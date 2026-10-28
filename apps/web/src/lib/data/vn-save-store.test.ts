/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { configure } from '@zip.js/zip.js';
import {
  deleteSaves,
  escapeName,
  listSaves,
  unescapeName,
  unzipSaves,
  vnSaveAreas,
  writeSaves,
  zipSaves
} from './vn-save-store';
import { hashPage } from './vn';

// jsdom has no Worker.
configure({ useWebWorkers: false });

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);

/** Puts an entry the way Emscripten's IDBFS does (so the engines' own data is read right). */
async function engineWrite(db: string, key: string, value: object) {
  const open = indexedDB.open(db, 21);

  open.onupgradeneeded = () =>
    open.result.createObjectStore('FILE_DATA').createIndex('timestamp', 'timestamp');
  const database = await new Promise<IDBDatabase>(
    (resolve) => (open.onsuccess = () => resolve(open.result))
  );

  await new Promise((resolve) => {
    const transaction = database.transaction('FILE_DATA', 'readwrite');

    transaction.objectStore('FILE_DATA').put(value, key);
    transaction.oncomplete = resolve;
  });
  database.close();
}

describe('vn save store', () => {
  it('names the engines’ databases', () => {
    const [saves] = vnSaveAreas('ゲーム', { encoding: 'sjis', files: [] });

    expect(saves.db).toBe(`/save/${hashPage('ゲーム')}`);

    const [folder, prefix] = vnSaveAreas('x', {
      encoding: 'sjis',
      files: [],
      engine: 'vnbox',
      folder: 'g123'
    });

    expect(folder.db).toBe('/lazyapp/opfs%3Avnbox%2Fg123');
    expect(folder.root).toBe('/lazyapp/opfs%3Avnbox%2Fg123/g123');
    expect(prefix.root).toBe('/root/lazy/opfs%3Avnbox%2Fg123/home/username/.wine');
  });

  it('escapes names like Boxedwine', () => {
    expect(escapeName('セ:a.')).toBe('(_xE3_)(_x82_)(_xBB_)(_colon_)a(_dot_)');
    expect(unescapeName('(_xE3_)(_x82_)(_xBB_)(_colon_)a(_dot_)')).toBe('セ:a.');
    expect(unescapeName('セーブ')).toBe('セーブ');
  });

  it('lists, replaces, zips and deletes, keeping the engine’s format', async () => {
    const [area] = vnSaveAreas('list', {
      encoding: 'sjis',
      files: [],
      engine: 'vnbox',
      folder: 'g1'
    });
    const old = new Date(2020, 0, 1);

    // A dir with a raw name (from the game folder) holding an escaped file name; no dir entry.
    await engineWrite(area.db, `${area.root}/セーブ/(_xE3_)(_x81_)(_x82_).dat`, {
      timestamp: old,
      mode: 0o100644,
      contents: bytes('old')
    });

    let entries = await listSaves(area);

    expect(entries.map((entry) => [entry.path, entry.dir, entry.size])).toEqual([
      ['セーブ', true, 0],
      ['セーブ/あ.dat', false, 3]
    ]);

    const replaced = await writeSaves(
      area,
      [
        { path: 'セーブ/あ.dat', bytes: bytes('new') },
        { path: 'new/い.dat', bytes: bytes('add') }
      ],
      entries
    );

    expect(replaced.map((entry) => entry.path)).toEqual(['セーブ/あ.dat']);
    entries = await listSaves(area);
    expect(entries.map((entry) => entry.key.slice(area.root.length))).toEqual([
      '/new',
      '/new/(_xE3_)(_x81_)(_x84_).dat',
      '/セーブ',
      '/セーブ/(_xE3_)(_x81_)(_x82_).dat'
    ]);
    expect(
      entries.filter((entry) => !entry.dir).every((entry) => entry.modified > old.getTime())
    ).toBe(true);

    const files = await unzipSaves(await zipSaves(area, entries));

    expect(files.map((file) => [file.path, text(file.bytes)])).toEqual([
      ['new/い.dat', 'add'],
      ['セーブ/あ.dat', 'new']
    ]);

    // Engine-readable: mode kept on replace, timestamps are Dates, folders are dir modes.
    const open = indexedDB.open(area.db, 21);
    const db = await new Promise<IDBDatabase>(
      (resolve) => (open.onsuccess = () => resolve(open.result))
    );
    const store = db.transaction('FILE_DATA').objectStore('FILE_DATA');
    const get = (key: string) =>
      new Promise<any>(
        (resolve) => (store.get(key).onsuccess = (e: any) => resolve(e.target.result))
      );
    const file = await get(`${area.root}/セーブ/(_xE3_)(_x81_)(_x82_).dat`);
    const dir = await get(`${area.root}/new`);

    db.close();
    expect(file.mode).toBe(0o100644);
    expect(file.timestamp).toBeInstanceOf(Date);
    expect(dir.mode & 0o170000).toBe(0o40000);

    expect((await deleteSaves(area, entries, 'new')).map((entry) => entry.path)).toEqual([
      'new',
      'new/い.dat'
    ]);
    expect((await listSaves(area)).map((entry) => entry.path)).toEqual(['セーブ', 'セーブ/あ.dat']);
  });

  it('refuses paths that leave the area or turn a folder into a file', async () => {
    const [area] = vnSaveAreas('refuse', { encoding: 'sjis', files: [] });

    await expect(writeSaves(area, [{ path: '../x', bytes: bytes('') }], [])).rejects.toThrow();
    await writeSaves(area, [{ path: 'a/b', bytes: bytes('') }], []);
    await expect(
      writeSaves(area, [{ path: 'a', bytes: bytes('') }], await listSaves(area))
    ).rejects.toThrow('a is a folder');
    // Plain names in a CONscripter area.
    expect((await listSaves(area)).map((entry) => entry.key)).toEqual([
      `${area.root}/a`,
      `${area.root}/a/b`
    ]);
  });
});
