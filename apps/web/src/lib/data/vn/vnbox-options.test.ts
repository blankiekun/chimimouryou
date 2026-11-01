/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fallbackKnobs,
  knobGroups,
  knobParams,
  knobsFromRegistry,
  loadVnboxKnobs,
  playerDefaults,
  splitTuning,
  validKnobValue,
  type Knob
} from '$lib/data/vn/vnbox-options';
import { vnboxPlayerUrl } from '$lib/data/vn/windows-game';

// The Tuning sheet's knobs from VNBox's vnbox-options.json (schema 1). Ways it could go wrong:
// - an old engine has no file (404, network error, HTML error page): the sheet must still show
//   the hand-written list, unchanged;
// - a newer schema or a malformed file/entry: never a broken knob; unknown schema = fallback,
//   one bad entry = that entry left out;
// - bools sent with the wrong value (fitWindow takes true/false, nativeLibc 1/0);
// - a number out of its range, or not a number, reaching the player's address;
// - a key both lists define shown twice, or the hand-written one winning;
// - knobs the registry doesn't list (audioFreq, bpp, cpu, ...) dropped;
// - the player's own defaults (fitWindow=true) shown as VNBox's (false), so "Off" does nothing;
// - saved tunings (`a=b&c=d`) changing keys or values when the sheet is opened and applied;
// - Debug knobs mixed in with the everyday ones.

const bool = (name: string, extra: object = {}) => ({
  name,
  label: name,
  description: `${name} does a thing.`,
  type: 'bool',
  default: true,
  urlValues: { true: '1', false: '0' },
  group: 'Speed',
  restart: true,
  experimental: false,
  ...extra
});

const registry = {
  schema: 1,
  groups: ['Speed', 'Display', 'Debug'],
  options: [
    bool('nativeLibc'),
    {
      name: 'fastX87',
      label: 'Fast x87 maths',
      description: 'x87 state.',
      type: 'choice',
      default: 1,
      choices: [
        { value: 0, label: 'Exact' },
        { value: 1, label: 'Fast' },
        { value: 2, label: 'Fastest', experimental: true }
      ],
      group: 'Speed',
      restart: true,
      experimental: false
    },
    bool('hostWined3d', { experimental: true }),
    {
      name: 'fps',
      label: 'Frame rate cap',
      description: 'Most frames per second.',
      type: 'int',
      default: 60,
      min: 0,
      max: 240,
      group: 'Display',
      restart: true,
      experimental: false
    },
    bool('fitWindow', {
      default: false,
      urlValues: { true: 'true', false: 'false' },
      group: 'Display'
    }),
    bool('stats', { default: false, group: 'Debug' }),
    {
      name: 'scale',
      label: 'Scale',
      description: 'A float.',
      type: 'float',
      default: 1,
      min: 0.5,
      max: 2,
      group: 'Display',
      restart: false,
      experimental: false
    }
  ]
};

const knob = (knobs: Knob[], key: string) => knobs.find((k) => k.key === key)!;

describe('knobsFromRegistry', () => {
  const knobs = knobsFromRegistry(registry)!;

  it('makes a switch per bool with the entry’s own on/off values', () => {
    expect(knob(knobs, 'nativeLibc')).toMatchObject({ on: '1', off: '0', initial: '1' });
    expect(knob(knobs, 'stats')).toMatchObject({ on: '1', off: '0', initial: '0' });
  });

  it('keeps the player’s own default where vnboxPlayerUrl sets one', () => {
    expect(knob(knobs, 'fitWindow')).toMatchObject({ on: 'true', off: 'false', initial: 'true' });
    const params = new URL(
      vnboxPlayerUrl({ encoding: 'sjis', files: [], engine: 'vnbox', folder: 'g', exe: 'a.exe' }),
      'http://x/'
    ).searchParams;

    for (const [key, value] of Object.entries(playerDefaults)) expect(params.get(key)).toBe(value);
  });

  it('makes a segmented control per choice, marking experimental values', () => {
    const fast = knob(knobs, 'fastX87');

    expect(fast.initial).toBe('1');
    expect(fast.options!.map((o) => o.id)).toEqual(['0', '1', '2']);
    expect(fast.options![2].text).toMatch(/experimental/i);
    expect(fast.options![1].text).not.toMatch(/experimental/i);
  });

  it('marks experimental knobs and notes restarts', () => {
    expect(knob(knobs, 'hostWined3d').title).toMatch(/experimental/i);
    expect(knob(knobs, 'nativeLibc').title).not.toMatch(/experimental/i);
    expect(knob(knobs, 'nativeLibc').hint).toMatch(/restart/i);
    expect(knob(knobs, 'scale').hint).not.toMatch(/restart/i);
  });

  it('lets registry entries win and keeps hand-written knobs it doesn’t list', () => {
    expect(knobs.filter((k) => k.key === 'fps')).toHaveLength(1);
    expect(knob(knobs, 'fps').number).toEqual({ min: 0, max: 240, int: true });
    for (const key of ['audioFreq', 'bpp', 'cpu', 'resolution', 'disableWasmJitForWrittenCode'])
      expect(knob(knobs, key)).toEqual({ ...knob(fallbackKnobs, key), group: expect.any(String) });
  });

  it('groups in the registry’s order with Debug last', () => {
    const groups = knobGroups(knobs).map((g) => g.name);

    expect(groups[0]).toBe('Speed');
    expect(groups.at(-1)).toBe('Debug');
    expect(
      knobGroups(knobs)
        .find((g) => g.name === 'Debug')!
        .knobs.map((k) => k.key)
    ).toEqual(['stats']);
  });

  it('refuses an unknown schema or a file that isn’t a registry', () => {
    for (const json of [{ ...registry, schema: 2 }, {}, [], null, 'x', { schema: 1, options: 3 }])
      expect(knobsFromRegistry(json)).toBeUndefined();
  });

  it('leaves out malformed entries, never the whole list', () => {
    const knobs = knobsFromRegistry({
      schema: 1,
      options: [
        bool('ok'),
        bool('bad name'),
        bool('a&b'),
        bool('noValues', { urlValues: undefined }),
        { ...registry.options[3], name: 'inverted', min: 10, max: 1 },
        { ...registry.options[3], name: 'outside', default: 500 },
        { ...registry.options[1], name: 'emptyChoice', choices: [] },
        { name: 'what', type: 'colour', default: 1, group: 'Speed' },
        7
      ]
    })!;

    expect(
      knobs.filter((k) => !fallbackKnobs.some((f) => f.key === k.key)).map((k) => k.key)
    ).toEqual(['ok']);
  });
});

describe('validKnobValue', () => {
  const knobs = knobsFromRegistry(registry)!;

  it('accepts numbers inside the range only', () => {
    const fps = knob(knobs, 'fps');

    expect(['0', '30', '240'].map((v) => validKnobValue(fps, v))).toEqual([true, true, true]);
    expect(
      ['-1', '241', '30.5', '', '1e2', '30&p=evil', ' 30', 'NaN'].map((v) => validKnobValue(fps, v))
    ).toEqual([false, false, false, false, false, false, false, false]);
    const scale = knob(knobs, 'scale');

    expect(['0.5', '1.25', '2'].every((v) => validKnobValue(scale, v))).toBe(true);
    expect(['0.4', '2.1', 'x', 'Infinity'].some((v) => validKnobValue(scale, v))).toBe(false);
  });

  it('takes only the listed values for switches and segmented controls', () => {
    expect(validKnobValue(knob(knobs, 'fastX87'), '2')).toBe(true);
    expect(validKnobValue(knob(knobs, 'fastX87'), '3')).toBe(false);
    expect(validKnobValue(knob(knobs, 'nativeLibc'), '0')).toBe(true);
    expect(validKnobValue(knob(knobs, 'nativeLibc'), 'yes')).toBe(false);
  });
});

describe('saved tunings', () => {
  const saved = 'fps=30&stats=1&fitWindow=false&bpp=16&registry=jpfonts%2Cgdi&foo=bar&cpu=p3';

  it('come back out unchanged through the registry knobs and the fallback alike', () => {
    for (const knobs of [knobsFromRegistry(registry)!, fallbackKnobs]) {
      const { values, extra } = splitTuning(knobs, saved);

      expect(extra).toBe('foo=bar');
      expect(new Set(knobParams(knobs, values))).toEqual(
        new Set(['fps=30', 'stats=1', 'fitWindow=false', 'bpp=16', 'cpu=p3'])
      );
    }
  });

  it('drop an out-of-range number before it reaches the address', () => {
    const knobs = knobsFromRegistry(registry)!;
    const { values } = splitTuning(knobs, 'fps=999&nativeLibc=0');

    expect(knobParams(knobs, values)).toEqual(['nativeLibc=0']);
    expect(knobParams(knobs, { fps: '' })).toEqual([]);
    expect(knobParams(knobs, { fps: '60' })).toEqual([]);
  });
});

describe('loadVnboxKnobs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches vnbox-options.json from the engine’s folder', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(registry)));

    vi.stubGlobal('fetch', fetch);
    expect(knob(await loadVnboxKnobs(), 'fastX87')).toBeDefined();
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toMatch(
      /\/vn\/vnbox\/vnbox-options\.json$/
    );
  });

  it('falls back to the hand-written list on an old engine', async () => {
    for (const answer of [
      () => new Response('not found', { status: 404 }),
      () => new Response('<!doctype html>'),
      () => {
        throw new TypeError('offline');
      }
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => answer())
      );
      expect(await loadVnboxKnobs()).toBe(fallbackKnobs);
    }
  });
});
