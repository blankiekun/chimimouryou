/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Covers for the Discord status of books without Find details: the series (or the title without
 * its volume and store tags) is searched on AniList (books, manga) or VNDB (VNs), and only an
 * exact title match is kept: saved as the book's Find details for everyone, or in this browser
 * when the server refuses it or there is none. Misses are remembered for 7 days (errors for an hour) and one search
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

/** A cover this browser matched (standalone, or the server refused to save it) */
export const localCover = (title: string) =>
  readMap<{ cover?: string }>(matchesKey)[title]?.cover || undefined;

/** Whether a search for this title may run now: none running, no miss in the last 7 days */
export function canSearch(title: string) {
  const missed = readMap<number>(missesKey)[title];

  return !searching && !(typeof missed === 'number' && Date.now() - missed < missAge);
}

/**
 * Searches once for the title's cover and keeps an exact match (Find details on the server, else
 * this browser). Resolves true when a cover was found. Never throws.
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

    const { serverless } = await import('$lib/data/server-connect');
    const saved =
      !serverless &&
      (await metadata.saveBookMetadata(title, match).then(
        () => true,
        () => false
      ));

    if (!saved) writeEntry(matchesKey, title, { cover: match.cover });
    return true;
  } catch {
    // Network errors and rate limits: stored as a miss that ends an hour from now.
    writeEntry(missesKey, title, Date.now() - missAge + errorRetry);
    return false;
  } finally {
    searching = false;
  }
}
