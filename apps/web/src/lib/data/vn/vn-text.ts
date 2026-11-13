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

import type {
  BooksDbBookData,
  BooksDbStatistic
} from '$lib/data/database/books-db/versions/books-db';
import { logger } from '$lib/data/logger';
import { MergeMode } from '$lib/data/merge-mode';
import { noteReading } from '$lib/data/social/social';
import type { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
import { autoReplication$, database } from '$lib/data/store';
import { context } from '$lib/data/sync/media-sync';
import { recordKanjiText } from '$lib/data/words/kanji-seen';
import {
  AutoReplicationType,
  ReplicationSaveBehavior
} from '$lib/functions/replication/replication-options';
import { replicateData } from '$lib/functions/replication/replicator';
import { isPluginEnabled } from '$lib/plugins';
import {
  getDefaultStatistic,
  updateStatistic
} from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
import { countTextCharacters } from '$lib/functions/get-character-count';
import { getDateKey } from '$lib/functions/statistic-util';
import {
  decodeText,
  loadVnRead,
  newText,
  saveVnRead,
  vnBookmark,
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

  /** perLine: the texts are lines (/hook, VNBox), not CONscripter's whole page resent (newText) */
  constructor(
    public read: VnRead,
    public statistics: Map<string, BooksDbStatistic>,
    now = Date.now(),
    public perLine = false
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
      const added = newText(this.previousText, text, this.seen, readBefore, this.perLine);
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

  /** Changes taken but not saved (the save failed): the next takeChanges has them again. */
  putBack({ text, days }: NonNullable<ReturnType<VnReading['takeChanges']>>) {
    this.unsavedText = text + this.unsavedText;
    days.forEach(({ dateKey }) => this.changedDays.add(dateKey));
    this.dirty = true;
  }

  today(startDayHours: number, now = new Date()) {
    return this.statistics.get(getDateKey(startDayHours, now))?.charactersRead ?? 0;
  }
}

/** A game's reading as saved on this browser: the read count raised to another device's bookmark. */
export async function loadVnReading(book: BooksDbBookData, perLine = false) {
  const read = await loadVnRead(book.title);
  // Another device may be further along: keep the larger position.
  const bookmark = await database.getBookmark(book.id);

  read.characters = Math.max(read.characters, bookmark?.exploredCharCount || 0);

  return new VnReading(
    read,
    new Map((await database.getStatisticsForBook(book.title)).map((stat) => [stat.dateKey, stat])),
    Date.now(),
    perLine
  );
}

/** Whether the book's progress syncs that way, as in the book reader (Calibre always syncs). */
export function vnSyncs(external: BaseStorageHandler | undefined, direction: AutoReplicationType) {
  const auto = autoReplication$.getValue();

  return (
    !!external &&
    (external.storageType === StorageKey.CALIBRE ||
      auto === direction ||
      auto === AutoReplicationType.All)
  );
}

/**
 * Saves a VnReading's changes (/v and /hook): on this browser 3 s after a text, synced at most
 * once a minute, and at once with `save(true)` (leaving, hiding).
 */
export class VnReadingSaver {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private syncedAt = 0;
  private unsynced = new Set<StorageDataType>();

  constructor(
    public book: BooksDbBookData,
    public reading: VnReading,
    private local: BaseStorageHandler,
    private external: BaseStorageHandler | undefined
  ) {}

  /** A text added something to save. */
  changed() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 3000);
  }

  async save(force = false) {
    clearTimeout(this.timer);

    const changes = this.reading.takeChanges();

    if (changes) {
      try {
        await this.saveLocally(changes);
      } catch (error) {
        this.reading.putBack(changes);
        throw error;
      }
    }
    if (!this.unsynced.size || !vnSyncs(this.external, AutoReplicationType.Up)) return;

    const wait = this.syncedAt + 60_000 - Date.now();

    if (!force && wait > 0) {
      // A player who stops reading still syncs within the minute.
      this.timer = setTimeout(() => this.save(), wait);
      return;
    }

    const types = [...this.unsynced];

    this.syncedAt = Date.now();
    this.unsynced = new Set();

    const error = await replicateData(
      this.local,
      this.external!,
      false,
      [context(this.book)],
      types
    ).catch((err: any) => err.message);

    if (!error) return;
    // Sent again with the next sync.
    types.forEach((type) => this.unsynced.add(type));
    logger.warn(`Visual novel progress sync failed: ${error}`);
  }

  private async saveLocally({
    read,
    text,
    days
  }: NonNullable<ReturnType<VnReading['takeChanges']>>) {
    const { book } = this;

    await saveVnRead(read);
    await database.putBookmark(vnBookmark(book.id, read.characters, book.characters));
    if (isPluginEnabled('social'))
      noteReading(book.title, read.characters, book.characters, false, 'vn');

    this.unsynced.add(StorageDataType.PROGRESS);
    if (days.length) {
      await database.storeStatistics(
        book.title,
        days,
        ReplicationSaveBehavior.Overwrite,
        MergeMode.LOCAL
      );
      this.unsynced.add(StorageDataType.STATISTICS);
    }
    // Last: it adds up, so a failed write before it must not have recorded the text already.
    await recordKanjiText(book.title, text, read.characters);
  }
}
