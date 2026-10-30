/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Highlights and notes, stored per book title in the browser (IndexedDB).
 * Books on a synced source also sync them as annotations.json in the book's
 * folder (sync-files.ts; on the server, the account's own folder while signed
 * in). Not part of upstream.
 */

import { BehaviorSubject } from 'rxjs';
import { accountReady, currentAccount } from '$lib/data/account';
import { logger } from '$lib/data/logger';
import { readerDb as db } from '$lib/data/reader-db';
import { syncFileStore, syncJsonFile } from '$lib/data/sync-files';

export const highlightColors = ['yellow', 'green', 'blue', 'pink'] as const;

export type HighlightColor = (typeof highlightColors)[number];

export interface Highlight {
  id: string;
  /** Character counts before the first and after the last highlighted character */
  start: number;
  end: number;
  text: string;
  note: string;
  color: HighlightColor;
  chapter: string;
  created: number;
  modified: number;
  /** Kept as a tombstone so the deletion syncs */
  deleted?: boolean;
}

export interface BookAnnotations {
  title: string;
  highlights: Highlight[];
  /**
   * Account id the cached highlights belong to ('' signed out). Only set for
   * synced books; records saved before this field existed have none.
   */
  account?: string;
}

const annotationsFileName = 'annotations.json';

/**
 * annotations.json from another device: highlights without an id, positions or `modified` are
 * dropped (they could never merge); undefined when `highlights` isn't a list.
 */
export function parseAnnotations(raw: any): { highlights: Highlight[] } | undefined {
  if (!Array.isArray(raw?.highlights)) return undefined;

  return {
    highlights: raw.highlights.filter(
      (highlight: any) =>
        typeof highlight?.id === 'string' &&
        Number.isFinite(highlight.start) &&
        Number.isFinite(highlight.end) &&
        Number.isFinite(highlight.modified)
    )
  };
}

/** Newer edit wins per highlight; tombstones win over older edits. */
export function mergeHighlights(local: Highlight[], remote: Highlight[]) {
  const merged = new Map<string, Highlight>();

  [...local, ...remote].forEach((highlight) => {
    const existing = merged.get(highlight.id);

    // On a tie the deletion wins, so both devices end with the same list.
    const tieDeleted =
      highlight.modified === existing?.modified && highlight.deleted && !existing.deleted;

    if (!existing || highlight.modified > existing.modified || tieDeleted) {
      merged.set(highlight.id, highlight);
    }
  });

  return [...merged.values()].sort((a, b) => a.start - b.start || a.created - b.created);
}

function sameHighlights(a: Highlight[], b: Highlight[]) {
  if (a.length !== b.length) {
    return false;
  }

  const byId = new Map(a.map((h) => [h.id, h]));

  return b.every(
    (h) => byId.get(h.id)?.modified === h.modified && !byId.get(h.id)?.deleted === !h.deleted
  );
}

function newId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Annotations of the book open in the reader. */
export class AnnotationsController {
  /** All highlights including deleted ones */
  private all: Highlight[] = [];

  private syncTimer: ReturnType<typeof setTimeout> | undefined;

  /** Syncs run one after another, so one can't upload without the other's merge. */
  private syncQueue = Promise.resolve();

  readonly highlights$ = new BehaviorSubject<Highlight[]>([]);

  readonly syncError$ = new BehaviorSubject('');

  /** `syncSource`: the storage source the book's files sync to ('' = this browser only). */
  constructor(
    readonly title: string,
    private readonly syncSource: string
  ) {}

  async load() {
    const stored = await (await db()).get('annotations', this.title);

    // The browser cache is shared by everyone who signs in here. Highlights cached
    // under another sign-in state must not be merged (and uploaded) into this one;
    // they are safe on that account's server. Old records without an owner are kept.
    const owner = this.syncSource ? await this.owner() : undefined;
    const ownedByOther =
      owner !== undefined && stored?.account !== undefined && stored.account !== owner;

    this.setAll(ownedByOther ? [] : stored?.highlights || []);

    if (this.syncSource) {
      await this.sync();
    }
  }

  add(highlight: Omit<Highlight, 'id' | 'created' | 'modified'>) {
    const now = Date.now();
    const created: Highlight = { ...highlight, id: newId(), created: now, modified: now };

    this.setAll(mergeHighlights(this.all, [created]));
    this.persist();

    return created;
  }

  update(id: string, changes: Partial<Pick<Highlight, 'note' | 'color'>>) {
    this.setAll(
      this.all.map((h) => (h.id === id ? { ...h, ...changes, modified: Date.now() } : h))
    );
    this.persist();
  }

  remove(id: string) {
    this.setAll(
      this.all.map((h) =>
        h.id === id ? { ...h, note: '', text: '', deleted: true, modified: Date.now() } : h
      )
    );
    this.persist();
  }

  async flush() {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = undefined;
      await this.sync();
    }
  }

  private setAll(highlights: Highlight[]) {
    this.all = highlights;
    this.highlights$.next(highlights.filter((h) => !h.deleted));
  }

  private async owner() {
    await accountReady();

    return currentAccount()?.id ?? '';
  }

  private async save(highlights: Highlight[]) {
    const owner = this.syncSource ? await this.owner() : undefined;

    await (await db()).put('annotations', { title: this.title, highlights, account: owner });
  }

  private persist() {
    this.save(this.all).catch((error) =>
      logger.error(`Saving highlights failed: ${error.message}`)
    );

    if (this.syncSource) {
      clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => {
        this.syncTimer = undefined;
        this.sync();
      }, 2000);
    }
  }

  private sync() {
    this.syncQueue = this.syncQueue.then(() => this.syncOnce());

    return this.syncQueue;
  }

  /** Merges with the synced copy and uploads the result if it differs. */
  private async syncOnce() {
    await accountReady();

    try {
      const store = await syncFileStore(this.syncSource);

      if (!store) return;

      await syncJsonFile(store, annotationsFileName, this.title, parseAnnotations, async (file) => {
        const remote = file?.highlights || [];
        const merged = mergeHighlights(this.all, remote);

        if (!sameHighlights(merged, this.all)) {
          this.setAll(merged);
          await this.save(merged);
        }

        return sameHighlights(merged, remote)
          ? undefined
          : { title: this.title, highlights: merged };
      });

      this.syncError$.next('');
    } catch (error: any) {
      const message = `Highlight sync failed: ${error.message}`;

      logger.warn(message);
      this.syncError$.next(message);
    }
  }
}

export function highlightsToMarkdown(title: string, highlights: Highlight[]) {
  const lines = [`# ${title}`, ''];
  let chapter: string | undefined;

  highlights.forEach((highlight) => {
    if (highlight.chapter !== chapter) {
      chapter = highlight.chapter;

      if (chapter) {
        lines.push(`## ${chapter}`, '');
      }
    }

    lines.push(`> ${highlight.text.replace(/\n/g, '\n> ')}`, '');

    if (highlight.note) {
      lines.push(highlight.note, '');
    }
  });

  return lines.join('\n');
}
