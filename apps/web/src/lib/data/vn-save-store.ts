/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * A visual novel's save area, read and written with no game running: both engines keep what a
 * game writes in Emscripten IDBFS databases, one per mount point (database name = mount path,
 * store FILE_DATA, key = absolute path, value { timestamp: Date, mode, contents? }).
 * - CONscripter: `/save/<hash of title>` (player.js `saveDir`), flat save files.
 * - VNBox (boxedwine-shell.js, lazyfs.js): `/lazyapp/<lazy>` holds the files the game wrote into
 *   its own folder (they win over the OPFS copy's), `/root/lazy/<lazy>` everything else Wine
 *   wrote (the prefix, C: = drive_c), with <lazy> = encodeURIComponent('opfs:vnbox/<folder>').
 *   Names Boxedwine wrote are escaped (`(_colon_)`, `(_xE3_)`… per byte, Fs::localNameToRemote).
 * Both engines load the database at start and write their whole tree back while running, so
 * changes are made only while the game is stopped. Not upstream.
 */

import {
  BlobReader,
  BlobWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter
} from '@zip.js/zip.js';
import { hashPage, type VnInfo } from '$lib/data/vn';

export interface SaveArea {
  label: string;
  /** IndexedDB database (the IDBFS mount point) */
  db: string;
  /** Key prefix shown as the area's top */
  root: string;
  /** Names are Boxedwine-escaped */
  escaped: boolean;
}

export interface SaveEntry {
  /** The IndexedDB key */
  key: string;
  /** Shown path relative to the area, '/'-separated, names unescaped */
  path: string;
  dir: boolean;
  size: number;
  modified: number;
}

/** The places a game's saves live in this browser. */
export function vnSaveAreas(title: string, info: VnInfo): SaveArea[] {
  if (info.engine !== 'vnbox') {
    const db = `/save/${hashPage(title)}`;

    return [{ label: 'Saves', db, root: db, escaped: false }];
  }

  const lazy = encodeURIComponent(`opfs:vnbox/${info.folder}`);
  const prefix = `/root/lazy/${lazy}`;

  return [
    {
      label: 'Game folder',
      db: `/lazyapp/${lazy}`,
      root: `/lazyapp/${lazy}/${info.folder}`,
      escaped: true
    },
    { label: 'Wine prefix', db: prefix, root: `${prefix}/home/username/.wine`, escaped: true }
  ];
}

const STORE = 'FILE_DATA';
// Emscripten's: S_IFREG | 0666, S_IFDIR | 0777
const FILE_MODE = 0o100666;
const DIR_MODE = 0o40777;
const isDirMode = (mode: number) => (mode & 0o170000) === 0o40000;

interface IdbEntry {
  timestamp: Date;
  mode: number;
  contents?: Uint8Array;
  link?: string;
}

function openDb(name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 21);

    // As IDBFS.getDB creates it, so the engine opens it unchanged later.
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE)
        ? request.transaction!.objectStore(STORE)
        : db.createObjectStore(STORE);

      if (!store.indexNames.contains('timestamp')) {
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  area: SaveArea,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => T
): Promise<T> {
  const db = await openDb(area.db);

  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const result = run(transaction.objectStore(STORE));

      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Save store write aborted'));
    });
  } finally {
    db.close();
  }
}

const SPECIAL: Record<string, string> = {
  colon: ':',
  question: '?',
  at: '@',
  dot: '.',
  space: ' '
};

/** Boxedwine's escaped name → the name the game sees (Fs::remoteNameToLocal). */
export function unescapeName(name: string) {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const token = /\(_(?:(colon|question|at|dot|space)|x([0-9A-Fa-f]{2}))_\)/y;

  for (let index = 0; index < name.length; ) {
    token.lastIndex = index;
    const match = token.exec(name);

    if (match) {
      bytes.push(match[1] ? SPECIAL[match[1]].charCodeAt(0) : parseInt(match[2], 16));
      index = token.lastIndex;
    } else {
      const char = String.fromCodePoint(name.codePointAt(index)!);

      bytes.push(...encoder.encode(char));
      index += char.length;
    }
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** A name as Boxedwine writes it (Fs::localNameToRemote). */
export function escapeName(name: string) {
  return [...new TextEncoder().encode(name)]
    .map((byte, index, all) => {
      const char = String.fromCharCode(byte);
      const last = index === all.length - 1;

      if (char === ':') return '(_colon_)';
      if (char === '?') return '(_question_)';
      if (char === '@') return '(_at_)';
      if (char === '.' && last) return '(_dot_)';
      if (char === ' ' && last) return '(_space_)';
      if (byte >= 0x80) return `(_x${byte.toString(16).toUpperCase().padStart(2, '0')}_)`;
      return char;
    })
    .join('');
}

/** Every file and folder in the area, folders implied by a file's path included, sorted by path. */
export async function listSaves(area: SaveArea): Promise<SaveEntry[]> {
  const found = new Map<string, SaveEntry>();

  await withStore(area, 'readonly', (store) => {
    const request = store.openCursor(
      IDBKeyRange.bound(`${area.root}/`, `${area.root}0`, false, true)
    );

    request.onsuccess = () => {
      const cursor = request.result;

      if (!cursor) return;

      const key = String(cursor.key);
      const value = cursor.value as IdbEntry;
      const parts = key.slice(area.root.length + 1).split('/');
      const shown = parts.map((part) => (area.escaped ? unescapeName(part) : part));

      // Parents first: an engine can persist a file whose folder it never listed.
      for (let depth = 1; depth < parts.length; depth++) {
        const path = shown.slice(0, depth).join('/');

        if (!found.has(path)) {
          found.set(path, {
            key: `${area.root}/${parts.slice(0, depth).join('/')}`,
            path,
            dir: true,
            size: 0,
            modified: 0
          });
        }
      }
      found.set(shown.join('/'), {
        key,
        path: shown.join('/'),
        dir: isDirMode(value.mode),
        size: value.contents?.byteLength ?? 0,
        modified: new Date(value.timestamp).getTime()
      });
      cursor.continue();
    };
  });

  return [...found.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The entries at `path` and below it ('' = the whole area). */
export function savesUnder(entries: SaveEntry[], path: string) {
  return entries.filter(
    (entry) => !path || entry.path === path || entry.path.startsWith(`${path}/`)
  );
}

/** A ZIP of the files among `entries`, at their paths in the area. */
export async function zipSaves(area: SaveArea, entries: SaveEntry[]) {
  const files = entries.filter((entry) => !entry.dir);
  const values = await withStore(area, 'readonly', (store) =>
    files.map((entry) => store.get(entry.key))
  );
  const writer = new ZipWriter(new BlobWriter('application/zip'));

  for (const [index, entry] of files.entries()) {
    const value = values[index].result as IdbEntry | undefined;

    if (!value?.contents) continue;
    await writer.add(entry.path, new Uint8ArrayReader(new Uint8Array(value.contents)), {
      lastModDate: new Date(entry.modified)
    });
  }

  return writer.close();
}

/** A shown path's segments, or undefined when one could leave its folder. */
export function savePathParts(path: string) {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean);

  return parts.length && parts.every((part) => part !== '.' && part !== '..') ? parts : undefined;
}

/**
 * Writes files at shown paths in the area (existing ones replaced, missing folders made) and
 * returns the entries they replaced.
 */
export async function writeSaves(
  area: SaveArea,
  files: { path: string; bytes: Uint8Array }[],
  entries: SaveEntry[]
): Promise<SaveEntry[]> {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const replaced: SaveEntry[] = [];
  const now = new Date();
  const puts: [string, IdbEntry][] = [];
  const modes = await withStore(
    area,
    'readonly',
    (store) =>
      new Map(
        entries.filter((entry) => !entry.dir).map((entry) => [entry.path, store.get(entry.key)])
      )
  );

  for (const file of files) {
    const parts = savePathParts(file.path);

    if (!parts) throw new Error(`${file.path} isn't a path inside the save folder`);

    let key = area.root;

    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/');
      const known = byPath.get(path);
      const last = index === parts.length - 1;

      key = known?.key ?? `${key}/${area.escaped ? escapeName(part) : part}`;
      if (known && known.dir === !last) return;
      if (known) throw new Error(`${path} is a folder`);
      if (!last) {
        const dir: SaveEntry = { key, path, dir: true, size: 0, modified: now.getTime() };

        byPath.set(path, dir);
        puts.push([key, { timestamp: now, mode: DIR_MODE }]);
      }
    });

    const path = parts.join('/');
    const old = byPath.get(path);

    if (old?.dir) throw new Error(`${path} is a folder`);
    if (old) replaced.push(old);
    puts.push([
      key,
      {
        timestamp: now,
        mode: (modes.get(path)?.result as IdbEntry | undefined)?.mode ?? FILE_MODE,
        contents: file.bytes
      }
    ]);
    byPath.set(path, {
      key,
      path,
      dir: false,
      size: file.bytes.byteLength,
      modified: now.getTime()
    });
  }

  await withStore(area, 'readwrite', (store) =>
    puts.forEach(([key, value]) => store.put(value, key))
  );

  return replaced;
}

/** Deletes the entries at `path` and below it. */
export async function deleteSaves(area: SaveArea, entries: SaveEntry[], path: string) {
  const gone = savesUnder(entries, path);

  await withStore(area, 'readwrite', (store) => gone.forEach((entry) => store.delete(entry.key)));

  return gone;
}

/** A ZIP's files with their paths, for writeSaves (folders and unsafe paths skipped). */
export async function unzipSaves(zip: Blob) {
  const reader = new ZipReader(new BlobReader(zip));

  try {
    const files: { path: string; bytes: Uint8Array }[] = [];

    for (const entry of await reader.getEntries()) {
      const parts = !entry.directory && savePathParts(entry.filename);

      if (parts && entry.getData) {
        files.push({ path: parts.join('/'), bytes: await entry.getData(new Uint8ArrayWriter()) });
      }
    }

    return files;
  } finally {
    await reader.close();
  }
}
