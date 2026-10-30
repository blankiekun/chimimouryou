/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Syosetu (小説家になろう, and its R18 site) on this device: server/import/sources/adapters/
 * syosetu.py in TypeScript, tested on the same saved pages. Work details and search from the
 * official novel API, the latest chapters from the work's last index page, chapter text from its
 * page.
 */

import { sourceText } from '../transport';
import { clean, plainText } from './build';
import { SiteMissing, type SiteDetails, type SiteList } from './site';

export const SITE = 'syosetu';
export const NAME = 'Syosetu';
export const DOMAIN = 'syosetu.com';
export const HOSTS = new Set(['ncode.syosetu.com', 'novel18.syosetu.com', 'api.syosetu.com']);
export const COVER_HOSTS = new Set<string>();
export const SEARCH_ORDER = 'most bookmarked';
const PAGE_SIZE = 20;
const MAX_RESULTS = 2000;
const WORK_HOSTS = ['ncode.syosetu.com', 'novel18.syosetu.com'];
// R18 pages redirect to an age check without it (browsers drop it; the apps send it).
const HEADERS = { Cookie: 'over18=yes' };
const INDEX_PAGE_SIZE = 100;
const LATEST = 3;

const WORK_PATH = /^\/(?:novelview\/infotop\/ncode\/)?(n\d{4}[a-z]{1,4})(?:\/\d+)?\/?$/i;
const INDEX_ENTRY =
  /<a href="\/n\w+\/(\d+)\/" class="p-eplist__subtitle">(.*?)<\/a>\s*<div class="p-eplist__update">\s*(\d{4})\/(\d{2})\/(\d{2})/gs;
const TITLE = /<h1 class="p-novel__title[^"]*">(.*?)<\/h1>/s;
const TEXT = /<div class="js-novel-text[^"]*">(.*?)<\/div>/gs;

/** [work key, work page] for a link to a work or one of its chapters, else null. */
export function parseUrl(url: string): [string, string] | null {
  let parts: URL;
  try {
    parts = new URL(url.trim());
  } catch {
    return null;
  }
  const match = WORK_PATH.exec(parts.pathname);
  if (!['http:', 'https:'].includes(parts.protocol) || !WORK_HOSTS.includes(parts.hostname)) {
    return null;
  }
  if (!match) return null;
  const key = match[1].toLowerCase();
  return [key, `https://${parts.hostname}/${key}/`];
}

export function workUrl(key: string) {
  return `https://ncode.syosetu.com/${key}/`;
}

const get = (url: string) => sourceText(url, { hosts: HOSTS, headers: HEADERS });

export function parseIndex(page: string) {
  return [...page.matchAll(INDEX_ENTRY)].map(([, n, title, y, m, d]) => ({
    n: Number(n),
    title: plainText(title),
    date: `${y}-${m}-${d}`
  }));
}

export function parseChapter(page: string) {
  const title = TITLE.exec(page);
  const blocks = [...page.matchAll(TEXT)].map((match) => clean(match[1]));
  return { title: title ? plainText(title[1]) : '', html: blocks.join('<p><br/></p>') };
}

interface ApiWork {
  title?: string;
  writer?: string;
  story?: string;
  ncode?: string;
  end?: number;
  novel_type?: number;
  noveltype?: number;
  general_all_no?: number;
  general_lastup?: string;
}

/** "2026-10-27 18:00:00" in Japan → ms */
function updated(work: ApiWork) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(work.general_lastup || '');
  return match
    ? Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+09:00`)
    : 0;
}

const short = (work: ApiWork) => (work.novel_type ?? work.noveltype) === 2;

/** SiteMissing when the site has no such work. */
export async function details(url: string): Promise<SiteDetails> {
  const [key, page] = parseUrl(url) ?? [];
  if (!key || !page) throw new SiteMissing('Not a Syosetu work link');
  const api = page.includes('novel18.') ? 'novel18api' : 'novelapi';
  const answer = JSON.parse(await get(`https://api.syosetu.com/${api}/api/?out=json&ncode=${key}`));
  if (!Array.isArray(answer) || (answer[0]?.allcount ?? 0) < 1 || answer.length < 2) {
    throw new SiteMissing('Syosetu has no such work (removed, or not public)');
  }
  const work: ApiWork = answer[1];
  const isShort = short(work);
  const chapters = isShort ? 1 : Number(work.general_all_no || 0);
  let latest: SiteDetails['latest'] = [];
  if (!isShort && chapters) {
    const last = Math.ceil(chapters / INDEX_PAGE_SIZE);
    latest = parseIndex(await get(page + (last > 1 ? `?p=${last}` : '')))
      .slice(-LATEST)
      .reverse();
  }
  return {
    title: (work.title || '').trim(),
    authors: (work.writer || '').trim(),
    status: work.end === 0 ? 'finished' : 'ongoing',
    chapters,
    short: isShort,
    summary: (work.story || '').trim(),
    updated: updated(work),
    latest,
    cover: ''
  };
}

/** Chapter n; a short story's text is on the work page itself. */
export async function chapter(url: string, n: number, info: SiteDetails) {
  const [, page] = parseUrl(url) ?? [];
  if (!page) throw new SiteMissing('Not a Syosetu work link');
  return parseChapter(await get(info.short ? page : `${page}${n}/`));
}

async function list(page: number, params: Record<string, string>): Promise<SiteList> {
  const start = (page - 1) * PAGE_SIZE + 1;
  if (start > MAX_RESULTS) return { total: 0, more: false, works: [] };
  const query = new URLSearchParams({
    out: 'json',
    lim: String(PAGE_SIZE),
    st: String(start),
    ...params
  });
  const answer = JSON.parse(await get(`https://api.syosetu.com/novelapi/api/?${query}`));
  if (!Array.isArray(answer) || !answer.length || typeof answer[0] !== 'object') {
    throw new Error("Syosetu's search answered in an unknown form");
  }
  const total = Number(answer[0].allcount || 0);
  const works = (answer.slice(1) as ApiWork[])
    .map((work) => ({ work, key: String(work.ncode || '').toLowerCase() }))
    .filter(({ key }) => WORK_PATH.test(`/${key}/`))
    .map(({ work, key }) => ({
      workKey: key,
      url: workUrl(key),
      title: String(work.title || '').trim(),
      authors: String(work.writer || '').trim(),
      status: work.end === 0 ? ('finished' as const) : ('ongoing' as const),
      chapters: short(work) ? 1 : Number(work.general_all_no || 0),
      updated: updated(work)
    }));
  return { total, more: start + PAGE_SIZE - 1 < Math.min(total, MAX_RESULTS), works };
}

export const search = (q: string, page: number) => list(page, { word: q, order: 'favnovelcnt' });
export const popular = (page: number) => list(page, { order: 'weekly' });
export const latest = (page: number) => list(page, { order: 'new' });
