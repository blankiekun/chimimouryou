/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { isVn, vnInfo } from '$lib/data/vn';
import {
  hookSuggestion,
  searchHookScripts,
  vnboxPlayerUrl,
  windowsGameBook,
  windowsGameFolder,
  windowsPrograms
} from '$lib/data/windows-game';

describe('windowsPrograms', () => {
  it('puts the likeliest game first: no setup or config tools, shallow, large', () => {
    const size = (size: number) => ({ size });

    expect(
      windowsPrograms({
        'setup.exe': size(9e6),
        'tools/big.exe': size(9e6),
        'config.exe': size(5e6),
        'game.exe': size(2e6),
        'readme.txt': size(1),
        'unins000.exe': size(1e6),
        'launcher.EXE': size(1e5)
      })
    ).toEqual([
      'game.exe',
      'launcher.EXE',
      'tools/big.exe',
      'setup.exe',
      'config.exe',
      'unins000.exe'
    ]);
  });
});

describe('windowsGameBook', () => {
  it('is a VNBox visual novel with its OPFS folder, program and hook', () => {
    const book = windowsGameBook('信天翁', 'game.exe', 'trans.send', undefined);

    expect(isVn(book)).toBe(true);
    expect(vnInfo(book)).toEqual({
      encoding: 'sjis',
      files: [],
      engine: 'vnbox',
      folder: windowsGameFolder('信天翁'),
      exe: 'game.exe',
      hook: 'trans.send'
    });
    expect(windowsGameFolder('信天翁')).toMatch(/^g[0-9a-z]+$/);
  });
});

describe('vnboxPlayerUrl', () => {
  it('gives VNBox the folder, program and hook in its own URL syntax', () => {
    const url = new URL(
      vnboxPlayerUrl(
        { encoding: 'sjis', files: [], engine: 'vnbox', folder: 'gabc', exe: '信天翁.exe' },
        'blob:http://x/1'
      ),
      'http://x/'
    );

    expect(url.pathname).toMatch(/\/vn\/vnbox\.html$/);
    expect(url.searchParams.get('lazy')).toBe('opfs:vnbox/gabc');
    expect(url.searchParams.get('p')).toBe('信天翁.exe');
    expect(url.searchParams.get('frida')).toBe('blob:http://x/1');
    expect(url.search).toContain('env=%22LC_ALL:ja_JP.UTF-8%22');
  });
});

describe('bundled hook scripts', () => {
  const scripts = [
    { file: 'PC_Albatross_Koukairoku.js', name: 'Albatross Koukairoku (信天翁航海録)', exes: [] },
    { file: 'PC_Steam_Fate_Stay_Night.js', name: 'Fate/stay night REMASTERED', exes: [] },
    { file: 'PC_Muv_Luv.js', name: 'Muv-Luv', exes: ['muvluv.exe'] },
    { file: 'PC_Summer_Pockets.js', name: 'Summer Pockets', exes: ['SiglusEngine.exe'] }
  ];
  const suggest = (exe: string, ...names: string[]) => hookSuggestion(scripts, { exe, names });

  it('suggests by the hand-kept table, then the program a script names', () => {
    expect(suggest('信天翁航海録.exe', 'whatever')).toBe('PC_Albatross_Koukairoku.js');
    expect(suggest('bin/MuvLuv.EXE')).toBe('PC_Muv_Luv.js');
  });

  it('else by name: romaji or Japanese, folder or title, never a generic program name', () => {
    expect(suggest('game.exe', 'Summer Pockets')).toBe('PC_Summer_Pockets.js');
    expect(suggest('game.exe', 'fate stay night')).toBe('PC_Steam_Fate_Stay_Night.js');
    expect(suggest('start.exe', '信天翁航海録 体験版')).toBe('PC_Albatross_Koukairoku.js');
    expect(suggest('game.exe', 'game')).toBeUndefined();
    expect(suggest('foo.exe', 'Unknown Novel')).toBeUndefined();
  });

  it('searches names and file names', () => {
    expect(searchHookScripts(scripts, 'muv luv').map((s) => s.file)).toEqual(['PC_Muv_Luv.js']);
    expect(searchHookScripts(scripts, '航海')).toHaveLength(1);
    expect(searchHookScripts(scripts, ' ')).toHaveLength(4);
  });

  it('gives VNBox a bundled script under /vn/ when no blob: script is passed', () => {
    const info = {
      encoding: 'sjis',
      files: [],
      engine: 'vnbox',
      folder: 'gabc',
      exe: 'a.exe',
      hookFile: 'PC_Muv_Luv.js'
    } as const;
    const frida = (hookUrl?: string) =>
      new URL(vnboxPlayerUrl({ ...info, files: [] }, hookUrl), 'http://x/').searchParams.get(
        'frida'
      );

    expect(frida()).toBe('vnbox/hooks/PC_Muv_Luv.js');
    expect(frida('blob:http://x/1')).toBe('blob:http://x/1');
  });
});
