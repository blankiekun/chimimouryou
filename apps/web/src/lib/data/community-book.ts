/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Community on the app's side (the UI's helpers around lib/data/community.ts): a book's lines with
 * their character counts (the spoiler guard, markers, Post to community), the line deep link,
 * which local book a work is, whether the reader passed a line there (the feed's spoiler blur),
 * the markers the reader shows, and replies to the reader's posts for Home. Not part of upstream.
 */

import { BehaviorSubject } from 'rxjs';
import { pagePath } from '$lib/data/env';
import { loadBookMetadata } from '$lib/data/book-metadata';
import {
  communityOn,
  communityWorks$,
  lineHash,
  loadNotes,
  resolveWork,
  sentences,
  titleWork,
  type CommunityNote,
  type VisibleThread
} from '$lib/data/community';
import { writableObjectLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';
import { HubError, socialSession$ } from '$lib/data/social-account';
import type { MessageKey } from '$lib/i18n';
import { countCharacters } from '$lib/functions/book-text/text-positions';

export interface BookLine {
  text: string;
  /** Character counts at the line's start and end (the reader's positions) */
  start: number;
  end: number;
}

/** The book's lines (community.ts `sentences`) per paragraph, with their character counts */
export function bookLines(paragraphs: { text: string; startCount: number }[]): BookLine[] {
  return paragraphs.flatMap(({ text, startCount }) => {
    let from = 0;

    return sentences(text).map((line) => {
      const at = Math.max(0, text.indexOf(line, from));
      const start = startCount + countCharacters(text.slice(0, at));

      from = at + line.length;
      return { text: line, start, end: start + countCharacters(line) };
    });
  });
}

/** The index of the line holding character count `count` (the last one starting at or before it) */
export function lineAt(lines: BookLine[], count: number) {
  let found = -1;

  for (const [index, line] of lines.entries()) {
    if (line.start > count) break;
    found = index;
  }
  return found;
}

/** Lines the reader has passed: those starting before their position */
export function passedLine(lines: BookLine[], position: number) {
  return lineAt(lines, Math.max(0, position - 1));
}

/** A line's deep link (Copy link; also for pasting elsewhere): opens the book there, or the thread */
export function lineLink(work: string, line: string, origin = location.origin) {
  return `${origin}${pagePath}/b?${new URLSearchParams({ line, work })}`;
}

/** The thread on the Community page, for readers without the book */
export const threadPath = (work: string, line: string) =>
  `${pagePath}/community?${new URLSearchParams({ work, line })}`;

/**
 * Where a `/b?line=&work=` link without a book id goes: this browser's copy of the work at the
 * line, else the thread on the Community page; null for other URLs or with social off.
 */
export async function lineLinkTarget(params: URLSearchParams) {
  const line = params.get('line') ?? '';
  const work = params.get('work') ?? '';

  if (!/^[0-9a-f]{32}$/.test(line) || !work || !communityOn()) return null;

  const book = await localBookFor(work);

  return book
    ? `${pagePath}/b?${new URLSearchParams({ id: String(book.id), line, work })}`
    : threadPath(work, line);
}

/** Book titles in this browser, with their ids */
async function localTitles() {
  const { database } = await import('$lib/data/store');
  const db = await database.db;
  const titles = new Map<string, number>();
  let cursor = await db.transaction('data').store.index('title').openKeyCursor();

  while (cursor) {
    titles.set(String(cursor.key), Number(cursor.primaryKey));
    cursor = await cursor.continue();
  }
  return titles;
}

/** This browser's book for a work: one confirmed as it, else one whose own title key it is */
export async function localBookFor(work: string) {
  const titles = await localTitles().catch(() => new Map<string, number>());
  const confirmed = communityWorks$.getValue();

  for (const [title, id] of titles) {
    if (confirmed[title] === work || (!confirmed[title] && titleWork(title) === work)) {
      return { id, title };
    }
  }
  return null;
}

const passedCache = new Map<string, Promise<Set<string>>>();

/**
 * Line hashes of a work the reader has passed in their own copy (empty without one), for the
 * feed's spoiler blur. Hashes the copy once per page view.
 */
export function passedLines(work: string) {
  let found = passedCache.get(work);

  if (!found) {
    found = (async () => {
      const book = await localBookFor(work);

      if (!book) return new Set<string>();

      const [{ database }, { getParagraphs }] = await Promise.all([
        import('$lib/data/store'),
        import('$lib/functions/book-text/book-search')
      ]);
      const [data, bookmark] = await Promise.all([
        database.getData(book.id),
        database.getBookmark(book.id)
      ]);
      const position = bookmark?.exploredCharCount ?? 0;

      if (!data?.elementHtml || !position) return new Set<string>();

      const lines = bookLines(getParagraphs(data.elementHtml));
      const passed = lines.slice(0, passedLine(lines, position) + 1);
      const hashes = await Promise.all(passed.map((line) => lineHash(line.text)));

      return new Set(hashes.filter((hash): hash is string => !!hash));
    })().catch(() => new Set<string>());
    passedCache.set(work, found);
  }
  return found;
}

/** The book's work (community.ts resolveWork), with its Find details url when it has one */
export async function bookWork(title: string) {
  const url = await loadBookMetadata().then(
    (map) => map[title]?.url ?? '',
    () => ''
  );

  return resolveWork(title, url);
}

/** Threads marked in the open book (set by its Community tab), and a marker's tap */
export const communityMarks$ = new BehaviorSubject<{
  title: string;
  marks: (VisibleThread & BookLine)[];
}>({ title: '', marks: [] });
/** The thread to show in the Community tab (a marker's tap, a new post): a line's hash */
export const communityMarkTap$ = new BehaviorSubject('');

/** Titles of works matched this session (the confirm sheet's AniList/VNDB title), for posts */
export const workTitles = new Map<string, string>();

/** Positions of lines in the book: what the Community tab passes to the markers */
export function markedLines(threads: VisibleThread[], lines: BookLine[]) {
  return threads.flatMap((thread) =>
    lines[thread.index] ? [{ ...thread, ...lines[thread.index] }] : []
  );
}

/** What to tell the reader when a community request failed */
export function communityErrorKey(error: unknown): MessageKey {
  const code = error instanceof HubError ? error.code : '';
  const status = error instanceof HubError ? error.status : 0;

  if (code === 'session' || status === 401) return 'community.error.session';
  if (code === 'links') return 'community.error.links';
  if (code === 'full') return 'community.error.full';
  if (status === 429) return 'community.error.limit';
  if (code === 'network' || code === 'paused' || status >= 500) return 'community.error.down';
  return 'community.error.other';
}

/** Replies to the reader's posts, cached (the hub allows one call a minute) */
export const communityNotes$ = writableObjectLocalStorageSubject<{
  user: string;
  at: number;
  notes: CommunityNote[];
} | null>()('communityNotes', null);

/** When the reader last opened each of their posts' replies, by post id (Unix seconds) */
export const communityNotesSeen$ = writableObjectLocalStorageSubject<Record<string, number>>()(
  'communityNotesSeen',
  {}
);

const notesCache = 15 * 60_000;

/** Home: new replies, signed in with social on only */
export async function refreshNotes() {
  const session = socialSession$.getValue();

  if (!session || !communityOn()) return;

  const cached = communityNotes$.getValue();
  const mine = cached?.user === session.me.id ? cached : null;

  if (mine && Date.now() - mine.at < notesCache) return;

  const fresh = await loadNotes(mine?.notes[0]?.at ?? 0).catch(() => null);

  if (!fresh) return;

  const ids = new Set(fresh.map((note) => note.id));

  communityNotes$.next({
    user: session.me.id,
    at: Date.now(),
    notes: [...fresh, ...(mine?.notes ?? []).filter((note) => !ids.has(note.id))].slice(0, 100)
  });
}

export interface NoteGroup {
  /** The reader's post */
  parent: string;
  work: string;
  line: string;
  title: string;
  vol: string;
  cover: string | null;
  names: string[];
  count: number;
  at: number;
}

/** Unseen replies grouped by the reader's post, newest first */
export function unseenNotes(notes: CommunityNote[], seen: Record<string, number>): NoteGroup[] {
  const groups = new Map<string, NoteGroup>();

  notes.forEach((note) => {
    if (!note.parent || note.at <= (seen[note.parent] ?? 0)) return;

    const group = groups.get(note.parent);
    const name = note.author?.name ?? '';

    if (group) {
      groups.set(note.parent, {
        ...group,
        count: group.count + 1,
        at: Math.max(group.at, note.at),
        names: name && !group.names.includes(name) ? [...group.names, name] : group.names
      });
    } else {
      groups.set(note.parent, {
        parent: note.parent,
        work: note.work,
        line: note.line,
        title: note.title,
        vol: note.vol,
        cover: note.cover,
        names: name ? [name] : [],
        count: 1,
        at: note.at
      });
    }
  });
  return [...groups.values()].sort((a, b) => b.at - a.at);
}

/** The reader opened a post's replies */
export function markNotesSeen(parent: string, at = Math.floor(Date.now() / 1000)) {
  communityNotesSeen$.next({ ...communityNotesSeen$.getValue(), [parent]: at });
}

/** The line in its page, split for showing the line bold */
export function splitContext(context: string, quote: string) {
  const at = quote ? context.indexOf(quote) : -1;

  return at < 0
    ? { before: '', line: quote || context, after: '' }
    : { before: context.slice(0, at), line: quote, after: context.slice(at + quote.length) };
}
