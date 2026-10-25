/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Community: posts on a line of a book ("Post to community": a question, a comment or a quote
 * worth sharing, optionally marked as a spoiler), replies to them, and a feed of every work's
 * posts, on the social hub (/v1/community/*, deploy/social-hub/src/community.ts). A thread is keyed
 * by the work (an AniList id and volume, a VNDB id, or the book's own title key) and the line's
 * hash, so two editions of one volume meet on the lines they share. Not part of upstream.
 *
 * Posts are plain text from anyone with a hub account: render them as text only (`{post.body}`
 * or textContent, never {@html}), keep line breaks with CSS (white-space: pre-wrap), and make no
 * links of URLs in them. Titles too.
 *
 * Requests: only while the social plugin is on (`communityOn`), and only from the Community tab
 * or a line deep link (nothing here runs on import). Signed out, only the public reads go (feed,
 * threads, thread, covers: no token, the hub caches them); writes need a hub account and are
 * refused here without one.
 *
 * Every thread shows wherever the reader is; spoilers are the app's to hide: a spoiler-marked
 * post's text (and the line it quotes) stays blurred until the reader taps Show spoiler, the work's
 * title, volume and cover beside it. Someone calling the API directly sees every post, spoilers
 * included, and a thread's page of context for any line they know.
 */

import { titleVolume } from '$lib/components/book-card/library-sort';
import { absBaseTitle, absCleanTitle, absMatchKey } from '$lib/data/audiobookshelf';
import { searchMetadata, type MetadataCandidate, type MetadataKind } from '$lib/data/book-metadata';
import { writableObjectLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';
import { HubError, hubFetch, hubImageUrl, socialSession$ } from '$lib/data/social-account';
import type { Person } from '$lib/data/social';
import { enabledPlugins$ } from '$lib/plugins/plugin-settings';

/** Lines shorter than this once normalised repeat all over a book: no threads on them */
export const minLine = 6;
export const quoteLength = 300;
export const contextLength = 600;
export const bodyLength = 1000;
export const titleLength = 200;

export interface CommunityAuthor extends Person {
  /** Only from authors with a public profile who share stats */
  level: { rank: number | null; wordsKnown: number | null } | null;
}

export interface CommunityPost {
  id: string;
  /** The top-level post a reply answers, null for top-level posts */
  parent: string | null;
  /** Plain text ('' for a deleted post kept for its replies) */
  body: string;
  /** The poster's spoiler mark */
  spoiler: boolean;
  at: number;
  edited: number | null;
  /** Helpful marks (replies only) from accounts at least 7 days old */
  helpful: number;
  voted: boolean;
  mine: boolean;
  /** null for a deleted post */
  author: CommunityAuthor | null;
  /** In a thread: false for a "This line only" post (older hubs leave it out: in the feed) */
  inFeed?: boolean;
}

/** The work as its first post named it, and its cover thumbnail (`workCoverUrl`) */
export interface CommunityWork {
  title: string;
  vol: string;
  cover: string | null;
}

export interface CommunityThread extends CommunityWork {
  work: string;
  line: string;
  /** The line and its page as the first poster's edition has them ('' when gone) */
  quote: string;
  context: string;
  posts: CommunityPost[];
}

export interface ThreadSummary {
  /** The first 8 hex of the line's hash */
  prefix: string;
  posts: number;
  /** Any post on the line is marked as a spoiler */
  spoiler: boolean;
}

export interface VisibleThread extends ThreadSummary {
  hash: string;
  /** The index of the line in the reader's book (the last occurrence passed) */
  index: number;
}

export interface CommunityNote extends CommunityPost, CommunityWork {
  work: string;
  line: string;
}

export interface FeedPost extends CommunityPost, CommunityWork {
  work: string;
  line: string;
  /** The line itself */
  quote: string;
  replies: number;
}

/** The hub may be asked only while the social plugin is on */
export const communityOn = () => enabledPlugins$.getValue().includes('social');

function read<T>(path: string) {
  if (!communityOn()) return Promise.reject(new HubError(0, 'off'));
  return hubFetch<T>(path);
}

/** Writes: social on and signed in to the hub, else refused here (nothing is sent) */
function write<T>(path: string, method: string, body?: unknown) {
  if (!communityOn()) return Promise.reject(new HubError(0, 'off'));
  if (!socialSession$.getValue()) return Promise.reject(new HubError(401, 'session'));
  return hubFetch<T>(path, method, body);
}

export const workCoverUrl = (cover: string) => hubImageUrl(`work/${cover}`);

/**
 * The line as two editions share it: ruby (Aozora 《》 and ｜) dropped, NFKC (full-width
 * letters and digits, half-width katakana, compatibility forms), lower case, and every whitespace,
 * punctuation (「」、。…― etc.), symbol (～, emoji) and format character (zero-width spaces, joiners)
 * removed. Kanji and kana spellings, and kanji numerals against digits, are not folded. Ruby given as
 * <rt> must be left out by the caller (take the text without rt). The hub's copy (normalizeLine in
 * deploy/social-hub/src/community.ts) must stay identical; both check test/line-hashes.json there.
 */
export function normalizeLine(line: string) {
  return line
    .replace(/《[^》]*》|｜/g, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}\p{Cf}]/gu, '');
}

/**
 * The first 32 hex of the normalised line's SHA-256; null for lines too short to have threads. A
 * line the book repeats has a thread per copy: copy n > 1 hashes the line with `#n` after it.
 */
export async function lineHash(line: string, occurrence = 1) {
  const normal = normalizeLine(line);

  if ([...normal].length < minLine) return null;

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(occurrence > 1 ? `${normal}#${occurrence}` : normal)
  );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/** Which copy of its line `lines[at]` is: 1 for the first time the book has it */
export function occurrenceOf(lines: string[], at: number) {
  const normal = normalizeLine(lines[at] ?? '');

  return lines.slice(0, at + 1).filter((line) => normalizeLine(line) === normal).length || 1;
}

/** Every line's hash (lineHash), a repeated line's later copies with their own */
export function lineHashes(lines: string[]) {
  const seen = new Map<string, number>();

  // All at once: one await per line takes seconds on a long book.
  return Promise.all(
    lines.map((line) => {
      const normal = normalizeLine(line);
      const occurrence = (seen.get(normal) ?? 0) + 1;

      seen.set(normal, occurrence);
      return lineHash(line, occurrence);
    })
  );
}

/** A book's text as lines: sentences ending in 。！？!? (with their closing brackets), or a line break */
export function sentences(text: string) {
  return (text.match(/[^\n。！？!?]*(?:[。！？!?]+[」』）)〉》】"']*|\n|$)/g) ?? [])
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The book's lines by hash prefix, each hash with its line's index */
export async function lineIndex(lines: string[]) {
  const byPrefix = new Map<string, { hash: string; index: number }[]>();

  (await lineHashes(lines)).forEach((hash, index) => {
    if (!hash) return;

    const prefix = hash.slice(0, 8);

    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), { hash, index }]);
  });
  return byPrefix;
}

/** Threads on lines of this book, in book order, wherever the reader is (spoilers are blurred instead) */
export function visibleThreads(
  threads: ThreadSummary[],
  index: Awaited<ReturnType<typeof lineIndex>>
): VisibleThread[] {
  return threads
    .flatMap((thread) => (index.get(thread.prefix) ?? []).map((line) => ({ ...thread, ...line })))
    .sort((a, b) => a.index - b.index);
}

/** The page around a line, at most contextLength characters, with the line whole in it */
export function clipContext(page: string, line: string) {
  const at = page.indexOf(line);
  const chars = [...page];

  if (at < 0 || chars.length <= contextLength) return at < 0 ? line : page;

  const start = [...page.slice(0, at)].length;
  const room = Math.max(0, contextLength - [...line].length);
  const from = Math.max(0, Math.min(start - Math.floor(room / 2), chars.length - contextLength));

  return chars.slice(from, from + contextLength).join('');
}

/** A volume as the hub takes it ('' for none or one it can't hold) */
export function volumeOf(title: string) {
  const volume = titleVolume(title);
  const text = volume === undefined ? '' : String(volume);

  return /^\d{1,4}(?:\.\d{1,2})?$/.test(text) ? text : '';
}

/** The book key (social.ts bookKey) the hub's work mapping uses, at most 100 characters */
const workBook = (title: string) => absMatchKey(absCleanTitle(title)).slice(0, 100);

/** The work key of an AniList or VNDB page (Find details' url), null for other pages */
export function workFromUrl(url: string, title: string) {
  const anilist = /^https:\/\/anilist\.co\/(?:manga|anime)\/([1-9]\d{0,8})(?:\/|$)/.exec(url);
  const vndb = /^https:\/\/vndb\.org\/(v[1-9]\d{0,8})(?:\/|$)/.exec(url);
  const volume = volumeOf(title);

  if (anilist) return `anilist:${anilist[1]}${volume ? `/${volume}` : ''}`;
  return vndb ? `vndb:${vndb[1]}` : null;
}

/** The fallback when no AniList or VNDB entry matches: the book's own key (null without one) */
export function titleWork(title: string) {
  const book = workBook(title);

  return book ? `title:${book}` : null;
}

/** Work keys the reader confirmed, by title, kept in this browser */
export const communityWorks$ = writableObjectLocalStorageSubject<Record<string, string>>()(
  'communityWorks',
  {}
);

function remember(title: string, work: string) {
  communityWorks$.next({ ...communityWorks$.getValue(), [title]: work });
}

/** Tells the hub which work this book is (counts once the account is 7 days old). */
async function vote(title: string, work: string) {
  const book = workBook(title);

  if (book && !work.startsWith('title:') && socialSession$.getValue()) {
    await write('/v1/community/work', 'PUT', { book, vol: volumeOf(title), work });
  }
}

/**
 * The book's work: the one confirmed in this browser, else its Find details url (confirmed by
 * whoever saved it), else `suggestion`, the hub's mapping, for the confirm sheet ("Is this … vol
 * N?"; signed in only). Neither: search with `searchWorks`, then `confirmWork`.
 */
export async function resolveWork(
  title: string,
  metadataUrl = ''
): Promise<{ work: string | null; suggestion: string | null }> {
  const cached = communityWorks$.getValue()[title];

  if (cached) return { work: cached, suggestion: null };

  const fromUrl = workFromUrl(metadataUrl, title);

  if (fromUrl) {
    remember(title, fromUrl);
    vote(title, fromUrl).catch(() => {});
    return { work: fromUrl, suggestion: null };
  }

  const book = workBook(title);

  if (!book || !socialSession$.getValue()) return { work: null, suggestion: null };

  const query = new URLSearchParams({ book, vol: volumeOf(title) });
  const { work } = await write<{ work: string | null }>(`/v1/community/work?${query}`, 'GET');

  return { work: null, suggestion: work };
}

/** AniList (books, manga) or VNDB (visual novels) entries for the confirm sheet, with their work keys */
export async function searchWorks(title: string, kind: MetadataKind) {
  const found = await searchMetadata(
    kind,
    absBaseTitle(title) || title,
    kind === 'vn' ? 'vndb' : 'anilist'
  );

  return found.flatMap((candidate: MetadataCandidate) => {
    const work = workFromUrl(candidate.url, title);

    return work ? [{ ...candidate, work }] : [];
  });
}

/** The reader's choice (null: none of them, the book's own key); returns the work key */
export async function confirmWork(title: string, work: string | null) {
  const chosen = work ?? titleWork(title);

  if (!chosen) return null;
  remember(title, chosen);
  await vote(title, chosen);
  return chosen;
}

/** Every thread of a work, page by page */
export async function listThreads(work: string) {
  const threads: ThreadSummary[] = [];
  let after: string | null = null;

  // shortcut: at most 20 pages (20,000 lines with posts); page lazily if a work ever has more.
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ work, ...(after ? { after } : {}) });
    const result: { threads: ThreadSummary[]; next: string | null } = await read(
      `/v1/community/threads?${query}`
    );

    threads.push(...result.threads);
    after = result.next;
    if (!after) break;
  }
  return threads;
}

export function loadThread(work: string, line: string) {
  return read<CommunityThread>(`/v1/community/thread?${new URLSearchParams({ work, line })}`);
}

/** Every work's posts, newest first, 30 a page: pass the last page's `next` for more */
export function loadFeed(before?: string) {
  return read<{ posts: FeedPost[]; next: string | null }>(
    `/v1/community/feed${before ? `?${new URLSearchParams({ before })}` : ''}`
  );
}

/**
 * Posts on a line; `context` is the page around it (clipContext), `title` the work's (the AniList
 * or VNDB title when matched, else the book's) and `vol` its volume (volumeOf); `feed` false keeps
 * it out of the Community feed, in the line's thread only.
 */
export function postOnLine(
  work: string,
  post: {
    title: string;
    vol: string;
    quote: string;
    context: string;
    body: string;
    spoiler: boolean;
    feed: boolean;
    /** Which copy of the line (occurrenceOf) */
    occurrence: number;
  }
) {
  return write<{ id: string; line: string } & CommunityWork>('/v1/community/posts', 'POST', {
    work,
    ...post
  });
}

/**
 * The work's one cover thumbnail, from the poster's own copy of the cover (re-encoded here as a
 * 160 px WebP without metadata), after their first post on a work the hub shows no cover for.
 * The hub takes only one per work and none from accounts in their first days.
 */
export async function uploadWorkCover(work: string, cover: Blob) {
  const { coverThumbnail } = await import('$lib/data/social-images');
  const thumbnail = await coverThumbnail(cover);

  if (!thumbnail) return null;
  return (
    await write<{ cover: string }>(
      `/v1/community/cover?${new URLSearchParams({ work })}`,
      'PUT',
      thumbnail
    )
  ).cover;
}

export function replyTo(parent: string, body: string, spoiler = false) {
  return write<{ id: string }>('/v1/community/posts', 'POST', { parent, body, spoiler });
}

export async function editPost(id: string, body: string, spoiler: boolean) {
  await write(`/v1/community/posts/${id}`, 'PUT', { body, spoiler });
}

export async function deletePost(id: string) {
  await write(`/v1/community/posts/${id}`, 'DELETE');
}

/** Replies only, never one's own */
export async function markHelpful(id: string, on: boolean) {
  await write(`/v1/community/posts/${id}/helpful`, on ? 'POST' : 'DELETE');
}

export async function reportPost(id: string) {
  await write('/v1/report', 'POST', { what: 'post', id });
}

/** The hub's work key for this book looks wrong */
export async function reportWork(title: string) {
  await write('/v1/report', 'POST', { what: 'work', book: workBook(title), vol: volumeOf(title) });
}

/** The work's title or cover is wrong or offensive */
export async function reportWorkInfo(work: string) {
  await write('/v1/report', 'POST', { what: 'workinfo', work });
}

/** Replies to the reader's posts since `since` (Unix seconds); the hub allows one call a minute */
export async function loadNotes(since = 0) {
  return (
    await write<{ notes: CommunityNote[] }>(`/v1/community/notes?since=${Math.floor(since)}`, 'GET')
  ).notes;
}
