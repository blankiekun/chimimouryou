/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { pagePath } from '$lib/data/env';
import { compatKeys } from '$lib/data/vn/windows-game';

/**
 * The /v Tuning sheet's VNBox settings: built from vnbox-options.json, which VNBox ships next to
 * its engine (schema 1, docs/VNBox-Options.md in VNBox), plus the hand-written knobs it doesn't
 * list. An engine without the file (VNBox v0.2.8 and older) gets the hand-written list alone.
 */
export interface Knob {
  key: string;
  title: string;
  hint: string;
  /** The value VNBox runs with when the key isn't set ('' = not in the address) */
  initial: string;
  shown: string;
  /** A heading the sheet groups knobs under; none in the hand-written list */
  group?: string;
  /** A segmented control's values */
  options?: { id: string; text: string }[];
  /** A switch's values */
  on?: string;
  off?: string;
  /** A number field's range */
  number?: { min: number; max: number; int: boolean };
}

/** What vnboxPlayerUrl sends when the key isn't tuned, where it isn't VNBox's own default. */
export const playerDefaults: Record<string, string> = { audioFreq: '44100', fitWindow: 'true' };

// What each does: boxedwine-shell.js, startupArgs.cpp and (fps) mainloop.cpp in VNBox.
// skipFrameFPS is left out: VNBox stores it and never reads it.
export const fallbackKnobs: Knob[] = [
  {
    key: 'fps',
    title: 'Frame rate',
    hint: 'Frames shown per second at most. Lower leaves more time for the game; Unlocked shows every frame it draws. VNBox v0.2.0+.',
    initial: '60',
    shown: '60',
    options: [
      ...['30', '60', '90', '120'].map((id) => ({ id, text: id })),
      { id: '0', text: 'Unlocked' }
    ]
  },
  {
    key: 'audioFreq',
    title: 'Sound rate',
    hint: 'Sample rate of the game sound in Hz. Lower costs less work per second but sounds duller.',
    initial: '44100',
    shown: '44100',
    options: ['11025', '22050', '44100'].map((id) => ({ id, text: id }))
  },
  {
    key: 'bpp',
    title: 'Colour depth',
    hint: "Bits per pixel of Wine's screen. 16 copies half the bytes per frame; a game may look banded or refuse it.",
    initial: '32',
    shown: '32',
    options: ['8', '16', '32'].map((id) => ({ id, text: id }))
  },
  {
    key: 'cpu',
    title: 'CPU',
    hint: 'The processor games are told they run on. An older one can steer a game off SSE code paths.',
    initial: '',
    shown: 'Pentium 4',
    options: [
      { id: '', text: 'Pentium 4' },
      { id: 'p3', text: 'Pentium III' },
      { id: 'p2', text: 'Pentium II' }
    ]
  },
  {
    key: 'resolution',
    title: 'Screen size',
    hint: "Wine's screen as WIDTHxHEIGHT (each under 2000). With Fit window on, the game's window sets it.",
    initial: '',
    shown: 'automatic'
  },
  {
    key: 'fitWindow',
    title: 'Fit window',
    hint: "The game's window fills the screen without a title bar. Off shows Wine's desktop around it.",
    initial: 'true',
    shown: 'on',
    on: 'true',
    off: 'false'
  },
  {
    key: 'disableWasmJitForWrittenCode',
    title: 'No JIT for rewritten code',
    hint: 'Code the game writes over runs in the interpreter instead of being compiled again. Can help games that patch themselves.',
    initial: '',
    shown: 'off',
    on: 'true',
    off: ''
  },
  {
    key: 'stats',
    title: 'Stats',
    hint: 'Every 2 seconds, frame pacing, present and GL timings, shown under Speed now and in the console. VNBox v0.2.0+.',
    initial: '',
    shown: 'off',
    on: '1',
    off: ''
  }
];

/** Where the hand-written knobs go beside the registry's groups. */
const fallbackGroups: Record<string, string> = {
  fps: 'Display',
  audioFreq: 'Audio',
  bpp: 'Display',
  cpu: 'Speed',
  resolution: 'Display',
  fitWindow: 'Display',
  disableWasmJitForWrittenCode: 'Speed',
  stats: 'Debug'
};

const debugGroup = 'Debug';
const safeName = /^[A-Za-z][\w-]{0,63}$/;
const safeValue = /^[\w.-]{0,64}$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value.slice(0, 500) : fallback;

/** One registry entry as a knob, or undefined when it is malformed. */
function knobFromEntry(entry: unknown): Knob | undefined {
  if (!isRecord(entry) || typeof entry.name !== 'string' || !safeName.test(entry.name)) return;

  const key = entry.name;
  const experimental = entry.experimental === true;
  const base = {
    key,
    title: `${text(entry.label, key)}${experimental ? ' (experimental)' : ''}`,
    hint: `${text(entry.description)}${entry.restart === false ? '' : ' Applies on restart.'}`.trim(),
    group: text(entry.group, 'Other') || 'Other'
  };
  const player = playerDefaults[key];

  if (entry.type === 'bool') {
    const values = entry.urlValues;

    if (typeof entry.default !== 'boolean' || !isRecord(values)) return;

    const { true: on, false: off } = values;

    if (typeof on !== 'string' || typeof off !== 'string' || on === off) return;
    if (!safeValue.test(on) || !safeValue.test(off)) return;

    const initial = player ?? (entry.default ? on : off);

    return { ...base, initial, shown: initial === on ? 'on' : 'off', on, off };
  }

  if (entry.type === 'choice') {
    if (!Array.isArray(entry.choices)) return;

    const options = entry.choices.flatMap((choice) => {
      const id = isRecord(choice) ? String(choice.value ?? '') : '';

      if (!isRecord(choice) || !safeValue.test(id) || id === '') return [];

      return [
        {
          id,
          text: `${text(choice.label, id)}${choice.experimental === true ? ' (experimental)' : ''}`
        }
      ];
    });
    const initial = player ?? String(entry.default);
    const shown = options.find((option) => option.id === initial);

    if (options.length < 2 || !shown) return;

    return { ...base, initial, shown: shown.text, options };
  }

  if (entry.type === 'int' || entry.type === 'float') {
    const { min, max } = entry;
    const int = entry.type === 'int';
    const number = { min: min as number, max: max as number, int };

    if (typeof min !== 'number' || typeof max !== 'number' || !(min <= max)) return;
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;

    const knob: Knob = { ...base, initial: player ?? String(entry.default), shown: '', number };

    if (!validKnobValue(knob, knob.initial)) return;

    return { ...knob, shown: knob.initial };
  }

  return undefined;
}

/**
 * vnbox-options.json as the sheet's knobs, the hand-written ones it doesn't list kept, ordered by
 * the registry's groups; undefined for a file that isn't schema 1.
 */
export function knobsFromRegistry(json: unknown): Knob[] | undefined {
  if (!isRecord(json) || json.schema !== 1 || !Array.isArray(json.options)) return;

  const listed = json.options.map(knobFromEntry).filter((knob) => knob !== undefined);
  const keys = new Set(listed.map((knob) => knob.key));
  const knobs = [
    ...listed,
    ...fallbackKnobs
      .filter((knob) => !keys.has(knob.key))
      .map((knob) => ({ ...knob, group: fallbackGroups[knob.key] ?? 'Other' }))
  ];
  const order = [
    ...(Array.isArray(json.groups) ? json.groups.filter((g) => typeof g === 'string') : []),
    ...knobs.map((knob) => knob.group!)
  ].filter((group) => group !== debugGroup);
  const rank = (group: string) => (group === debugGroup ? Infinity : order.indexOf(group));

  return knobs.sort((a, b) => rank(a.group!) - rank(b.group!));
}

/** The knobs in their groups, Debug last; the hand-written list is one group named ''. */
export function knobGroups(knobs: Knob[]) {
  const groups: { name: string; knobs: Knob[] }[] = [];

  for (const knob of knobs) {
    const name = knob.group ?? '';
    const group = groups.find((g) => g.name === name);

    if (group) group.knobs.push(knob);
    else groups.push({ name, knobs: [knob] });
  }

  return groups.sort((a, b) => +(a.name === debugGroup) - +(b.name === debugGroup));
}

/** A value the knob can send: numbers only in their range, listed values for the rest. */
export function validKnobValue(knob: Knob, value: string) {
  if (knob.number) {
    const pattern = knob.number.int ? /^-?\d{1,10}$/ : /^-?\d{1,10}(?:\.\d{1,10})?$/;
    const number = Number(value);

    return pattern.test(value) && number >= knob.number.min && number <= knob.number.max;
  }
  if (knob.options) return knob.options.some((option) => option.id === value);
  if (knob.on !== undefined) return value === knob.on || value === knob.off;

  return true;
}

/** A saved tuning's knob values, and what is neither a knob nor Compatibility (Extra settings). */
export function splitTuning(knobs: Knob[], tuning: string) {
  const keyOf = (pair: string) => pair.split('=')[0];
  const pairs = tuning.split('&').filter(Boolean);
  const isKnob = (pair: string) =>
    knobs.some((knob) => knob.key === keyOf(pair)) || compatKeys.has(keyOf(pair));
  const values: Record<string, string> = Object.fromEntries(
    pairs
      .filter((pair) => knobs.some((knob) => knob.key === keyOf(pair)))
      .map((pair) => [keyOf(pair), pair.slice(keyOf(pair).length + 1)])
  );

  return { values, extra: pairs.filter((pair) => !isKnob(pair)).join('&') };
}

/**
 * The set knobs as `key=value`. A typed number out of its range, or the default, is left out;
 * other values are kept as saved, as before the registry.
 */
export function knobParams(knobs: Knob[], values: Record<string, string>) {
  return knobs.flatMap((knob) => {
    const value = values[knob.key];

    if (value === undefined) return [];
    if (knob.number && (value === knob.initial || !validKnobValue(knob, value))) return [];

    return [`${knob.key}=${value}`];
  });
}

/** The engine's knobs, or the hand-written list when it has no usable vnbox-options.json. */
export async function loadVnboxKnobs(): Promise<Knob[]> {
  try {
    // Beside boxedwine.js (vnbox.html loads vnbox/boxedwine.js); hosts cache /vn/vnbox/ for a day.
    const response = await fetch(`${pagePath}/vn/vnbox/vnbox-options.json`, { cache: 'no-cache' });

    return (response.ok && knobsFromRegistry(await response.json())) || fallbackKnobs;
  } catch {
    return fallbackKnobs;
  }
}
