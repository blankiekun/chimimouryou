/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The placement check (/placement): a yes/no vocabulary test over Jiten frequency bands,
 * LexTALE style, 20, 40 or 60 words with 3, 5 or 7 made-up ones spread through it to catch
 * yes-bias. Adaptive: it starts mid-range
 * and moves a band up after a yes and down after a no, so most words land near the reader's
 * boundary. The result is one number, a frequency rank where a logistic curve of yes over
 * log(rank), shifted down by the false-alarm rate, crosses one half: word list rows ranked
 * at or above it count as known (`getKnownSet`). Every result is kept with its date
 * (`placementResults$`, synced in sharedSettings, merged by date): the latest one counts, also
 * when lower, and the history (words-history.ts) uses the one in force each day.
 * Items: placement-items.json, built by scripts/placement/build-items.py. Not part of upstream.
 *
 * Hard mode (/hard-word-test, /placement?mode=hard) asks each word's reading, typed, then its
 * meaning from four choices, and counts a word only when both are right. Same bands, staircase
 * and fit, no made-up words: the target is raised for lucky guesses (`hardGuess`) instead. Its
 * items (placement-hard-items.json, scripts/placement/build-hard-items.py) load only when it
 * starts. Its results are kept as `mode: 'typed'` records; the stricter latest of the two modes
 * counts. The first hard mode (`mode: 'hard'`) chose readings too, which careful elimination
 * beat (one reader got 400k): its results are kept but count for nothing.
 */

import { writableBooleanLocalStorageSubject } from '$lib/data/internal/writable-boolean-local-storage-subject';
import { writableArrayLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';
import { writableNumberLocalStorageSubject } from '$lib/data/internal/writable-number-local-storage-subject';
import placementItems from '$lib/data/placement-items.json';
import { convertToHiragana } from '$lib/vendor/yomitan/language/ja/japanese-wanakana';
import { convertKatakanaToHiragana } from '$lib/vendor/yomitan/language/ja/japanese';
import { arrayOf, isRecord } from '$lib/data/setting-parsers';

export interface PlacementItem {
  /** The word shown */
  w: string;
  /** Jiten rank; absent for made-up words */
  r?: number;
  /** Band index into `bands`; absent for made-up words */
  b?: number;
}

/** A hard-mode item: every accepted reading (the main one first) and four meanings, the right one first. */
export interface HardItem extends PlacementItem {
  k: string[];
  m: string[];
}

export interface PlacementAnswer {
  item: PlacementItem;
  yes: boolean;
}

export interface PlacementResult {
  /** Estimated words known: rows ranked 1…cutoff count as known */
  cutoff: number;
  /** Made-up words answered yes, and how many were shown */
  falseAlarms: number;
  pseudoWords: number;
  /** Too many made-up words answered yes: nothing is saved */
  retake: boolean;
  /** Words known, the number shown: the chance of knowing each rank summed over the list */
  words?: number;
  /** The curve `words` sums (`knownChance`) */
  curve?: PlacementCurve;
}

/**
 * A result's fitted curve: the chance a word of rank r is known is
 * 1 / (1 + e^-(shift + slope·(ln r − ln 5000))), 1 below `firstNo` (the most common word
 * answered no), 0 past the list.
 */
export interface PlacementCurve {
  shift: number;
  slope: number;
  firstNo: number;
}

export const placementBands: number[] = placementItems.bands;
export const placementList: PlacementItem[] = placementItems.items;
/** Test lengths the reader picks from, and the default */
export const placementLengths = [20, 40, 60];
export const placementLength = 40;
/** Made-up words per length: about 1 in 8, at least 3 */
const pseudoWords: Record<number, number> = { 20: 3, 40: 5, 60: 7 };

/** The band of the 5,000 most common words */
const startBand = Math.max(
  0,
  placementBands.findIndex((high) => high >= 5000)
);
/** The first answers move two bands, so a native reader reaches the last band (the end of
 * the frequency list) in about six answers */
const fastSteps = 6;
/**
 * More than half the made-up words answered yes (2 of 3, 3 of 5, 4 of 7): no result. Fewer
 * slips only shift the curve down.
 */
const maxFalseAlarmRate = 0.5;

/** How many of a test's words are made up. */
export const placementPseudoWords = (length = placementLength) =>
  pseudoWords[length] ?? Math.max(3, Math.round(length / 8));

/** Whether word `index` of a test of `length` is a made-up one: spread evenly through it. */
export function isPseudoSlot(index: number, length = placementLength) {
  const count = placementPseudoWords(length);

  return Array.from({ length: count }, (_, k) => Math.floor(((k + 0.5) * length) / count)).includes(
    index
  );
}
const pivot = Math.log(5000);

/** One test result. `typed`: hard mode, stored the same way; `hard`: its retired first version. */
export interface PlacementRecord {
  mode: 'yesno' | 'typed' | 'hard';
  /** When it was taken (ms); 0 for a result from before dates were kept */
  date: number;
  cutoff: number;
  /** Words in the test (20, 40 or 60) */
  length: number;
  /** The words known shown for it (`PlacementResult.words`); older results show the cutoff */
  words?: number;
  /** The curve `words` sums; older results have none */
  curve?: PlacementCurve;
}

/** What words known needs of a result. */
export type PlacementEstimate = Pick<PlacementRecord, 'cutoff' | 'words' | 'curve'>;

/** Every result, oldest first. */
export const placementResults$ = writableArrayLocalStorageSubject<PlacementRecord>()(
  'placementResults',
  [],
  arrayOf<PlacementRecord>(isRecord)
);
/** The cutoff in force now, from `placementResults$` (0: not taken, or nothing known). */
export const placementCutoff$ = writableNumberLocalStorageSubject()('placementCutoff', 0);
/** Words in the test that gave `placementCutoff$` (20, 40 or 60). */
export const placementCutoffLength$ = writableNumberLocalStorageSubject()(
  'placementCutoffLength',
  0
);

/** Both devices' results, one per mode and date, oldest first. */
export function mergePlacementResults(
  local: PlacementRecord[] = [],
  remote: PlacementRecord[] = []
) {
  const byKey = new Map(
    [...local, ...remote].map((record) => [`${record.mode}|${record.date}`, record])
  );

  return [...byKey.values()].sort((a, b) => a.date - b.date || (a.mode < b.mode ? -1 : 1));
}

/**
 * The result in force at `date`: each mode's latest one by then, and of those the stricter
 * (lower cutoff); retired `hard` results don't count. Undefined before the first.
 */
export function placementAt(results: PlacementRecord[], date = Infinity) {
  const latest = new Map<string, PlacementRecord>();

  for (const record of results) {
    if (record.mode === 'hard') continue;
    if (record.date <= date && !((latest.get(record.mode)?.date ?? -1) > record.date)) {
      latest.set(record.mode, record);
    }
  }

  return [...latest.values()].sort((a, b) => a.cutoff - b.cutoff)[0];
}

/** Saves a result taken now; it replaces the earlier ones of its mode. */
export function recordPlacement(
  mode: PlacementRecord['mode'],
  cutoff: number,
  length: number,
  words?: number,
  curve?: PlacementCurve
) {
  placementResults$.next(
    mergePlacementResults(placementResults$.getValue(), [
      {
        mode,
        date: Date.now(),
        cutoff,
        length,
        ...(words !== undefined && { words }),
        ...(curve && { curve })
      }
    ])
  );
}

/** The words known a result shows: its estimate, else (older results) its cutoff. */
export const placementWords = (record?: { cutoff: number; words?: number }) =>
  record?.words ?? record?.cutoff ?? 0;

/**
 * The chance `placementWords` already counts a word of this rank as known: its curve, or for
 * a result without one, 1 within the cutoff. 0 without a result or a rank.
 */
export function knownChance(
  record: PlacementEstimate | undefined,
  rank: number | null | undefined
) {
  if (!record || rank == null) return 0;

  const { curve } = record;

  if (!curve) return rank <= record.cutoff ? 1 : 0;
  if (rank >= placementBands[placementBands.length - 1]) return 0;

  return rank < curve.firstNo
    ? 1
    : 1 / (1 + Math.exp(-(curve.shift + curve.slope * (Math.log(rank) - pivot))));
}

// A result saved before dates were kept becomes an undated first one.
if (!placementResults$.getValue().length && placementCutoff$.getValue() > 0) {
  placementResults$.next([
    {
      mode: 'yesno',
      date: 0,
      cutoff: placementCutoff$.getValue(),
      length: placementCutoffLength$.getValue()
    }
  ]);
}
placementResults$.subscribe((results) => {
  const current = placementAt(results);

  if (!current) return;
  if (placementCutoff$.getValue() !== current.cutoff) placementCutoff$.next(current.cutoff);
  if (placementCutoffLength$.getValue() !== current.length) {
    placementCutoffLength$.next(current.length);
  }
});
/** Home offered the check once (per browser). */
export const placementOffered$ = writableBooleanLocalStorageSubject()('placementOffered', false);
/** The result came from the public word test (/word-test): Home says so once. */
export const placementFromWordTest$ = writableBooleanLocalStorageSubject()(
  'placementFromWordTest',
  false
);

/** The current cutoff, 0 when unset or invalid. */
export function placementCutoff() {
  const value = placementCutoff$.getValue();

  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Chance of getting a hard item right without knowing it: the meaning's four choices. A typed
 * reading is right by luck far less often, so this errs on the strict side.
 */
export const hardGuess = 0.25;

/** One mode's latest result, if it was taken. */
export const latestPlacement = (results: PlacementRecord[], mode: PlacementRecord['mode']) =>
  placementAt(results.filter((record) => record.mode === mode));

/** Kana as typed, romaji converted, katakana folded to hiragana. */
export const typedKana = (text: string) =>
  convertKatakanaToHiragana(convertToHiragana(text.replace(/\s+/g, '')), true);

/** Whether `typed` is one of the item's readings. */
export const readingMatches = (item: HardItem, typed: string) =>
  item.k.some((reading) => typedKana(reading) === typedKana(typed));

/** Hard mode's items, loaded when it starts (bigger than the yes/no ones). */
export const loadHardItems = () =>
  import('$lib/data/placement-hard-items.json').then((m) => m.default.items as HardItem[]);

/** A copy of `list` in random order. */
export function shuffle<T>(list: T[], random = Math.random) {
  const out = [...list];

  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));

    [out[i], out[j]] = [out[j], out[i]];
  }

  return out;
}

/** The band the next real word comes from: one step up per yes, down per no. */
export function currentBand(answers: PlacementAnswer[], bands = placementBands) {
  let band = Math.min(startBand, bands.length - 1);
  let real = 0;

  for (const { item, yes } of answers) {
    if (item.b === undefined) continue;

    const step = real < fastSteps ? 2 : 1;

    band = Math.min(bands.length - 1, Math.max(0, band + (yes ? step : -step)));
    real += 1;
  }

  return band;
}

/** The next word to show, or undefined when the test is over. */
export function nextItem(
  answers: PlacementAnswer[],
  items = placementList,
  random = Math.random,
  bands = placementBands,
  length = placementLength
): PlacementItem | undefined {
  if (answers.length >= length) return undefined;

  const used = new Set(answers.map(({ item }) => item.w));
  const unused = items.filter((item) => !used.has(item.w));
  const pick = (pool: PlacementItem[]) => pool[Math.floor(random() * pool.length)];

  if (isPseudoSlot(answers.length, length)) {
    const pseudo = unused.filter((item) => item.b === undefined);

    if (pseudo.length) return pick(pseudo);
  }

  const band = currentBand(answers, bands);

  // The band's words, else the nearest band with words left (below first).
  for (let distance = 0; distance < bands.length; distance += 1) {
    for (const b of [band - distance, band + distance]) {
      const pool = unused.filter((item) => item.b === b);

      if (pool.length) return pick(pool);
    }
  }

  return undefined;
}

/**
 * Fits P(yes) = 1 / (1 + e^-(a + b·x)), x = ln(rank) − ln(5000), by Newton's method with
 * a small ridge, which keeps it finite when yes and no don't overlap (a perfect knower).
 */
export function fitLogistic(points: { x: number; y: number }[], ridge = 0.05) {
  let a = 0;
  let b = 0;

  for (let i = 0; i < 50; i += 1) {
    let ga = ridge * a;
    let gb = ridge * b;
    let haa = ridge;
    let hab = 0;
    let hbb = ridge;

    for (const { x, y } of points) {
      const p = 1 / (1 + Math.exp(-(a + b * x)));
      const w = p * (1 - p);

      ga += p - y;
      gb += (p - y) * x;
      haa += w;
      hab += w * x;
      hbb += w * x * x;
    }

    const det = haa * hbb - hab * hab;

    if (!det) break;

    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;

    a -= da;
    b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }

  return { a, b };
}

/**
 * The rank where the fitted yes rate on real words, less the false-alarm rate, crosses
 * one half; rounded to 100 and kept within the bands. No result when more than half of
 * the made-up words got a yes. `guess`, the chance of a right answer by luck (hard mode),
 * moves the target to where the share actually known is one half: g + (1 − g) / 2.
 */
export function scorePlacement(
  answers: PlacementAnswer[],
  bands = placementBands,
  guess = 0
): PlacementResult {
  const pseudo = answers.filter(({ item }) => item.r === undefined);
  const real = answers.filter(({ item }) => item.r !== undefined);
  const falseAlarms = pseudo.filter(({ yes }) => yes).length;
  const falseRate = pseudo.length ? falseAlarms / pseudo.length : 0;
  const result = { cutoff: 0, falseAlarms, pseudoWords: pseudo.length, retake: false };

  if (falseRate > maxFalseAlarmRate) return { ...result, retake: true };
  if (!real.length) return result;

  const { a, b } = fitLogistic(
    real.map(({ item, yes }) => ({ x: Math.log(item.r!) - pivot, y: yes ? 1 : 0 }))
  );
  const target = 0.5 + falseRate + guess / 2;
  const top = bands[bands.length - 1];
  let rank: number;

  if (b >= 0) {
    // Not falling with rank (too few or odd answers): all or nothing by the yes rate.
    rank = real.filter(({ yes }) => yes).length / real.length > target ? top : 0;
  } else {
    rank = Math.exp((Math.log(target / (1 - target)) - a) / b + pivot);
  }

  const cutoff = Math.min(top, Math.round(Math.max(0, rank) / 100) * 100);

  if (b >= 0) return { ...result, cutoff };

  // Words known: the curve, shifted like the cutoff so it is one half there, summed over the
  // list, all known below the most common word answered no. Measured against the cutoff on
  // simulated readers it is about a quarter closer, but the staircase rarely shows words far
  // past the boundary, so a reader who knows some of the rare ones is still undercounted.
  // Capped at the list's end: no "no" at all stays a finite number when synced.
  const firstNo = Math.min(top, ...real.filter(({ yes }) => !yes).map(({ item }) => item.r!));
  const shift = a - Math.log(target / (1 - target));
  let words = 0;

  for (let r = 5; r < top; r += 10) {
    words += r < firstNo ? 10 : 10 / (1 + Math.exp(-(shift + b * (Math.log(r) - pivot))));
  }

  return {
    ...result,
    cutoff,
    words: Math.round(words / 100) * 100,
    curve: { shift, slope: b, firstNo }
  };
}
