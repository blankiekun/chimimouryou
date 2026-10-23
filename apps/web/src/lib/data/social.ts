/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Friends on the social hub: the friends list (cached 15 minutes, loaded only by Home and
 * /friends), requests, and the reader's own status (current books, pushed on opening and
 * leaving a book and at most every 15 minutes while reading). Requests go out only while
 * signed in to the hub. Not part of upstream.
 */

import { absCleanTitle, absMatchKey } from '$lib/data/audiobookshelf';
import {
  writableArrayLocalStorageSubject,
  writableObjectLocalStorageSubject
} from '$lib/data/internal/writable-object-local-storage-subject';
import { hubFetch, socialSession$ } from '$lib/data/social-account';

export interface FriendBook {
  key: string;
  title: string;
  author: string;
  kind: 'book' | 'manga' | 'vn';
  /** 0-1 */
  pct: number;
  /** Unix seconds */
  readAt: number;
}

export interface Person {
  id: string;
  username: string;
  name: string;
  avatar: number;
}

export interface Friend extends Person {
  since: number;
  books: FriendBook[];
}

export interface FriendsList {
  friends: Friend[];
  incoming: (Person & { at: number })[];
  /** Who a code belongs to stays hidden until they accept */
  outgoing: { id: string; code: string; at: number }[];
}

const cacheTime = 15 * 60_000;
const pushInterval = 15 * 60_000;
/** Like words met: 97% counts as finished */
const finishedShare = 0.97;

export const friends$ = writableObjectLocalStorageSubject<{
  at: number;
  user: string;
  list: FriendsList;
} | null>()('socialFriends', null);

/** The books this reader is on, newest first (at most 3), as last sent to the hub */
const currentBooks$ = writableArrayLocalStorageSubject<FriendBook>()('socialBooks', []);

/** The same book across libraries: the title without store tags, width, case and punctuation */
export function bookKey(title: string) {
  return absMatchKey(absCleanTitle(title));
}

/** Friends who read most recently first */
export function byLastRead(friends: Friend[]) {
  const last = (friend: Friend) => Math.max(0, ...friend.books.map((book) => book.readAt));

  return [...friends].sort((a, b) => last(b) - last(a));
}

/** "2 hours ago" for a Unix time, in the UI language */
export function relativeTime(seconds: number, lang: string, now = Date.now()) {
  const diff = Math.round(seconds - now / 1000);
  const format = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const units = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60]
  ] as const;

  for (const [unit, size] of units) {
    if (Math.abs(diff) >= size) return format.format(Math.round(diff / size), unit);
  }
  return format.format(0, 'minute');
}

function setList(list: FriendsList) {
  const session = socialSession$.getValue();

  if (session) friends$.next({ at: Date.now(), user: session.me.id, list });
  return list;
}

/** The cached list, refreshed when older than 15 minutes; failures keep the cache quietly. */
export async function loadFriends(force = false) {
  const session = socialSession$.getValue();
  const cached = friends$.getValue();

  if (!session) return;
  if (!force && cached?.user === session.me.id && Date.now() - cached.at < cacheTime) return;
  await hubFetch<FriendsList>('/v1/friends').then(setList, () => {});
}

export const sendFriendRequest = (code: string) =>
  hubFetch<FriendsList>('/v1/friends/request', 'POST', { code }).then(setList);

export const acceptFriend = (id: string) =>
  hubFetch<FriendsList>(`/v1/friends/${id}/accept`, 'POST').then(setList);

/** Decline, cancel or remove */
export const removeFriend = (id: string) =>
  hubFetch<FriendsList>(`/v1/friends/${id}`, 'DELETE').then(setList);

export const blockFriend = (id: string) =>
  hubFetch<FriendsList>(`/v1/block/${id}`, 'POST').then(setList);

let lastPush = { at: 0, title: '' };

/**
 * The reading position of a book in the reader: updates the current books and sends them when
 * leaving, on a book not sent last, or 15 minutes after the last push.
 */
export function noteReading(title: string, position: number, characters: number, leaving = false) {
  const session = socialSession$.getValue();

  if (!session || !characters) return;

  const book: FriendBook = {
    key: bookKey(title),
    title,
    author: '',
    kind: 'book',
    pct: Math.min(1, position / characters),
    readAt: Math.floor(Date.now() / 1000)
  };
  const books = [book, ...currentBooks$.getValue().filter((other) => other.key !== book.key)]
    .filter((other) => other.pct < finishedShare)
    .slice(0, 3);

  currentBooks$.next(books);
  if (!leaving && title === lastPush.title && Date.now() - lastPush.at < pushInterval) return;
  lastPush = { at: Date.now(), title };
  hubFetch('/v1/status', 'PUT', {
    books: session.me.share.current === false ? [] : books,
    leaving
  }).catch(() => {
    // Too soon for the hub or unreachable: a settled position 5 minutes on tries again.
    lastPush = { at: Date.now() - pushInterval + 5 * 60_000, title };
  });
}
