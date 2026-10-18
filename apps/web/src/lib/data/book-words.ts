/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * "Words to study first" on the book page: words a book uses often that are
 * rarer in general, from the difficulty service's per-book word list, and their
 * CSV export for Anki. Not part of upstream.
 */

import { difficultyApiUrl } from '$lib/data/calibre';

/** Form, reading (null when the analyser has none), count in the book, Jiten frequency rank (null: not listed) */
export type BookWord = [string, string | null, number, number | null];

/** The book's most frequent words, most frequent first; undefined if it has no word list yet. */
export async function loadBookWords(id: number): Promise<BookWord[] | undefined> {
  const response = await fetch(`${difficultyApiUrl}words/${id}`, { cache: 'no-cache' });

  return response.ok ? response.json() : undefined;
}

const numberPattern = /^[\d０-９〇一二三四五六七八九十百千万]+$/u;
export const kanjiPattern = /\p{Unified_Ideograph}/u;
const singleKanaPattern = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]$/u;

/**
 * Words outside the `words95` most common ones (or not in the frequency list), in
 * the list's order (most frequent in the book first). Numbers, lone kana and unlisted
 * kana-only tokens are left out: on real books they are tokenizer noise (だ, 8, 一).
 */
export function wordsToStudy(words: BookWord[], words95: number) {
  return words.filter(
    ([form, , , rank]) =>
      (rank === null ? kanjiPattern.test(form) : rank > words95) &&
      !numberPattern.test(form) &&
      !singleKanaPattern.test(form)
  );
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
