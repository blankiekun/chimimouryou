/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The pure parts of manga text made in the browser (manga-ocr.worker.ts): model inputs from pixels,
 * the detector's boxes, manga-ocr's greedy decoding and post-processing, and a block's text split
 * over the columns (or rows) seen in its ink, so the overlay has one line per column as mokuro
 * gives. Not part of upstream.
 */

import type { MokuroBlock } from '$lib/data/manga/mokuro';

export type Box = [number, number, number, number];

/** RT-DETR's input side and manga-ocr's */
export const detectorSize = 640;
export const ocrSize = 224;
/** manga-ocr's [CLS] (start) and [SEP] (end) ids; ids up to 4 are special tokens */
export const startId = 2;
export const endId = 3;
export const maxTokens = 300;
/** ogkalu's labels: 0 bubble, 1 text in a bubble, 2 free text */
const textLabels = new Set([1, 2]);
const minScore = 0.5;

/** RGBA pixels (detectorSize²) → the detector's [1, 3, H, W] input, 0-1 */
export function detectorInput(rgba: Uint8ClampedArray) {
  const area = rgba.length / 4;
  const input = new Float32Array(area * 3);

  for (let i = 0; i < area; i += 1) {
    input[i] = rgba[i * 4] / 255;
    input[area + i] = rgba[i * 4 + 1] / 255;
    input[area * 2 + i] = rgba[i * 4 + 2] / 255;
  }

  return input;
}

/** PIL's convert('L') weights, as manga-ocr greys its crops */
const grey = (rgba: Uint8ClampedArray, i: number) =>
  (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;

/** RGBA pixels (ocrSize²) → manga-ocr's [1, 3, 224, 224] input: grey in 3 channels, -1 to 1 */
export function ocrInput(rgba: Uint8ClampedArray) {
  const area = rgba.length / 4;
  const input = new Float32Array(area * 3);

  for (let i = 0; i < area; i += 1) {
    const value = grey(rgba, i) / 127.5 - 1;

    input[i] = value;
    input[area + i] = value;
    input[area * 2 + i] = value;
  }

  return input;
}

/** The detector's text boxes (not bare bubbles) in page pixels, clamped, tiny ones dropped. */
export function textBoxes(
  scores: ArrayLike<number>,
  labels: ArrayLike<number | bigint>,
  boxes: ArrayLike<number>,
  width: number,
  height: number
): Box[] {
  const found: Box[] = [];

  for (let i = 0; i < scores.length; i += 1) {
    if (scores[i] < minScore || !textLabels.has(Number(labels[i]))) continue;

    const box = Array.from({ length: 4 }, (_, j) =>
      Math.round(Math.min(Math.max(boxes[i * 4 + j], 0), j % 2 ? height : width))
    ) as Box;

    if (box[2] - box[0] > 4 && box[3] - box[1] > 4) found.push(box);
  }

  return found;
}

/** The likeliest next token: the arg max of the logits' last step ([1, steps, size]). */
export function nextToken(logits: ArrayLike<number>, steps: number, size: number) {
  const offset = (steps - 1) * size;
  let best = 0;

  for (let k = 1; k < size; k += 1) {
    if (logits[offset + k] > logits[offset + best]) best = k;
  }

  return best;
}

/** Token ids → text with manga-ocr's post_process: no spaces, dots runs as dots, full width. */
export function decodeText(ids: number[], vocab: string[]) {
  return ids
    .filter((id) => id > 4)
    .map((id) => (vocab[id] ?? '').replace(/^##/, ''))
    .join('')
    .replace(/\s/g, '')
    .replace(/…/g, '...')
    .replace(/[・.]{2,}/g, (dots) => '.'.repeat(dots.length))
    .replace(/[!-~]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0xfee0));
}

/**
 * The columns of a vertical block (right to left) or the rows of a horizontal one, from the dark
 * pixels of its grey crop: each with its ink length along the text. Thin runs (furigana) are left
 * out. None when the text isn't dark on light.
 */
export function inkLines(
  greyPixels: ArrayLike<number>,
  width: number,
  height: number,
  vertical: boolean
) {
  const across = vertical ? width : height;
  const along = vertical ? height : width;
  const dark = (a: number, b: number) => greyPixels[vertical ? b * width + a : a * width + b] < 128;
  const ink = new Array<number>(across).fill(0);

  for (let a = 0; a < across; a += 1) {
    for (let b = 0; b < along; b += 1) if (dark(a, b)) ink[a] += 1;
  }

  const runs: [number, number][] = [];
  let start = -1;

  for (let a = 0; a <= across; a += 1) {
    const on = a < across && ink[a] > 0;

    if (on && start < 0) start = a;
    if (!on && start >= 0) {
      runs.push([start, a]);
      start = -1;
    }
  }

  const widest = Math.max(0, ...runs.map(([from, to]) => to - from));
  const lines = runs
    .filter(([from, to]) => to - from >= widest * 0.6)
    .map(([from, to]) => {
      let first = along;
      let last = -1;

      for (let a = from; a < to; a += 1) {
        for (let b = 0; b < along; b += 1) {
          if (dark(a, b)) {
            first = Math.min(first, b);
            last = Math.max(last, b);
          }
        }
      }

      return { from, to, length: last - first + 1 };
    });

  return vertical ? lines.reverse() : lines;
}

/** Characters that may not start a line (kinsoku): they go to the end of the line before. */
const noLineStart = /^[、。，．,.！？!?」』）)】〕ーっゃゅょッャュョぁぃぅぇぉァィゥェォ…‥～〜・]/u;

/** The text split into one line per weight, in proportion to them (whole characters). */
export function splitText(text: string, weights: number[]) {
  const chars = [...text];
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  if (weights.length < 2 || chars.length < weights.length || total <= 0) return [text];

  const lines: string[][] = [];
  let at = 0;
  let sum = 0;

  for (const [index, weight] of weights.entries()) {
    sum += weight;

    const end =
      index === weights.length - 1
        ? chars.length
        : Math.max(
            at + 1,
            Math.min(
              Math.round((chars.length * sum) / total),
              chars.length - (weights.length - index - 1)
            )
          );

    lines.push(chars.slice(at, end));
    at = end;
  }

  for (let i = 1; i < lines.length; i += 1) {
    while (lines[i].length > 1 && noLineStart.test(lines[i][0]))
      lines[i - 1].push(lines[i].shift()!);
  }

  return lines.map((line) => line.join('')).filter(Boolean);
}

/**
 * A block for the overlay: its text over the ink lines found, with a font size that fits the
 * block both ways (the overlay doesn't wrap).
 */
export function toBlock(box: Box, text: string, lines: { length: number }[]): MokuroBlock {
  const width = box[2] - box[0];
  const height = box[3] - box[1];
  const vertical = height > width;
  const split = splitText(
    text,
    lines.map((line) => line.length)
  );
  const across = vertical ? width : height;
  const along = vertical ? height : width;
  const longest = Math.max(1, ...split.map((line) => [...line].length));

  return {
    box,
    vertical,
    fontSize: Math.max(1, Math.round(Math.min((across / split.length) * 0.8, along / longest))),
    lines: split
  };
}
