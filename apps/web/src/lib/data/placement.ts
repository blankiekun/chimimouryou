/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The placement check (/placement): a yes/no vocabulary test over Jiten frequency bands,
 * LexTALE style, with 7 made-up words spread through it to catch yes-bias. Adaptive: it starts mid-range
 * and moves a band up after a yes and down after a no, so most words land near the reader's
 * boundary. The result is one number, a frequency rank where a logistic curve of yes over
 * log(rank), shifted down by the false-alarm rate, crosses one half: word list rows ranked
 * at or above it count as known (`getKnownSet`). Synced in sharedSettings.
 * Items: placement-items.json, built by scripts/placement/build-items.py. Not part of upstream.
 */

import { writableBooleanLocalStorageSubject } from '$lib/data/internal/writable-boolean-local-storage-subject';
import { writableNumberLocalStorageSubject } from '$lib/data/internal/writable-number-local-storage-subject';
import placementItems from '$lib/data/placement-items.json';

export interface PlacementItem {
  /** The word shown */
  w: string;
  /** Jiten rank; absent for made-up words */
  r?: number;
  /** Band index into `bands`; absent for made-up words */
  b?: number;
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
}

export const placementBands: number[] = placementItems.bands;
export const placementList: PlacementItem[] = placementItems.items;
/** Words per test; 7 of them made up, one in each eighth (`isPseudoSlot`) */
export const placementLength = 60;

/** The band of the 5,000 most common words */
const startBand = Math.max(
  0,
  placementBands.findIndex((high) => high >= 5000)
);
/** The first answers move two bands, so a native reader reaches the last band (the end of
 * the frequency list) in about six answers */
const fastSteps = 6;
/** 4 of 7 made-up words answered yes: no result (up to 3 slips only shift the curve) */
const maxFalseAlarmRate = 0.5;
const pseudoEvery = 8;

/** Positions 4, 12, 20 … 52: the made-up words, spread through the test. */
export const isPseudoSlot = (index: number) => index % pseudoEvery === pseudoEvery / 2;
export const placementPseudoWords = Math.ceil((placementLength - pseudoEvery / 2) / pseudoEvery);
const pivot = Math.log(5000);

/** 0: not taken (or nothing known). */
export const placementCutoff$ = writableNumberLocalStorageSubject()('placementCutoff', 0);
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
  bands = placementBands
): PlacementItem | undefined {
  if (answers.length >= placementLength) return undefined;

  const used = new Set(answers.map(({ item }) => item.w));
  const unused = items.filter((item) => !used.has(item.w));
  const pick = (pool: PlacementItem[]) => pool[Math.floor(random() * pool.length)];

  if (isPseudoSlot(answers.length)) {
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
 * the made-up words got a yes.
 */
export function scorePlacement(
  answers: PlacementAnswer[],
  bands = placementBands
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
  const target = 0.5 + falseRate;
  const top = bands[bands.length - 1];
  let rank: number;

  if (b >= 0) {
    // Not falling with rank (too few or odd answers): all or nothing by the yes rate.
    rank = real.filter(({ yes }) => yes).length / real.length > target ? top : 0;
  } else {
    rank = Math.exp((Math.log(target / (1 - target)) - a) / b + pivot);
  }

  return { ...result, cutoff: Math.min(top, Math.round(Math.max(0, rank) / 100) * 100) };
}
