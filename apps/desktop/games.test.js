/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isHookCode, isSafeSaveName } from './games.js';

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
