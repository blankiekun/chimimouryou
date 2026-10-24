/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Friends on the social hub: the friends list and the activity feed (cached 15 minutes,
 * loaded only by Home, /friends and profiles), profiles, requests, and the reader's own
 * status (current books, a finished book and stats, pushed on opening and leaving a book and
 * at most every 15 minutes while reading). Books hidden from friends never leave the browser.
 * Requests go out only while signed in to the hub. Not part of upstream.
 */

import { absCleanTitle, absMatchKey } from '$lib/data/audiobookshelf';
import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import {
  writableArrayLocalStorageSubject,
  writableObjectLocalStorageSubject
} from '$lib/data/internal/writable-object-local-storage-subject';
import { activityWeeks, learnerStats } from '$lib/data/learner-stats';
import {
  HubError,
  hubFetch,
  shareDefaults,
  socialSession$,
  type ShareKey
} from '$lib/data/social-account';
import { enabledPlugins$ } from '$lib/plugins/plugin-settings';

export type BookKind = 'book' | 'manga' | 'vn';

export interface FriendBook {
  key: string;
  title: string;
  author: string;
  /** hidden: "Reading something", only the share is sent (key and title empty) */
  kind: BookKind | 'hidden';
  /** 0-1 */
  pct: number;
  /** Unix seconds */
  readAt: number;
  /** The hub's thumbnail (its content hash), when it has one */
  cover?: string | null;
}

export interface FinishedBook {
  key: string;
  title: string;
  kind: BookKind;
  /** YYYY-MM */
  month: string;
  cover?: string | null;
}

export interface SocialStats {
  streak: number;
  weekChars: number;
  weekMinutes: number;
  finishedYear: number;
  /** 84 days, oldest first, a level 0-4 each */
  heat: string;
  wordsKnown?: number;
  /** Reading rank 1-7 (reading-rank.ts) and the characters it counted; the hub caps both */
  rank?: number;
  chars?: number;
}

export interface Person {
  id: string;
  username: string;
  name: string;
  avatar: number;
  /** The uploaded picture's version, 0 or absent for the preset */
  picture?: number;
  /** 'dev' for the hub's moderators (a Dev badge), else '' or absent (older hubs) */
  role?: string;
}

export interface Friend extends Person {
  since: number;
  books: FriendBook[];
  finished?: FinishedBook[];
  stats?: SocialStats | null;
}

export interface FriendsList {
  friends: Friend[];
  incoming: (Person & { at: number })[];
  /** Who a code belongs to stays hidden until they accept (a username: "@name") */
  outgoing: { id: string; code: string; at: number }[];
}

export interface SocialEvent {
  id: number;
  type: 'started' | 'finished' | 'streak';
  key: string;
  title: string;
  kind: BookKind;
  /** Days, for streaks */
  value: number;
  at: number;
  /** In the feed */
  user?: Person;
}

export interface Profile {
  profile: Person & { created: number; public: boolean };
  relation: 'self' | 'friend' | 'visitor';
  since?: number;
  books: FriendBook[];
  finished: FinishedBook[];
  stats: SocialStats | null;
  events: SocialEvent[];
}

const cacheTime = 15 * 60_000;
const pushInterval = 15 * 60_000;
/** The hub's guard between two status pushes (STATUS_GAP in deploy/social-hub) */
const hubGap = 60_000;
/** Like words met: 97% counts as finished */
const finishedShare = 0.97;

export const friends$ = writableObjectLocalStorageSubject<{
  at: number;
  user: string;
  list: FriendsList;
} | null>()('socialFriends', null);

export const feed$ = writableObjectLocalStorageSubject<{
  at: number;
  user: string;
  events: SocialEvent[];
} | null>()('socialFeed', null);

/** The books this reader is on, newest first (at most 3), hidden ones included: never sent */
const currentBooks$ = writableArrayLocalStorageSubject<FriendBook>()('socialBooks', []);

/** Finished here and not yet on the hub */
const finishedPending$ = writableArrayLocalStorageSubject<Omit<FinishedBook, 'month'>>()(
  'socialFinishedPending',
  []
);

// Books are only noted while signed in: another hub account here (a server sign-in change
// brings the account's own) must not send the last one's.
socialSession$.subscribe((session) => {
  const id = session?.me.id;

  if (!id || typeof window === 'undefined') return;
  if (window.localStorage.getItem('socialBooksUser') !== id) {
    currentBooks$.next([]);
    finishedPending$.next([]);
    window.localStorage.setItem('socialBooksUser', id);
  }
});

/** Book keys hidden from friends (the book page's switch), kept in this browser only */
export const hiddenBooks$ = writableArrayLocalStorageSubject<string>()('socialHiddenBooks', []);

/** The same book across libraries: the title without store tags, width, case and punctuation */
export function bookKey(title: string) {
  return absMatchKey(absCleanTitle(title));
}

export function shareOn(key: ShareKey) {
  return socialSession$.getValue()?.me.share[key] ?? shareDefaults[key];
}

/** Hidden by its own switch, or all manga / all visual novels */
export function isHidden(book: { key: string; kind: string }, hidden = hiddenBooks$.getValue()) {
  return (
    hidden.includes(book.key) ||
    (book.kind === 'manga' && shareOn('hideManga')) ||
    (book.kind === 'vn' && shareOn('hideVn'))
  );
}

export function setBookHidden(title: string, hide: boolean) {
  const key = bookKey(title);
  const others = hiddenBooks$.getValue().filter((other) => other !== key);

  hiddenBooks$.next(hide ? [...others, key] : others);
  if (hide) {
    finishedPending$.next(finishedPending$.getValue().filter((book) => book.key !== key));
    // Friends see the change with the next push, at most 15 minutes on.
    lastPush = { at: 0, title: '' };
  }
}

/** What friends get of the current books: the shown ones, or "Reading something" when all are hidden */
export function sharedBooks(books: FriendBook[], hidden = hiddenBooks$.getValue()): FriendBook[] {
  if (!shareOn('current')) return [];

  const shown = books.filter((book) => !isHidden(book, hidden));
  const [latest] = books;

  return shown.length || !latest
    ? shown
    : [{ key: '', title: '', author: '', kind: 'hidden', pct: latest.pct, readAt: latest.readAt }];
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

/** "March" this year, else "March 2025" */
export function monthName(month: string, lang: string, now = new Date()) {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 1, 15));

  return new Intl.DateTimeFormat(lang, {
    month: 'long',
    ...(year === now.getFullYear() ? {} : { year: 'numeric' }),
    timeZone: 'UTC'
  }).format(date);
}

/** Friends with this book: reading it, then finished it (the book page's Friends row) */
export function friendsWithBook(friends: Friend[], title: string) {
  const key = bookKey(title);

  return friends.flatMap((friend) => {
    const reading = friend.books.find((book) => book.key === key);
    const finished = friend.finished?.find((book) => book.key === key);

    if (reading) return [{ friend, pct: reading.pct, month: '' }];
    if (finished) return [{ friend, pct: 1, month: finished.month }];
    return [];
  });
}

/** The stats a profile shows, from the daily statistics */
export function socialStats(
  statistics: BooksDbStatistic[],
  today: string,
  wordsKnown?: number,
  rank?: { tier: number; characters: number }
): SocialStats {
  const stats = learnerStats(statistics, today);
  const week = new Set(
    activityWeeks(statistics, today, 2)
      .flat()
      .slice(-7)
      .map((day) => day.dateKey)
  );
  const year = today.slice(0, 4);

  return {
    streak: stats.streak,
    weekChars: stats.weekCharacters,
    weekMinutes: Math.round(
      statistics
        .filter((statistic) => week.has(statistic.dateKey))
        .reduce((sum, statistic) => sum + Math.max(0, statistic.readingTime || 0), 0) / 60
    ),
    finishedYear: new Set(
      statistics
        .filter((statistic) => statistic.completedBook && statistic.dateKey.startsWith(year))
        .map((statistic) => statistic.title)
    ).size,
    heat: activityWeeks(statistics, today, 13)
      .flat()
      .slice(-84)
      .map((day) => day.level)
      .join('')
      .padStart(84, '0'),
    ...(wordsKnown === undefined ? {} : { wordsKnown }),
    ...(rank ? { rank: rank.tier, chars: rank.characters } : {})
  };
}

let lastStats: SocialStats | undefined;

async function collectStats() {
  if (!shareOn('stats')) return undefined;

  const [{ database, startDayHoursForTracker$ }, { getDateKey }] = await Promise.all([
    import('$lib/data/store'),
    import('$lib/functions/statistic-util')
  ]);
  const statistics = await database.getStatisticsForTimeWindow('0000-00-00', '9999-99-99');
  const known = shareOn('wordsKnown')
    ? await import('$lib/data/words-met')
        .then(({ getWordsSummary }) => getWordsSummary())
        .then((summary) => summary.known)
        .catch(() => undefined)
    : undefined;

  const rank = await import('$lib/data/reading-rank-data')
    .then(({ loadReadingRank }) => loadReadingRank(statistics))
    .catch(() => undefined);

  lastStats = socialStats(statistics, getDateKey(startDayHoursForTracker$.getValue()), known, rank);
  return lastStats;
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

/** Friends' events (90 days, the newest 100), refreshed like the friends list */
export async function loadFeed() {
  const session = socialSession$.getValue();
  const cached = feed$.getValue();

  if (!session) return;

  const mine = cached?.user === session.me.id ? cached : null;

  if (mine && Date.now() - mine.at < cacheTime) return;
  await hubFetch<{ events: SocialEvent[] }>(`/v1/feed?since=${mine?.events[0]?.at ?? 0}`).then(
    ({ events }) => {
      const oldest = Date.now() / 1000 - 90 * 86400;
      const fresh = new Set(events.map((event) => event.id));

      feed$.next({
        at: Date.now(),
        user: session.me.id,
        events: [...events, ...(mine?.events ?? []).filter((event) => !fresh.has(event.id))]
          .filter((event) => event.at > oldest)
          .slice(0, 100)
      });
    },
    () => {}
  );
}

const profiles = new Map<string, { at: number; profile: Profile }>();

/** A profile, cached 15 minutes; null when it doesn't exist or isn't shown to this reader */
export async function loadProfile(username: string, force = false) {
  const key = `${socialSession$.getValue()?.me.id ?? ''}:${username.toLowerCase()}`;
  const cached = profiles.get(key);

  if (!force && cached && Date.now() - cached.at < cacheTime) return cached.profile;
  try {
    const profile = await hubFetch<Profile>(`/v1/profile/${encodeURIComponent(username)}`);

    profiles.set(key, { at: Date.now(), profile });
    return profile;
  } catch (error) {
    if (error instanceof HubError && error.status === 404) return null;
    throw error;
  }
}

export const reportProfile = (username: string, what: 'name' | 'picture' = 'name') =>
  hubFetch('/v1/report', 'POST', { username, what });

/** A cover thumbnail on the hub: the one this reader (username) uploaded for the book key */
export const reportCover = (key: string, username: string) =>
  hubFetch('/v1/report', 'POST', { what: 'cover', key, username });

export const sendFriendRequest = (code: string) =>
  hubFetch<FriendsList>('/v1/friends/request', 'POST', { code }).then(setList);

/** Add friend on a public profile */
export const requestByUsername = (username: string) =>
  hubFetch<FriendsList>('/v1/friends/request', 'POST', { username }).then(setList);

export const acceptFriend = (id: string) =>
  hubFetch<FriendsList>(`/v1/friends/${id}/accept`, 'POST').then(setList);

/** Decline, cancel or remove */
export const removeFriend = (id: string) =>
  hubFetch<FriendsList>(`/v1/friends/${id}`, 'DELETE').then(setList);

export const blockFriend = (id: string) =>
  hubFetch<FriendsList>(`/v1/block/${id}`, 'POST').then(setList);

/**
 * Covers by book key, for friends' books you have too: the books in this browser, then the
 * server's Calibre catalog (none in the standalone without a server).
 */
export async function localCovers() {
  const [{ database }, calibre] = await Promise.all([
    import('$lib/data/store'),
    import('$lib/data/calibre')
  ]);
  const db = await database.db;
  const covers = new Map<string, { title: string; imagePath: string | Blob }>();
  const catalog = await calibre.loadCalibreCatalog().catch(() => []);

  catalog.forEach((book) => {
    const imagePath = calibre.calibreCoverUrl(book);

    if (imagePath) covers.set(bookKey(book.title), { title: book.title, imagePath });
  });
  // shortcut: walks every stored book (values include their HTML); add a title/cover index if
  // libraries get large enough for /friends to feel it.
  let cursor = await db.transaction('data').store.openCursor();

  while (cursor) {
    const { title, coverImage } = cursor.value;

    if (coverImage) covers.set(bookKey(title), { title, imagePath: coverImage });
    cursor = await cursor.continue();
  }
  return covers;
}

let lastPush = { at: 0, title: '' };
/** A book is open in a reader (for the push when the tab closes) */
let reading = false;

async function pushStatus(leaving: boolean, keepalive = false) {
  if (!socialSession$.getValue()) return;

  const books = sharedBooks(currentBooks$.getValue());
  const finished = finishedPending$.getValue().find((book) => !isHidden(book));
  // pagehide can't wait for IndexedDB: the stats of the last push.
  const stats = keepalive ? lastStats : await collectStats().catch(() => lastStats);

  const { needCovers } = await hubFetch<{ needCovers?: string[] }>(
    '/v1/status',
    'PUT',
    { books, leaving, ...(finished ? { finished } : {}), ...(stats ? { stats } : {}) },
    keepalive
  );
  finishedPending$.next(
    finishedPending$.getValue().filter((book) => book !== finished && !isHidden(book))
  );
  if (!keepalive && needCovers?.length) uploadCovers(needCovers).catch(() => {});
}

/** Book keys whose cover this page already tried to give the hub */
const coversTried = new Set<string>();

/**
 * The hub has no thumbnail of these shared books (it only asks for books just pushed, so never
 * hidden ones): a 160 px WebP of each cover this reader has, made in the browser.
 */
export async function uploadCovers(keys: string[]) {
  const wanted = keys.filter((key) => !coversTried.has(key));

  if (!wanted.length) return;

  const [covers, { coverThumbnail }, { serverFetch }, { coverThumbUrl }] = await Promise.all([
    localCovers(),
    import('$lib/data/social-images'),
    import('$lib/data/server-connect'),
    import('$lib/data/calibre')
  ]);

  for (const key of wanted) {
    const cover = covers.get(key)?.imagePath;

    coversTried.add(key);
    if (!cover) continue;
    try {
      const image =
        typeof cover === 'string'
          ? await serverFetch(coverThumbUrl(cover)).then((response) =>
              response.ok ? response.blob() : null
            )
          : cover;
      const thumbnail = image && (await coverThumbnail(image));

      if (thumbnail) {
        await hubFetch(`/v1/cover?key=${encodeURIComponent(key)}`, 'PUT', thumbnail);
      }
    } catch (_) {
      // Already given (409), or the next page load tries again.
    }
  }
}

if (typeof window !== 'undefined') {
  // Best effort when the tab closes in a book: onDestroy doesn't run then.
  window.addEventListener('pagehide', () => {
    if (reading) pushStatus(true, true).catch(() => {});
    reading = false;
  });
}

/**
 * The reading position of a book in a reader: updates the current books and sends them when
 * leaving, on a book not sent last, on finishing one, or 15 minutes after the last push.
 */
export function noteReading(
  title: string,
  position: number,
  characters: number,
  leaving = false,
  kind: BookKind = 'book'
) {
  const session = socialSession$.getValue();

  if (!session || !characters) return;

  const book: FriendBook = {
    key: bookKey(title),
    title,
    author: '',
    kind,
    pct: Math.min(1, position / characters),
    readAt: Math.floor(Date.now() / 1000)
  };
  const before = currentBooks$.getValue();
  const previous = before.find((other) => other.key === book.key);
  const finished = !!previous && previous.pct < finishedShare && book.pct >= finishedShare;
  const books = [book, ...before.filter((other) => other.key !== book.key)]
    .filter((other) => other.pct < finishedShare)
    .slice(0, 3);

  reading = !leaving;
  currentBooks$.next(books);
  if (finished && !isHidden(book)) {
    finishedPending$.next([
      ...finishedPending$.getValue().filter((other) => other.key !== book.key),
      { key: book.key, title, kind }
    ]);
  }
  if (
    !leaving &&
    !finished &&
    title === lastPush.title &&
    Date.now() - lastPush.at < pushInterval
  ) {
    return;
  }
  lastPush = { at: Date.now(), title };
  pushStatus(leaving, leaving).catch(() => {
    // Too soon for the hub or unreachable: a settled position a minute on tries again.
    lastPush = { at: Date.now() - pushInterval + hubGap, title };
  });
}

/**
 * Statistics deleted on the Statistics page: the recomputed stats go to the hub at once, outside
 * the 15-minute cadence (once more a minute on when the hub's guard refuses), and books left
 * without any statistics leave the hub's finished books and events.
 */
export async function statisticsDeleted(titles: string[]) {
  if (!socialSession$.getValue() || !enabledPlugins$.getValue().includes('social')) return;

  const { database } = await import('$lib/data/store');
  const gone = new Set<string>();

  for (const title of titles) {
    if (!(await database.getStatisticsForBook(title)).length) gone.add(bookKey(title));
  }
  finishedPending$.next(finishedPending$.getValue().filter((book) => !gone.has(book.key)));
  await Promise.all(
    [...gone].map((key) =>
      hubFetch(`/v1/finished/${encodeURIComponent(key)}`, 'DELETE').catch(() => {})
    )
  );
  lastPush = { ...lastPush, at: Date.now() };
  await pushStatus(false).catch((error) => {
    if (error instanceof HubError && error.status === 429) {
      setTimeout(() => pushStatus(false).catch(() => {}), hubGap + 1000);
    }
  });
}
