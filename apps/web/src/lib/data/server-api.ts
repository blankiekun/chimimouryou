/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The server's /api/v1 (server/api/service.py): the version check, the catalog (cached in
 * IndexedDB, then only its changes), a mirror of this account's reading data (`GET /sync`, kept
 * per server and account so readers on a shared browser never see each other's rows) and the row
 * writes with their 409 rule (an older `modified` than the server's is refused with its row).
 * Not part of upstream.
 */

import { openDB } from 'idb';
import { accountReady } from '$lib/data/account';
import type { CalibreBook } from '$lib/data/calibre';
import { serverBase, serverFetch } from '$lib/data/server-connect';

/** A row of `GET /api/v1/sync` (server/api/service.py `row_json`). */
export interface SyncRow {
  book?: number;
  dateKey?: string;
  goalStart?: string;
  hid?: string;
  kind?: string;
  name?: string;
  series?: string;
  size?: number;
  progress?: number;
  deleted?: boolean;
  data?: any;
  modified: number;
  rev: number;
}

const tables = [
  'progress',
  'statistics',
  'goals',
  'highlights',
  'bookDocs',
  'accountDocs',
  'games',
  'series',
  'metadata'
] as const;

export type SyncTable = (typeof tables)[number];

export type Mirror = { rev: number } & Record<SyncTable, SyncRow[]>;

/** A catalog entry as the API sends it (`book_json`). */
interface ApiBook extends Omit<CalibreBook, 'id' | 'bookId'> {
  id: number;
  calibreId: number;
  key: string;
  originalTitle: string;
  deleted: boolean;
  rev: number;
}

const keyOf: Record<SyncTable, (row: Partial<SyncRow>) => string> = {
  progress: (row) => `${row.book}`,
  statistics: (row) => `${row.book}/${row.dateKey}`,
  goals: (row) => `${row.goalStart}`,
  highlights: (row) => `${row.book}/${row.hid}`,
  bookDocs: (row) => `${row.book}/${row.kind}`,
  accountDocs: (row) => `${row.kind}`,
  games: (row) => `${row.name}`,
  series: (row) => `${row.book}`,
  metadata: (row) => `${row.book}`
};

/** Write paths and the row they write, so a written row goes into the mirror. */
const writePaths: [RegExp, SyncTable, (match: RegExpMatchArray) => Partial<SyncRow>][] = [
  [/^books\/(\d+)\/progress$/, 'progress', (m) => ({ book: +m[1] })],
  [/^books\/(\d+)\/statistics\/([^/]+)$/, 'statistics', (m) => ({ book: +m[1], dateKey: m[2] })],
  [
    /^books\/(\d+)\/highlights\/([^/]+)$/,
    'highlights',
    (m) => ({ book: +m[1], hid: decodeURIComponent(m[2]) })
  ],
  [/^books\/(\d+)\/docs\/(\w+)$/, 'bookDocs', (m) => ({ book: +m[1], kind: m[2] })],
  [/^docs\/(\w+)$/, 'accountDocs', (m) => ({ kind: m[1] })],
  [/^goals\/([^/]+)$/, 'goals', (m) => ({ goalStart: m[1] })],
  [/^series\/(\d+)$/, 'series', (m) => ({ book: +m[1] })],
  [/^metadata\/(\d+)$/, 'metadata', (m) => ({ book: +m[1] })],
  [
    /^games\/([^/?]+)\?modified=(\d+)$/,
    'games',
    (m) => ({ name: decodeURIComponent(m[1]), modified: +m[2] })
  ]
];

function apiFetch(path: string, init: RequestInit = {}) {
  return serverFetch(`/api/v1/${path}`, { cache: 'no-store', ...init });
}

async function httpError(response: Response) {
  const message = (await response.json().catch(() => ({})))?.error;
  // Full disk and too large keep the server's words: the reader can act on them.
  const keep = (response.status === 507 || response.status === 413) && typeof message === 'string';

  return Object.assign(
    new Error(keep ? message : `Server request failed (HTTP ${response.status})`),
    { status: response.status }
  );
}

let version: Promise<void> | undefined;

/**
 * Resolves when the server speaks this app's API (asked once per page load; failures aren't
 * kept). An older server (no /api/v1) or a newer API is refused with a message (status 426);
 * offline the fetch's TypeError passes through.
 */
export function apiVersion() {
  version ??= apiFetch('version')
    .then(async (response) => {
      const api = response.ok ? (await response.json().catch(() => ({})))?.api : undefined;

      if (api === 1) return;

      throw Object.assign(
        new Error(
          typeof api === 'number' && api > 1
            ? 'This server is newer than the app: update the app.'
            : 'This server is older than the app: it needs the /api/v1 update.'
        ),
        { status: 426 }
      );
    })
    .catch((error) => {
      version = undefined;
      throw error;
    });

  return version;
}

let cacheDb: ReturnType<typeof openDB> | undefined;

/** The cache, or undefined where IndexedDB is missing (a private window): then nothing is kept. */
async function cache() {
  try {
    cacheDb ??= openDB('chimi-server', 1, {
      upgrade(db) {
        db.createObjectStore('cache');
      }
    });
    return await cacheDb;
  } catch {
    cacheDb = undefined;
    return undefined;
  }
}

async function cacheGet<T>(key: string): Promise<T | undefined> {
  try {
    return (await (await cache())?.get('cache', key)) as T | undefined;
  } catch {
    return undefined;
  }
}

async function cachePut(key: string, value: unknown) {
  try {
    await (await cache())?.put('cache', value, key);
  } catch {
    // A full or blocked IndexedDB: the data stays in memory for this page load.
  }
}

function toCalibreBook(book: ApiBook): CalibreBook {
  const rest: Partial<ApiBook> = { ...book };

  (['calibreId', 'key', 'originalTitle', 'deleted', 'rev'] as const).forEach(
    (field) => delete rest[field]
  );

  // `id` stays the Calibre id (estimates, mokuro, readings and imports key by it).
  return { ...(rest as CalibreBook), id: book.calibreId, bookId: book.id };
}

const newestFirst = (a: ApiBook, b: ApiBook) => b.added - a.added || b.id - a.id;

let catalogBooks: CalibreBook[] | undefined;

/**
 * The catalog: the cached copy brought up to date with the books changed since its rev (all of
 * them the first time). HTTP errors keep their status (404: the first build is still running).
 */
export async function catalog(): Promise<CalibreBook[]> {
  const key = `catalog:${serverBase}`;
  const cached = await cacheGet<{ rev: number; books: ApiBook[] }>(key);
  const fetchSince = async (since: number) => {
    const response = await apiFetch(`catalog?since=${since}`);

    if (!response.ok) throw await httpError(response);

    return (await response.json()) as { rev: number; books: ApiBook[] };
  };

  let result = await fetchSince(cached?.rev || 0);

  // The server's database was made again (its rev went back): start over.
  if (cached?.rev && result.rev < cached.rev) result = await fetchSince(0);

  let books = result.books;

  // A delta: changed books replace theirs, deleted ones go.
  if (cached?.rev && result.rev >= cached.rev) {
    const byId = new Map(cached.books.map((book) => [book.id, book]));

    result.books.forEach((book) => byId.set(book.id, book));
    books = [...byId.values()].filter((book) => !book.deleted).sort(newestFirst);
  }

  if (!cached || result.rev !== cached.rev) await cachePut(key, { rev: result.rev, books });

  catalogBooks = books.map(toCalibreBook);

  return catalogBooks;
}

/** books.id of a catalog title (live books only), from the last catalog read or its cache. */
export async function bookIdOf(title: string) {
  if (!catalogBooks) {
    const cached = await cacheGet<{ books: ApiBook[] }>(`catalog:${serverBase}`);

    catalogBooks = cached ? cached.books.map(toCalibreBook) : await catalog();
  }

  return catalogBooks.find((book) => book.title === title)?.bookId;
}

function emptyMirror(): Mirror {
  return Object.fromEntries([['rev', 0], ...tables.map((table) => [table, []])]) as Mirror;
}

async function mirrorKey() {
  return `sync:${serverBase}:${(await accountReady())?.id ?? ''}`;
}

const mirrors = new Map<string, Mirror>();
const pulls = new Map<string, Promise<Mirror>>();

function mergeRows(mirror: Mirror, table: SyncTable, rows: SyncRow[]) {
  const byKey = new Map(mirror[table].map((row) => [keyOf[table](row), row]));

  rows.forEach((row) => {
    const key = keyOf[table](row);
    const old = byKey.get(key);

    // A delta asked for before a write landed must not replace the written row.
    if (!old || row.rev >= old.rev) byKey.set(key, row);
  });

  return [...byKey.values()];
}

async function storedMirror(key: string) {
  let mirror = mirrors.get(key);

  if (!mirror) {
    mirror = (await cacheGet<Mirror>(key)) || emptyMirror();
    mirrors.set(key, mirror);
  }

  return mirror;
}

async function pull(key: string) {
  const stored = await storedMirror(key);
  const fetchSince = async (since: number) => {
    const response = await apiFetch(`sync?since=${since}`);

    if (!response.ok) throw await httpError(response);

    return (await response.json()) as Mirror;
  };

  let delta = await fetchSince(stored.rev);
  // The server's database was made again (its rev went back): start over.
  const reset = delta.rev < stored.rev;

  if (reset) delta = await fetchSince(0);

  // The mirror as it is now: rows written meanwhile (`remember`) are kept.
  const current = reset ? emptyMirror() : mirrors.get(key) || stored;
  const mirror = { ...current, rev: delta.rev } as Mirror;

  tables.forEach((table) => {
    mirror[table] = mergeRows(current, table, delta[table] || []);
  });
  mirrors.set(key, mirror);
  // shortcut: the whole mirror is written per change; per-row records if accounts get big.
  await cachePut(key, mirror);

  return mirror;
}

/**
 * This account's rows (signed out: the shared '' account's). `refresh` asks the server for the
 * rows changed since the mirror's rev (concurrent calls share one request); without it the stored
 * mirror is returned as it is (offline).
 */
export async function syncMirror(refresh = true): Promise<Mirror> {
  const key = await mirrorKey();

  if (!refresh) return storedMirror(key);

  let pending = pulls.get(key);

  if (!pending) {
    pending = pull(key).finally(() => pulls.delete(key));
    pulls.set(key, pending);
  }

  return pending;
}

async function remember(table: SyncTable, row: SyncRow) {
  const key = await mirrorKey();
  const mirror = await storedMirror(key);
  const next = { ...mirror, [table]: mergeRows(mirror, table, [row]) } as Mirror;

  mirrors.set(key, next);
  await cachePut(key, next);
}

export type WriteResult = { ok: true; rev: number } | { ok: false; row: SyncRow };

async function write(path: string, init: RequestInit, row: Partial<SyncRow>) {
  const response = await apiFetch(path, init);
  const [pattern, table, keyFields] = writePaths.find(([candidate]) => candidate.test(path)) || [];
  const fields = pattern && keyFields ? keyFields(path.match(pattern)!) : {};

  if (response.status === 409) {
    const stored = (await response.json()).row as SyncRow;

    if (table) await remember(table, { ...fields, ...stored });

    return { ok: false, row: stored } as WriteResult;
  }

  if (!response.ok) throw await httpError(response);

  const { rev } = await response.json();

  if (table) await remember(table, { ...row, ...fields, rev } as SyncRow);

  return { ok: true, rev } as WriteResult;
}

/**
 * Writes a row (`body` has `modified`; DELETE writes a tombstone). The written row, or on 409
 * the server's newer one, goes into the mirror. Other failures throw with their status.
 */
export function putRow(
  path: string,
  body: { modified: number; data?: unknown; [field: string]: unknown },
  method: 'PUT' | 'DELETE' = 'PUT',
  keepalive = false
) {
  const deleted =
    method === 'DELETE' || (body.data as { deleted?: unknown } | undefined)?.deleted === true;

  return write(
    path,
    {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(keepalive ? { keepalive } : {})
    },
    { ...body, ...(method === 'DELETE' ? { data: {} } : {}), deleted }
  );
}

/** Uploads a file (a text copy, a game record: `games/<name>?modified=<ms>`), or deletes one. */
export function putFile(path: string, data: Blob | undefined, type = '') {
  return write(
    path,
    data ? { method: 'PUT', headers: { 'Content-Type': type }, body: data } : { method: 'DELETE' },
    { size: data?.size || 0, deleted: !data }
  );
}

/** Reads a file (a game record); undefined when the server has none. */
export async function getFile(path: string) {
  const response = await apiFetch(path);

  if (response.status === 404) return undefined;
  if (!response.ok) throw await httpError(response);

  return response.blob();
}

/** Forgets the mirrors of every other account (`releaseReaderData`): a shared browser keeps one. */
export async function dropSyncMirrors(accountId: string) {
  const keep = `sync:${serverBase}:${accountId}`;

  [...mirrors.keys()].filter((key) => key !== keep).forEach((key) => mirrors.delete(key));

  try {
    const db = await cache();
    const keys = ((await db?.getAllKeys('cache')) || []) as string[];

    await Promise.all(
      keys
        .filter((key) => key.startsWith('sync:') && key !== keep)
        .map((key) => db?.delete('cache', key))
    );
  } catch {
    // Nothing kept to drop.
  }
}
