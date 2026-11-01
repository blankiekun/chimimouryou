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
  isWindowsSaveKey,
  listSaves,
  readWindowsSaves,
  unescapeName,
  unzipSaves,
  vnSaveAreas,
  windowsSaveFiles,
  windowsSavesStamp,
  writeSaves,
  writeWindowsSaves,
  zipSaves
} from './vn-save-store';
import { hashPage, mergeVnSaves } from './vn';

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

  it('syncs only a Windows game’s saves', () => {
    const user = 'wine/drive_c/users/username';

    expect(isWindowsSaveKey('game/save/01.sav')).toBe(true);
    expect(isWindowsSaveKey(`${user}/AppData/Roaming/Maker/save.dat`)).toBe(true);
    expect(isWindowsSaveKey(`${user}/Documents/Game/s.dat`)).toBe(true);
    expect(isWindowsSaveKey(`${user}/Saved Games/Game/s.dat`)).toBe(true);
    expect(isWindowsSaveKey('wine/drive_c/users/Public/Documents/Game/s.dat')).toBe(true);
    expect(isWindowsSaveKey(`${user}/AppData/Local/Temp/x.tmp`)).toBe(false);
    expect(isWindowsSaveKey(`${user}/AppData/Local/Microsoft/Windows/INetCache/x`)).toBe(false);
    expect(isWindowsSaveKey(`${user}/AppData`)).toBe(false);
    expect(isWindowsSaveKey('wine/drive_c/windows/system32/x.dll')).toBe(false);
    expect(isWindowsSaveKey('wine/user.reg')).toBe(false);
    expect(isWindowsSaveKey('wine/drive_c/ProgramData/Maker/Game/save1.dat')).toBe(true);
    expect(isWindowsSaveKey('wine/drive_c/ProgramData/Microsoft/Windows/x.dat')).toBe(false);
    expect(isWindowsSaveKey('wine/drive_c/ProgramData/Maker/Cache/x')).toBe(false);
    expect(isWindowsSaveKey('wine/drive_c/ProgramData/Maker/temp/x')).toBe(false);
    expect(isWindowsSaveKey('wine/drive_c/ProgramData/x.dat')).toBe(true);
    expect(isWindowsSaveKey('wine/drive_c/ProgramData')).toBe(false);
    expect(isWindowsSaveKey('game/../x')).toBe(false);
    expect(isWindowsSaveKey('game')).toBe(false);
  });

  it('round-trips a Windows game’s saves through vnsaves.json', async () => {
    const info = { encoding: 'sjis' as const, files: [], engine: 'vnbox' as const };
    const pcA = vnSaveAreas('a', { ...info, folder: 'gA' });
    const pcB = vnSaveAreas('b', { ...info, folder: 'gB' });
    const [game, prefix] = pcA;
    const at = new Date(2025, 0, 1);

    await engineWrite(game.db, `${game.root}/save/01.sav`, {
      timestamp: at,
      mode: 0o100644,
      contents: bytes('game save')
    });
    await engineWrite(
      prefix.db,
      `${prefix.root}/drive_c/users/username/AppData/Roaming/(_xE3_)(_x82_)(_xBB_)/s.dat`,
      { timestamp: at, mode: 0o100644, contents: bytes('roaming') }
    );
    await engineWrite(prefix.db, `${prefix.root}/drive_c/windows/system32/x.dll`, {
      timestamp: at,
      mode: 0o100644,
      contents: bytes('dll')
    });
    await engineWrite(prefix.db, `${prefix.root}/user.reg`, {
      timestamp: at,
      mode: 0o100644,
      contents: bytes('reg')
    });

    const files = await windowsSaveFiles(pcA);
    const { saves = {} } = await readWindowsSaves(files);

    expect(Object.keys(saves).sort()).toEqual([
      'game/save/01.sav',
      'wine/drive_c/users/username/AppData/Roaming/セ/s.dat'
    ]);
    expect((await readWindowsSaves(files, 5)).saves).toBeUndefined();
    // Wine's other files (the registry, DLLs) are never read, not even listed.
    expect(files.listed.get(prefix)!.map((entry) => entry.path)).not.toEqual(
      expect.arrayContaining(['user.reg'])
    );
    expect(files.listed.get(prefix)!.some((entry) => entry.path.includes('system32'))).toBe(false);

    // PC B already has an older copy of the game save and a newer one of nothing else.
    await engineWrite(pcB[0].db, `${pcB[0].root}/save/01.sav`, {
      timestamp: new Date(2024, 0, 1),
      mode: 0o100644,
      contents: bytes('older')
    });

    const synced = mergeVnSaves(
      saves,
      { 'wine/user.reg': saves['game/save/01.sav'] },
      isWindowsSaveKey
    );

    expect(Object.keys(synced)).not.toContain('wine/user.reg');
    expect(await writeWindowsSaves(pcB, synced)).toBe(2);

    const onB = await windowsSaveFiles(pcB);
    const back = (await readWindowsSaves(onB)).saves!;

    expect(Object.keys(back).sort()).toEqual(Object.keys(saves).sort());
    expect(text(Uint8Array.from(atob(back['game/save/01.sav'].data), (c) => c.charCodeAt(0)))).toBe(
      'game save'
    );
    // Written with the synced times, so nothing is newer and a second pull writes nothing.
    expect(windowsSavesStamp(onB)).toBe(windowsSavesStamp(files));
    expect(await writeWindowsSaves(pcB, synced)).toBe(0);
  });
});
