/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Where a visual novel's text comes from and what the /v page does with it. Two engines send
 * text: CONscripter (static/vn/player.html) at every click wait with the page's bytes and
 * character boxes, and VNBox (static/vn/vnbox.html) with each line its text hook sends. Each
 * frame takes `textLines` (its raw text → overlay lines, which it shows and keeps for Anki)
 * and `onText` in startGame's options; `vnTextSource` gives both, turning the raw text into
 * the one contract the page counts: (text, skipped, readBefore).
 */

import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import {
  getDefaultStatistic,
  updateStatistic
} from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
import { countTextCharacters } from '$lib/functions/get-character-count';
import { getDateKey } from '$lib/functions/statistic-util';
import {
  decodeText,
  newText,
  overlayLines,
  vnboxLines,
  type VnInfo,
  type VnOverlayLine,
  type VnRead
} from '$lib/data/vn/vn';

/** Text shown by the game: skipped text counts nothing; readBefore = the engine had it as read */
export type OnVnText = (text: string, skipped: boolean, readBefore: boolean) => void;

export interface VnTextSource {
  /** The player page, in static/vn/ */
  player: 'player.html' | 'vnbox.html';
  /** startGame options: the frame's raw text as overlay lines */
  textLines: (...raw: any[]) => VnOverlayLine[];
  /** startGame options: the frame's raw text, handed on as OnVnText */
  onText: (...raw: any[]) => void;
}

export function vnTextSource(info: VnInfo, onText: OnVnText): VnTextSource {
  if (info.engine === 'vnbox') {
    // A hook sends each line once, as the game shows it; nothing says it was skipped or read.
    return {
      player: 'vnbox.html',
      textLines: (line: string, width: number, height: number) =>
        vnboxLines(line, { width, height }),
      onText: (line: string) => onText(line, false, false)
    };
  }

  return {
    player: 'player.html',
    textLines: (bytes: Uint8Array, boxes: Int32Array) => overlayLines(bytes, boxes, info.encoding),
    onText: (bytes: Uint8Array, skipped: number, _boxes: Int32Array, readBefore: number) =>
      onText(decodeText(bytes, info.encoding), !!skipped, readBefore === 1)
  };
}

/** Time between two texts counted as reading at most, so breaks don't count. */
export const maxSecondsPerPage = 120;

/**
 * A game's reading while it is played: characters read (progress), the day's statistics and
 * the text read since the last save (for "Kanji met"), from the texts the engine shows.
 */
export class VnReading {
  seen: Set<string>;
  previousText = '';
  unsavedText = '';
  lastTextTime: number;
  changedDays = new Set<string>();
  dirty = false;

  constructor(
    public read: VnRead,
    public statistics: Map<string, BooksDbStatistic>,
    now = Date.now()
  ) {
    this.seen = new Set(read.pages);
    this.lastTextTime = now;
  }

  /** Counts a text; true when there is something to save. */
  add(
    text: string,
    skipped: boolean,
    readBefore: boolean,
    options: { statistics: boolean; startDayHours: number },
    now = Date.now()
  ) {
    if (!skipped) {
      const added = newText(this.previousText, text, this.seen, readBefore);
      const characters = countTextCharacters(added);
      const seconds = Math.min((now - this.lastTextTime) / 1000, maxSecondsPerPage);

      if (characters) {
        this.read.characters += characters;
        this.unsavedText += added;
        this.dirty = true;
      }

      if (options.statistics && (characters || seconds >= 1)) {
        const day = getDateKey(options.startDayHours, new Date(now));
        const stat = this.statistics.get(day) ?? getDefaultStatistic(this.read.title, day);

        this.statistics.set(day, updateStatistic(stat, Math.round(seconds), characters, now));
        this.changedDays.add(day);
        this.dirty = true;
      }
    }

    this.previousText = text;
    this.lastTextTime = now;

    return this.dirty;
  }

  /** What changed since the last call, to save; undefined when nothing did. */
  takeChanges() {
    if (!this.dirty) return undefined;

    const changes = {
      read: { ...this.read, pages: [...this.seen] },
      text: this.unsavedText,
      days: [...this.changedDays].map((day) => this.statistics.get(day)!)
    };

    this.dirty = false;
    this.unsavedText = '';
    this.changedDays = new Set();

    return changes;
  }

  today(startDayHours: number, now = new Date()) {
    return this.statistics.get(getDateKey(startDayHours, now))?.charactersRead ?? 0;
  }
}
