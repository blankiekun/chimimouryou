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
 * local-sources.ts runs an extension's works as site `ext:<repo id>:<source id>`.
 *
 * The one index format supported: a JSON list of entries with name, id, baseUrl, apiUrl, lang,
 * itemType (0 manga, 1 anime, 2 novel), sourceCodeLanguage (0 Dart, 1 JS), version and
 * sourceCodeUrl (Mangayomi's index.json, novel_index.json and anime_index.json all look so).
 */

import { standalone } from '$lib/data/env';
import { openExtension, type ExtensionRuntime, type ExtensionSource } from './extension-runtime';
import { clean } from './sites/build';
import * as kakuyomu from './sites/kakuyomu';
import type { SiteDetails } from './sites/site';
import * as syosetu from './sites/syosetu';
import { sourceText } from './transport';
import { SourceError, type SourceRepo, type SourceRepoExtension } from './types';

export interface RepoRow {
  id: number;
  url: string;
  entries: ExtensionSource[];
  /** When the index was last read (ms) */
  fetched: number;
}

export interface ExtensionRow {
  repo: number;
  id: number;
  on: boolean;
  /** The pinned code and its SHA-256 (hex), from the index's version `version` */
  code: string;
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

async function sha256(code: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The repository's entries; a SourceError on field `url` when it isn't one. */
async function readIndex(url: string) {
  const host = httpsHost(url);
  if (!host) throw new SourceError('Use an address starting with https://.', 'url');
  let raw: unknown;
  try {
    raw = JSON.parse(await sourceText(url, { hosts: new Set([host]) }));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SourceError('Not a Mangayomi index (expected a JSON list).', 'url');
    }
    throw new SourceError((error as Error).message, 'url');
  }
  if (!Array.isArray(raw)) {
    throw new SourceError('Not a Mangayomi index (expected a JSON list).', 'url');
  }
  const entries = raw.filter(
    (entry): entry is ExtensionSource =>
      !!entry &&
      typeof entry === 'object' &&
      typeof entry.name === 'string' &&
      typeof entry.id === 'number' &&
      typeof entry.baseUrl === 'string'
  );
  if (!entries.length) {
    throw new SourceError('Not a Mangayomi index (no entries with name, id and baseUrl).', 'url');
  }
  return entries;
}

/** Why the app won't run the entry ('' = it can), and its tag. */
function verdict(entry: ExtensionSource): Pick<SourceRepoExtension, 'off' | 'tag'> {
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

/** Manga and novels only: anime (itemType 1) isn't listed. */
const listed = (entry: ExtensionSource) => entry.itemType === 0 || entry.itemType === 2;

function view(repo: RepoRow | undefined, entry: ExtensionSource, row?: ExtensionRow) {
  return {
    id: entry.id as number,
    site: repo ? `ext:${repo.id}:${entry.id}` : '',
    name: entry.name,
    lang: text(entry.lang),
    kind: entry.itemType === 0 ? 'manga' : 'novel',
    version: row?.version || text(entry.version),
    available: text(entry.version),
    installed: !!row?.code,
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
  const entries = await readIndex(url.trim());
  return { url: url.trim(), extensions: entries.filter(listed).map((e) => view(undefined, e)) };
}

/** Fetches the entry's code and pins it. */
async function install(repo: RepoRow, entry: ExtensionSource, on: boolean): Promise<ExtensionRow> {
  if (verdict(entry).off) throw new SourceError(`${entry.name}: ${verdict(entry).off}`);
  const url = text(entry.sourceCodeUrl);
  const code = await sourceText(url, { hosts: new Set([httpsHost(url)]) });
  return {
    repo: repo.id,
    id: entry.id as number,
    on,
    code,
    sha256: await sha256(code),
    version: text(entry.version)
  };
}

/** Saves the repository and installs the extensions `on` names. */
export async function addRepo(url: string, on: number[]) {
  const db = await store();
  url = url.trim();
  if ((await db.all<RepoRow>('repos')).some((r) => r.url === url)) {
    throw new SourceError('This repository is already added.', 'url');
  }
  const entries = await readIndex(url);
  // Code first, so a failed install leaves nothing half-saved.
  const draft: RepoRow = { id: 0, url, entries, fetched: Date.now() };
  const picked = entries.filter((e) => on.includes(e.id as number) && listed(e));
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

/** The index again when it is older than 10 min; a failure keeps the last one. */
async function fresh(repo: RepoRow, force = false): Promise<[RepoRow, string]> {
  if (!force && Date.now() - repo.fetched < INDEX_MS) return [repo, ''];
  try {
    const updated = { ...repo, entries: await readIndex(repo.url), fetched: Date.now() };
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
export async function setExtension(repoId: number, id: number, on: boolean) {
  const db = await store();
  const repo = await repoRow(repoId);
  const row = await db.one<ExtensionRow>('extensions', [repoId, id]);
  const entry = repo.entries.find((e) => e.id === id);
  if (!entry) throw new SourceError('The repository no longer lists this extension');
  if (row?.code) await db.put('extensions', { ...row, on });
  else if (on) await db.put('extensions', await install(repo, entry, true));
  if (!on) closeSite(`ext:${repoId}:${id}`);
  return getRepo(repoId);
}

/** Replaces the pinned code with the index's current version (the reader tapped Update). */
export async function updateExtension(repoId: number, id: number) {
  const db = await store();
  const [repo] = await fresh(await repoRow(repoId), true);
  const row = await db.one<ExtensionRow>('extensions', [repoId, id]);
  const entry = repo.entries.find((e) => e.id === id);
  if (!entry || !row) throw new SourceError('The repository no longer lists this extension');
  await db.put('extensions', await install(repo, entry, row.on));
  closeSite(`ext:${repoId}:${id}`);
  return getRepo(repoId);
}

/** Removes the repository and its extensions; works fetched through them stay in the library. */
export async function removeRepo(id: number) {
  const db = await store();
  for (const row of await db.all<ExtensionRow>('extensions')) {
    if (row.repo === id) {
      await db.remove('extensions', [row.repo, row.id]);
      closeSite(`ext:${row.repo}:${row.id}`);
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
      if (shown.on && shown.installed && !shown.off) {
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

async function start(site: string) {
  const [, repoId, sourceId] = site.split(':').map(Number);
  const db = await store();
  const repo = await repoRow(repoId);
  const row = await db.one<ExtensionRow>('extensions', [repoId, sourceId]);
  const entry = repo.entries.find((e) => e.id === sourceId);
  if (!row?.code || !entry) throw new SourceError('This extension isn’t installed');
  if (!row.on) throw new SourceError('This extension is switched off (Sources → Repositories)');
  if ((await sha256(row.code)) !== row.sha256) {
    throw new SourceError('This extension’s stored code is damaged: tap Update in its repository');
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
  } finally {
    current.users -= 1;
    // Calls overlap (a cover beside the details): only the last one out arms the timer.
    if (!current.users) current.timer = window.setTimeout(() => closeSite(site), IDLE_MS);
  }
}

export async function siteName(site: string) {
  const [, repoId, sourceId] = site.split(':').map(Number);
  const repo = await repoRow(repoId);
  const entry = repo.entries.find((e) => e.id === sourceId);
  if (!entry) throw new SourceError('No such source');
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
export async function chapter(site: string, n: number, found: SiteDetails) {
  const url = found.episodes?.[n - 1];
  const title = found.titles?.[n - 1] ?? '';
  if (!url) throw new SourceError(`Chapter ${n} is no longer listed`);
  if (found.kind === 'manga') {
    return use(site, async (runtime) => {
      const pages: Blob[] = [];
      for (const page of await runtime.pages(url)) {
        const image = await runtime.image(page.url, page.headers);
        pages.push(new Blob([image.body], { type: image.type }));
      }
      if (!pages.length) throw new SourceError('The chapter has no pages');
      return { title, item: url, pages };
    });
  }
  const html = await use(site, (runtime) => runtime.html(title, url));
  return { title, item: url, html: clean(html) };
}

/** An image of the source (a cover); only from hosts the extension may load images from. */
export async function image(site: string, url: string) {
  return use(site, (runtime) => runtime.image(url));
}
