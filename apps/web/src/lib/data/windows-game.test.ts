/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { isVn, vnInfo } from '$lib/data/vn';
import {
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
