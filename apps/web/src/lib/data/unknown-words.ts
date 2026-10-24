/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Unknown-word underlines (like LingQ/Migaku): the readings file's kanji-word occurrences
 * (generated-furigana.ts) whose word isn't known (known-words.ts: met, Anki, the placement
 * cutoff or a mark), as character-count spans the reader draws as the `ttu-unknown` CSS
 * highlight. Marks are followed live, so marking a word known removes its underlines.
 * Not part of upstream.
 */

import { from, map, switchMap, type Observable } from 'rxjs';
import { isNoiseWord, type BookWord } from '$lib/data/book-words';
import type { ReadingsFile } from '$lib/data/generated-furigana';
import { getKnownSet, type KnownSet } from '$lib/data/known-words';
import { wordMark, wordMarks$, type WordMarks } from '$lib/data/word-marks';
import { estimatedBooks, estimatedWordList } from '$lib/data/words-met';

/** [start, end) in the book's character counts */
export type CountSpan = [number, number];

type Known = Pick<KnownSet, 'met' | 'anki' | 'placed'>;

/**
 * The spans of the occurrences of unknown words, in reading order. A readings word takes the
 * book's word-list row of the same form and reading (else of the form) for its rank and lemma.
 * shortcut: kana-only words aren't in `occ`, so they never underline; add them to the readings
 * file if readers ask.
 */
export function unknownSpans(
  readings: ReadingsFile,
  list: BookWord[],
  known: Known,
  marks: WordMarks
): CountSpan[] {
  const rows = new Map<string, BookWord>();

  for (const row of list) {
    rows.set(`${row[0]}\t${row[1] ?? ''}`, row);
    if (!rows.has(row[0])) rows.set(row[0], row);
  }

  const unknown = (readings.words ?? []).map(([form, reading]) => {
    const word: BookWord = rows.get(`${form}\t${reading ?? ''}`) ??
      rows.get(form) ?? [form, reading, 0, null];

    return !(
      isNoiseWord(word) ||
      known.met(word) ||
      known.anki(word) ||
      known.placed(word) ||
      wordMark(marks, word)
    );
  });
  const spans: CountSpan[] = [];
  let start = 0;
  let claimedEnd = 0;

  for (let i = 0; i < readings.occ.length; i += 3) {
    start += readings.occ[i];

    // A counter span (三本) comes before its tokens at the same start: the first one wins.
    if (start < claimedEnd) continue;

    const [form] = readings.words?.[readings.occ[i + 1]] ?? [''];
    const gloss = readings.glosses[readings.occ[i + 2]];
    // shortcut: the file has no surface length; the kanji runs' end, else the form up to its
    // okurigana (食べた: 食), so conjugated verbs underline their stem only.
    const length = Math.max(
      1,
      form.match(/^[^\p{Script=Hiragana}]+/u)?.[0].length ?? 0,
      ...(gloss ?? []).map(([offset, size]) => offset + size)
    );

    claimedEnd = start + length;
    if (unknown[readings.occ[i + 1]]) spans.push([start, claimedEnd]);
  }

  return spans;
}

/** The spans overlapping [start, end), for drawing the rendered part of the book. */
export function spansWithin(spans: CountSpan[], start: number, end: number) {
  let low = 0;
  let high = spans.length;

  while (low < high) {
    const middle = (low + high) >> 1;

    if (spans[middle][1] <= start) low = middle + 1;
    else high = middle;
  }

  const within: CountSpan[] = [];

  for (let i = low; i < spans.length && spans[i][0] < end; i += 1) within.push(spans[i]);

  return within;
}

/** The book's unknown-word spans, again whenever the marks change. */
export function unknownSpans$(title: string, readings: ReadingsFile): Observable<CountSpan[]> {
  const parts = Promise.all([
    estimatedBooks()
      .then((books) => books.find((book) => book.title === title))
      .then((book) => (book ? estimatedWordList(book) : null))
      .catch(() => null),
    getKnownSet()
  ]);

  return from(parts).pipe(
    switchMap(([list, known]) =>
      wordMarks$.pipe(map((marks) => unknownSpans(readings, list ?? [], known, marks)))
    )
  );
}
