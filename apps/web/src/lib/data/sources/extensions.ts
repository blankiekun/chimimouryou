/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Extension repositories on this device: a Mangayomi index.json a reader added, its JS extensions
 * switched on or off, each installed extension's code pinned by SHA-256. Kept in `chimi-sources`
 * (repos, extensions) in both editions, never synced. Code is fetched only at install and when the
 * reader taps Update; the runtime only ever gets the stored code, checked against its pin.
 * local-sources.ts runs an extension's works as site `ext:<repo key>:<source id>`, the key being
 * `repoKey` of the index address, so every device that adds the same index names them alike.
 *
 * Index formats: a JSON list of Mangayomi entries with name, id, baseUrl, apiUrl, lang, itemType
 * (0 manga, 1 anime, 2 novel), sourceCodeLanguage (0 Dart, 1 JS), version and sourceCodeUrl
 * (Mangayomi's index.json, novel_index.json and anime_index.json all look so), or a JSON list of
 * Manatan v2 packages (manga.min.json, novel.min.json: `extensionType: "manatan2"`, a string id,
 * packageUrl relative to the index, sha256 and size of the `.manatan2` zip, the manifest with its
 * sources and `permissions`). A Manatan package is pinned by the index's SHA-256 like JS code and
 * runs with the manifest inside the pinned zip; one package can hold several sources, each its own
 * site. Manatan extensions run only with native fetch (desktop and Android apps).
 * A Mihon/Tachiyomi repository is its index.pb (mihon-index.ts): each extension is a jar the
 * desktop app downloads and pins (mihon.js), its sources run in the app's JVM host
 * (mihon-runtime.ts); source ids are 64-bit decimal strings, as on Android later.
 */

import { standalone } from '$lib/data/env';
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import {
  allowedHosts,
  openExtension,
  openManatan,
  type ExtensionRuntime,
  type ExtensionSource,
  type ManatanSource
} from './extension-runtime';
import { readMihonIndex, type MihonEntry } from './mihon-index';
import { mihonHost, openMihon } from './mihon-runtime';
import { clean } from './sites/build';
import * as kakuyomu from './sites/kakuyomu';
import type { SiteDetails } from './sites/site';
import * as syosetu from './sites/syosetu';
import { NeedsAppError, nativeFetch, notInstalledMessage, sourceFetch } from './transport';
import { SourceError, type SourceRepo, type SourceRepoExtension } from './types';

export interface RepoRow {
  id: number;
  /** repoKey(url); missing on rows from before keys until local-sources' one-time pass */
  key: string;
  url: string;
  entries: ExtensionSource[];
  /** A Mihon index.pb (else a JSON index) and its signing key (the Android host checks apks against it) */
  format?: 'mihon';
  signingKey?: string;
  /** When the index was last read (ms) */
  fetched: number;
}

export interface ExtensionRow {
  repo: number;
  /** The Mangayomi source id, or the Manatan package id */
  id: number | string;
  on: boolean;
  /** The pinned code (JS, or a Manatan package's zip; '' for a Mihon jar, kept by the desktop app) and its SHA-256 (hex), from the index's version `version` */
  code: string | ArrayBuffer;
  sha256: string;
  version: string;
}

interface Store {
  all<T>(store: 'repos' | 'extensions'): Promise<T[]>;
  one<T>(store: 'repos' | 'extensions', key: IDBValidKey): Promise<T | undefined>;
  put(store: 'repos' | 'extensions', value: unknown): Promise<IDBValidKey>;
  remove(store: 'repos' | 'extensions', key: IDBValidKey): Promise<void>;
}

const INDEX_MS = 10 * 60 * 1000;
const IDLE_MS = 60 * 1000;
const BUILT_IN = new Set([...kakuyomu.HOSTS, ...syosetu.HOSTS]);
const local = () => import('./local-sources');
const store = async () => (await local()).extensionStore as Store;

const text = (value: unknown) =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

function httpsHost(url: unknown) {
  try {
    const parsed = new URL(text(url));
    return parsed.protocol === 'https:' ? parsed.hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

async function sha256(code: string | ArrayBuffer) {
  const data = typeof code === 'string' ? new TextEncoder().encode(code) : code;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The repository's entries; a SourceError on field `url` when it isn't one. */
async function readIndex(url: string): Promise<Pick<RepoRow, 'entries' | 'format' | 'signingKey'>> {
  const host = httpsHost(url);
  if (!host) throw new SourceError('Use an address starting with https://.', 'url');
  let raw: unknown;
  try {
    const { body } = await sourceFetch(url, { hosts: new Set([host]) });
    const start = new Uint8Array(body.slice(0, 2));
    if (/\.pb$/i.test(new URL(url).pathname) || (start[0] === 0x1f && start[1] === 0x8b)) {
      const store = await readMihonIndex(body);
      if (!store.entries.length) {
        // shortcut: a store that keeps its list at another address (field 102) isn't followed.
        throw new SourceError('No extensions in this index.pb.', 'url');
      }
      // A Mihon entry's sites live in its `sources`, not baseUrl (isMihon tells them apart).
      return {
        entries: store.entries as unknown as ExtensionSource[],
        format: 'mihon',
        signingKey: store.signingKey
      };
    }
    raw = JSON.parse(new TextDecoder().decode(body));
  } catch (error) {
    if (error instanceof SourceError) throw error;
    if (error instanceof SyntaxError) {
      throw new SourceError('Not an extension index (expected a JSON list).', 'url');
    }
    throw new SourceError((error as Error).message, 'url');
  }
  if (
    raw &&
    typeof raw === 'object' &&
    (raw as { extensionType?: unknown }).extensionType === 'manatan2'
  ) {
    throw new SourceError(
      'This is the list of Manatan indexes: add manga.min.json or novel.min.json from the same folder.',
      'url'
    );
  }
  if (!Array.isArray(raw)) {
    throw new SourceError('Not an extension index (expected a JSON list).', 'url');
  }
  const entries = raw.filter(
    (entry): entry is ExtensionSource =>
      !!entry &&
      typeof entry === 'object' &&
      typeof entry.name === 'string' &&
      (isManatan(entry)
        ? typeof entry.id === 'string'
        : typeof entry.id === 'number' && typeof entry.baseUrl === 'string')
  );
  if (!entries.length) {
    if (
      raw.some((entry) => entry && typeof entry === 'object' && 'apk' in entry && 'pkg' in entry)
    ) {
      throw new SourceError(mihonMessage, 'url');
    }
    throw new SourceError('Not an extension index (no entries with name, id and baseUrl).', 'url');
  }
  return { entries };
}

/** A repository's name in site ids and identifiers: 12 hex of the SHA-256 of its index address. */
export async function repoKey(url: string) {
  return (await sha256(new URL(url).href)).slice(0, 12);
}

const mihonMessage = 'This is an old Mihon/Tachiyomi index: add index.pb from the same folder.';

/** `ext:<repo key>:<source id>` → its parts; the id stays a string (Manatan ids are names). */
function siteParts(site: string) {
  const [, key, sourceId] = site.split(':');
  return { key, sourceId };
}

const extSite = (repo: RepoRow, sourceId: number | string) => `ext:${repo.key}:${sourceId}`;

const isManatan = (entry: Record<string, unknown>) => entry.extensionType === 'manatan2';
const isMihon = (entry: Record<string, unknown>): entry is MihonEntry =>
  entry.extensionType === 'mihon';
/** The extensions-lib versions the host runs (Mihon's ExtensionLoader takes 1.4-1.6 too). */
const MIHON_LIBS = new Set(['1.4', '1.5', '1.6']);
/** The server's identifier check takes source ids of this shape (service.py EXT_IDENTIFIER). */
const MANATAN_ID = /^[a-z0-9-]{1,40}$/;

/** A Manatan package's manga and novel sources, from its index entry or its manifest. */
function manatanSources(entry: Record<string, unknown>) {
  const manifest = (entry.manifest ?? entry) as Record<string, unknown>;
  return (Array.isArray(manifest.sources) ? manifest.sources : []).filter(
    (source): source is ManatanSource =>
      !!source &&
      typeof source.id === 'string' &&
      MANATAN_ID.test(source.id) &&
      typeof source.name === 'string' &&
      (source.contentType === 'manga' || source.contentType === 'novel')
  );
}

const manifestOf = (entry: ExtensionSource) =>
  (entry.manifest && typeof entry.manifest === 'object' ? entry.manifest : {}) as Record<
    string,
    any
  >;

/** The entry (Mangayomi source or Manatan package) that holds the site's source. */
const entryFor = (repo: RepoRow, sourceId: string) =>
  repo.entries.find((e) =>
    isManatan(e)
      ? manatanSources(e).some((source) => source.id === sourceId)
      : isMihon(e)
        ? e.sources.some((source) => source.id === sourceId)
        : String(e.id) === sourceId
  );

function mihonVerdict(entry: MihonEntry): Pick<SourceRepoExtension, 'off' | 'tag'> {
  const tag = entry.contentWarning === 3 ? '18+' : '';
  if (!MIHON_LIBS.has(entry.lib)) return { off: 'Made for another Mihon version.', tag };
  if (entry.sources.length && entry.sources.every((s) => BUILT_IN.has(httpsHost(s.baseUrl)))) {
    return { off: 'The built-in source is used instead.', tag: 'Built in' };
  }
  if (!entry.sources.length) return { off: 'No source this app can run.', tag };
  if (!httpsHost(entry.jarUrl)) return { off: 'The index gives no desktop (jar) build.', tag };
  return { off: '', tag };
}

function manatanVerdict(entry: ExtensionSource): Pick<SourceRepoExtension, 'off' | 'tag'> {
  const manifest = manifestOf(entry);
  const permissions = (manifest.permissions ?? {}) as Record<string, any>;
  if (manifest.apiVersion !== 2) return { off: 'Made for another Manatan version.', tag: '' };
  if (permissions.webview) {
    return { off: 'Needs a web view (Cloudflare): can’t run in this app.', tag: 'Web view' };
  }
  if (Array.isArray(permissions.services) && permissions.services.length) {
    return { off: 'Needs host services this app doesn’t offer.', tag: '' };
  }
  const allow = allowedHosts(permissions.network?.allow);
  if ([...BUILT_IN].some((host) => allow.has(host))) {
    return { off: 'The built-in source is used instead.', tag: 'Built in' };
  }
  if (!manatanSources(entry).length) return { off: 'No source this app can run.', tag: '' };
  if (typeof entry.packageUrl !== 'string' || typeof entry.sha256 !== 'string') {
    return { off: 'The index gives no package address.', tag: '' };
  }
  return { off: '', tag: '' };
}

/** Why the app won't run the entry ('' = it can), and its tag. */
function verdict(entry: ExtensionSource): Pick<SourceRepoExtension, 'off' | 'tag'> {
  if (isManatan(entry)) return manatanVerdict(entry);
  if (isMihon(entry)) return mihonVerdict(entry);
  if (entry.sourceCodeLanguage !== 1) {
    return { off: 'Dart extension: can’t run in a browser.', tag: 'Dart' };
  }
  if ([entry.baseUrl, entry.apiUrl].some((url) => BUILT_IN.has(httpsHost(url)))) {
    return { off: 'The built-in source is used instead.', tag: 'Built in' };
  }
  if (!httpsHost(entry.baseUrl)) return { off: 'Its site isn’t on https.', tag: '' };
  if (!httpsHost(entry.sourceCodeUrl))
    return { off: 'The index gives no https code address.', tag: '' };
  return { off: '', tag: '' };
}

/** Manga and novels only: anime (itemType 1) and video aren't listed. */
const listed = (entry: ExtensionSource) =>
  isMihon(entry) ||
  (isManatan(entry)
    ? entry.contentType === 'manga' || entry.contentType === 'novel'
    : entry.itemType === 0 || entry.itemType === 2);

/** Mihon extensions are manga (keiyoushi has no novels). */
const kindOf = (entry: ExtensionSource) =>
  isMihon(entry) || (isManatan(entry) ? entry.contentType === 'manga' : entry.itemType === 0)
    ? 'manga'
    : 'novel';

function view(repo: RepoRow | undefined, entry: ExtensionSource, row?: ExtensionRow) {
  const id = entry.id as number | string;
  const first = isManatan(entry)
    ? manatanSources(entry)[0]?.id
    : isMihon(entry)
      ? entry.sources[0]?.id
      : id;
  return {
    id,
    site: repo && first !== undefined ? extSite(repo, first) : '',
    name: entry.name,
    lang: text(entry.lang),
    kind: kindOf(entry),
    appOnly: isManatan(entry) || isMihon(entry),
    version: row?.version || text(entry.version),
    available: text(entry.version),
    installed: !!row?.sha256,
    on: !!row?.on,
    ...verdict(entry)
  } satisfies SourceRepoExtension;
}

function repoJson(repo: RepoRow, rows: ExtensionRow[], error = ''): SourceRepo {
  const extensions = repo.entries.filter(listed).map((entry) =>
    view(
      repo,
      entry,
      rows.find((r) => r.repo === repo.id && r.id === entry.id)
    )
  );
  return {
    id: repo.id,
    url: repo.url,
    name: new URL(repo.url).hostname,
    extensions,
    updates: extensions.filter((e) => e.installed && !e.off && e.available !== e.version).length,
    error
  };
}

/** The repository's extensions as Add a source lists them, without saving anything. */
export async function lookUpRepo(url: string) {
  const { entries } = await readIndex(url.trim());
  return { url: url.trim(), extensions: entries.filter(listed).map((e) => view(undefined, e)) };
}

/** Fetches the entry's code and pins it (a Manatan package: only if it matches the index). */
async function install(repo: RepoRow, entry: ExtensionSource, on: boolean): Promise<ExtensionRow> {
  if (verdict(entry).off) throw new SourceError(`${entry.name}: ${verdict(entry).off}`);
  if (isMihon(entry)) {
    const host = mihonHost();
    if (!host) throw new NeedsAppError(httpsHost(repo.url));
    // The desktop app downloads the jar and keeps it under its SHA-256 (the pin); trust on first use.
    const { sha256: pin } = await host.install(entry.jarUrl);
    return { repo: repo.id, id: entry.id, on, code: '', sha256: pin, version: entry.version };
  }
  if (isManatan(entry) && !nativeFetch()) throw new NeedsAppError(httpsHost(repo.url));
  const url = isManatan(entry)
    ? new URL(text(entry.packageUrl), repo.url).href
    : text(entry.sourceCodeUrl);
  if (!httpsHost(url)) throw new SourceError(`${entry.name}: the index gives no https address`);
  const { body } = await sourceFetch(url, { hosts: new Set([httpsHost(url)]) });
  const code = isManatan(entry) ? body : new TextDecoder().decode(body);
  const pin = await sha256(code);
  if (
    isManatan(entry) &&
    (pin !== text(entry.sha256).toLowerCase() ||
      (typeof entry.size === 'number' && entry.size !== body.byteLength))
  ) {
    throw new SourceError(`${entry.name}: the package doesn’t match its index (SHA-256)`);
  }
  return {
    repo: repo.id,
    id: entry.id as number | string,
    on,
    code,
    sha256: pin,
    version: text(entry.version)
  };
}

/** Saves the repository and installs the extensions `on` names. */
export async function addRepo(url: string, on: (number | string)[]) {
  const db = await store();
  url = url.trim();
  if ((await db.all<RepoRow>('repos')).some((r) => r.url === url)) {
    throw new SourceError('This repository is already added.', 'url');
  }
  const index = await readIndex(url);
  const { entries } = index;
  // Code first, so a failed install leaves nothing half-saved.
  const draft: RepoRow = { id: 0, key: await repoKey(url), url, ...index, fetched: Date.now() };
  const picked = entries.filter((e) => on.includes(e.id as number | string) && listed(e));
  const rows = [];
  for (const entry of picked) rows.push(await install(draft, entry, true));
  const { id: _, ...unsaved } = draft;
  const id = (await db.put('repos', unsaved)) as number;
  for (const row of rows) await db.put('extensions', { ...row, repo: id });
  return repoJson(
    { ...draft, id },
    rows.map((row) => ({ ...row, repo: id }))
  );
}

async function repoRow(id: number) {
  const repo = await (await store()).one<RepoRow>('repos', id);
  if (!repo) throw new SourceError('No such repository');
  return repo;
}

/** The repository a site names; on another device's follow it may not be added here. */
async function siteRepo(site: string) {
  const { key, sourceId } = siteParts(site);
  const repo = (await (await store()).all<RepoRow>('repos')).find((r) => r.key === key);
  if (!repo) throw new SourceError(notInstalledMessage);
  return { repo, sourceId, entry: entryFor(repo, sourceId) };
}

/** Every site of the entry: a Mangayomi source, or each source of a Manatan package. */
const sitesOf = (repo: RepoRow, entry: ExtensionSource) =>
  isManatan(entry)
    ? manatanSources(entry).map((source) => extSite(repo, source.id))
    : isMihon(entry)
      ? entry.sources.map((source) => extSite(repo, source.id))
      : [extSite(repo, entry.id as number)];

/** The index again when it is older than 10 min; a failure keeps the last one. */
async function fresh(repo: RepoRow, force = false): Promise<[RepoRow, string]> {
  if (!force && Date.now() - repo.fetched < INDEX_MS) return [repo, ''];
  try {
    const updated = { ...repo, ...(await readIndex(repo.url)), fetched: Date.now() };
    await (await store()).put('repos', updated);
    return [updated, ''];
  } catch (error) {
    return [repo, (error as Error).message];
  }
}

export async function listRepos() {
  const db = await store();
  const rows = await db.all<ExtensionRow>('extensions');
  const repos = [];
  for (const row of await db.all<RepoRow>('repos')) {
    const [repo, error] = await fresh(row);
    repos.push(repoJson(repo, rows, error));
  }
  return { repos };
}

export async function getRepo(id: number) {
  const [repo, error] = await fresh(await repoRow(id), true);
  return repoJson(repo, await (await store()).all<ExtensionRow>('extensions'), error);
}

/** Switches an extension on (installing it the first time) or off (its code stays). */
export async function setExtension(repoId: number, id: number | string, on: boolean) {
  const db = await store();
  const repo = await repoRow(repoId);
  const row = await db.one<ExtensionRow>('extensions', [repoId, id]);
  const entry = repo.entries.find((e) => e.id === id);
  if (!entry) throw new SourceError('The repository no longer lists this extension');
  if (row?.sha256) await db.put('extensions', { ...row, on });
  else if (on) await db.put('extensions', await install(repo, entry, true));
  if (!on) sitesOf(repo, entry).forEach(closeSite);
  return getRepo(repoId);
}

/** Replaces the pinned code with the index's current version (the reader tapped Update). */
export async function updateExtension(repoId: number, id: number | string) {
  const db = await store();
  const [repo] = await fresh(await repoRow(repoId), true);
  const row = await db.one<ExtensionRow>('extensions', [repoId, id]);
  const entry = repo.entries.find((e) => e.id === id);
  if (!entry || !row) throw new SourceError('The repository no longer lists this extension');
  await db.put('extensions', await install(repo, entry, row.on));
  sitesOf(repo, entry).forEach(closeSite);
  return getRepo(repoId);
}

/** Removes the repository and its extensions; works fetched through them stay in the library. */
export async function removeRepo(id: number) {
  const db = await store();
  const repo = await repoRow(id);
  for (const row of await db.all<ExtensionRow>('extensions')) {
    if (row.repo === id) {
      await db.remove('extensions', [row.repo, row.id]);
      const entry = repo.entries.find((e) => e.id === row.id);
      (entry ? sitesOf(repo, entry) : [extSite(repo, row.id)]).forEach(closeSite);
    }
  }
  await db.remove('repos', id);
  return {};
}

/** Switched-on, installed extensions (Browse's source list). */
export async function extensionSites() {
  const db = await store();
  const rows = await db.all<ExtensionRow>('extensions');
  const sites = [];
  for (const repo of await db.all<RepoRow>('repos')) {
    for (const entry of repo.entries.filter(listed)) {
      const shown = view(
        repo,
        entry,
        rows.find((r) => r.repo === repo.id && r.id === entry.id)
      );
      if (!shown.on || !shown.installed || shown.off) continue;
      if (isManatan(entry)) {
        for (const source of manatanSources(entry)) {
          const kind = source.contentType as 'manga' | 'novel';
          sites.push({ site: extSite(repo, source.id), name: source.name, kind, repo: repo.url });
        }
      } else if (isMihon(entry)) {
        for (const source of entry.sources) {
          const name = entry.sources.length > 1 ? `${source.name} (${source.lang})` : source.name;
          sites.push({
            site: extSite(repo, source.id),
            name,
            kind: 'manga' as const,
            repo: repo.url
          });
        }
      } else {
        sites.push({ site: shown.site, name: shown.name, kind: shown.kind, repo: repo.url });
      }
    }
  }
  return sites;
}

// Running an extension ------------------------------------------------------------------------

const running = new Map<
  string,
  { runtime: Promise<ExtensionRuntime>; timer?: number; users: number }
>();

function closeSite(site: string) {
  const open = running.get(site);
  if (!open) return;
  running.delete(site);
  clearTimeout(open.timer);
  open.runtime.then((r) => r.close()).catch(() => undefined);
}

/** The pinned package's wasm and the source as its own manifest.json describes it. */
async function unpack(zip: ArrayBuffer, entry: ExtensionSource, sourceId: string) {
  const reader = new ZipReader(new BlobReader(new Blob([zip])));
  try {
    const files = await reader.getEntries();
    const read = async (name: string) => {
      const file = files.find((f) => f.filename === name);
      if (!file || file.directory || !file.getData) {
        throw new SourceError(`${entry.name}: the package has no ${name}`);
      }
      return file.getData(new Uint8ArrayWriter());
    };
    const manifest = JSON.parse(new TextDecoder().decode(await read('manifest.json')));
    const source = manatanSources(manifest).find((s) => s.id === sourceId);
    if (manifest.id !== entry.id || !source || typeof manifest.wasm !== 'string') {
      throw new SourceError(`${entry.name}: the package doesn’t match its index`);
    }
    const wasm = await read(manifest.wasm);
    return {
      wasm: wasm.buffer as ArrayBuffer,
      source,
      allow: manifest.permissions?.network?.allow
    };
  } finally {
    await reader.close();
  }
}

async function start(site: string) {
  const { repo, sourceId, entry } = await siteRepo(site);
  const db = await store();
  const row = entry && (await db.one<ExtensionRow>('extensions', [repo.id, entry.id as string]));
  if (!row?.sha256 || !entry) throw new SourceError(notInstalledMessage);
  if (!row.on) throw new SourceError('This extension is switched off (Sources → Repositories)');
  if (isMihon(entry)) {
    // The desktop app re-hashes the jar against the pin before it loads it.
    if (!mihonHost()) throw new NeedsAppError(httpsHost(repo.url));
    return openMihon(row.sha256, sourceId);
  }
  if ((await sha256(row.code)) !== row.sha256) {
    throw new SourceError('This extension’s stored code is damaged: tap Update in its repository');
  }
  if (typeof row.code !== 'string') {
    if (!nativeFetch()) throw new NeedsAppError(httpsHost(repo.url));
    const { wasm, source, allow } = await unpack(row.code, entry, sourceId);
    return openManatan(wasm, source, allow);
  }
  // The server edition's proxy checks the hosts against the repository itself.
  return openExtension(row.code, entry, standalone ? undefined : repo.url);
}

/** Runs fn with the site's extension, opened once and closed after a minute with no call. */
async function use<T>(site: string, fn: (runtime: ExtensionRuntime) => Promise<T>) {
  let open = running.get(site);
  if (!open) {
    const opened = { runtime: start(site), users: 0 };
    running.set(site, opened);
    opened.runtime.catch(() => running.get(site) === opened && running.delete(site));
    open = opened;
  }
  const current = open;
  clearTimeout(current.timer);
  current.users += 1;
  try {
    return await fn(await current.runtime);
  } catch (error) {
    // A crashed or stopped runtime opens afresh next time.
    if ((await current.runtime.catch(() => null))?.stopped) closeSite(site);
    throw error;
  } finally {
    current.users -= 1;
    // Calls overlap (a cover beside the details): only the last one out arms the timer.
    if (!current.users) current.timer = window.setTimeout(() => closeSite(site), IDLE_MS);
  }
}

export async function siteName(site: string) {
  const { repo, sourceId, entry } = await siteRepo(site);
  if (!entry) throw new SourceError('No such source');
  if (isManatan(entry)) {
    const source = manatanSources(entry).find((s) => s.id === sourceId)!;
    const kind = source.contentType as 'manga' | 'novel';
    return { name: source.name, domain: httpsHost((source as { baseUrl?: string }).baseUrl), kind };
  }
  if (isMihon(entry)) {
    const source = entry.sources.find((s) => s.id === sourceId)!;
    return { name: source.name, domain: httpsHost(source.baseUrl), kind: 'manga' as const };
  }
  return { name: entry.name, domain: httpsHost(entry.baseUrl), kind: view(repo, entry).kind };
}

/** Popular, latest or a search: one page of works. */
export async function browse(
  site: string,
  mode: 'popular' | 'latest' | 'search',
  page: number,
  q = ''
) {
  return use(site, (runtime) =>
    mode === 'search' ? runtime.search(q, page) : runtime[mode](page)
  );
}

const ONGOING = new Set([0, 2, 5]);

function day(value: string) {
  const ms = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

/** The work as a site adapter's details; chapters in reading order, their addresses in `episodes`. */
export async function details(site: string, url: string): Promise<SiteDetails> {
  const { kind } = await siteName(site);
  const found = await use(site, (runtime) => runtime.detail(url));
  // Mangayomi lists chapters newest first.
  const chapters = [...found.chapters].reverse();
  const dates = chapters.map((c) => day(c.dateUpload));
  return {
    title: found.name || url,
    authors: found.author || found.artist,
    status: ONGOING.has(found.status) ? 'ongoing' : 'finished',
    chapters: chapters.length,
    short: false,
    summary: found.description,
    updated: Math.max(0, ...dates),
    latest: chapters
      .map((c, i) => ({
        n: i + 1,
        title: c.name,
        date: dates[i] ? new Date(dates[i]).toISOString().slice(0, 10) : ''
      }))
      .slice(-3)
      .reverse(),
    cover: found.imageUrl,
    episodes: chapters.map((c) => c.url),
    titles: chapters.map((c) => c.name),
    kind
  };
}

/** Chapter n: its text (novels) or its page images (manga), with its address as the item. */
export async function chapter(site: string, n: number, found: SiteDetails, work: string) {
  const url = found.episodes?.[n - 1];
  const title = found.titles?.[n - 1] ?? '';
  if (!url) throw new SourceError(`Chapter ${n} is no longer listed`);
  if (found.kind === 'manga') {
    return use(site, async (runtime) => {
      const pages = await runtime.chapterPages(url, work);
      if (!pages.length) throw new SourceError('The chapter has no pages');
      return { title, item: url, pages };
    });
  }
  const html = await use(site, (runtime) => runtime.html(title, url, work));
  return { title, item: url, html: clean(html) };
}

/** An image of the source (a cover); only from hosts the extension may load images from. */
export async function image(site: string, url: string) {
  return use(site, (runtime) => runtime.image(url));
}
