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
import { titleVolume } from '$lib/components/book-card/library-sort';
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
} from '$lib/data/discord-template';
import {
  activityTemplate,
  discordActivities$,
  discordOptions,
  discordOptions$
} from '$lib/data/discord-settings';
import {
  relayActivity,
  relayAllowed,
  relayClear,
  relayPageTurn,
  resetRelay
} from '$lib/data/discord-relay';
import { socialSession$ } from '$lib/data/social-account';
import { resetHubCovers } from '$lib/data/discord-covers';
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
}

export type ConnectionState =
  | 'checking'
  | 'connected'
  | 'missing'
  | 'ankiClosed'
  | 'discordClosed'
  | 'blocked'
  | 'off';

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
    charsRead: characters ? number(position) : '',
    timeLeftBook: bookLeft === undefined ? '' : formatDuration(bookLeft),
    timeLeftChapter: chapterLeft === undefined ? '' : formatDuration(chapterLeft),
    charsToday: stats ? number(stats.charsToday) : '',
    timeToday: stats ? formatDuration(stats.timeToday) : '',
    speed: speed ? number(speed) : '',
    wordsKnown: extras.wordsKnown === undefined ? '' : number(extras.wordsKnown),
    streak: stats?.streak ? `${stats.streak} ${stats.streak === 1 ? 'day' : 'days'}` : ''
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
let catalogCache: Promise<Map<string, { id: number; author: string; series: string }>> | undefined;
/** The 1-10 level by catalog id */
let difficultyCache: Promise<Record<string, number | undefined>> | undefined;
let coverCache: { saves: number; value: Promise<Record<string, { cover: string }>> } | undefined;

async function loadStats(): Promise<ReadingStats | undefined> {
  const [{ database, startDayHoursForTracker$ }, { getDateKey }, { learnerStats }] =
    await Promise.all([
      import('$lib/data/store'),
      import('$lib/functions/statistic-util'),
      import('$lib/data/learner-stats')
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
  catalogCache ??= import('$lib/data/calibre')
    .then(({ loadCalibreCatalog }) => loadCalibreCatalog())
    .then(
      (books) =>
        new Map(
          books.map((book) => [
            book.title,
            { id: book.id, author: book.authors, series: book.series }
          ])
        )
    )
    .catch(() => new Map());
  return (await catalogCache).get(title);
}

async function extrasFor(title: string, used: Set<VariableName>): Promise<ValueExtras> {
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
      value: import('$lib/data/words-met')
        .then(({ getWordsSummary }) => getWordsSummary())
        .then((summary) => summary.known)
        .catch(() => undefined)
    };
    extras.wordsKnown = await wordsCache.value;
  }
  if (title && needs('author', 'series')) {
    const book = await catalogBook(title);
    const { guessSeriesName } = await import('$lib/data/series-overrides');

    extras.author = book?.author;
    extras.series = book?.series || guessSeriesName(title);
  }
  if (title && needs('difficulty')) {
    difficultyCache ??= Promise.all([
      import('$lib/data/calibre'),
      import('$lib/data/difficulty-core')
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
async function coverFor(title: string, hidden: boolean) {
  const metadata = await import('$lib/data/book-metadata');

  if (coverCache?.saves !== metadata.metadataSaves) {
    coverCache = {
      saves: metadata.metadataSaves,
      value: metadata.loadBookMetadata().catch(() => ({}))
    };
  }

  const picked = (await coverCache.value)[title]?.cover;
  const covers = await import('$lib/data/discord-covers');
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
  const { canSearch, findCover } = await import('$lib/data/discord-covers');

  if (kind === 'idle' || !title || !canSearch(title)) return;
  const series = (await catalogBook(title))?.series;

  if (allowed()) findCover(title, kind, series);
}

const isPrivate = async (activity: ReadingActivity) => {
  if (activity.kind === 'idle' || !activity.title) return false;
  if (discordOptions().hideTitles) return true;

  const { bookKey, isHidden } = await import('$lib/data/social');

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
    extrasFor(title, templateVariables(template)),
    template.largeImage === 'cover' && title && activity.kind !== 'idle'
      ? coverFor(title, hidden)
      : undefined
  ]);
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
let renderRun = 0;
const openedAt = new Map<string, number>();

function put(activity: DiscordActivity) {
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
    if (activity.title && !openedAt.has(activity.title)) openedAt.set(activity.title, now);
    clearTimeout(awayTimer);
    awayTimer = setTimeout(goAway, Math.max(1, discordOptions().awayMinutes) * 60_000);
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
  statsCache = wordsCache = undefined;
  catalogCache = difficultyCache = coverCache = undefined;
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
}
