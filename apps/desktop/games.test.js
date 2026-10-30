/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSafeSaveName } from './games.js';

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
