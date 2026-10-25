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
  communityMatchAsked$,
  communityOn,
  communityWorks$,
  confirmWork,
  lineIndex,
  listThreads,
  loadNotes,
  resolveWork,
  searchWorks,
  sentences,
  titleWork,
  visibleThreads,
  volumeOf,
  workFromUrl,
  type CommunityNote,
  type CommunityPost,
  type ThreadSummary,
  type VisibleThread
} from '$lib/data/community';
import { writableObjectLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';
import { HubError, socialSession$ } from '$lib/data/social-account';
import type { MessageKey } from '$lib/i18n';
import type { SearchIndex } from '$lib/functions/book-text/book-search';
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

/** The thread on the Community page, for readers without the book; `post`: that feed post's discussion */
export const threadPath = (work: string, line: string, post?: string) =>
  `${pagePath}/community?${new URLSearchParams({ work, line, ...(post && { post }) })}`;

/**
 * A line's thread in two kinds: comments made for the line ("This line only") with their replies,
 * each comment followed by its own, then replies whose post is hidden; and the feed posts, each
 * its own discussion with its replies.
 */
export function splitThread(posts: CommunityPost[]) {
  const roots = posts.filter((post) => !post.parent);
  const repliesTo = (root: CommunityPost) => posts.filter((post) => post.parent === root.id);
  const shown = new Set(roots.map((root) => root.id));

  return {
    comments: [
      ...roots
        .filter((root) => root.inFeed === false)
        .flatMap((root) => [root, ...repliesTo(root)]),
      ...posts.filter((post) => post.parent && !shown.has(post.parent))
    ],
    feed: roots
      .filter((root) => root.inFeed !== false)
      .map((root) => ({ root, replies: repliesTo(root) }))
  };
}

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

const metadataUrl = (title: string) =>
  loadBookMetadata().then(
    (map) => map[title]?.url ?? '',
    () => ''
  );

/** The book's work (community.ts resolveWork), with its Find details url when it has one */
export async function bookWork(title: string) {
  return resolveWork(title, await metadataUrl(title));
}

export interface BookCommunity {
  work: string | null;
  /** The hub's suggestion for the match sheet, when there is no work */
  suggestion: string | null;
  lines: BookLine[];
  index: Awaited<ReturnType<typeof lineIndex>>;
  /** The work's threads (none without a work) */
  threads: ThreadSummary[];
}

let loaded: {
  title: string;
  getIndex: () => Promise<SearchIndex>;
  result: Promise<BookCommunity>;
} | null = null;

/**
 * What the Community tab loads on its first visit, also run on book open (markBookOnOpen): the
 * work, the lines, their index and the work's threads. Kept per open book (`getIndex` is the
 * reader page's), so the tab reuses what the book open asked; a failure is not kept.
 */
export function loadBookCommunity(title: string, getIndex: () => Promise<SearchIndex>) {
  if (loaded?.title !== title || loaded.getIndex !== getIndex) {
    const result = (async () => {
      const [resolved, searchIndex] = await Promise.all([bookWork(title), getIndex()]);
      const lines = bookLines(searchIndex.paragraphs);
      const index = await lineIndex(lines.map((line) => line.text));
      const threads = resolved.work ? await listThreads(resolved.work) : [];

      return { ...resolved, lines, index, threads };
    })();

    loaded = { title, getIndex, result };
    result.catch(() => {
      if (loaded?.result === result) loaded = null;
    });
  }
  return loaded.result;
}

/** The tab went away: its next visit asks again */
export function forgetBookCommunity() {
  loaded = null;
}

/** Every thread of the book as markers (a line on the screen being read counts as reached) */
export const bookMarks = ({ lines, index, threads }: Omit<BookCommunity, 'work' | 'suggestion'>) =>
  markedLines(visibleThreads(threads, index), lines);

/**
 * On book open (after it rendered): the markers without opening the tab, only signed in with
 * social on and for a book already matched to its work in this browser or by its Find details
 * url. Other books: the match toast when the hub suggests a work (offerMatch).
 */
export async function markBookOnOpen(title: string, getIndex: () => Promise<SearchIndex>) {
  if (!communityOn() || !socialSession$.getValue()) return;
  if (!communityWorks$.getValue()[title] && !workFromUrl(await metadataUrl(title), title)) {
    // No suggestion reachable: the Community tab still offers the match sheet.
    await offerMatch(title, getIndex).catch(() => {});
    return;
  }

  const before = communityMarks$.getValue();
  const found = await loadBookCommunity(title, getIndex);

  // The tab or a post may have set fresher ones meanwhile; older ones (this book opened before) go.
  if (found.work && communityMarks$.getValue() === before) {
    communityMarks$.next({ title, marks: bookMarks(found) });
  }
}

/** The match toast's question: the hub's suggested work for the open book, as AniList shows it */
export interface MatchOffer {
  title: string;
  work: string;
  name: string;
  cover: string;
  vol: string;
  getIndex: () => Promise<SearchIndex>;
}

export const matchOffer$ = new BehaviorSubject<MatchOffer | null>(null);

/**
 * Whether the toast asks about this book: signed in with social on, not matched, the hub suggests
 * a work, and the reader hasn't answered it for this title before.
 */
export function shouldOfferMatch(
  title: string,
  found: { work: string | null; suggestion: string | null }
) {
  return (
    communityOn() &&
    !!socialSession$.getValue() &&
    !found.work &&
    !!found.suggestion &&
    !communityMatchAsked$.getValue()[title]
  );
}

async function offerMatch(title: string, getIndex: () => Promise<SearchIndex>) {
  // Answered before: the hub isn't even asked for its suggestion.
  if (communityMatchAsked$.getValue()[title]) return;

  const found = await resolveWork(title);

  if (!shouldOfferMatch(title, found)) return;

  // The match sheet's search: the toast names the work only when AniList knows it.
  const candidate = (await searchWorks(title, 'book').catch(() => [])).find(
    (item) => item.work === found.suggestion
  );

  if (candidate) {
    matchOffer$.next({
      title,
      work: candidate.work,
      name: candidate.title,
      cover: candidate.cover ?? '',
      vol: volumeOf(title),
      getIndex
    });
  }
}

/**
 * The toast's answer; the title is never asked again. Match confirms the suggestion as the match
 * sheet's Yes does (kept in this browser before the hub's vote, so a failed vote still matches)
 * and marks the lines.
 */
export async function answerMatch(offer: MatchOffer, match: boolean) {
  matchOffer$.next(null);
  communityMatchAsked$.next({ ...communityMatchAsked$.getValue(), [offer.title]: Date.now() });
  if (!match) return;

  const chosen = await confirmWork(offer.title, offer.work).catch(() => offer.work);

  if (chosen) workTitles.set(chosen, offer.name);
  await refreshBookMarks(offer.title, offer.getIndex);
}

/**
 * After a post on a line of the open book: its threads again (the post matched the book, so the
 * next book open marks it too), so the new line's marker shows without the Community tab.
 */
export async function refreshBookMarks(title: string, getIndex: () => Promise<SearchIndex>) {
  forgetBookCommunity();

  const found = await loadBookCommunity(title, getIndex);

  if (found.work) communityMarks$.next({ title, marks: bookMarks(found) });
}

/**
 * Threads marked in a book (set by its Community tab, the book open or a post; kept while the book
 * is open, whatever the panel does: the markers show only the open book's), and a marker's tap
 */
export const communityMarks$ = new BehaviorSubject<{
  title: string;
  marks: (VisibleThread & BookLine)[];
}>({ title: '', marks: [] });

/**
 * The last marks of recently opened books, by title: kept in this browser only (never synced),
 * without the lines' text, so a book shows its bubbles at once on open, before the hub answers.
 */
export const communityMarksCache$ = writableObjectLocalStorageSubject<
  Record<string, { at: number; marks: (VisibleThread & BookLine)[] }>
>()('communityMarksCache', {});

const cachedBooks = 30;

communityMarks$.subscribe(({ title, marks }) => {
  if (!title) return;

  const others = Object.entries(communityMarksCache$.getValue())
    .filter(([key]) => key !== title)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, cachedBooks - 1);
  const mine = { at: Date.now(), marks: marks.map((mark) => ({ ...mark, text: '' })) };

  communityMarksCache$.next(Object.fromEntries(marks.length ? [[title, mine], ...others] : others));
});

/**
 * On book open: its cached marks at once, with social on (showing them sends nothing, so signed
 * out too); markBookOnOpen refreshes them from the hub after.
 */
export function restoreBookMarks(title: string) {
  const cached = communityMarksCache$.getValue()[title];

  if (cached && communityOn() && communityMarks$.getValue().title !== title) {
    communityMarks$.next({ title, marks: cached.marks });
  }
}

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
  // 'busy' is the hub's per-address burst limit, not a posting limit
  if (status === 429 && code !== 'busy') return 'community.error.limit';
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
