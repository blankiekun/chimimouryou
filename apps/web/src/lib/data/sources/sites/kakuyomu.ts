/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Kakuyomu (カクヨム) on this device: server/import/sources/adapters/kakuyomu.py in TypeScript,
 * tested on the same saved pages. No official API, so work details and search come from the
 * Apollo state its pages embed (__NEXT_DATA__), chapter text from the episode page. Chapter n is
 * the work's n-th episode in its table of contents.
 */

import { FetchError, sourceText } from '../transport';
import { clean, plainText } from './build';
import { SiteMissing, type SiteDetails, type SiteList } from './site';

export const SITE = 'kakuyomu';
export const NAME = 'Kakuyomu';
export const DOMAIN = 'kakuyomu.jp';
export const HOSTS = new Set(['kakuyomu.jp']);
export const COVER_HOSTS = new Set(['cdn.kdkw.jp']);
export const SEARCH_ORDER = 'weekly ranking';
const LATEST = 3;

const WORK_PATH = /^\/works\/(\d{1,30})(?:\/episodes\/\d{1,30})?\/?$/;
const NEXT_DATA = /<script id="__NEXT_DATA__" type="application\/json"[^>]*>(.*?)<\/script>/s;
const EPISODE_TITLE = /<p class="widget-episodeTitle[^"]*">(.*?)<\/p>/s;
const EPISODE_BODY = /<div class="widget-episodeBody[^"]*"[^>]*>(.*?)<\/div>/s;
const CHANGED = "Kakuyomu's pages have changed; this app can't read them yet";

type State = Record<string, Record<string, any>>;

export function parseUrl(url: string): [string, string] | null {
  let parts: URL;
  try {
    parts = new URL(url.trim());
  } catch {
    return null;
  }
  const match = WORK_PATH.exec(parts.pathname);
  if (!['http:', 'https:'].includes(parts.protocol) || parts.hostname !== 'kakuyomu.jp' || !match) {
    return null;
  }
  return [match[1], workUrl(match[1])];
}

export function workUrl(key: string) {
  return `https://kakuyomu.jp/works/${key}`;
}

async function get(url: string) {
  try {
    return await sourceText(url, { hosts: HOSTS });
  } catch (error) {
    if (error instanceof FetchError && (error.status === 404 || error.status === 410)) {
      throw new SiteMissing('Kakuyomu has no such work (removed, or not public)');
    }
    throw error;
  }
}

function state(page: string): State {
  try {
    const found = JSON.parse(NEXT_DATA.exec(page)?.[1] ?? '').props.pageProps.__APOLLO_STATE__;
    if (found && typeof found === 'object' && !Array.isArray(found)) return found;
  } catch {
    // below
  }
  throw new Error(CHANGED);
}

function ref(all: State, value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (all[(value as any).__ref ?? ''] ?? {}) : {};
}

const ms = (iso: unknown) => (typeof iso === 'string' && Date.parse(iso)) || 0;

function summary(all: State, work: Record<string, any>) {
  return {
    title: String(work.title || '').trim(),
    authors: String(work.alternateAuthorName || ref(all, work.author).activityName || '').trim(),
    status: work.serialStatus === 'COMPLETED' ? ('finished' as const) : ('ongoing' as const),
    chapters: Number(work.publicEpisodeCount || 0),
    updated: ms(work.lastEpisodePublishedAt)
  };
}

/** A date in Japan: "2026-10-27". */
const jstDate = (time: number) => new Date(time + 9 * 3600 * 1000).toISOString().slice(0, 10);

export async function details(url: string): Promise<SiteDetails> {
  const [key, page] = parseUrl(url) ?? [];
  if (!key || !page) throw new SiteMissing('Not a Kakuyomu work link');
  return parseDetails(await get(page), key);
}

/** The work page's details; an Error when the page can't be read. */
export function parseDetails(page: string, key: string): SiteDetails {
  const all = state(page);
  const work = all[`Work:${key}`];
  if (!work?.title) throw new Error(CHANGED);
  const episodes = ((work.tableOfContentsV2 as unknown[]) || []).flatMap((section) =>
    ((ref(all, section).episodeUnions as unknown[]) || []).map((episode) => ref(all, episode))
  );
  const info = summary(all, work);
  // A list shorter than the count would silently drop chapters from the volumes.
  if (episodes.length !== info.chapters || !episodes.every((e) => e.id)) {
    throw new Error(`${CHANGED} (it lists ${episodes.length} of ${info.chapters} episodes)`);
  }
  const latest = episodes
    .map((e, i) => ({
      n: i + 1,
      title: String(e.title || '').trim(),
      date: jstDate(ms(e.publishedAt))
    }))
    .slice(-LATEST)
    .reverse();
  return {
    ...info,
    short: false,
    summary: String(work.introduction || '').trim(),
    latest,
    cover: work.adminCoverImageUrl || work.promotionalImageUrl || '',
    episodes: episodes.map((e) => String(e.id))
  };
}

export function parseChapter(page: string) {
  const body = EPISODE_BODY.exec(page);
  if (!body) throw new Error(CHANGED);
  const title = EPISODE_TITLE.exec(page);
  return { title: title ? plainText(title[1]) : '', html: clean(body[1]) };
}

export async function chapter(url: string, n: number, info: SiteDetails) {
  const [key, page] = parseUrl(url) ?? [];
  if (!key) throw new SiteMissing('Not a Kakuyomu work link');
  const episodes = info.episodes ?? [];
  if (n < 1 || n > episodes.length) throw new SiteMissing(`Kakuyomu no longer lists episode ${n}`);
  return parseChapter(await get(`${page}/episodes/${episodes[n - 1]}`));
}

async function list(page: number, params: Record<string, string>): Promise<SiteList> {
  const all = state(
    await get(
      `https://kakuyomu.jp/search?${new URLSearchParams({ ...params, page: String(page) })}`
    )
  );
  const found = Object.entries(all.ROOT_QUERY ?? {}).find(([name]) =>
    name.startsWith('searchWorks(')
  )?.[1];
  if (!found || typeof found !== 'object') throw new Error(CHANGED);
  const works = ((found.nodes as unknown[]) || [])
    .map((node) => ref(all, node))
    .filter((work) => /^\d+$/.test(String(work.id ?? '')))
    .map((work) => ({ workKey: String(work.id), url: workUrl(work.id), ...summary(all, work) }));
  return {
    total: Number(found.totalCount || 0),
    more: !!found.pageInfo?.hasNextPage,
    works
  };
}

export const search = (q: string, page: number) => list(page, { q });
export const popular = (page: number) => list(page, { order: 'weekly_ranking' });
export const latest = (page: number) => list(page, { order: 'last_episode_published_at' });
