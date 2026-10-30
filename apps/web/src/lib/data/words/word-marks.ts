/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Words the reader marked known or ignored by hand (Book words, the reader's selection
 * toolbar; listed and unmarked on the Words page). Both count as known
 * (known-words.ts, words-met.ts). Kept in reader-db `known` under 'marks', synced as
 * words.json in the account folder while signed in (extras-sync.ts), cleared with the
 * known words when the reader changes. Not part of upstream.
 */

import { BehaviorSubject } from 'rxjs';
import { csvField, type BookWord } from '$lib/data/book-words';
import { pullWordMarks, wordMarksChanged } from '$lib/data/extras-sync';
import { readerDb } from '$lib/data/reader-db';
import { estimatedBooks, estimatedWordList } from '$lib/data/words-met';

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

/** The word's mark: by form and reading, else by form alone, else by its lemma (判る: 分かる). */
export function wordMark(marks: WordMarks, [form, reading, , , lemma]: BookWord) {
  return (
    marks[markKey(form, reading)]?.status ||
    marks[markKey(form)]?.status ||
    (lemma && marks[markKey(lemma)]?.status) ||
    null
  );
}

/** Whether any reading of the form is marked (the reader's toolbar). */
export function formMarked(marks: WordMarks, form: string) {
  return Object.entries(marks).some(([key, mark]) => mark.status && key.startsWith(`${form}\t`));
}

/** The marks that mark this word (to unmark it): by its reading and by its form alone. */
export function marksOf(marks: WordMarks, [form, reading]: BookWord): [string, string | null][] {
  return (
    [
      [form, reading],
      [form, null]
    ] as [string, string | null][]
  ).filter(([f, r]) => marks[markKey(f, r)]?.status);
}

/**
 * How to mark a word of a book's list: by form alone, so a reading that changes in a
 * later word list doesn't orphan the mark, unless the list reads the form two ways.
 */
export function markEntry(list: BookWord[], [form, reading]: BookWord): [string, string | null] {
  const readings = new Set(list.filter((word) => word[0] === form).map((word) => word[1]));

  return [form, readings.size > 1 ? reading : null];
}

/**
 * The word-list form a selection is (conjugated or not): the form itself, else the
 * longest form whose stem (without its last kana, or する) starts the selection, followed
 * by a few kana only (呟いた → 呟く, 勉強した → 勉強する). '' when none.
 */
export function selectionForm(selection: string, forms: ReadonlySet<string> | undefined) {
  if (!selection || !forms) return '';
  if (forms.has(selection)) return selection;

  let best = '';

  for (const form of forms) {
    const stem = form.endsWith('する')
      ? form.slice(0, -2)
      : form.replace(/\p{Script=Hiragana}$/u, '');

    if (
      stem !== form &&
      /\p{Unified_Ideograph}/u.test(stem) &&
      selection.startsWith(stem) &&
      /^\p{Script=Hiragana}{1,6}$/u.test(selection.slice(stem.length)) &&
      form.length > best.length
    ) {
      best = form;
    }
  }

  return best;
}

export interface MarkedWord {
  form: string;
  /** '' when marked by form alone */
  reading: string;
  status: WordStatus;
  modified: number;
}

/** The words marked known or ignored, newest first (the Words page). */
export function markedWords(marks: WordMarks): MarkedWord[] {
  return Object.entries(marks)
    .filter(([, mark]) => mark.status)
    .sort(([, a], [, b]) => b.modified - a.modified)
    .map(([key, mark]) => {
      const [form, reading] = key.split('\t');

      return { form, reading, status: mark.status!, modified: mark.modified };
    });
}

/** CSV of marked words, with a BOM so Excel reads it as UTF-8. */
export function markedWordsCsv(words: MarkedWord[]) {
  const rows = [
    ['word', 'reading', 'status', 'marked'],
    ...words.map(({ form, reading, status, modified }) => [
      form,
      reading,
      status,
      new Date(modified).toISOString().slice(0, 10)
    ])
  ];

  return `\uFEFF${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;
}

/** Changes whenever any mark does (part of the known set's cache key). */
export function marksSignature(marks: WordMarks) {
  const values = Object.values(marks);

  const active = values.filter((mark) => mark.status).length;

  return `${values.length}:${active}:${values.reduce((sum, mark) => sum + mark.modified, 0)}`;
}

/** A status from a newer version (words.json) stays stored and synced, but marks nothing here. */
const knownMarks = (marks: WordMarks): WordMarks =>
  Object.fromEntries(
    Object.entries(marks).filter(
      ([, mark]) => mark.status === null || mark.status === 'known' || mark.status === 'ignored'
    )
  );

export async function getWordMarks() {
  await pullWordMarks();

  const marks = knownMarks(((await (await readerDb()).get('known', 'marks')) ?? {}) as WordMarks);

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
  wordMarks$.next(knownMarks(marks));
  wordMarksChanged();
}

/**
 * The written forms of a book's word list (the reader's "Mark known"): a Calibre book's, or in
 * the standalone without a server its local one.
 */
export async function bookWordForms(title: string) {
  const book = (await estimatedBooks()).find((estimated) => estimated.title === title);
  const words = book && (await estimatedWordList(book));

  return new Set(words?.map(([form]) => form));
}

/** The reader's word list forms of the open book, loaded on its first selection ("Mark known"). */
export class WordFormsLoader {
  forms$ = new BehaviorSubject<{ title: string; forms: Set<string> } | undefined>(undefined);

  load(title: string) {
    this.forms$.next({ title, forms: new Set() });
    getWordMarks().catch(() => undefined);
    bookWordForms(title).then(
      (forms) => this.forms$.getValue()?.title === title && this.forms$.next({ title, forms }),
      () => {}
    );
  }
}
