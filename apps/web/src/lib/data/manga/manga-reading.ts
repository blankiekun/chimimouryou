/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * A manga volume's reading while /m is open: the day's statistics (time, and the characters of
 * the mokuro text on the pages read) and the text read since the last save, for "Kanji met".
 * The visual novel's VnReading (vn-text.ts) in a smaller form. Not part of upstream.
 */

import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import type { MokuroPage } from '$lib/data/manga/mokuro';
import { maxSecondsPerPage } from '$lib/data/vn/vn-text';
import {
  getDefaultStatistic,
  updateStatistic
} from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
import { countTextCharacters } from '$lib/functions/get-character-count';
import { getDateKey } from '$lib/functions/statistic-util';

type Text = (MokuroPage | undefined)[];
type Options = { statistics: boolean; startDayHours: number };
type Changes = { text: string; upTo: number; days: BooksDbStatistic[] };

/** A page's text, blocks and lines joined. */
export const mangaPageText = (page: MokuroPage | undefined) =>
  page?.blocks.map((block) => block.lines.join('')).join('\n') ?? '';

export class MangaReading {
  private text: Text = [];
  /** The first page not counted yet */
  private readThrough: number;
  /** When the time last counted ended; unset while paused */
  private last: number | undefined;
  private unsavedText = '';
  private changedDays = new Set<string>();
  private dirty = false;

  constructor(
    private title: string,
    private statistics: Map<string, BooksDbStatistic>,
    private pageCount: number,
    openedPage: number,
    private shown: number[],
    now = Date.now()
  ) {
    this.readThrough = openedPage;
    this.last = now;
  }

  /** The page text came (or changed). */
  setText(text: Text) {
    this.text = text;
  }

  /** The pages on screen changed. */
  moved(shown: number[], options: Options, now = Date.now()) {
    if (shown.length === this.shown.length && shown.every((page, i) => page === this.shown[i])) {
      return;
    }

    // The last page can never be left, so it counts on arrival.
    const counted = [...this.shown, ...(shown.includes(this.pageCount - 1) ? shown : [])].filter(
      (page, i, all) => page >= this.readThrough && all.indexOf(page) === i
    );
    const text = counted.map((page) => mangaPageText(this.text[page])).join('');

    if (counted.length) this.readThrough = Math.max(...counted) + 1;
    if (text) {
      this.unsavedText += text;
      this.dirty = true;
    }

    this.count(countTextCharacters(text), options, now);
    this.shown = shown;
    this.last = now;
  }

  /** The page is hidden or closed: the time on the current pages, no characters. */
  pause(options: Options, now = Date.now()) {
    this.count(0, options, now);
    this.last = undefined;
  }

  /** The page is visible again: time away doesn't count. */
  resume(now = Date.now()) {
    this.last = now;
  }

  /** What changed since the last call; undefined when nothing did. */
  takeChanges(): Changes | undefined {
    if (!this.dirty) return undefined;

    const changes = {
      text: this.unsavedText,
      upTo: this.text
        .slice(0, this.readThrough)
        .reduce((sum, page) => sum + countTextCharacters(mangaPageText(page)), 0),
      days: [...this.changedDays].map((day) => this.statistics.get(day)!)
    };

    this.dirty = false;
    this.unsavedText = '';
    this.changedDays = new Set();

    return changes;
  }

  /** Changes taken but not saved: the next takeChanges has them again. */
  putBack({ text, days }: Changes) {
    this.unsavedText = text + this.unsavedText;
    days.forEach(({ dateKey }) => this.changedDays.add(dateKey));
    this.dirty = true;
  }

  private count(characters: number, options: Options, now: number) {
    const seconds =
      this.last === undefined ? 0 : Math.min((now - this.last) / 1000, maxSecondsPerPage);

    if (!options.statistics || (!characters && seconds < 1)) return;

    const day = getDateKey(options.startDayHours, new Date(now));
    const stat = this.statistics.get(day) ?? getDefaultStatistic(this.title, day);

    this.statistics.set(day, updateStatistic(stat, Math.round(seconds), characters, now));
    this.changedDays.add(day);
    this.dirty = true;
  }
}
