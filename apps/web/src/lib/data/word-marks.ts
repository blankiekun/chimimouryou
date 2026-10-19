/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Words the reader marked known or ignored by hand (book page New words, the reader's
 * selection toolbar; unmarked in Settings → Anki → Known Words). Both count as known
 * (known-words.ts, words-met.ts). Kept in reader-db `known` under 'marks', synced as
 * words.json in the account folder while signed in (extras-sync.ts), cleared with the
 * known words when the reader changes. Not part of upstream.
 */

import { BehaviorSubject } from 'rxjs';
import type { BookWord } from '$lib/data/book-words';
import { loadCalibreCatalog, loadCalibreDifficulty } from '$lib/data/calibre';
import { pullWordMarks, wordMarksChanged } from '$lib/data/extras-sync';
import { readerDb } from '$lib/data/reader-db';
import { wordList } from '$lib/data/words-met';

export type WordStatus = 'known' | 'ignored';

export interface WordMark {
  /** null: unmarked (kept so the removal wins over older copies) */
  status: WordStatus | null;
  modified: number;
}

/** `form\treading` (like words-met's `wordKey`; an empty reading marks every reading) → mark */
export type WordMarks = Record<string, WordMark>;

export const wordMarks$ = new BehaviorSubject<WordMarks>({});

export const markKey = (form: string, reading?: string | null) => `${form}\t${reading ?? ''}`;

/** The word's mark: by form and reading, else by form alone. */
export function wordMark(marks: WordMarks, [form, reading]: BookWord) {
  return marks[markKey(form, reading)]?.status || marks[markKey(form)]?.status || null;
}

/** Changes whenever any mark does (part of the known set's cache key). */
export function marksSignature(marks: WordMarks) {
  const values = Object.values(marks);

  const active = values.filter((mark) => mark.status).length;

  return `${values.length}:${active}:${values.reduce((sum, mark) => sum + mark.modified, 0)}`;
}

export async function getWordMarks() {
  await pullWordMarks();

  const marks = ((await (await readerDb()).get('known', 'marks')) ?? {}) as WordMarks;

  wordMarks$.next(marks);

  return marks;
}

/** Marks the words (null unmarks them), by their reading when they have one. */
export async function setWordMarks(
  words: [form: string, reading: string | null][],
  status: WordStatus | null
) {
  const tx = (await readerDb()).transaction('known', 'readwrite');
  const modified = Date.now();
  const marks = { ...((await tx.store.get('marks')) as WordMarks | undefined) };

  for (const [form, reading] of words) {
    marks[markKey(form, reading)] = { status, modified };
  }

  await tx.store.put(marks, 'marks');
  await tx.done;
  wordMarks$.next(marks);
  wordMarksChanged();
}

/** The written forms of a Calibre book's word list (the reader's "Mark known"). */
export async function bookWordForms(title: string) {
  const [catalog, difficulty] = await Promise.all([loadCalibreCatalog(), loadCalibreDifficulty()]);
  const id = catalog.find((book) => book.title === title)?.id;
  const estimate = id === undefined ? undefined : difficulty[id];
  const words = estimate && (await wordList(id!, estimate.computedAt));

  return new Set(words?.map(([form]) => form));
}
