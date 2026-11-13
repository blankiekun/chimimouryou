/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The Discord plugin's sender: the readers (/b, /m, /v) and the library report what is open
 * (`discordActivity`), this fills in the activity's template and PUTs it to the Anki add-on on
 * 127.0.0.1:41918 (apps/anki-discord), at most once per 15 s and only when it changed. Away after
 * N minutes without a page turn; DELETE on leaving, Show my status off or the plugin off. Nothing
 * goes to the add-on while the plugin or Show my status is off. Not part of upstream.
 */

import { BehaviorSubject, combineLatest } from 'rxjs';
import {
  getChapterData,
  type SectionWithProgress
} from '$lib/components/book-reader/book-toc/book-toc';
import { titleVolume } from '$lib/data/library/library-sort';
import {
  activityKey,
  activityProblems,
  buildActivity,
  templateFields,
  usedVariables,
  type DiscordActivity,
  type DiscordActivityTemplate,
  type DiscordKind,
  type DiscordTimes,
  type DiscordValues,
  type VariableName
} from '$lib/data/discord/discord-template';
import {
  activityTemplate,
  discordActivities$,
  discordOptions,
  discordOptions$
} from '$lib/data/discord/discord-settings';
import {
  relayActivity,
  relayAllowed,
  relayClear,
  relayPageTurn,
  resetRelay
} from '$lib/data/discord/discord-relay';
import { socialSession$ } from '$lib/data/social/social-account';
import { resetHubCovers } from '$lib/data/discord/discord-covers';
import { enabledPlugins$ } from '$lib/plugins/plugin-settings';

export const addonUrl = 'http://127.0.0.1:41918';
/** Origins the add-on allows without `extraOrigins` (server.py DEFAULT_ORIGINS) */
export const addonOrigins = [
  'https://chimireader.github.io',
  'https://chimireader.blankie.moe',
  'http://127.0.0.1:41917'
];
export const addonReadme =
  'https://github.com/blankiekun/chimimouryou/tree/main/apps/anki-discord#readme';

const minGap = 15_000;
const leaveDelay = 2_000;

/** What a reader or the library reports */
export interface ReadingActivity {
  kind: DiscordKind;
  title?: string;
  /** Characters read (books, VNs) */
  position?: number;
  characters?: number;
  /** Manga pages, from 1 */
  page?: number;
  pageCount?: number;
  sections?: SectionWithProgress[];
  /** A natively played game is running: it stays the status without page turns (no Away) */
  playing?: boolean;
  /** VN lines read (this game) */
  lines?: number;
}

export interface ReadingStats {
  charsToday: number;
  /** Seconds */
  timeToday: number;
  /** Characters per hour */
  speed: number;
  streak: number;
}

export interface ValueExtras {
  stats?: ReadingStats;
  author?: string;
  series?: string;
  difficulty?: number;
  wordsKnown?: number;
  /** The Find details page (AniList, VNDB, Jiten), else the Community match's */
  workUrl?: string;
  titleRomaji?: string;
  titleEnglish?: string;
  communityUrl?: string;
  profileUrl?: string;
  /** Calibre's 0-5 stars */
  rating?: number | null;
  tags?: string[];
  publisher?: string;
  /** Share (0-1) of the book's words the reader knows */
  comprehension?: number;
  /** Characters read in this title since the session's first move in it */
  sessionChars?: number;
  cardsMinedToday?: number;
  newWordsToday?: number;
  linesToday?: number;
}

export type ConnectionState =
  'checking' | 'connected' | 'missing' | 'ankiClosed' | 'discordClosed' | 'blocked' | 'off';

export interface DiscordConnection {
  state: ConnectionState;
  /** Epoch ms of the add-on's last send to Discord */
  lastSent: number | null;
  /** The add-on holds a presence key (hub relay) */
  paired?: boolean;
  checkedAt: number;
}

export const discordConnection$ = new BehaviorSubject<DiscordConnection>({
  state: 'checking',
  lastSent: null,
  checkedAt: 0
});

/** The last values filled in, for the editor's picker and preview (this page only) */
export const discordValues$ = new BehaviorSubject<{
  kind: DiscordKind;
  values: DiscordValues;
  cover?: string;
} | null>(null);

const kindNames: Record<DiscordKind, string> = {
  book: 'Book',
  manga: 'Manga',
  vn: 'Visual novel',
  idle: ''
};

const number = (value: number) => Math.round(value).toLocaleString('en-US');

/** "32 min", "9 h 40 min"; '' under a minute */
export function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);

  if (!Number.isFinite(minutes) || minutes < 1) return '';
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60
    ? `${Math.floor(minutes / 60)} h ${minutes % 60} min`
    : `${Math.floor(minutes / 60)} h`;
}

/** The chapter at the reading position: label, number, count and characters left in it */
function chapterAt(sections: SectionWithProgress[] | undefined, position: number) {
  if (!sections?.length) return undefined;

  const [chapters, index] = getChapterData(sections);
  const chapter = chapters[index];

  if (!chapter) return undefined;
  return {
    label: chapter.label ?? '',
    number: index + 1,
    count: chapters.length,
    left:
      chapter.startCharacter !== undefined && chapter.characters !== undefined
        ? Math.max(0, chapter.startCharacter + chapter.characters - position)
        : undefined
  };
}

/** The variables' values and the times for the timestamp */
export function readingValues(
  activity: ReadingActivity,
  extras: ValueExtras,
  times: Omit<DiscordTimes, 'chapterLeft' | 'bookLeft'>
): { values: DiscordValues; times: DiscordTimes } {
  const { kind, title = '', position = 0, characters = 0, page, pageCount } = activity;
  const { stats } = extras;
  const speed = stats?.speed ?? 0;
  const chapter = chapterAt(activity.sections, position);
  const volume = title ? titleVolume(title) : undefined;
  const fraction = pageCount ? (page ?? 0) / pageCount : characters ? position / characters : NaN;
  const bookLeft = characters && speed ? ((characters - position) / speed) * 3600 : undefined;
  const chapterLeft =
    chapter?.left !== undefined && speed ? (chapter.left / speed) * 3600 : undefined;
  const values: DiscordValues = {
    title,
    author: extras.author,
    series: extras.series,
    volume: volume === undefined ? '' : `Vol. ${volume}`,
    chapter: chapter?.label,
    kind: kindNames[kind],
    difficulty: extras.difficulty === undefined ? '' : extras.difficulty.toFixed(1),
    chapterNumber: chapter ? String(chapter.number) : '',
    chapterCount: chapter ? String(chapter.count) : '',
    percent: Number.isFinite(fraction) ? `${Math.min(100, Math.floor(fraction * 100))}%` : '',
    page: page ? String(page) : '',
    pageCount: pageCount ? String(pageCount) : '',
    charsRead: position ? number(position) : '',
    timeLeftBook: bookLeft === undefined ? '' : formatDuration(bookLeft),
    timeLeftChapter: chapterLeft === undefined ? '' : formatDuration(chapterLeft),
    charsToday: stats ? number(stats.charsToday) : '',
    timeToday: stats ? formatDuration(stats.timeToday) : '',
    speed: speed ? number(speed) : '',
    wordsKnown: extras.wordsKnown === undefined ? '' : number(extras.wordsKnown),
    streak: stats?.streak ? `${stats.streak} ${stats.streak === 1 ? 'day' : 'days'}` : '',
    workUrl: extras.workUrl,
    vndbId: extras.workUrl?.match(/^https:\/\/vndb\.org\/(v\d+)/)?.[1],
    anilistId: extras.workUrl?.match(/^https:\/\/anilist\.co\/(?:manga|anime)\/(\d+)/)?.[1],
    titleRomaji: extras.titleRomaji,
    titleEnglish: extras.titleEnglish,
    communityUrl: extras.communityUrl,
    rating: extras.rating ? `${Math.round(extras.rating * 2) / 2}/5` : '',
    tags: extras.tags?.slice(0, 3).join(', '),
    publisher: extras.publisher,
    comprehension:
      extras.comprehension === undefined ? '' : `${Math.round(extras.comprehension * 100)}%`,
    charsSession: extras.sessionChars ? number(extras.sessionChars) : '',
    timeSession: times.session ? formatDuration((times.now - times.session) / 1000) : '',
    linesRead: activity.lines ? number(activity.lines) : '',
    cardsMinedToday: extras.cardsMinedToday === undefined ? '' : number(extras.cardsMinedToday),
    newWordsToday: extras.newWordsToday === undefined ? '' : number(extras.newWordsToday),
    linesToday: extras.linesToday === undefined ? '' : number(extras.linesToday),
    profileUrl: extras.profileUrl
  };

  return { values, times: { ...times, bookLeft, chapterLeft } };
}

const templateVariables = (template: DiscordActivityTemplate) =>
  new Set<VariableName>([
    ...templateFields(template).flatMap((field) => usedVariables(field.text)),
    ...(template.party ? [template.partyCurrent, template.partyMax] : []),
    ...(template.timestamp.endsWith('Left') ? (['speed'] as VariableName[]) : [])
  ]);

// Lookups shared by every update, each made only when a template needs it.
let statsCache: { at: number; value: Promise<ReadingStats | undefined> } | undefined;
let wordsCache: { at: number; value: Promise<number | undefined> } | undefined;
let newWordsCache: { at: number; value: Promise<number | undefined> } | undefined;
interface CatalogEntry {
  id: number;
  author: string;
  series: string;
  rating?: number | null;
  tags: string[];
  publisher: string;
}
let catalogCache: Promise<Map<string, CatalogEntry>> | undefined;
/** The 1-10 level by catalog id */
let difficultyCache: Promise<Record<string, number | undefined>> | undefined;
let metadataCache:
  | {
      saves: number;
      value: Promise<import('$lib/data/library/book-metadata').BookMetadataMap>;
    }
  | undefined;
/** knownCoverage$ loaded for {comprehension} (Calibre books) */
let coverageLoad: { at: number; value: Promise<unknown> } | undefined;
/** Calibre books whose exact coverage was asked for on this page */
const coverageAsked = new Set<number>();
/** {comprehension} of books outside the catalog (the standalone's word lists), by title */
const localShares = new Map<string, { at: number; value: Promise<number | undefined> }>();

async function loadStats(): Promise<ReadingStats | undefined> {
  const [{ database, startDayHoursForTracker$ }, { getDateKey }, { learnerStats }] =
    await Promise.all([
      import('$lib/data/store'),
      import('$lib/functions/statistic-util'),
      import('$lib/data/stats/learner-stats')
    ]);
  const statistics = await database.getStatisticsForTimeWindow('0000-00-00', '9999-99-99');
  const today = getDateKey(startDayHoursForTracker$.getValue());
  const stats = learnerStats(statistics, today);

  return {
    charsToday: stats.todayCharacters,
    timeToday: statistics
      .filter((statistic) => statistic.dateKey === today)
      .reduce((sum, statistic) => sum + Math.max(0, statistic.readingTime || 0), 0),
    speed: stats.speed,
    streak: stats.streak
  };
}

const fresh = <T>(cache: { at: number; value: T } | undefined, age: number) =>
  cache && Date.now() - cache.at < age ? cache : undefined;

async function catalogBook(title: string) {
  catalogCache ??= import('$lib/data/remote/calibre')
    .then(({ loadCalibreCatalog }) => loadCalibreCatalog())
    .then(
      (books) =>
        new Map(
          books.map((book) => [
            book.title,
            {
              id: book.id,
              author: book.authors,
              series: book.series,
              rating: book.rating,
              tags: book.tags ?? [],
              publisher: book.publisher ?? ''
            }
          ])
        )
    )
    .catch(() => new Map());
  return (await catalogCache).get(title);
}

/** The page of a Community work key: anilist:123[/vol] → its AniList page, vndb:v17 → VNDB's */
export function workPage(work?: string) {
  const anilist = /^anilist:(\d+)/.exec(work ?? '');
  const vndb = /^vndb:(v\d+)$/.exec(work ?? '');

  if (anilist) return `https://anilist.co/manga/${anilist[1]}`;
  return vndb ? `https://vndb.org/${vndb[1]}` : undefined;
}

/** The site's https address (no trailing slash), '' when it isn't served over https */
async function siteUrl() {
  const { basePath, pagePath } = await import('$lib/data/env');
  const site = `${basePath || window.location.origin}${pagePath}`.replace(/\/+$/, '');

  return site.startsWith('https://') ? site : '';
}

async function localShare(title: string) {
  const [{ localWordList }, { getKnownSet }, { wordCoverage }] = await Promise.all([
    import('$lib/data/analysis/analysis-tools'),
    import('$lib/data/words/known-words'),
    import('$lib/data/words/book-words')
  ]);
  const [list, known] = await Promise.all([localWordList(title), getKnownSet()]);

  return list ? wordCoverage(list.words, known.isKnown, list.totals)?.share : undefined;
}

/** The share of the book's words the reader knows: the library's coverage, else the word list's */
async function comprehensionFor(title: string, hidden: boolean) {
  const book = await catalogBook(title);

  if (book) {
    const words = await import('$lib/data/words/known-words');

    coverageLoad = fresh(coverageLoad, 600_000) ?? {
      at: Date.now(),
      value: words.loadCoverageCache().catch(() => undefined)
    };
    await coverageLoad.value;

    const share = words.knownCoverage$.getValue()[book.id];

    // Worked out in the background (its word list is fetched): the next update has it.
    if (share === undefined && !hidden && allowed() && !coverageAsked.has(book.id)) {
      coverageAsked.add(book.id);
      words.cacheCoverage([book.id]);
    }
    return share;
  }

  const { standalone } = await import('$lib/data/env');

  if (!standalone) return undefined;

  const cached = fresh(localShares.get(title), 600_000) ?? {
    at: Date.now(),
    value: localShare(title).catch(() => undefined)
  };

  localShares.set(title, cached);
  return cached.value;
}

/** Words marked known today (Words page, popup), ignored ones left out */
async function countNewWords() {
  const [{ getWordMarks }, { startDayHoursForTracker$ }, { getDateKey }] = await Promise.all([
    import('$lib/data/words/word-marks'),
    import('$lib/data/store'),
    import('$lib/functions/statistic-util')
  ]);
  const hours = startDayHoursForTracker$.getValue();
  const today = getDateKey(hours);

  return Object.values(await getWordMarks()).filter(
    (mark) => mark.status === 'known' && getDateKey(hours, new Date(mark.modified)) === today
  ).length;
}

async function extrasFor(
  title: string,
  used: Set<VariableName>,
  hidden: boolean
): Promise<ValueExtras> {
  const extras: ValueExtras = {};
  const needs = (...names: VariableName[]) => names.some((name) => used.has(name));

  if (needs('charsToday', 'timeToday', 'speed', 'streak', 'timeLeftBook', 'timeLeftChapter')) {
    statsCache = fresh(statsCache, 60_000) ?? {
      at: Date.now(),
      value: loadStats().catch(() => undefined)
    };
    extras.stats = await statsCache.value;
  }
  if (needs('wordsKnown')) {
    wordsCache = fresh(wordsCache, 600_000) ?? {
      at: Date.now(),
      value: import('$lib/data/words/words-met')
        .then(({ getWordsSummary }) => getWordsSummary())
        .then((summary) => summary.known)
        .catch(() => undefined)
    };
    extras.wordsKnown = await wordsCache.value;
  }
  if (title && needs('author', 'series', 'rating', 'tags', 'publisher')) {
    const book = await catalogBook(title);
    const { guessSeriesName } = await import('$lib/data/library/series-overrides');

    extras.author = book?.author;
    extras.series = book?.series || guessSeriesName(title);
    extras.rating = book?.rating;
    extras.tags = book?.tags;
    extras.publisher = book?.publisher;
  }
  if (
    title &&
    needs('workUrl', 'vndbId', 'anilistId', 'titleRomaji', 'titleEnglish', 'communityUrl')
  ) {
    const [metadata, { communityWorks$, communityOn, workFromUrl }] = await Promise.all([
      metadataFor(title),
      import('$lib/data/social/community')
    ]);
    const work = communityWorks$.getValue()[title];

    extras.workUrl = metadata?.url || workPage(work);
    if (needs('titleRomaji', 'titleEnglish')) {
      const saved = metadata?.titleRomaji || metadata?.titleEnglish;
      // Asked from AniList/VNDB only for a book whose title may leave the browser.
      const asked =
        !saved && extras.workUrl && !hidden && allowed()
          ? (await import('$lib/data/discord/discord-titles')).altTitles(extras.workUrl)
          : undefined;

      extras.titleRomaji = saved ? metadata?.titleRomaji : asked?.romaji;
      extras.titleEnglish = saved ? metadata?.titleEnglish : asked?.english;
    }
    if (needs('communityUrl') && !hidden && communityOn()) {
      const key = work ?? (metadata ? workFromUrl(metadata.url, title) : null);
      const site = key ? await siteUrl() : '';

      if (key && site) extras.communityUrl = `${site}/community?work=${encodeURIComponent(key)}`;
    }
  }
  if (needs('profileUrl') && enabledPlugins$.getValue().includes('social')) {
    const name = socialSession$.getValue()?.me.username;
    const site = name ? await siteUrl() : '';

    if (name && site) extras.profileUrl = `${site}/u?name=${encodeURIComponent(name)}`;
  }
  if (title && needs('comprehension')) {
    extras.comprehension = await comprehensionFor(title, hidden);
  }
  if (needs('newWordsToday')) {
    newWordsCache = fresh(newWordsCache, 60_000) ?? {
      at: Date.now(),
      value: countNewWords().catch(() => undefined)
    };
    extras.newWordsToday = await newWordsCache.value;
  }
  if (needs('cardsMinedToday', 'linesToday')) {
    const [{ minedCards, vnLines }, { startDayHoursForTracker$ }] = await Promise.all([
      import('$lib/data/stats/day-counters'),
      import('$lib/data/store')
    ]);
    const hours = startDayHoursForTracker$.getValue();

    extras.cardsMinedToday = minedCards.today(hours);
    extras.linesToday = vnLines.today(hours);
  }
  if (title && needs('difficulty')) {
    difficultyCache ??= Promise.all([
      import('$lib/data/remote/calibre'),
      import('$lib/data/difficulty/difficulty-core')
    ])
      .then(async ([{ loadCalibreDifficulty }, { levelOf }]) =>
        Object.fromEntries(
          Object.entries(await loadCalibreDifficulty()).map(([id, estimate]) => [
            id,
            levelOf(estimate)
          ])
        )
      )
      .catch(() => ({}));

    const book = await catalogBook(title);

    extras.difficulty = book && (await difficultyCache)[book.id];
  }
  return extras;
}

/**
 * A public https cover, in this order: the one picked in Find details (AniList, VNDB, Jiten;
 * automatic matches save no cover), the book's own cover as a hub thumbnail (signed in, social
 * on and the book not private; uploaded once when the hub has none), the AniList/VNDB cover this
 * browser matched (discord-covers.ts), else none. Find details are reloaded after any save.
 */
async function metadataFor(title: string) {
  const metadata = await import('$lib/data/library/book-metadata');

  if (metadataCache?.saves !== metadata.metadataSaves) {
    metadataCache = {
      saves: metadata.metadataSaves,
      value: metadata.loadBookMetadata().catch(() => ({}))
    };
  }
  return (await metadataCache.value)[title];
}

async function coverFor(title: string, hidden: boolean) {
  const picked = (await metadataFor(title))?.cover;
  const covers = await import('$lib/data/discord/discord-covers');
  const hub =
    !picked &&
    !hidden &&
    allowed() &&
    socialSession$.getValue() &&
    enabledPlugins$.getValue().includes('social')
      ? await covers.hubCover(title)
      : undefined;

  return picked || hub || covers.localCover(title);
}

/** No cover yet: search for one in the background; the next update shows it. */
async function discoverCover(activity: ReadingActivity) {
  const { kind, title } = activity;
  const { canSearch, findCover } = await import('$lib/data/discord/discord-covers');

  if (kind === 'idle' || !title || !canSearch(title)) return;
  const series = (await catalogBook(title))?.series;

  if (allowed()) findCover(title, kind, series);
}

const isPrivate = async (activity: ReadingActivity) => {
  if (activity.kind === 'idle' || !activity.title) return false;
  if (discordOptions().hideTitles) return true;

  const { bookKey, isHidden } = await import('$lib/data/social/social');

  return isHidden({ key: bookKey(activity.title), kind: activity.kind });
};

const allowed = () => enabledPlugins$.getValue().includes('discord') && discordOptions().show;

/** The finished activity for what is open, and whether a problem keeps it from being sent */
export async function renderActivity(
  activity: ReadingActivity,
  times: Omit<DiscordTimes, 'chapterLeft' | 'bookLeft'>
) {
  const template = activityTemplate(activity.kind);
  const title = activity.title ?? '';
  const hidden = await isPrivate(activity);
  const [extras, cover] = await Promise.all([
    extrasFor(title, templateVariables(template), hidden),
    template.largeImage === 'cover' && title && activity.kind !== 'idle'
      ? coverFor(title, hidden)
      : undefined
  ]);
  const start = title && activity.kind !== 'manga' ? sessionPositions.get(title) : undefined;

  if (start !== undefined) extras.sessionChars = Math.max(0, (activity.position ?? 0) - start);

  const filled = readingValues(activity, extras, times);

  // Only while sending is allowed, and never for a private book: the title would leave the browser.
  if (template.show && template.largeImage === 'cover' && title && !cover && !hidden && allowed()) {
    discoverCover(activity);
  }
  discordValues$.next({ kind: activity.kind, values: filled.values, cover });
  return {
    template,
    blocked: !hidden && activityProblems(template, filled.values).length > 0,
    activity: template.show
      ? buildActivity(template, filled.values, { times: filled.times, cover, private: hidden })
      : undefined
  };
}

/** Chrome's Local Network Access permission was refused: requests to this computer fail. */
export async function localNetworkDenied() {
  try {
    const permission = await navigator.permissions.query({
      name: 'local-network-access' as PermissionName
    });

    return permission.state === 'denied';
  } catch {
    // Browsers without Local Network Access
    return false;
  }
}

// The add-on's answers set the status line; failures are quiet (no console spam).
async function unreachableState(): Promise<ConnectionState> {
  if (await localNetworkDenied()) return 'blocked';
  return window.localStorage.getItem('discordAddonSeen') ? 'ankiClosed' : 'missing';
}

function setConnection(change: Partial<DiscordConnection>) {
  discordConnection$.next({ ...discordConnection$.getValue(), ...change, checkedAt: Date.now() });
}

async function call(method: 'GET' | 'PUT' | 'DELETE', body?: unknown, keepalive = false) {
  try {
    const response = await fetch(`${addonUrl}/v1/${method === 'GET' ? 'status' : 'activity'}`, {
      method,
      ...(body
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
      keepalive,
      signal: AbortSignal.timeout?.(5000)
    });

    window.localStorage.setItem('discordAddonSeen', '1');
    if (response.status === 403) setConnection({ state: 'missing' });
    return response;
  } catch {
    setConnection({ state: await unreachableState() });
    return undefined;
  }
}

/** GET /v1/status for the status line; nothing is asked while the plugin or Show my status is off */
export async function checkConnection() {
  if (!allowed()) {
    setConnection({ state: 'off' });
    return;
  }
  if (!discordConnection$.getValue().checkedAt) setConnection({ state: 'checking' });

  const response = await call('GET');

  if (!response?.ok) return;

  const status = await response.json().catch(() => ({}));

  setConnection({
    state: status.discord === 'connected' ? 'connected' : 'discordClosed',
    lastSent: typeof status.lastSent === 'number' ? status.lastSent : null,
    paired: status.paired === true
  });
}

// The sender's state (one per page).
let current: ReadingActivity | undefined;
let lastKey = '';
let lastAt = 0;
let sent = false;
let pending: DiscordActivity | undefined;
let sendTimer: ReturnType<typeof setTimeout> | undefined;
let leaveTimer: ReturnType<typeof setTimeout> | undefined;
let awayTimer: ReturnType<typeof setTimeout> | undefined;
let away = false;
let sessionStart = 0;
/** Each title's position at its first move this session ({charsSession}) */
const sessionPositions = new Map<string, number>();
let renderRun = 0;
const openedAt = new Map<string, number>();
let lastActivity: DiscordActivity | undefined;
/** Which tab sent last: only that one re-sends, or two open tabs would swap the status. */
const senderId = String(Math.random());
/** The add-on clears a status after 15 minutes without a PUT (a crashed browser sends no DELETE). */
const resendMs = 5 * 60_000;

function put(activity: DiscordActivity) {
  lastActivity = activity;
  window.localStorage.setItem('discordSender', senderId);
  lastKey = activityKey(activity);
  lastAt = Date.now();
  sent = true;
  call('PUT', activity).then((response) => {
    if (response?.ok) setConnection({ lastSent: Date.now() });
  });
}

function flush() {
  sendTimer = undefined;
  if (pending && allowed()) put(pending);
  pending = undefined;
}

/** Sends the activity if it changed, at most once per 15 s (the newest one wins). */
function deliver(activity: DiscordActivity | undefined) {
  if (!activity) {
    clear();
    return;
  }
  if (activityKey(activity) === lastKey) {
    pending = undefined;
    return;
  }

  pending = activity;
  const wait = lastAt + minGap - Date.now();

  if (wait <= 0) flush();
  else sendTimer ??= setTimeout(flush, wait);
}

/** DELETE, once, if this page sent a status */
export function clear(keepalive = false) {
  relayClear(keepalive);
  clearTimeout(sendTimer);
  sendTimer = undefined;
  pending = undefined;
  if (!sent) return;
  sent = false;
  lastKey = '';
  call('DELETE', undefined, keepalive);
}

async function update() {
  if (!allowed() || !current) return;

  const run = ++renderRun;
  const shown = away && discordOptions().awayIdle ? { kind: 'idle' as const } : current;

  if (away && !discordOptions().awayIdle) {
    clear();
    return;
  }

  const result = await renderActivity(shown, {
    now: Date.now(),
    session: sessionStart || undefined,
    opened: (current.title && openedAt.get(current.title)) || undefined
  });

  if (run !== renderRun || !allowed()) return;
  if (result.blocked) return; // the last status that worked stays
  relayActivity(shown.kind, result.activity);
  deliver(result.activity);
}

const moved = (before: ReadingActivity | undefined, after: ReadingActivity) =>
  !before ||
  before.title !== after.title ||
  before.position !== after.position ||
  before.page !== after.page;

function goAway() {
  away = true;
  sessionStart = 0;
  sessionPositions.clear();
  update();
}

/**
 * What is open now (from a reader or the library), or undefined when leaving it. A reader's
 * page turn ends Away and restarts its clock.
 */
export function discordActivity(activity: ReadingActivity | undefined) {
  clearTimeout(leaveTimer);
  if (!activity) {
    current = undefined;
    clearTimeout(awayTimer);
    // The next page (e.g. the library) may report at once: clear only if nothing follows.
    leaveTimer = setTimeout(() => !current && clear(), leaveDelay);
    return;
  }

  if (activity.kind !== 'idle' && moved(current, activity)) {
    const now = Date.now();

    away = false;
    relayPageTurn();
    sessionStart ||= now;
    if (activity.title && !sessionPositions.has(activity.title)) {
      sessionPositions.set(activity.title, activity.position ?? 0);
    }
    if (activity.title && !openedAt.has(activity.title)) openedAt.set(activity.title, now);
    clearTimeout(awayTimer);
    awayTimer = setTimeout(goAway, Math.max(1, discordOptions().awayMinutes) * 60_000);
  }
  if (activity.playing) {
    away = false;
    sessionStart ||= Date.now();
    clearTimeout(awayTimer);
  }
  current = activity;
  update();
}

/** Send test status: the activity for the open book (or sample values), at once */
export async function sendTest(activity: DiscordActivity) {
  if (!allowed()) return;
  clearTimeout(sendTimer);
  sendTimer = undefined;
  pending = undefined;
  put(activity);
}

/** For tests: forget everything this page sent */
export function resetSender() {
  [sendTimer, leaveTimer, awayTimer].forEach(clearTimeout);
  sendTimer = leaveTimer = awayTimer = undefined;
  current = pending = undefined;
  lastKey = '';
  lastAt = 0;
  sent = away = false;
  sessionStart = 0;
  openedAt.clear();
  sessionPositions.clear();
  coverageAsked.clear();
  localShares.clear();
  statsCache = wordsCache = newWordsCache = coverageLoad = undefined;
  catalogCache = difficultyCache = metadataCache = undefined;
  import('$lib/data/discord/discord-titles').then(({ resetAltTitles }) => resetAltTitles());
  resetHubCovers();
  discordValues$.next(null);
  resetRelay();
}

if (typeof window !== 'undefined') {
  // The plugin or Show my status going off clears the status; templates changing resend it.
  combineLatest([enabledPlugins$, discordOptions$, discordActivities$, socialSession$]).subscribe(
    () => {
      if (!relayAllowed()) relayClear();
      if (allowed()) update();
      else clear();
    }
  );
  window.addEventListener('pagehide', () => clear(true));
  setInterval(() => {
    if (
      sent &&
      lastActivity &&
      allowed() &&
      window.localStorage.getItem('discordSender') === senderId
    ) {
      put(lastActivity);
    }
  }, resendMs);
}
