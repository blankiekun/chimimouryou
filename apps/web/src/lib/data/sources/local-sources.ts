/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Sources on this device (standalone): server/import/sources/api.py in the browser, with the same
 * answers (types.ts), so the routes/sources/ pages work in both editions (server-sources.ts picks).
 * Works, their volumes, jobs, follows, servers and cached chapters live in IndexedDB
 * (`chimi-sources`). Fetched volumes go into this device's library as ordinary imported books
 * titled `<work> <n>` in the work's series; the open volume is re-imported under the same title, so
 * it keeps its id and with it the reader's place (database.upsertData). Jobs run one at a time
 * while the app is open; followed works are checked every `Check every` hours (Settings → Sources),
 * on Wi-Fi only when that is on and the browser can tell. Follows are shared as sources.json in the
 * reader's sync folder, each run by the device that made it (Sync, below).
 */

import { browser } from '$app/env';
import { standalone } from '$lib/data/env';
import { Capacitor } from '@capacitor/core';
import { openDB, type IDBPDatabase } from 'idb';
import { StorageKey } from '$lib/data/storage/storage-types';
import { database } from '$lib/data/store';
import { mangaElementHtml } from '$lib/data/manga/manga';
import loadEpub from '$lib/functions/file-loaders/epub/load-epub';
import loadCbz from '$lib/functions/file-loaders/cbz/load-cbz';
import type { LoadData } from '$lib/functions/file-loaders/types';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
import type { SyncFileStore } from '$lib/data/storage/handler/base-handler';
import { readerStore } from '$lib/data/sync/extras-sync';
import { syncJsonFile } from '$lib/data/sync/sync-files';
import { logger } from '$lib/data/logger';
import { cbz, epub, plan, VOLUME_SIZE } from './sites/build';
import * as kakuyomu from './sites/kakuyomu';
import * as opds from './sites/opds';
import { SiteMissing, type SiteDetails } from './sites/site';
import * as syosetu from './sites/syosetu';
import type { ExtensionRow, RepoRow } from './extensions';
import {
  connection,
  DEVICE_FOLLOWS,
  sourcesAutoUpdate$,
  sourcesCheckHours$,
  sourcesWifiOnly$
} from './sources-settings';
import { blobUrlCache } from '$lib/functions/blob-url-cache';
import { NeedsAppError, nativeFetch, pacing, sourceFetch } from './transport';
import {
  SourceError,
  type SourceFollow,
  type SourceJob,
  type SourceExtensionFeed,
  type SourceSearch,
  type SourceWork
} from './types';

const SITES = { syosetu, kakuyomu };
const MANGA_VOLUME_SIZE = 10;
const DETAILS_MS = 10 * 60 * 1000;
const RETRY_MS = 3600 * 1000;
const MAX_ACTIVE = 20;
const KEEP_DONE_MS = 7 * 24 * 3600 * 1000;
const ACTIVE = ['queued', 'fetching'];
/** Rough sizes for the free-space gate: a web novel chapter, a manga page, a whole file. */
const CHAPTER_BYTES = 30_000;
const PAGE_BYTES = 400_000;
const FILE_BYTES = 60_000_000;

interface WorkRow {
  id: number;
  site: string;
  workKey: string;
  url: string;
  title: string;
  authors: string;
  status: SourceWork['status'];
  chapters: number;
  updated: number;
  cover: string;
  kind: 'novel' | 'manga';
  per: 'volume' | 'chapter';
  volumeSize: number;
  /** A server's items by their lasting numbers (opds.itemKey), number n at n - 1 */
  itemKeys: string[];
}

interface VolumeRow {
  work: number;
  number: number;
  first: number;
  last: number;
  complete: boolean;
  /** The book's title in the library */
  title: string;
  /** Server edition (an extension's work): sent to the server's import queue */
  uploaded?: boolean;
}

interface JobRow extends Omit<SourceJob, 'title' | 'site' | 'siteName' | 'domain' | 'workId'> {
  work: number;
}

interface FollowRow {
  work: number;
  paused: boolean;
  state: SourceFollow['state'];
  detail: string;
  lastCheck: number | null;
  nextCheck: number | null;
  modified: number;
  /** Another device runs it (sources.json); missing = this one; '' = the next desktop or Android app */
  device?: string;
  deviceName?: string;
  /** The site's name from sources.json, for an extension this device doesn't have */
  siteName?: string;
}

/** A follow in sources.json; unfollows stay as `deleted`, so another device's copy can't revive it. */
interface SharedFollow {
  key: string;
  site: string;
  siteName: string;
  workKey: string;
  url: string;
  title: string;
  /** The device that checks it */
  device: string;
  deviceName: string;
  paused: boolean;
  modified: number;
  deleted?: boolean;
}

export type ServerRow = opds.ServerRow & { deleted?: boolean };

type Chapter =
  | { title: string; html: string; item?: string }
  | { title: string; item: string; file: File }
  | { title: string; item: string; pages: Blob[] };

interface Stores {
  works: WorkRow;
  volumes: VolumeRow;
  jobs: JobRow;
  follows: FollowRow;
  servers: ServerRow;
  chapters: Chapter & { work: number; n: number };
  shared: SharedFollow;
  repos: RepoRow;
  extensions: ExtensionRow;
}

let opened: Promise<IDBPDatabase> | undefined;

function db() {
  opened ??= openDB('chimi-sources', 3, {
    upgrade(base, version) {
      if (version < 1) {
        base
          .createObjectStore('works', { keyPath: 'id', autoIncrement: true })
          .createIndex('key', ['site', 'workKey'], { unique: true });
        base.createObjectStore('volumes', { keyPath: ['work', 'number'] });
        base.createObjectStore('jobs', { keyPath: 'id' });
        base.createObjectStore('follows', { keyPath: 'work' });
        base.createObjectStore('servers', { keyPath: 'id', autoIncrement: true });
        base.createObjectStore('chapters', { keyPath: ['work', 'n'] });
      }
      if (version < 2) base.createObjectStore('shared', { keyPath: 'key' });
      // Extension repositories (extensions.ts), this device only.
      if (version < 3) {
        base.createObjectStore('repos', { keyPath: 'id', autoIncrement: true });
        base.createObjectStore('extensions', { keyPath: ['repo', 'id'] });
      }
    }
  }).then(async (base) => {
    await keyRepos(base);
    return base;
  });
  return opened;
}

const REPO_KEYS_DONE = 'sourcesRepoKeys';

/**
 * One-time pass: extension sites were `ext:<this device's repo number>:<source>`, now
 * `ext:<repo key>:<source>` (extensions.ts repoKey), so devices name the same work alike. Every
 * step skips what is already done, so a pass cut off midway runs again safely; the flag only
 * saves the reads. (SHA-256 is async, so it can't run inside the upgrade transaction.)
 */
async function keyRepos(base: IDBPDatabase) {
  try {
    if (localStorage.getItem(REPO_KEYS_DONE)) return;
  } catch {
    // No storage: the pass runs on every open, finding nothing to do after the first.
  }
  const keys = new Map<number, string>();
  for (const repo of (await base.getAll('repos')) as RepoRow[]) {
    const key = repo.key || (await (await extensions()).repoKey(repo.url));
    if (!repo.key) await base.put('repos', { ...repo, key });
    keys.set(repo.id, key);
  }
  const rename = (site: string) => {
    const [, old, ...rest] = site.split(':');
    // A key is always 12 hex; a repo number never that long.
    const key = isExtension(site) && old.length !== 12 ? keys.get(Number(old)) : undefined;
    return key ? ['ext', key, ...rest].join(':') : site;
  };
  for (const work of (await base.getAll('works')) as WorkRow[]) {
    if (rename(work.site) !== work.site)
      await base.put('works', { ...work, site: rename(work.site) });
  }
  for (const entry of (await base.getAll('shared')) as SharedFollow[]) {
    const site = rename(entry.site);
    if (site === entry.site) continue;
    await base.put('shared', { ...entry, site, key: sharedKey(entry.device, site, entry.workKey) });
    await base.delete('shared', entry.key);
  }
  try {
    localStorage.setItem(REPO_KEYS_DONE, '1');
  } catch {
    // See above.
  }
}

export const all = async <K extends keyof Stores>(store: K) =>
  (await (await db()).getAll(store)) as Stores[K][];
export const one = async <K extends keyof Stores>(store: K, key: IDBValidKey) =>
  (await (await db()).get(store, key)) as Stores[K] | undefined;
export const put = async <K extends keyof Stores>(
  store: K,
  value: Omit<Stores[K], 'id'> | Stores[K]
) => (await db()).put(store, value);
export const remove = async (store: keyof Stores, key: IDBValidKey) =>
  (await db()).delete(store, key);

/** extensions.ts reads and writes its two stores through these. */
export const extensionStore = { all, one, put, remove };

const extensions = () => import('./extensions');
const isExtension = (site: string) => site.startsWith('ext:');

// Sites ---------------------------------------------------------------------------------------

interface Source {
  name: string;
  domain: string;
  server: opds.Server | null;
  coverHosts: Set<string>;
  /** An extension's images (covers) go through it */
  image?(url: string): Promise<{ body: ArrayBuffer }>;
  details(url: string): Promise<SiteDetails | opds.ServerDetails>;
  chapter(url: string, n: number, details: SiteDetails): Promise<Chapter>;
}

export async function source(site: string): Promise<Source> {
  if (site in SITES) {
    const adapter = SITES[site as keyof typeof SITES];
    return {
      name: adapter.NAME,
      domain: adapter.DOMAIN,
      server: null,
      coverHosts: adapter.COVER_HOSTS,
      details: adapter.details,
      chapter: adapter.chapter
    };
  }
  if (isExtension(site)) {
    const ext = await extensions();
    const { name, domain } = await ext.siteName(site);
    return {
      name,
      domain,
      server: null,
      coverHosts: new Set(),
      image: (url) => ext.image(site, url),
      details: (url) => ext.details(site, url),
      chapter: (url, n, found) => ext.chapter(site, n, found, url)
    };
  }
  const row = site.startsWith('opds:') ? await one('servers', Number(site.slice(5))) : undefined;
  if (!row || row.deleted) throw new SourceError('No such source');
  const server = new opds.Server(row);
  return {
    name: row.name,
    domain: server.domain,
    server,
    coverHosts: new Set(),
    details: (url) => server.details(url),
    chapter: (_, n, details) => server.chapter(n, details as opds.ServerDetails)
  };
}

const details = new Map<number, [number, SiteDetails | opds.ServerDetails]>();

const isPages = (work: WorkRow) =>
  (work.site.startsWith('opds:') || isExtension(work.site)) &&
  work.kind === 'manga' &&
  (work.per === 'chapter' || work.volumeSize > 1);

/** The site's details (kept 10 min), saved into the work. */
async function fetchDetails(work: WorkRow) {
  const cached = details.get(work.id);
  if (cached && Date.now() - cached[0] < DETAILS_MS) return cached[1];
  let found = await (await source(work.site)).details(work.url);
  let size = work.volumeSize || VOLUME_SIZE;
  let itemKeys = work.itemKeys;
  if ('mode' in found && found.mode === 'files') {
    // An entry keeps the number it got first; new ones get the next numbers (api.py _number_files).
    itemKeys = [...work.itemKeys];
    for (const item of found.items) {
      if (item && !itemKeys.includes(opds.itemKey(item))) itemKeys.push(opds.itemKey(item));
    }
    const byKey = new Map(found.items.map((item) => [item && opds.itemKey(item), item]));
    found = {
      ...found,
      items: itemKeys.map((key) => byKey.get(key) ?? null),
      chapters: itemKeys.length
    };
    size = 1;
  } else if ('mode' in found || (isExtension(work.site) && found.kind === 'manga')) {
    size = work.per === 'chapter' ? 1 : MANGA_VOLUME_SIZE;
  }
  details.set(work.id, [Date.now(), found]);
  await put('works', {
    ...work,
    title: found.title,
    authors: found.authors,
    status: found.status,
    chapters: found.chapters,
    updated: found.updated,
    cover: found.cover,
    kind: ('kind' in found && found.kind) || work.kind,
    volumeSize: size,
    itemKeys
  });
  return found;
}

/**
 * Page manga and extension works are numbered by list order: a chapter fetched before that moved
 * fails the job. `keys` = the chapters' lasting keys in the site's current order.
 */
function checkChapters(work: WorkRow, keys: (string | undefined)[], where = "server's") {
  work.itemKeys.forEach((key, i) => {
    if (key && keys[i] !== key) {
      throw new Error(
        `The ${where} chapter list changed at Ch. ${i + 1}, so nothing was replaced; the volumes in the library stay as they are`
      );
    }
  });
}

async function workRow(id: number) {
  const work = await one('works', id);
  if (!work) throw new SourceError('No such work');
  return work;
}

async function workFor(site: string, workKey: string, url: string) {
  const found = (await (await db()).getFromIndex('works', 'key', [site, workKey])) as
    | WorkRow
    | undefined;
  if (found) return found;
  const id = (await put('works', {
    site,
    workKey,
    url,
    title: '',
    authors: '',
    status: 'ongoing',
    chapters: 0,
    updated: 0,
    cover: '',
    kind: 'novel',
    per: 'volume',
    volumeSize: VOLUME_SIZE,
    itemKeys: []
  })) as number;
  return workRow(id);
}

async function inLibrary(volume: VolumeRow | undefined) {
  // Sent to the server's import queue: this device can't see Calibre's copy.
  if (volume?.uploaded) return true;
  return !!volume && !!(await database.getDataByTitle(volume.title));
}

async function workJson(work: WorkRow, found?: SiteDetails): Promise<SourceWork> {
  const site = await source(work.site);
  const follow = await one('follows', work.id);
  const volumes = (await all('volumes')).filter((v) => v.work === work.id);
  const jobs = (await all('jobs')).filter((j) => j.work === work.id && ACTIVE.includes(j.state));
  const fetching = new Set(jobs.flatMap((j) => j.volumes));
  const shown = [];
  for (const volume of plan(work.chapters, work.volumeSize || VOLUME_SIZE)) {
    const row = volumes.find((v) => v.number === volume.number);
    const has = await inLibrary(row);
    shown.push({ ...volume, inLibrary: has, pending: !has && fetching.has(volume.number) });
  }
  return {
    id: work.id,
    site: work.site,
    siteName: site.name,
    domain: site.domain,
    interval: site.server ? pacing.server : pacing.site,
    workKey: work.workKey,
    url: work.url,
    title: work.title,
    authors: work.authors,
    status: work.status,
    chapters: work.chapters,
    updated: work.updated,
    summary: found?.summary ?? '',
    latest: found?.latest ?? [],
    volumeSize: work.volumeSize || VOLUME_SIZE,
    volumes: shown,
    checkHours: sourcesCheckHours$.getValue(),
    following: !!follow,
    paused: !!follow?.paused,
    cover: !!work.cover,
    kind: work.kind,
    per: work.per,
    perChoice: isPages(work) && !volumes.length && !jobs.length ? MANGA_VOLUME_SIZE : null,
    server: site.server ? site.server.row.id : null,
    files: !!site.server && !isPages(work),
    elsewhere: follow && !runsHere(follow) ? follow.deviceName || 'another device' : ''
  };
}

async function show(work: WorkRow) {
  let found: SiteDetails | undefined;
  try {
    found = await fetchDetails(work);
  } catch (error) {
    // Never fetched: nothing to show.
    if (!work.title) throw error;
  }
  return workJson(await workRow(work.id), found);
}

/** A new work the site turns out not to have doesn't stay as an empty row. */
async function showNew(work: WorkRow) {
  try {
    return await show(work);
  } catch (error) {
    if (!work.title && !(await all('jobs')).some((j) => j.work === work.id)) {
      await remove('works', work.id);
    }
    throw error;
  }
}

export async function lookUpWork(url: string) {
  for (const [site, adapter] of Object.entries(SITES)) {
    const found = adapter.parseUrl(url);
    if (found) return showNew(await workFor(site, ...found));
  }
  throw new SourceError('Not a link to a work on a supported site (Syosetu, Kakuyomu)');
}

export async function getWork(id: number) {
  return show(await workRow(id));
}

export async function resolveWork(site: string, workKey: string) {
  if (isExtension(site)) return showNew(await workFor(site, workKey, workKey));
  if (site.startsWith('opds:')) {
    const { server } = await source(site);
    const key = opds.workKey(server!.row.type, server!.url(workKey));
    return showNew(await workFor(site, key, server!.url(key)));
  }
  if (!(site in SITES)) throw new SourceError('No such site');
  return showNew(await workFor(site, workKey, SITES[site as keyof typeof SITES].workUrl(workKey)));
}

// Search and covers ---------------------------------------------------------------------------

export async function marks(site: string, keys: string[]) {
  const works = (await all('works')).filter((w) => w.site === site && keys.includes(w.workKey));
  const follows = new Set((await all('follows')).map((f) => f.work));
  const volumes = await all('volumes');
  const out = new Map<string, { inLibrary: boolean; following: boolean }>();
  for (const work of works) {
    let has = false;
    for (const volume of volumes.filter((v) => v.work === work.id)) {
      if (await inLibrary(volume)) has = true;
    }
    out.set(work.workKey, { inLibrary: has, following: follows.has(work.id) });
  }
  return out;
}

export async function browseSite(
  site: string,
  kind: 'search' | 'popular' | 'latest',
  page: number,
  q = ''
): Promise<SourceSearch> {
  const adapter = SITES[site as keyof typeof SITES];
  if (!adapter) throw new SourceError('No such site');
  const found = kind === 'search' ? await adapter.search(q, page) : await adapter[kind](page);
  const marked = await marks(
    site,
    found.works.map((w) => w.workKey)
  );
  return {
    site,
    siteName: adapter.NAME,
    domain: adapter.DOMAIN,
    order: adapter.SEARCH_ORDER,
    total: found.total,
    page,
    more: found.more,
    works: found.works.map((w) => ({
      ...w,
      inLibrary: !!marked.get(w.workKey)?.inLibrary,
      following: !!marked.get(w.workKey)?.following
    }))
  };
}

/** Images as blob: URLs (the CSP allows no other hosts); the last 200 are kept. */
const cachedImage = blobUrlCache(200);
const imageUrl = (key: string, get: () => Promise<{ body: ArrayBuffer }>) =>
  cachedImage(key, async () => new Blob([(await get()).body]));

/** The work's cover (from a host its site names, or its server). */
export async function coverSrc(workId: number) {
  const work = await workRow(workId);
  const site = await source(work.site);
  if (!work.cover) throw new Error('No cover');
  return imageUrl(`cover:${work.id}:${work.cover}`, () =>
    site.server
      ? site.server.get(site.server.url(work.cover))
      : site.image
        ? site.image(work.cover)
        : sourceFetch(work.cover, { hosts: site.coverHosts })
  );
}

/** A page of an extension's popular or latest works, or a search. */
export async function browseExtension(
  site: string,
  mode: 'popular' | 'latest' | 'search',
  page: number,
  q = ''
): Promise<SourceExtensionFeed> {
  const ext = await extensions();
  const { name, kind } = await ext.siteName(site);
  const found = await ext.browse(site, mode, page, q);
  const marked = await marks(
    site,
    found.list.map((w) => w.link)
  );
  return {
    site,
    name,
    kind,
    page,
    more: found.hasNextPage,
    works: found.list.map((w) => ({
      title: w.name,
      workKey: w.link,
      cover: w.imageUrl,
      inLibrary: !!marked.get(w.link)?.inLibrary,
      following: !!marked.get(w.link)?.following
    }))
  };
}

/** A browse cover of an extension (a host it may load images from, else it fails). */
export async function extensionImageSrc(site: string, url: string) {
  const ext = await extensions();
  return imageUrl(`ext:${site}:${url}`, () => ext.image(site, url));
}

/** An image on the server (a browse cover). */
export async function serverImageSrc(id: number, href: string) {
  const { server } = await source(`opds:${id}`);
  return imageUrl(`server:${id}:${href}`, () => server!.get(server!.url(href)));
}

// Free space ----------------------------------------------------------------------------------

/** About how much the volumes take, and whether this device has room for them. */
export async function spaceFor(work: SourceWork, numbers: number[]) {
  const chapters = work.volumes
    .filter((v) => numbers.includes(v.number))
    .reduce((sum, v) => sum + v.last - v.first + 1, 0);
  const bytes =
    chapters * (work.files ? FILE_BYTES : work.kind === 'manga' ? 20 * PAGE_BYTES : CHAPTER_BYTES);
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  const free = estimate?.quota ? estimate.quota - (estimate.usage ?? 0) : null;
  return { bytes, free, fits: free === null || bytes <= free };
}

// Jobs ----------------------------------------------------------------------------------------

async function jobJson(job: JobRow): Promise<SourceJob> {
  const work = await workRow(job.work);
  const site = await source(work.site).catch(() => ({ name: work.site, domain: '' }));
  const { work: workId, ...rest } = job;
  return {
    ...rest,
    workId,
    title: work.title,
    site: work.site,
    siteName: site.name,
    domain: site.domain
  };
}

export async function addVolumes(workId: number, numbers: number[], per?: 'volume' | 'chapter') {
  let work = await workRow(workId);
  if (per && per !== work.per) {
    if (!isPages(work)) throw new SourceError('This work comes as whole files');
    if (!(await workJson(work)).perChoice) {
      throw new SourceError(`Some of it is already here: it stays one CBZ per ${work.per}`);
    }
    work = { ...work, per, volumeSize: per === 'chapter' ? 1 : MANGA_VOLUME_SIZE };
    await put('works', work);
    details.delete(work.id);
  }
  const shown = await workJson(work);
  const wanted = shown.volumes.filter(
    (v) => numbers.includes(v.number) && !v.inLibrary && !v.pending
  );
  if (!wanted.length) throw new SourceError('Those volumes are already here or on their way');
  if (
    !(
      await spaceFor(
        shown,
        wanted.map((v) => v.number)
      )
    ).fits
  ) {
    throw new SourceError('Not enough space on this device for them');
  }
  if ((await all('jobs')).filter((j) => ACTIVE.includes(j.state)).length >= MAX_ACTIVE) {
    throw new SourceError('Too many works waiting to be fetched; try again later');
  }
  const now = Date.now();
  const job: JobRow = {
    id: crypto.randomUUID(),
    work: workId,
    kind: 'add',
    volumes: wanted.map((v) => v.number),
    unit: shown.files ? 'volumes' : 'chapters',
    done: 0,
    total: wanted.reduce((sum, v) => sum + v.last - v.first + 1, 0),
    state: 'queued',
    error: '',
    failedAt: null,
    created: now,
    updated: now
  };
  await put('jobs', job);
  wake();
  return { job: await jobJson(job) };
}

export async function getQueue() {
  const jobs = (await all('jobs')).sort((a, b) => b.created - a.created);
  for (const job of jobs.filter(
    (j) => j.state === 'done' && j.updated < Date.now() - KEEP_DONE_MS
  )) {
    await remove('jobs', job.id);
  }
  return {
    jobs: await Promise.all(
      jobs
        .filter((j) => !(j.state === 'done' && j.updated < Date.now() - KEEP_DONE_MS))
        .map(jobJson)
    ),
    interval: pacing.site
  };
}

async function setState(
  id: string,
  allowed: string[],
  state: SourceJob['state'],
  fields: Partial<JobRow> = {}
) {
  const job = await one('jobs', id);
  if (!job || !allowed.includes(job.state)) return null;
  const changed = { ...job, ...fields, state, updated: Date.now() };
  await put('jobs', changed);
  return changed;
}

export async function retryJob(id: string) {
  const job = await setState(id, ['failed', 'cancelled'], 'queued', { error: '' });
  if (!job) throw new SourceError('Only a failed or cancelled job can be retried');
  wake();
  return { job: await jobJson(job) };
}

export async function cancelJob(id: string) {
  const job = await setState(id, ACTIVE, 'cancelled');
  if (!job) throw new SourceError('Only a waiting or running job can be cancelled');
  return { job: await jobJson(job) };
}

export async function removeJob(id: string) {
  const job = await one('jobs', id);
  if (!job) throw new SourceError('No such job');
  if (ACTIVE.includes(job.state)) throw new SourceError('Cancel the job first');
  await remove('jobs', id);
  // Chapters cached for it go too, unless another job of the work still needs them.
  if (!(await all('jobs')).some((j) => j.work === job.work && j.state !== 'done')) {
    for (const chapter of await all('chapters')) {
      if (chapter.work === job.work) await remove('chapters', [chapter.work, chapter.n]);
    }
  }
  return {};
}

// Follows -------------------------------------------------------------------------------------

async function followJson(follow: FollowRow): Promise<SourceFollow> {
  const work = await workRow(follow.work);
  const site = await source(work.site).catch(() => ({
    name: follow.siteName || work.site,
    domain: ''
  }));
  const jobs = (await all('jobs')).filter((j) => j.work === work.id && ACTIVE.includes(j.state));
  let volumes = 0;
  for (const volume of (await all('volumes')).filter((v) => v.work === work.id)) {
    if (await inLibrary(volume)) volumes += 1;
  }
  return {
    workId: work.id,
    title: work.title,
    site: work.site,
    siteName: site.name,
    domain: site.domain,
    chapters: work.chapters,
    volumes,
    paused: follow.paused,
    state: jobs.length ? 'checking' : follow.state,
    detail: follow.detail,
    lastCheck: follow.lastCheck,
    nextCheck: follow.nextCheck,
    modified: follow.modified,
    cover: !!work.cover,
    elsewhere: runsHere(follow) ? '' : follow.deviceName || 'another device'
  };
}

/** Another device's follows of its servers: listed with Unfollow only (server ids are per device). */
async function sharedServerFollows(): Promise<SourceFollow[]> {
  const me = deviceId();
  return (await all('shared'))
    .filter((e) => e.site.startsWith('opds:') && e.device !== me && !e.deleted)
    .map((e) => ({
      workId: 0,
      shared: e.key,
      title: e.title,
      site: e.site,
      siteName: e.siteName,
      domain: '',
      chapters: 0,
      volumes: 0,
      paused: e.paused,
      state: '',
      detail: '',
      lastCheck: null,
      nextCheck: null,
      modified: e.modified,
      cover: false,
      elsewhere: e.deviceName || 'another device'
    }));
}

export async function getFollowing() {
  pullSources();
  const follows = [
    ...(await Promise.all((await all('follows')).map(followJson))),
    ...(await sharedServerFollows())
  ];
  return {
    follows: follows.sort((a, b) => a.title.localeCompare(b.title)),
    checkHours: sourcesCheckHours$.getValue()
  };
}

/** Follows the work, or pauses/resumes it; a new follow is checked at once. */
export async function followWork(workId: number, paused = false) {
  await workRow(workId);
  const old = await one('follows', workId);
  await put('follows', {
    state: '',
    detail: '',
    lastCheck: null,
    nextCheck: null,
    ...old,
    work: workId,
    paused,
    modified: Date.now()
  });
  await share(workId);
  await markDeviceFollows();
  if (!paused) await queueDueChecks(Date.now(), true);
  return { follow: await followJson((await one('follows', workId))!) };
}

export async function unfollowWork(workId: number) {
  const follow = await one('follows', workId);
  if (!follow) throw new SourceError('Not following that work');
  await remove('follows', workId);
  await share(workId, follow);
  await markDeviceFollows();
  return {};
}

/** Unfollows another device's server follow: a `deleted` entry in sources.json, applied there. */
export async function unfollowShared(key: string) {
  const entry = await one('shared', key);
  if (!entry || entry.deleted) throw new SourceError('Not following that work');
  await put('shared', { ...entry, deleted: true, modified: Date.now() });
  clearTimeout(sharedTimer);
  sharedTimer = setTimeout(syncSources, 2000);
  return {};
}

/** Server edition: whether the root layout starts the timer (only extension works follow here). */
async function markDeviceFollows() {
  const any = (await all('follows')).some(runsHere);
  try {
    if (any) localStorage.setItem(DEVICE_FOLLOWS, '1');
    else localStorage.removeItem(DEVICE_FOLLOWS);
  } catch {
    // Without storage the server edition checks only while a Sources page is open.
  }
}

/** Check now: every unpaused follow (or the one work) at once, on mobile data too. */
export async function checkNow(workId?: number) {
  const follows = (await all('follows')).filter(
    (f) => !f.paused && runsHere(f) && (workId === undefined || f.work === workId)
  );
  if (workId !== undefined && !follows.length) {
    throw new SourceError('Not following that work, or it is paused');
  }
  for (const follow of follows) await put('follows', { ...follow, nextCheck: null });
  await queueDueChecks(Date.now(), true);
  return getFollowing();
}

/**
 * One update job per work with a due, unpaused follow and no job under way. On mobile data with
 * Wi-Fi only on, due follows wait (state wifi) unless `now` is a Check now.
 */
export async function queueDueChecks(now: number, asked = false) {
  const jobs = await all('jobs');
  const busy = new Set(jobs.filter((j) => ACTIVE.includes(j.state)).map((j) => j.work));
  const waitForWifi = !asked && sourcesWifiOnly$.getValue() && connection() === 'mobile';
  let queued = 0;
  for (const follow of await all('follows')) {
    if (
      follow.paused ||
      !runsHere(follow) ||
      (follow.nextCheck !== null && follow.nextCheck > now) ||
      busy.has(follow.work)
    ) {
      continue;
    }
    if (waitForWifi) {
      if (follow.state !== 'wifi') {
        await put('follows', {
          ...follow,
          state: 'wifi',
          detail: 'Waiting for Wi-Fi: on mobile data now'
        });
      }
      continue;
    }
    // A failed check goes on from the chapter it stopped at.
    const old = jobs
      .filter(
        (j) =>
          j.work === follow.work && j.kind === 'update' && ['failed', 'cancelled'].includes(j.state)
      )
      .sort((a, b) => b.created - a.created)[0];
    await put(
      'jobs',
      old
        ? { ...old, state: 'queued', error: '', updated: Date.now() }
        : {
            id: crypto.randomUUID(),
            work: follow.work,
            kind: 'update',
            volumes: [],
            unit: 'chapters',
            done: 0,
            total: 0,
            state: 'queued',
            error: '',
            failedAt: null,
            created: Date.now(),
            updated: Date.now()
          }
    );
    await put('follows', {
      ...follow,
      nextCheck: now + sourcesCheckHours$.getValue() * 3600 * 1000
    });
    queued += 1;
  }
  if (queued) wake();
}

async function followResult(workId: number, state: SourceFollow['state'], detail: string) {
  const follow = await one('follows', workId);
  if (!follow) return;
  const now = Date.now();
  await put('follows', {
    ...follow,
    state,
    detail,
    lastCheck: now,
    nextCheck: now + (state === 'failed' ? RETRY_MS : sourcesCheckHours$.getValue() * 3600 * 1000)
  });
}

// The runner ----------------------------------------------------------------------------------

/** Chapter n, from the cache or the site (then cached). */
async function chapter(work: WorkRow, found: SiteDetails, n: number): Promise<Chapter> {
  const cached = await one('chapters', [work.id, n]);
  if (cached) return cached;
  const fetched = await (await source(work.site)).chapter(work.url, n, found);
  if ('item' in fetched && fetched.item && !work.itemKeys[n - 1]) {
    work.itemKeys[n - 1] = fetched.item;
    await put('works', { ...(await workRow(work.id)), itemKeys: work.itemKeys });
  }
  await put('chapters', { ...fetched, work: work.id, n });
  return fetched;
}

/** The volume's book: an EPUB of the chapters, a server's file as it came, or its pages. */
async function volumeBook(
  work: WorkRow,
  number: number,
  chapters: Chapter[],
  series: string
): Promise<LoadData> {
  const title = `${series} ${number}`;
  const now = Date.now();
  const [first] = chapters;
  let data: LoadData;
  if ('file' in first) {
    data = first.file.name.endsWith('.epub')
      ? await loadEpub(first.file, document, now)
      : await loadCbz(new File([first.file], `${title}.cbz`), now);
  } else if ('pages' in first) {
    const blobs: Record<string, Blob> = {};
    chapters.forEach(
      (c, i) =>
        'pages' in c &&
        c.pages.forEach((page, p) => {
          blobs[
            `${String(i + 1).padStart(4, '0')}-${String(p + 1).padStart(4, '0')}.${page.type.split('/')[1]}`
          ] = page;
        })
    );
    const names = Object.keys(blobs);
    data = {
      title,
      styleSheet: '',
      elementHtml: mangaElementHtml(names),
      blobs,
      coverImage: blobs[names[0]],
      hasThumb: true,
      characters: names.length,
      lastBookModified: now,
      lastBookOpen: 0
    };
  } else {
    const file = await epub({
      title,
      authors: work.authors,
      series,
      seriesIndex: number,
      identifier: `chimi:${work.site}:${work.workKey}:${number}`,
      chapters: chapters.map((c) => ({ title: c.title, xhtml: 'html' in c ? c.html : '' }))
    });
    data = await loadEpub(file, document, now);
  }
  return { ...data, title, series, seriesIndex: number };
}

/**
 * The series a volume is saved under: `<work>`, or `<work> (<site name>)` when a book that isn't
 * this work's already has the title (another work of that name, or the reader's own import).
 * Titles are identities: a saved volume keeps its title (VolumeRow), and a work keeps the form its
 * first saved volume got.
 */
async function volumeSeries(work: WorkRow, number: number) {
  const mine = (await all('volumes')).filter((v) => v.work === work.id && !v.uploaded);
  const saved = mine.find((v) => v.number === number);
  if (saved) return saved.title.slice(0, saved.title.lastIndexOf(' '));
  const suffixed = `${work.title} (${(await source(work.site)).name})`;
  if (mine.some((v) => v.title.startsWith(`${suffixed} `))) return suffixed;
  if (mine.some((v) => v.title.startsWith(`${work.title} `))) return work.title;
  return (await database.getDataByTitle(`${work.title} ${number}`)) ? suffixed : work.title;
}

/** Into this device's library; the same title replaces the book in place (same id, same place). */
async function saveVolume(book: LoadData) {
  const { getStorageHandler } = await import('$lib/data/storage/storage-handler-factory');
  const handler = getStorageHandler(
    window,
    StorageKey.BROWSER,
    undefined,
    true,
    true,
    ReplicationSaveBehavior.Overwrite
  );
  handler.startContext({ title: book.title, imagePath: book.coverImage || '' });
  await handler.saveBook(book, false);
  if (book.coverImage) await handler.saveCover(book.coverImage);
  database.dataListChanged$.next(handler);
}

/**
 * Server edition (extension works): the volume as an EPUB or CBZ into the server's import queue,
 * like an upload from Import; Calibre adds it with the series from the file.
 */
async function uploadVolume(work: WorkRow, number: number, chapters: Chapter[]) {
  const title = `${work.title} ${number}`;
  // chimi:ext:<repo key>:<source>:<work>:<n>: the import service replaces the book carrying it.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(work.workKey));
  const workHash = [...new Uint8Array(digest).slice(0, 6)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const identifier = `chimi:${work.site}:${workHash}:${number}`;
  const file = chapters.some((c) => 'pages' in c)
    ? await cbz({
        title,
        authors: work.authors,
        series: work.title,
        number,
        pages: chapters.flatMap((c) => ('pages' in c ? [c.pages] : []))
      })
    : await epub({
        title,
        authors: work.authors,
        series: work.title,
        seriesIndex: number,
        identifier,
        chapters: chapters.map((c) => ({ title: c.title, xhtml: 'html' in c ? c.html : '' }))
      });
  const { uploadToCalibre } = await import('$lib/data/remote/calibre-import');
  await uploadToCalibre(file, undefined, {
    identifier,
    title,
    authors: work.authors,
    series: work.title,
    seriesIndex: String(number)
  });
  return title;
}

/** (volumes an update fetches, new chapters): the open volume here and every one after it. */
async function updatePlan(work: WorkRow, planned: Map<number, { first: number; last: number }>) {
  const kept = new Map<number, VolumeRow>();
  for (const volume of (await all('volumes')).filter((v) => v.work === work.id)) {
    if (await inLibrary(volume)) kept.set(volume.number, volume);
  }
  const size = work.volumeSize || VOLUME_SIZE;
  const last = kept.size ? kept.get(Math.max(...kept.keys())) : undefined;
  let start: number;
  let have: number;
  if (!last) {
    // Nothing here yet: start where the reader's picked add began, when it failed.
    const picked = (await all('jobs'))
      .filter(
        (j) => j.work === work.id && j.kind === 'add' && ['failed', 'cancelled'].includes(j.state)
      )
      .flatMap((j) => j.volumes)
      .filter((n) => planned.has(n));
    start = picked.length ? Math.min(...picked) : 1;
    have = planned.has(start) ? planned.get(start)!.first - 1 : 0;
  } else {
    start = last.number + (last.last - last.first + 1 >= size ? 1 : 0);
    have = last.last;
  }
  const numbers = [...planned.entries()]
    .filter(([n, v]) => n >= start && !(kept.has(n) && kept.get(n)!.last >= v.last))
    .map(([n]) => n)
    .sort((a, b) => a - b);
  return { numbers, fresh: Math.max(0, work.chapters - have) };
}

const volumesText = (n: number[]) =>
  n.length === 1 ? `Vol. ${n[0]}` : `Vol. ${n[0]}–${n[n.length - 1]}`;

class ChapterError extends Error {
  constructor(
    public chapter: number,
    message: string
  ) {
    super(message);
  }
}

async function cancelled(id: string) {
  return (await one('jobs', id))?.state !== 'fetching';
}

async function runJob(job: JobRow) {
  details.delete(job.work);
  const found = await fetchDetails(await workRow(job.work));
  if (job.kind === 'update') await claim(job.work);
  const work = await workRow(job.work);
  if ('mode' in found && found.mode === 'pages') {
    checkChapters(
      work,
      found.items.map((item) => (item ? opds.itemKey(item) : undefined))
    );
  } else if (isExtension(work.site)) {
    checkChapters(work, (found as SiteDetails).episodes ?? [], "extension's");
  }
  const size = work.volumeSize || VOLUME_SIZE;
  const planned = new Map(plan(work.chapters, size).map((v) => [v.number, v]));
  let remaining: number[];
  let fresh = 0;
  if (job.kind === 'update') {
    const update = await updatePlan(work, planned);
    fresh = update.fresh;
    const resumed = job.volumes.filter((n) => planned.has(n));
    remaining = resumed.length
      ? [...new Set([...resumed, ...update.numbers.filter((n) => n > Math.max(...resumed))])].sort(
          (a, b) => a - b
        )
      : update.numbers;
    if (!remaining.length) {
      await remove('jobs', job.id);
      await followResult(work.id, 'current', '');
      return;
    }
    job = {
      ...job,
      volumes: remaining,
      done: 0,
      total: remaining.reduce((sum, n) => sum + planned.get(n)!.last - planned.get(n)!.first + 1, 0)
    };
  } else {
    remaining = [...job.volumes];
    if (remaining.some((n) => !planned.has(n))) {
      throw new SiteMissing(`Vol. ${Math.max(...remaining)} is no longer on the site`);
    }
    const left = remaining.reduce(
      (sum, n) => sum + planned.get(n)!.last - planned.get(n)!.first + 1,
      0
    );
    job = { ...job, done: Math.max(0, job.total - left) };
  }
  await put('jobs', job);
  const updated = [...remaining];
  for (const number of [...remaining]) {
    const volume = planned.get(number)!;
    const chapters: Chapter[] = [];
    for (let n = volume.first; n <= volume.last; n += 1) {
      if (await cancelled(job.id)) return;
      try {
        chapters.push(await chapter(work, found, n));
      } catch (error) {
        if (error instanceof NeedsAppError) throw error;
        throw new ChapterError(
          n,
          `Chapter ${n}: ${error instanceof Error ? error.message : error}`
        );
      }
      job = {
        ...((await one('jobs', job.id)) ?? job),
        done: Math.min(job.total, job.done + 1),
        updated: Date.now()
      };
      await put('jobs', job);
    }
    const complete = volume.last - volume.first + 1 >= size;
    // Server edition: only extension works run here, and their volumes go to Calibre.
    const uploaded = !standalone && isExtension(work.site);
    let title: string;
    if (uploaded) {
      title = await uploadVolume(work, number, chapters);
    } else {
      const book = await volumeBook(work, number, chapters, await volumeSeries(work, number));
      await saveVolume(book);
      title = book.title;
    }
    await put('volumes', {
      work: work.id,
      number,
      first: volume.first,
      last: volume.last,
      complete,
      title,
      ...(uploaded && { uploaded })
    });
    if (complete) {
      for (let n = volume.first; n <= volume.last; n += 1) await remove('chapters', [work.id, n]);
    }
    remaining.splice(remaining.indexOf(number), 1);
    job = { ...((await one('jobs', job.id)) ?? job), volumes: [...remaining], updated: Date.now() };
    await put('jobs', job);
  }
  await setState(job.id, ['fetching'], 'done');
  if (job.kind === 'update') {
    await followResult(
      work.id,
      'new',
      `${fresh} new chapter${fresh === 1 ? '' : 's'}, added to ${volumesText(updated)}`
    );
  }
}

let running: Promise<void> | undefined;

/** Runs every queued job, oldest first, one at a time (resolves when the queue is empty). */
export function runQueued() {
  running ??= (async () => {
    try {
      for (;;) {
        const job = (await all('jobs'))
          .filter((j) => j.state === 'queued')
          .sort((a, b) => a.created - b.created)[0];
        if (!job) return;
        const started = await setState(job.id, ['queued'], 'fetching');
        if (!started) continue;
        try {
          await runJob(started);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await setState(job.id, ['fetching'], 'failed', {
            error: message,
            failedAt: error instanceof ChapterError ? error.chapter : null
          });
          if (job.kind === 'update') {
            const state =
              error instanceof NeedsAppError
                ? 'app'
                : error instanceof SiteMissing && !(error instanceof ChapterError)
                  ? 'removed'
                  : 'failed';
            await followResult(job.work, state, message);
            if (state === 'app') await release(job.work);
          }
        }
      }
    } finally {
      running = undefined;
    }
  })();
  return running;
}

function wake() {
  if (browser) runQueued().catch(() => undefined);
}

let timer: ReturnType<typeof setInterval> | undefined;

/** Jobs a closed tab left fetching go on from their cached chapters. */
async function resumeJobs() {
  for (const job of (await all('jobs')).filter((j) => j.state === 'fetching')) {
    await put('jobs', { ...job, state: 'queued' });
  }
}

let resumed: Promise<void> | undefined;

/** Server edition: extension works' jobs run here while a Sources page is open. */
export function resumeDeviceJobs() {
  resumed ??= resumeJobs().then(wake, () => undefined);
  return resumed;
}

/** The timer while the app is open (root layout, standalone): due follows, then the queue. */
export function startLocalSources() {
  if (timer || !browser) return;
  const tick = () => {
    pullSources(SHARED_FRESH_MS * 15);
    if (sourcesAutoUpdate$.getValue()) queueDueChecks(Date.now()).catch(() => undefined);
    wake();
  };
  resumeJobs().then(tick, () => undefined);
  timer = setInterval(tick, 60 * 1000);
}

// Sync (sources.json) -----------------------------------------------------------------------------

const SHARED_FRESH_MS = 60 * 1000;
let sharedSyncedAt = 0;
let sharedTimer: ReturnType<typeof setTimeout> | undefined;
let sharedQueue = Promise.resolve();

/** Random per browser or app install (like immersion-log's). */
function deviceId() {
  try {
    let id = localStorage.getItem('sourcesDevice');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('sourcesDevice', id);
    }
    return id;
  } catch {
    return 'device';
  }
}

/** How other devices name this one: "Followed in the desktop app; updates there" (board 5s). */
function deviceName() {
  if ('chimiDesktop' in globalThis) return 'the desktop app';
  if (Capacitor.isNativePlatform()) return 'the Android app';
  return 'a browser';
}

/** A follow no device here can fetch for: released to the next desktop or Android app. */
const RELEASED = '';
const RELEASED_NAME = 'the desktop or Android app';

const runsHere = (follow: FollowRow) =>
  follow.device === undefined ||
  follow.device === deviceId() ||
  (follow.device === RELEASED && nativeFetch());

/** A plain browser that needs the app hands the follow on (a server's numbers stay per device). */
async function release(workId: number) {
  const follow = await one('follows', workId);
  const work = await one('works', workId);
  if (!follow || !work || nativeFetch() || work.site.startsWith('opds:')) return;
  await put('follows', {
    ...follow,
    device: RELEASED,
    deviceName: RELEASED_NAME,
    modified: Date.now()
  });
  await share(workId);
  await markDeviceFollows();
}

/** The desktop or Android app takes a released follow once it could fetch the work. */
async function claim(workId: number) {
  const follow = await one('follows', workId);
  if (follow?.device !== RELEASED) return;
  await put('follows', {
    ...follow,
    device: undefined,
    deviceName: undefined,
    modified: Date.now()
  });
  await share(workId);
  await markDeviceFollows();
}

/** A server's number is this device's own, so its works are keyed by the device too. */
const sharedKey = (device: string, site: string, workKey: string) =>
  site.startsWith('opds:') ? `${device} ${site} ${workKey}` : `${site} ${workKey}`;

/** The newer entry; on a tie the unfollow, so both devices end the same. */
const newer = (a: SharedFollow, b?: SharedFollow) =>
  !b || a.modified > b.modified || (a.modified === b.modified && !!a.deleted && !b.deleted);

const sameShared = (a?: SharedFollow, b?: SharedFollow) =>
  !!a && !!b && a.modified === b.modified && !!a.deleted === !!b.deleted && a.device === b.device;

async function sharedEntry(work: WorkRow, follow: FollowRow, deleted = false) {
  const device = follow.device ?? deviceId();
  return {
    key: sharedKey(device, work.site, work.workKey),
    site: work.site,
    siteName: (await source(work.site).catch(() => ({ name: follow.siteName || work.site }))).name,
    workKey: work.workKey,
    url: work.url,
    title: work.title,
    device,
    deviceName: follow.deviceName ?? deviceName(),
    paused: follow.paused,
    modified: deleted ? Date.now() : follow.modified,
    ...(deleted && { deleted })
  };
}

/** Records a follow, pause or unfollow (`removed`: the follow that went) for sources.json. */
export async function share(workId: number, removed?: FollowRow) {
  const work = await one('works', workId);
  const follow = removed ?? (await one('follows', workId));
  if (!work || !follow) return;
  await put('shared', await sharedEntry(work, follow, !!removed));
  clearTimeout(sharedTimer);
  sharedTimer = setTimeout(syncSources, 2000);
}

/** sources.json: malformed follows are dropped; undefined when `follows` isn't a list. */
export function parseSourcesFile(raw: any): { follows: SharedFollow[] } | undefined {
  if (!Array.isArray(raw?.follows)) return undefined;
  return {
    follows: raw.follows.filter(
      (f: any) =>
        ['key', 'site', 'workKey', 'url', 'title', 'device', 'deviceName'].every(
          (field) => typeof f?.[field] === 'string'
        ) && typeof f.modified === 'number'
    )
  };
}

/** Downloads unless synced within `fresh` ms. */
function pullSources(fresh = SHARED_FRESH_MS) {
  if (browser && Date.now() - sharedSyncedAt >= fresh) syncSources();
}

export function syncSources(): Promise<void> {
  sharedQueue = sharedQueue.then(async () => {
    try {
      const store = await readerStore();
      if (store) await syncSourcesWith(store);
    } catch (error: any) {
      logger.warn(`Sources sync failed: ${error.message}`);
    }
  });
  return sharedQueue;
}

/**
 * Merges sources.json with this device's follows (the newer entry per work wins) and applies it:
 * another device's follows of the built-in sites are listed here and never checked here; its
 * server follows stay in the file only.
 */
export async function syncSourcesWith(store: SyncFileStore) {
  const me = deviceId();
  // Follows from before sources.json, or never shared.
  for (const follow of await all('follows')) {
    const work = await one('works', follow.work);
    if (work && !(await one('shared', sharedKey(follow.device ?? me, work.site, work.workKey)))) {
      await put('shared', await sharedEntry(work, follow));
    }
  }
  await syncJsonFile(store, 'sources.json', undefined, parseSourcesFile, async (file) => {
    const remote = new Map((file?.follows ?? []).map((f) => [f.key, f]));
    const merged = new Map((await all('shared')).map((f) => [f.key, f]));
    for (const entry of remote.values()) {
      if (newer(entry, merged.get(entry.key))) {
        merged.set(entry.key, entry);
        await put('shared', entry);
      }
    }
    for (const entry of merged.values()) {
      if (entry.site.startsWith('opds:') && entry.device !== me) continue;
      // Built-in sites and extensions name a work alike on every device (a server's numbers don't).
      const work =
        (entry.site in SITES || isExtension(entry.site)) && !entry.deleted
          ? await workFor(entry.site, entry.workKey, entry.url)
          : ((await (await db()).getFromIndex('works', 'key', [entry.site, entry.workKey])) as
              | WorkRow
              | undefined);
      if (!work) continue;
      if (!work.title) await put('works', { ...work, title: entry.title });
      const follow = await one('follows', work.id);
      if (entry.deleted) {
        if (follow && follow.modified <= entry.modified) await remove('follows', work.id);
      } else if (!follow || follow.modified < entry.modified) {
        const device = entry.device === me ? undefined : entry.device;
        await put('follows', {
          state: '',
          detail: '',
          lastCheck: null,
          nextCheck: null,
          ...follow,
          // Taken over by another device (or released): this device's last result no longer applies.
          ...(follow && follow.device !== device && { state: '', detail: '' }),
          work: work.id,
          paused: entry.paused,
          modified: entry.modified,
          device,
          deviceName: entry.device === me ? undefined : entry.deviceName,
          siteName: entry.siteName
        });
      }
    }
    await markDeviceFollows();
    const changed = [...merged.values()].some((f) => !sameShared(f, remote.get(f.key)));
    return changed ? { follows: [...merged.values()] } : undefined;
  });
  sharedSyncedAt = Date.now();
}
