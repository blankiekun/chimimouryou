/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Finding Steam's Proton builds (proton.js) on made-up Steam folders: no Steam runs here, and the
// launch itself is checked by e2e/native-vn.e2e.mjs with E2E_RUNNER=proton. Written before the code,
// from the ways finding can go wrong:
// - a library on another drive (a Deck's SD card), named only in libraryfolders.vdf, isn't read, so
//   a Proton or its runtime installed there is "not installed";
// - the runtime is looked for only in the Proton's own library;
// - a game or the runtime itself in steamapps/common is offered as a Proton build;
// - Automatic takes a build whose runtime isn't installed (the launch fails) over an older one
//   that would run, or the missing runtime isn't named for the reader to install;
// - versions compare as text, so Proton 9.0 beats Proton 10.0; Experimental or a custom build beats
//   a numbered Valve one;
// - a runtime Steam still lists (appmanifest) whose folder is gone counts as installed;
// - ~/.steam/root being a link to ~/.local/share/Steam lists every build twice;
// - a path with an escaped backslash or quote, a comment line, or the old flat libraryfolders
//   ("1" "/path") is read wrong; a cut-off or binary file throws and takes Settings down with it;
// - no Steam at all throws instead of finding nothing.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { findProton, parseVdf } from './proton.js';

const sniper = '1628350';
const runtime4 = '4183110';

/** A made-up home: `files` by path, a string for a file's text. */
function tree(files) {
  const home = mkdtempSync(join(tmpdir(), 'chimi-proton-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(home, path)), { recursive: true });
    writeFileSync(join(home, path), text);
  }
  return home;
}

const proton = (dir, appid) => ({
  [`${dir}/proton`]: '#!/bin/sh\n',
  [`${dir}/toolmanifest.vdf`]: `"manifest"\n{\n\t"version"\t"2"\n\t// what it runs in\n\t"commandline"\t"/proton %verb%"\n\t"require_tool_appid"\t"${appid}"\n}\n`
});

const runtime = (library, appid, dir, entry = true) => ({
  [`${library}/steamapps/appmanifest_${appid}.acf`]: `"AppState"\n{\n\t"appid"\t\t"${appid}"\n\t"installdir"\t\t"${dir}"\n}\n`,
  [`${library}/steamapps/common/${dir}/${entry ? '_v2-entry-point' : 'README.md'}`]: ''
});

const steam = '.local/share/Steam';
const names = (home) => findProton(home).map((build) => build.name);

test('builds and their runtime are found across libraries, best first; games are left out', () => {
  const home = tree({
    ...proton(`${steam}/steamapps/common/Proton 9.0 (Beta)`, sniper),
    ...proton(`${steam}/steamapps/common/Proton - Experimental`, sniper),
    ...proton(`${steam}/compatibilitytools.d/GE-Proton10-4`, sniper),
    [`${steam}/steamapps/common/Some Game/game.exe`]: '',
    // The SD card: Proton 10 and the runtime every build here needs.
    ...proton('sdcard/steamapps/common/Proton 10.0', sniper),
    ...runtime('sdcard', sniper, 'SteamLinuxRuntime_sniper')
  });
  writeFileSync(
    join(home, steam, 'steamapps/libraryfolders.vdf'),
    `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${join(home, steam)}"\n\t\t"apps"\n\t\t{\n\t\t\t"228980"\t\t"1"\n\t\t}\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${join(home, 'sdcard')}"\n\t}\n}\n`
  );
  // As Steam sets it up: ~/.steam/root links to the install.
  mkdirSync(join(home, '.steam'));
  symlinkSync(join(home, steam), join(home, '.steam/root'));
  try {
    const builds = findProton(home);
    assert.deepEqual(
      builds.map((build) => build.name),
      ['Proton 10.0', 'Proton 9.0 (Beta)', 'Proton - Experimental', 'GE-Proton10-4']
    );
    for (const build of builds) {
      assert.equal(build.runtime, join(home, 'sdcard/steamapps/common/SteamLinuxRuntime_sniper'));
      assert.equal(build.needs, undefined);
    }
    assert.equal(builds[0].path, join(home, 'sdcard/steamapps/common/Proton 10.0'));
    assert.equal(builds[0].root, join(home, steam));
  } finally {
    rmSync(home, { recursive: true });
  }
});

test('a build whose runtime is missing or gone is listed after those that run, naming it', () => {
  const home = tree({
    ...proton(`${steam}/steamapps/common/Proton 11.0`, runtime4),
    ...proton(`${steam}/steamapps/common/Proton 8.0`, sniper),
    ...proton(`${steam}/steamapps/common/Proton 7.0`, '1391110'),
    ...runtime(steam, sniper, 'SteamLinuxRuntime_sniper'),
    // Steam still lists it, its folder holds no entry point.
    ...runtime(steam, '1391110', 'SteamLinuxRuntime_soldier', false)
  });
  try {
    const builds = findProton(home);
    assert.deepEqual(
      builds.map((build) => [build.name, !!build.runtime, build.needs]),
      [
        ['Proton 8.0', true, undefined],
        ['Proton 11.0', false, 'Steam Linux Runtime 4.0'],
        ['Proton 7.0', false, 'Steam Linux Runtime 2.0 (soldier)']
      ]
    );
  } finally {
    rmSync(home, { recursive: true });
  }
});

test('no Steam, and Steam files that can’t be read, find nothing instead of throwing', () => {
  const empty = tree({});
  const broken = tree({
    ...proton(`${steam}/steamapps/common/Proton 10.0`, sniper),
    [`${steam}/steamapps/libraryfolders.vdf`]:
      '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"/nowhe',
    [`${steam}/steamapps/appmanifest_${sniper}.acf`]: '\0\u0001{{{"'
  });
  try {
    assert.deepEqual(findProton(empty), []);
    assert.deepEqual(names(broken), ['Proton 10.0']);
    assert.equal(findProton(broken)[0].runtime, undefined);
  } finally {
    rmSync(empty, { recursive: true });
    rmSync(broken, { recursive: true });
  }
});

test('Steam’s text files: escapes, comments, any key case, the old flat library list', () => {
  assert.deepEqual(
    {
      ...parseVdf('// made by Steam\n"LibraryFolders"\n{\n\t"1"\t\t"D:\\\\Games \\"2\\""\n}\n')
        .libraryfolders
    },
    { 1: 'D:\\Games "2"' }
  );
  const flat = tree({
    ...proton('old/steamapps/common/Proton 8.0', sniper),
    [`${steam}/steamapps/libraryfolders.vdf`]: ''
  });
  writeFileSync(
    join(flat, steam, 'steamapps/libraryfolders.vdf'),
    `"LibraryFolders"\n{\n\t"TimeNextStatsReport"\t\t"1"\n\t"1"\t\t"${join(flat, 'old')}"\n}\n`
  );
  try {
    assert.deepEqual(names(flat), ['Proton 8.0']);
  } finally {
    rmSync(flat, { recursive: true });
  }
});
