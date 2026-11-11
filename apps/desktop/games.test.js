/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ankiCommand, isHookCode, isSafeSaveName, localAnkiUrl, startPage } from './games.js';

const user = 'wine/drive_c/users/username/';

test('main never writes or reads synced names that run code or reach Windows’ own folders', () => {
  for (const name of [
    `${user}AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/x.bat`,
    `${user}AppData/Roaming/microsoft/x.dat`,
    `${user}AppData/Roaming/Microsoft./x.dat`,
    `${user}AppData/Roaming/MICROS~1/x.dat`,
    `${user}AppData/Roaming/.. /x.dat`,
    `${user}AppData/Roaming/Game/a.txt.bat`,
    `${user}AppData/Local/Temp/x.dat`,
    `${user}Desktop/x.dat`,
    'wine/drive_c/ProgramData/Microsoft/x.dat',
    'wine/drive_c/windows/system32/x.dat',
    'game/d3d9.dll',
    'game/x.EXE.',
    'game/patch.xp3',
    'game/game/archive.rpa',
    'game/game/x.rpyb',
    'game/x.pyd',
    'game/lib/x.so',
    'game/game.exe.config',
    'game/game.exe.manifest',
    'game/game.exe.local',
    'game/../x.dat',
    'game'
  ])
    assert.equal(isSafeSaveName(name), false, name);
  for (const name of [
    `${user}AppData/Roaming/Game/save1.dat`,
    `${user}Documents/Game/s.sav`,
    `${user}Saved Games/Game/s.sav`,
    'wine/drive_c/ProgramData/Game/s.dat',
    'game/savedata/01.sav'
  ])
    assert.equal(isSafeSaveName(name), true, name);
});

test('only one plausible hook code goes to the helper’s stdin, never a second command', () => {
  for (const code of [
    'HQ4@1A2B:testvn.exe\ninsert HS0@0:x.dll',
    'HS4@0:gdi32.dll\r:TextOutA',
    'HS4@0:gdi32.dll\0',
    'HS4@0:gdi32.dll\u2028x',
    `HS4@${'0'.repeat(600)}`,
    'hs4@0:gdi32.dll',
    'insert HS4@0:gdi32.dll',
    'HS4:gdi32.dll',
    'H@',
    '',
    undefined,
    42,
    ['HS4@0']
  ])
    assert.equal(isHookCode(code), false, JSON.stringify(code));
  for (const code of [
    'HS4@0:gdi32.dll:TextOutA',
    '/HQN-8*0@4A3B10:game.exe',
    'HQ4@1A2B:ゲーム 体験版.exe',
    'RS@1234:game.exe',
    'HW-1C:-20@44A6F0'
  ])
    assert.equal(isHookCode(code), true, code);
});

// How `--game=<folder>` (Steam launch options) can go wrong: another switch that starts the same
// (`--gamescope…`) taken for it; an empty value opening a game page for nothing; a value with `&`
// or `#` adding its own query (`&native=<id>` would play another record); no argument at all, or a
// second start without one, navigating away from what is open.
test('a --game= argument opens that game’s page, anything else none', () => {
  const origin = 'http://127.0.0.1:41917';
  assert.equal(
    startPage(origin, ['/app', '--ozone-platform=x11', '--game=1712-ab_c']),
    `${origin}/hook?game=1712-ab_c`
  );
  assert.equal(
    startPage(origin, ['/app', '--game=x&native=5#y']),
    `${origin}/hook?game=x%26native%3D5%23y`
  );
  for (const argv of [['/app'], ['/app', '--game='], ['/app', '--gamescope=1', '--game']])
    assert.equal(startPage(origin, argv), undefined);
});

// Start Anki with games, written before the code. How it could fail:
// - an empty PATH entry (`a::b`, a trailing `:`) is read as the current folder, which may be the
//   game's: a planted `anki` there would run;
// - a folder named `anki` on PATH is picked as the program;
// - with Anki both on PATH and in Flatpak, Flatpak wins (PATH is what the user set up);
// - Flatpak's Anki is picked with no `flatpak` program to run it, or missed when installed per user;
// - on Windows an unset LOCALAPPDATA turns into a relative `undefined\Programs\…` path;
// - an address that only looks local (`localhost.example.com`, `127.0.0.1.nip.io`, a LAN address)
//   counts as this computer, so a remote Anki is "not answering" and a local one gets started;
// - a malformed or non-HTTP address throws instead of counting as not local.
test('Anki is looked for only where it is installed, never in the current folder', () => {
  const files =
    (...paths) =>
    (path) =>
      paths.includes(path);
  const home = '/home/u';
  const linux = (PATH, isFile) => ankiCommand({ platform: 'linux', env: { PATH }, home, isFile });

  assert.equal(linux('/usr/bin::/bin:', files('anki')).found, undefined);
  assert.equal(linux('/opt/dir', files()).found, undefined);
  assert.deepEqual(
    linux(
      '/usr/local/bin:/usr/bin',
      files('/usr/bin/anki', '/usr/bin/flatpak', '/var/lib/flatpak/app/net.ankiweb.Anki')
    ).found,
    { command: '/usr/bin/anki', args: [] }
  );
  assert.equal(linux('/usr/bin', files('/var/lib/flatpak/app/net.ankiweb.Anki')).found, undefined);
  assert.deepEqual(
    linux(
      '/usr/bin',
      files('/usr/bin/flatpak', '/home/u/.local/share/flatpak/app/net.ankiweb.Anki')
    ).found,
    { command: '/usr/bin/flatpak', args: ['run', 'net.ankiweb.Anki'] }
  );
  assert.ok(linux('', files()).looked.length > 0);

  const win = ankiCommand({ platform: 'win32', env: {}, home: 'C:\\Users\\u', isFile: () => true });
  assert.ok(!win.looked.some((path) => path.includes('undefined')), win.looked.join());
  assert.ok(
    win.looked.every((path) => /^[A-Z]:\\/i.test(path)),
    win.looked.join()
  );
  assert.equal(
    ankiCommand({ platform: 'freebsd', env: { PATH: '/usr/bin' }, home, isFile: () => true }).found,
    undefined
  );
});

test('only an AnkiConnect address on this computer counts as local', () => {
  for (const url of [
    'http://127.0.0.1:8765',
    'http://localhost:8765/',
    'http://[::1]:8765',
    'https://127.0.0.2:8765'
  ])
    assert.ok(localAnkiUrl(url), url);
  for (const url of [
    'http://localhost.example.com:8765',
    'http://127.0.0.1.nip.io:8765',
    'http://192.168.0.5:8765',
    'file:///127.0.0.1',
    'javascript:alert(1)',
    'not a url',
    '',
    undefined,
    42
  ])
    assert.equal(localAnkiUrl(url), undefined, String(url));
});
