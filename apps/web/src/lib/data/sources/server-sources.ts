/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Sources on the server edition: the import service's /calibre/import/api/sources/ endpoints
 * (accounts with the import permission). The standalone build has no server and sends nothing.
 */

import { standalone } from '$lib/data/env';
import { errorMessage } from '$lib/data/remote/calibre-import';
import type { SourceFollow, SourceJob, SourceSearch, SourceWork } from './types';

const apiUrl = '/calibre/import/api/sources/';

async function call<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) {
  if (standalone) {
    throw new Error('Sources need the server edition');
  }

  const response = await fetch(`${apiUrl}${path}`, {
    method,
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }

  return (await response.json()) as T;
}

/** A link to a work on a supported site → the work, with its volume plan. */
export function lookUpWork(url: string) {
  return call<SourceWork>('POST', 'lookup', { url });
}

export function getWork(id: number) {
  return call<SourceWork>('GET', `works/${id}`);
}

/** A site's work by its key (a search result) → the work, with its volume plan. */
export function resolveWork(site: string, workKey: string) {
  return call<SourceWork>('POST', 'works/resolve', { site, workKey });
}

/** The built-in sites, in the order the search page lists them. */
export const searchSites = [
  { site: 'syosetu', name: 'Syosetu' },
  { site: 'kakuyomu', name: 'Kakuyomu' }
];

/** A page (20 works) of a site's search results, or its popular or latest works. */
export function browseSite(
  site: string,
  kind: 'search' | 'popular' | 'latest',
  page: number,
  q = ''
) {
  const query = new URLSearchParams({ page: String(page), ...(kind === 'search' ? { q } : {}) });

  return call<SourceSearch>('GET', `sites/${site}/${kind}?${query}`);
}

/** The work's cover image, fetched once by the server (an image URL, so the CSP stays as it is). */
export function coverUrl(workId: number) {
  return `${apiUrl}covers/${workId}`;
}

/** Queues the volumes for fetching; the server skips ones in the library or on their way. */
export function addVolumes(workId: number, volumes: number[]) {
  return call<{ job: SourceJob }>('POST', `works/${workId}/add`, { volumes });
}

/** This account's jobs, newest first, and the seconds between two requests to one site. */
export function getQueue() {
  return call<{ jobs: SourceJob[]; interval: number }>('GET', 'queue');
}

export function retryJob(id: string) {
  return call<{ job: SourceJob }>('POST', `jobs/${id}/retry`, {});
}

export function cancelJob(id: string) {
  return call<{ job: SourceJob }>('POST', `jobs/${id}/cancel`, {});
}

export function removeJob(id: string) {
  return call<object>('DELETE', `jobs/${id}`);
}

/** Follows the work, or pauses/resumes it; a new follow is checked at once. */
export function followWork(workId: number, paused = false) {
  return call<{ follow: SourceFollow }>('PUT', `follows/${workId}`, { paused });
}

/** Stops checking the work; its volumes stay in the library. */
export function unfollowWork(workId: number) {
  return call<object>('DELETE', `follows/${workId}`);
}

type Following = { follows: SourceFollow[]; checkHours: number };

/** This account's follows and the hours between two checks. */
export function getFollowing() {
  return call<Following>('GET', 'following');
}

/** Check now: every unpaused follow, or the one work. */
export function checkNow(workId?: number) {
  return call<Following>('POST', 'check', workId === undefined ? {} : { work: workId });
}

/** "about 4 min" for this many requests at one per `interval` seconds. */
export function timeLeft(requests: number, interval: number) {
  const minutes = Math.ceil((requests * interval) / 60);

  return minutes <= 1 ? 'about 1 min' : `about ${minutes} min`;
}
