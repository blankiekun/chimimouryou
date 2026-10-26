/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Covers for the Discord status. First the book's own cover as a public hub thumbnail
 * (`hubCover`). Without one, the series (or the title without its volume and store tags) is
 * searched on AniList (books, manga) or VNDB (VNs), and only an exact title match is kept: its
 * details (never its cover: one per series would replace every volume's card) are saved as the
 * book's Find details, its cover in this browser only. Misses are remembered for 7 days (errors for an hour) and one search
 * runs at a time, so the sources' rate limits are never hit. The sender (discord.ts) decides when
 * a search is allowed. Not part of upstream.
 */

import { guessSeriesName } from '$lib/data/series-overrides';
import type { MetadataCandidate, MetadataKind } from '$lib/data/book-metadata';

const matchesKey = 'discordCoverMatches';
const missesKey = 'discordCoverMisses';
const missAge = 7 * 24 * 3600_000;
/** A failed search (offline, rate limit) is retried after an hour, not a week */
const errorRetry = 3600_000;

let searching = false;

function readMap<T>(key: string): Record<string, T> {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '{}');

    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeEntry(key: string, title: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ ...readMap(key), [title]: value }));
  } catch {
    // Storage full or blocked: the search may run again next session.
  }
}

/** Width, case, spaces and punctuation ignored: "Ｒｅ：ゼロ" and "re zero" style differences */
export const matchKey = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');

/** What to search for: the Calibre series, else the title without volume, store tags and author */
export function coverQuery(title: string, series = '') {
  if (series.trim()) return series.trim().normalize('NFKC');

  const bare = title
    .normalize('NFKC')
    .replace(/【[^】]*】/g, ' ')
    .replace(/\s+[-‐－–—]\s+[^-‐－–—]+$/, '')
    .replace(/(?:\s*[([（][^)\]）]*[)\]）])+\s*$/, '')
    .trim();

  return guessSeriesName(bare);
}

/** The candidate one of whose titles is the query (after `matchKey`), else undefined */
export function exactMatch(query: string, candidates: MetadataCandidate[]) {
  const key = matchKey(query);

  return key
    ? candidates.find((candidate) =>
        [candidate.title, ...(candidate.names ?? [])].some((name) => matchKey(name) === key)
      )
    : undefined;
}

/** The AniList/VNDB cover this browser matched */
export const localCover = (title: string) =>
  readMap<{ cover?: string }>(matchesKey)[title]?.cover || undefined;

/** Whether a search for this title may run now: none running, no miss in the last 7 days */
export function canSearch(title: string) {
  const missed = readMap<number>(missesKey)[title];

  return !searching && !(typeof missed === 'number' && Date.now() - missed < missAge);
}

/**
 * Searches once for the title's cover and keeps an exact match: its cover in this browser, its
 * details as Find details on the server. Resolves true when a cover was found. Never throws.
 */
export async function findCover(title: string, kind: MetadataKind, series = '') {
  if (!canSearch(title)) return false;
  searching = true;
  try {
    const metadata = await import('$lib/data/book-metadata');
    const query = coverQuery(title, series);
    const match = query ? exactMatch(query, await metadata.searchMetadata(kind, query)) : undefined;

    if (!match?.cover) {
      writeEntry(missesKey, title, Date.now());
      return false;
    }

    writeEntry(matchesKey, title, { cover: match.cover });

    const { serverless } = await import('$lib/data/server-connect');

    // Details only, and never over details the book already has (picked in the dialog).
    const saved = serverless ? undefined : await metadata.loadBookMetadata().catch(() => undefined);

    if (saved && !saved[title]) {
      await metadata.saveBookMetadata(title, { ...match, cover: '' }).catch(() => {});
    }
    return true;
  } catch {
    // Network errors and rate limits: stored as a miss that ends an hour from now.
    writeEntry(missesKey, title, Date.now() - missAge + errorRetry);
    return false;
  } finally {
    searching = false;
  }
}

const retryAfter = 5 * 60_000;
const maxTries = 3;
/** Per title: the public URL (or none), and when a refused upload may be tried again */
const hubCovers = new Map<
  string,
  { value: Promise<string | undefined>; tries: number; retryAt?: number }
>();

/**
 * The book's own cover as a public https thumbnail on the social hub (Discord fetches it with no
 * session): the hub's thumbnail for its book key, else one made from this browser's or the
 * Calibre catalog's cover and uploaded. Asked once per book and page; an upload the hub refused
 * (the book isn't shared or in a live Discord status yet) is tried again 5 minutes later, 3
 * times at most. The sender checks that the reader is signed in, social is on and the book isn't
 * private. Undefined when there is none.
 */
export function hubCover(title: string) {
  const cached = hubCovers.get(title);

  if (cached && !(cached.retryAt && Date.now() >= cached.retryAt)) return cached.value;

  const entry = {
    tries: (cached?.tries ?? 0) + 1,
    value: Promise.resolve<string | undefined>(undefined)
  };

  entry.value = loadHubCover(title, () => {
    if (entry.tries < maxTries) Object.assign(entry, { retryAt: Date.now() + retryAfter });
  }).catch(() => undefined);
  hubCovers.set(title, entry);
  return entry.value;
}

async function loadHubCover(title: string, refused: () => void) {
  const [{ bookKey, bookThumbnail, localCovers }, { HubError, hubFetch, hubImageUrl }] =
    await Promise.all([import('$lib/data/social'), import('$lib/data/social-account')]);
  const key = encodeURIComponent(bookKey(title));
  const url = (file: unknown) => {
    const address =
      typeof file === 'string' && /^[0-9a-f]{16}$/.test(file) && hubImageUrl(`cover/${file}`);

    return address && address.startsWith('https://') ? address : undefined;
  };
  // Hubs from before GET cover?key answer 404: the upload below still works.
  const lookup = () =>
    hubFetch<{ cover?: string }>(`/v1/cover?key=${key}`).then(
      (body) => url(body.cover),
      () => undefined
    );
  const existing = await lookup();

  if (existing) return existing;

  const cover = (await localCovers()).get(bookKey(title))?.imagePath;
  const thumbnail = cover && (await bookThumbnail(cover));

  if (!thumbnail) return undefined;
  try {
    return url(
      (await hubFetch<{ cover?: string }>(`/v1/cover?key=${key}`, 'PUT', thumbnail)).cover
    );
  } catch (error) {
    if (error instanceof HubError && error.status === 409) return lookup();
    refused();
    return undefined;
  }
}

/** For tests */
export const resetHubCovers = () => hubCovers.clear();
