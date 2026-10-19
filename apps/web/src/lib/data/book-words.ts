/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The book page's word coverage and "New words" (words a book uses often that are
 * rarer in general and not known yet), from the difficulty service's per-book word
 * list, and their CSV export for Anki. Not part of upstream.
 */

import { difficultyApiUrl } from '$lib/data/calibre';

/** Form, reading (null when the analyser has none), count in the book, Jiten frequency rank (null: not listed) */
export type BookWord = [string, string | null, number, number | null];

/**
 * The book's most frequent words, most frequent first; undefined if it has no word list
 * yet (404). Other failures (server restarting, signed out) throw, so they aren't cached.
 */
export async function loadBookWords(id: number): Promise<BookWord[] | undefined> {
  const response = await fetch(`${difficultyApiUrl}words/${id}`, { cache: 'no-cache' });

  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Word list: ${response.status}`);

  return foldReadings(await response.json());
}

/**
 * Rows without a reading (conjugated-only occurrences) join the form's most frequent
 * row with a reading, so 呟く with and without つぶやく are one word.
 */
export function foldReadings(words: BookWord[]): BookWord[] {
  const top = new Map<string, BookWord>();

  for (const word of words) {
    if (word[1] !== null && (top.get(word[0])?.[2] ?? -1) < word[2]) top.set(word[0], word);
  }

  const extra = new Map<BookWord, number>();
  const kept = words.filter((word) => {
    const into = word[1] === null && top.get(word[0]);

    if (into) extra.set(into, (extra.get(into) ?? 0) + word[2]);

    return !into;
  });

  return extra.size
    ? kept
        .map(
          (word): BookWord =>
            extra.has(word) ? [word[0], word[1], word[2] + extra.get(word)!, word[3]] : word
        )
        .sort((a, b) => b[2] - a[2])
    : words;
}

const numberPattern = /^[\d０-９〇一二三四五六七八九十百千万]+$/u;
export const kanjiPattern = /\p{Unified_Ideograph}/u;
const singleKanaPattern = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]$/u;

/** Rows per word list (`WORDS_PER_BOOK` in the difficulty service) */
export const wordsPerBook = 2000;

/**
 * Particles: frequent but not vocabulary to learn. The word lists carry no part of
 * speech, so they are dropped by form.
 */
export const particles = new Set(
  (
    'は が を に で と も の へ や か な ね よ わ ぞ ぜ さ て ば し から まで より だけ ほど ' +
    'くらい ぐらい など なら って けど けれど のに ので しか こそ でも ても さえ'
  ).split(' ')
);

/**
 * Not vocabulary: particles, numbers, lone kana and unlisted kana-only tokens (on real
 * books those are tokenizer noise: だ, 8, 一). The difficulty service's word totals
 * (`is_noise_word`) leave out the same.
 */
export function isNoiseWord([form, , , rank]: BookWord) {
  return (
    particles.has(form) ||
    numberPattern.test(form) ||
    singleKanaPattern.test(form) ||
    (rank === null && !kanjiPattern.test(form))
  );
}

/**
 * Words outside the `words95` most common ones (or not in the frequency list), in
 * the list's order (most frequent in the book first), without noise (`isNoiseWord`).
 */
export function wordsToStudy(words: BookWord[], words95: number) {
  return words.filter((word) => !isNoiseWord(word) && (word[3] === null || word[3] > words95));
}

/**
 * The words to study not known yet, frequent in the book and rare in general first:
 * by count × log10(rank), unranked words taking the list's rarest rank.
 */
export function newWords(study: BookWord[], isKnown: (word: BookWord) => boolean) {
  const maxRank = Math.max(10, ...study.map(([, , , rank]) => rank ?? 0));
  const weight = ([, , count, rank]: BookWord) => count * Math.log10(rank ?? maxRank);

  return study.filter((word) => !isKnown(word)).sort((a, b) => weight(b) - weight(a));
}

/** The estimate's totals over all the book's words (newer estimates only) */
export interface WordTotals {
  uniqueWords?: number;
  tokens?: number;
}

export interface WordCoverage {
  /** Different words (form and reading), without noise */
  words: number;
  /** Of the listed words, not known */
  newWords: number;
  /** Words past the list's cap (each used rarely), counted as unknown */
  unlisted: number;
  /** Share of the words' occurrences that are known */
  share: number;
  /** false: only the list's `wordsPerBook` most frequent words were counted */
  complete: boolean;
}

/**
 * How much of a book's running text is known words, without noise (`isNoiseWord`).
 * With the estimate's totals, words past the list's cap count as unknown; without
 * them (older estimates) only the listed words count, unless the list wasn't cut.
 */
export function wordCoverage(
  words: BookWord[],
  isKnown: (word: BookWord) => boolean,
  totals: WordTotals = {}
): WordCoverage | undefined {
  let unique = 0;
  let unknown = 0;
  let tokens = 0;
  let known = 0;

  for (const word of words) {
    if (!isNoiseWord(word)) {
      unique += 1;
      tokens += word[2];
      if (isKnown(word)) known += word[2];
      else unknown += 1;
    }
  }

  const hasTotals = totals.uniqueWords !== undefined && totals.tokens !== undefined;
  const unlisted = hasTotals ? Math.max(0, totals.uniqueWords! - unique) : 0;

  if (hasTotals) {
    unique = Math.max(unique, totals.uniqueWords!);
    tokens = Math.max(tokens, totals.tokens!);
  }

  return tokens
    ? {
        words: unique,
        newWords: unknown,
        unlisted,
        share: known / tokens,
        complete: hasTotals || words.length < wordsPerBook
      }
    : undefined;
}

function csvField(value: string | number | null) {
  const text = value === null ? '' : String(value);

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV for Anki or a spreadsheet, with a BOM so Excel reads it as UTF-8. */
export function wordsCsv(words: BookWord[]) {
  return `\uFEFF${[['word', 'reading', 'count in book', 'frequency rank'], ...words]
    .map((row) => row.map(csvField).join(','))
    .join('\r\n')}\r\n`;
}

export function wordsFileName(title: string) {
  const name = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
    .replace(/^\.+/, '');

  return `${name || 'book'} words.csv`;
}

export function downloadWordsCsv(title: string, words: BookWord[]) {
  const a = document.createElement('a');

  a.href = URL.createObjectURL(new Blob([wordsCsv(words)], { type: 'text/csv;charset=utf-8' }));
  a.download = wordsFileName(title);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
