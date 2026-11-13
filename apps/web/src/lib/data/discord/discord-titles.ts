/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Romaji and English titles for the Discord status ({titleRomaji}, {titleEnglish}) of books
 * matched in Find details before those were saved with the match: asked once from AniList or
 * VNDB by the match's url and kept in this browser only (never written to the server's row).
 * Misses are kept 7 days, errors an hour; one request at a time, in the background, so the next
 * update shows the result. The sender (discord.ts) decides when a lookup is allowed. Jiten
 * matches have none (their titles are saved at pick time). Not part of upstream.
 */

export interface AltTitles {
  romaji: string;
  english: string;
}

const storageKey = 'discordAltTitles';
const missAge = 7 * 24 * 3600_000;
const errorRetry = 3600_000;

let fetching = false;

type Entry = AltTitles & { at: number };

function readMap(): Record<string, Entry> {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) || '{}');

    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function write(url: string, entry: Entry) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ ...readMap(), [url]: entry }));
  } catch {
    // Storage full or blocked: asked again next session.
  }
}

async function post(url: string, body: object) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** The source's titles for a match's url; undefined for pages it can't ask (Jiten) */
export async function fetchAltTitles(url: string): Promise<AltTitles | undefined> {
  const anilist = /^https:\/\/anilist\.co\/(?:manga|anime)\/(\d+)/.exec(url);
  const vndb = /^https:\/\/vndb\.org\/(v\d+)/.exec(url);

  if (anilist) {
    const { data } = await post('https://graphql.anilist.co', {
      query: 'query ($id: Int) { Media(id: $id) { title { romaji english } } }',
      variables: { id: Number(anilist[1]) }
    });

    return {
      romaji: data?.Media?.title?.romaji || '',
      english: data?.Media?.title?.english || ''
    };
  }
  if (vndb) {
    const { vndbAltTitles } = await import('$lib/data/library/book-metadata');
    const { results } = await post('https://api.vndb.org/kana/vn', {
      filters: ['id', '=', vndb[1]],
      fields: 'title,alttitle,titles.title,titles.lang,titles.latin,titles.official,titles.main'
    });
    const titles = results?.[0] ? vndbAltTitles(results[0]) : undefined;

    return titles && { romaji: titles.titleRomaji, english: titles.titleEnglish };
  }
  return undefined;
}

/**
 * The titles this browser has for the url; without them (and no recent miss), asks once in the
 * background and returns undefined.
 */
export function altTitles(url: string): AltTitles | undefined {
  const entry = readMap()[url];

  if (entry && (entry.romaji || entry.english)) return entry;
  if ((entry && Date.now() - entry.at < missAge) || fetching) return undefined;

  fetching = true;
  fetchAltTitles(url)
    .then((titles) =>
      write(url, { romaji: titles?.romaji ?? '', english: titles?.english ?? '', at: Date.now() })
    )
    .catch(() => write(url, { romaji: '', english: '', at: Date.now() - missAge + errorRetry }))
    .finally(() => {
      fetching = false;
    });
  return undefined;
}

/** For tests */
export const resetAltTitles = () => {
  fetching = false;
};
