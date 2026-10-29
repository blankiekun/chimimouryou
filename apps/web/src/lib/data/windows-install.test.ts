/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  autorunProgram,
  besideMsi,
  copyProtection,
  discsOf,
  folderDiscs,
  folderSetup,
  installedPrograms,
  installerKind,
  listDisc,
  lnkTarget,
  msiArgs,
  prefixSnapshot,
  registryMoved,
  silentArgs
} from './windows-install';
import { vnSaveAreas } from './vn-save-store';

// jsdom's Blob has no arrayBuffer() or stream().
Blob.prototype.arrayBuffer ??= function (this: Blob) {
  return new Promise<ArrayBuffer>((resolve) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(this);
  });
};
Blob.prototype.stream ??= function (this: Blob) {
  return new ReadableStream({
    start: async (controller) => {
      controller.enqueue(new Uint8Array(await this.arrayBuffer()));
      controller.close();
    }
  });
};

/** A shortcut (.lnk) to path, with its LinkInfo's Unicode path */
function shortcut(path: string) {
  const lnk = new Uint8Array(0x4c + 0x24 + path.length * 2 + 2);
  const view = new DataView(lnk.buffer);

  view.setUint32(0, 0x4c, true);
  view.setUint32(0x14, 2, true); // HasLinkInfo
  view.setUint32(0x4c + 4, 0x24, true);
  view.setUint32(0x4c + 8, 1, true);
  view.setUint32(0x4c + 0x10, 0x24 + path.length * 2, true); // ANSI path: the terminator
  view.setUint32(0x4c + 0x1c, 0x24, true);
  [...path].forEach((char, i) => view.setUint16(0x4c + 0x24 + i * 2, char.charCodeAt(0), true));

  return lnk;
}

describe('windows-install', () => {
  it('reads autorun.inf', () => {
    expect(autorunProgram('[AutoRun]\r\nicon=a.ico\r\nopen=SETUP\\Setup.exe /lang jp\r\n')).toEqual(
      { program: 'SETUP/Setup.exe', args: '/lang jp' }
    );
    expect(autorunProgram('[autorun]\nopen="My Setup.exe"')).toEqual({
      program: 'My Setup.exe',
      args: ''
    });
    expect(autorunProgram('[other]\nopen=x.exe')).toBeUndefined();
  });

  it('names installers and their silent switches', () => {
    const ascii = (text: string) => new TextEncoder().encode(`MZ....${text}....`);
    const wide = (text: string) =>
      new Uint8Array([...text].flatMap((char) => [char.charCodeAt(0), 0]));

    expect(installerKind(ascii('Inno Setup Setup Data'))).toBe('inno');
    expect(installerKind(wide('Nullsoft Install System'))).toBe('nsis');
    expect(installerKind(ascii('InstallShield'))).toBe('installshield');
    expect(installerKind(ascii('nothing'))).toBeUndefined();
    expect(silentArgs('nsis', 'C:\\files\\g1')).toBe('/S /D=C:\\files\\g1');
  });

  it('finds copy protection by its files', () => {
    expect(copyProtection(['SETUP.EXE', 'GAME/CMS32_95.DLL', 'secdrv.sys'])).toEqual([
      'SecuROM',
      'SafeDisc'
    ]);
    expect(copyProtection(['setup.exe'])).toEqual([]);
  });

  it('reads a shortcut target', () => {
    const path = 'C:\\files\\g1\\game.exe';

    expect(lnkTarget(shortcut(path))).toBe(path);
  });

  it('finds what an install left, whatever its file dates', async () => {
    const [, prefix] = vnSaveAreas('Game', {
      encoding: 'sjis',
      files: [],
      engine: 'vnbox',
      folder: 'g9'
    });
    const write = (path: string, contents: Uint8Array, timestamp: Date) =>
      new Promise((resolve) => {
        const open = indexedDB.open(prefix.db, 21);

        open.onupgradeneeded = () =>
          open.result.createObjectStore('FILE_DATA').createIndex('timestamp', 'timestamp');
        open.onsuccess = () => {
          const transaction = open.result.transaction('FILE_DATA', 'readwrite');

          transaction
            .objectStore('FILE_DATA')
            .put({ timestamp, mode: 0o100666, contents }, `${prefix.root}/drive_c/${path}`);
          transaction.oncomplete = () => resolve(open.result.close());
        };
      });
    const old = new Date('2010-07-23T05:00:00Z');

    await write('Program Files/Old/old.exe', new Uint8Array(4), old);

    const before = await prefixSnapshot('Game', 'g9');

    // msiexec dates the files it unpacks from the cabinet's: years before the install.
    await write('Program Files/raiL/Game/play.exe', new Uint8Array(8), old);
    await write('Program Files/raiL/Game/data.xfl', new Uint8Array(8), old);
    await write(
      'users/username/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/raiL/Game.lnk',
      shortcut('C:\\Program Files\\raiL\\Game\\play.exe'),
      new Date()
    );

    const found = await installedPrograms('Game', 'g9', before);

    expect(found.map((program) => [program.path, program.shortcut])).toEqual([
      ['drive_c/Program Files/raiL/Game/play.exe', true]
    ]);
  });

  it('groups images into discs and lists an ISO', async () => {
    const sector = (n: number) => new Uint8Array(2048 * n);
    const iso = sector(20);

    // Primary descriptor at 16: root directory at sector 18, one file at 19.
    iso.set([1, ...new TextEncoder().encode('CD001')], 16 * 2048);
    iso.set(new TextEncoder().encode('GAMEDISC'), 16 * 2048 + 40);
    const record = (at: number, lba: number, size: number, flags: number, name: number[]) => {
      iso[at] = 33 + name.length + (name.length % 2 ? 0 : 1);
      new DataView(iso.buffer).setUint32(at + 2, lba, true);
      new DataView(iso.buffer).setUint32(at + 10, size, true);
      iso[at + 25] = flags;
      iso[at + 32] = name.length;
      iso.set(name, at + 33);
      return at + iso[at];
    };
    record(16 * 2048 + 156, 18, 2048, 2, [0]);
    let at = record(18 * 2048, 18, 2048, 2, [0]);
    at = record(at, 18, 2048, 2, [1]);
    record(at, 19, 5, 0, [...new TextEncoder().encode('AUTORUN.INF;1')]);
    iso.set(new TextEncoder().encode('hello'), 19 * 2048);
    expect(iso[17 * 2048]).toBe(0); // no Joliet descriptor

    const files = [
      new File([iso], 'disc2.iso'),
      new File(['x'], 'Game.mdf'),
      new File(['x'], 'Game.mds'),
      new File([iso], 'disc1.iso')
    ];
    const discs = await discsOf(files);

    expect(discs.map((disc) => disc.main.name)).toEqual(['disc1.iso', 'disc2.iso', 'Game.mds']);
    expect(discs[2].files.map((file) => file.name)).toEqual(['Game.mds', 'Game.mdf']);

    const listing = await listDisc(discs[0]);

    expect(listing?.label).toBe('GAMEDISC');
    expect(listing?.files.map((file) => file.path)).toEqual(['AUTORUN.INF']);
    expect(new TextDecoder().decode(await listing!.read(listing!.files[0]))).toBe('hello');
  });

  it('tells installer folders and disc images from game folders', async () => {
    const exe = (text: string) => new File([`MZ....${text}....`], 'x.exe');

    // An Inno Setup installer named after the game, beside its readme.
    expect(
      await folderSetup({ 'ゲーム.exe': exe('Inno Setup Setup Data'), 'readme.txt': exe('') })
    ).toEqual({ installer: 'ゲーム.exe', args: '' });
    // autorun.inf's program, with its arguments, whatever its name.
    expect(
      await folderSetup({
        'AUTORUN.INF': new File(['[autorun]\r\nopen=menu.exe /jp'], 'AUTORUN.INF'),
        'menu.exe': exe(''),
        'DirectX/dxsetup.exe': exe('')
      })
    ).toEqual({ installer: 'menu.exe', args: '/jp' });
    // A game folder: its program is no installer, whatever setup tools sit beside it.
    expect(await folderSetup({ 'game.exe': exe(''), 'setup.exe': exe('') })).toBeUndefined();
    expect(await folderSetup({ 'Setup.exe': exe(''), 'data/game.exe': exe('') })).toBeUndefined();
    expect(await folderSetup({ 'Setup.exe': exe(''), 'DirectX/dxsetup.exe': exe('') })).toEqual({
      installer: 'Setup.exe',
      args: ''
    });

    const files = { 'disc/game.cue': exe(''), 'disc/game.bin': exe(''), 'track02.wav': exe('') };

    expect(folderDiscs(files)).toEqual(['disc/game.cue', 'disc/game.bin', 'track02.wav']);
    expect(folderDiscs({ ...files, 'game.exe': exe('') })).toEqual([]);
    expect(folderDiscs({ 'bgm.wav': exe('') })).toEqual([]);
  });

  it("matches a CUE's Shift JIS file names", async () => {
    const name = 'ゴア.iso';
    const sjis = new Uint8Array([
      ...new TextEncoder().encode('FILE "'),
      0x83,
      0x53,
      0x83,
      0x41,
      ...new TextEncoder().encode('.iso" BINARY\r\n')
    ]);
    const discs = await discsOf([new File([sjis], 'ゴア.cue'), new File(['x'], name)]);

    expect(discs.map((disc) => disc.files.map((file) => file.name))).toEqual([['ゴア.cue', name]]);
    expect(new TextDecoder().decode(await discs[0].main.arrayBuffer())).toBe(
      'FILE "ゴア.iso" BINARY\r\n'
    );
  });

  it('runs msiexec on the package beside a setup', () => {
    expect(besideMsi('setup.exe', ['setup.exe', 'Game.MSI', 'sub/other.msi'])).toBe('Game.MSI');
    expect(besideMsi('cd/setup.exe', ['cd/a.msi', 'cd/b.msi'])).toBeUndefined();
    expect(msiArgs('E:\\Game.msi', 'C:\\files\\g1')).toBe(
      '/i "E:\\Game.msi" /qn TARGETDIR="C:\\files\\g1" INSTALLDIR="C:\\files\\g1"'
    );
  });

  it('points registry paths at the moved game', () => {
    const reg = [
      '[Software\\\\raiL\\\\Game] 1700000000',
      '"Path"="C:\\\\Program Files\\\\raiL\\\\\\x30b2\\x30fc\\x30e0"',
      '"Exe"="\\"c:\\\\program files\\\\rail\\\\Game\\\\play.exe\\" %1"',
      '"Other"="C:\\\\Program Files\\\\raiLsoft"',
      '"Kept"="as \\x30b2 written"'
    ].join('\n');

    expect(registryMoved(reg, 'C:\\Program Files\\raiL', 'C:\\files\\g1').split('\n')).toEqual([
      '[Software\\\\raiL\\\\Game] 1700000000',
      '"Path"="C:\\\\files\\\\g1\\\\\\x30b2\\x30fc\\x30e0"',
      '"Exe"="\\"C:\\\\files\\\\g1\\\\Game\\\\play.exe\\" %1"',
      '"Other"="C:\\\\Program Files\\\\raiLsoft"',
      '"Kept"="as \\x30b2 written"'
    ]);
  });
});
