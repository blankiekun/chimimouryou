/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isVn, vnInfo } from '$lib/data/vn';
import {
  copyWindowsGame,
  fittedTuning,
  hookSuggestion,
  rankThreads,
  savedHookName,
  searchHookScripts,
  vnboxPlayerUrl,
  windowsGameBook,
  windowsGameFolder,
  windowsPrograms,
  type HookThread
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

  it('puts tuning over the defaults in place, but never the folder, program or hook', () => {
    const info = { encoding: 'sjis', files: [], engine: 'vnbox', folder: 'gabc', exe: 'a.exe' };
    const search = vnboxPlayerUrl(
      info as any,
      'blob:http://x/1',
      'audioFreq=22050&fitWindow=false&stats=1&lazy=opfs:x&p=evil.exe&frida=x&env=%22WINEDEBUG:-all%22&a#b'
    ).split('?')[1];
    const pairs = search.split('&');

    // VNBox reads the first key=, so each key appears once.
    expect(pairs.filter((pair) => pair.startsWith('audioFreq='))).toEqual(['audioFreq=22050']);
    expect(pairs).toContain('fitWindow=false');
    expect(pairs).not.toContain('fitWindow=true');
    expect(pairs).toContain('stats=1');
    expect(pairs).toContain('env=%22WINEDEBUG:-all%22');
    expect(pairs).toContain('a%23b');
    expect(pairs.filter((pair) => /^(lazy|p|frida)=/.test(pair))).toEqual([
      'lazy=opfs%3Avnbox%2Fgabc',
      'p=a.exe',
      'frida=blob%3Ahttp%3A%2F%2Fx%2F1'
    ]);
  });
});

describe('fittedTuning', () => {
  it('starts a capped game once on a big screen, then keeps the size its window took', () => {
    // Muramasa: 1024x576, capped to 806x576 on the 800x600 start.
    expect(fittedTuning('stats=1', 806, 576)).toEqual({
      tuning: 'stats=1&resolution=1920x1200',
      restart: true
    });
    // The big screen itself, then its 320x240 splash, before the game's window.
    expect(fittedTuning('stats=1&resolution=1920x1200', 1920, 1200)).toBeUndefined();
    expect(fittedTuning('stats=1&resolution=1920x1200', 320, 240)).toBeUndefined();
    expect(fittedTuning('stats=1&resolution=1920x1200', 1024, 576)).toEqual({
      tuning: 'stats=1&resolution=1024x576',
      restart: false
    });
  });

  it('leaves games that fit, display modes and tuned sizes alone', () => {
    expect(fittedTuning('', 800, 600)).toBeUndefined();
    expect(fittedTuning('', 640, 480)).toBeUndefined();
    expect(fittedTuning('', 1024, 768)).toBeUndefined();
    expect(fittedTuning('resolution=1024x576', 806, 576)).toBeUndefined();
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

describe('copyWindowsGame', () => {
  /** An in-memory OPFS: folders are Maps, files their bytes; writes land on close only. */
  function fakeOpfs() {
    const lookups: string[] = [];
    const dir = (path: string, entries = new Map<string, any>()): any => ({
      entries,
      async getDirectoryHandle(name: string, { create = false } = {}) {
        lookups.push(`${path}${name}/`);
        if (!entries.has(name)) {
          if (!create) throw new DOMException('missing', 'NotFoundError');
          entries.set(name, dir(`${path}${name}/`));
        }
        return entries.get(name);
      },
      async getFileHandle(name: string) {
        if (!entries.has(name)) entries.set(name, { bytes: new Uint8Array(), writes: 0 });

        const entry = entries.get(name);

        return {
          getFile: async () => ({ size: entry.bytes.length }),
          createWritable: async () => {
            const chunks: Uint8Array[] = [];

            return new WritableStream<Uint8Array>({
              write: (chunk) => void chunks.push(chunk),
              close: () => {
                entry.bytes = new Uint8Array(chunks.flatMap((chunk) => [...chunk]));
                entry.writes += 1;
              }
            });
          }
        };
      }
    });
    const root = dir('');

    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });
    return { root, lookups };
  }

  const file = (text: string, gate?: Promise<void>) =>
    ({
      size: text.length,
      stream: () =>
        new ReadableStream({
          async pull(controller) {
            await gate;
            controller.enqueue(new TextEncoder().encode(text));
            controller.close();
          }
        })
    }) as unknown as File;
  const game = (root: any) => root.entries.get('vnbox').entries.get('g1').entries;

  afterEach(() => vi.unstubAllGlobals());

  it('copies every file, looks each folder up once and skips files already copied', async () => {
    const { root, lookups } = fakeOpfs();
    const files = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`data/sub/f${i}.bin`, file(`file ${i}`)])
    );

    files['game.exe'] = file('MZ');
    await copyWindowsGame('g1', files, () => {});

    const sub = game(root).get('data').entries.get('sub').entries;

    expect(sub.size).toBe(20);
    expect(new TextDecoder().decode(sub.get('f7.bin').bytes)).toBe('file 7');
    expect(lookups.filter((path) => path === 'vnbox/g1/data/sub/')).toHaveLength(1);

    const progress: number[] = [];

    await copyWindowsGame('g1', files, (done) => progress.push(done));
    expect(sub.get('f7.bin').writes).toBe(1);
    expect(progress.at(-1)).toBe(Object.values(files).reduce((sum, f) => sum + f.size, 0));
  });

  it('stops on abort, keeps no cut-off file and resumes by size', async () => {
    const { root } = fakeOpfs();
    const abort = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const files = {
      'a.txt': file('aaa'),
      'slow.bin': file('slow', gate),
      'z.txt': file('zzz')
    };
    const copying = copyWindowsGame('g1', files, () => {}, abort.signal);

    await new Promise((resolve) => setTimeout(resolve, 10));
    abort.abort();
    release();
    await expect(copying).rejects.toThrow();
    expect(game(root).get('slow.bin').bytes.length).toBe(0);

    await copyWindowsGame('g1', files, () => {});
    expect(new TextDecoder().decode(game(root).get('slow.bin').bytes)).toBe('slow');
    expect(game(root).get('a.txt').writes).toBe(1);
  });
});

describe('rankThreads', () => {
  const thread = (id: string, recent: [string, number][]): HookThread => ({
    id,
    kind: 'search',
    count: recent.length,
    recent: recent.map(([text, click]) => ({ text, click }))
  });

  it('puts the one-line-per-click Japanese thread first', () => {
    const ranked = rankThreads([
      thread('chars', [
        ['今', 1],
        ['日', 1],
        ['は', 1]
      ]),
      thread('menu', [
        ['Start', 1],
        ['Start', 2],
        ['Start', 3]
      ]),
      thread('lines', [
        ['今日は晴れ。', 1],
        ['「行こうか」', 2],
        ['空が青い。', 3]
      ]),
      thread('quiet', [])
    ]);

    expect(ranked[0]).toEqual({ thread: expect.objectContaining({ id: 'lines' }), score: 1 });
    expect(ranked.slice(1).map(({ score }) => score)).toEqual([0, 0, 0]);
  });
});

describe('savedHookName', () => {
  it('names the script, the bundled file or none', () => {
    expect(savedHookName({ hook: '// @name  Muramasa\nfoo()' })).toBe('Muramasa');
    expect(savedHookName({ hook: 'foo()' })).toBe('Chosen script');
    expect(savedHookName({ hookFile: 'PC_Muramasa.js' })).toBe('PC_Muramasa.js');
    expect(savedHookName({})).toBeUndefined();
  });
});
