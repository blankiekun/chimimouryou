/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Sources: on the server edition the import service's /calibre/import/api/sources/ endpoints
 * (accounts with the import permission); the standalone build runs them on this device
 * (local-sources.ts, same answers) and sends nothing to the server.
 */

import { standalone } from '$lib/data/env';
import { errorMessage } from '$lib/data/remote/calibre-import';
import {
  SourceError,
  type SourceFollow,
  type SourceJob,
  type SourceSearch,
  type SourceServer,
  type SourceServerFeed,
  type SourceWork
} from './types';

const apiUrl = '/calibre/import/api/sources/';
// Loaded only in the standalone build.
const local = () => import('./local-sources');

async function call<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) {
  if (standalone) throw new Error('No server in the standalone edition');
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!response.ok) {
    const field = await response
      .clone()
      .json()
      .then((body) => (typeof body?.field === 'string' ? body.field : ''))
      .catch(() => '');
    throw new SourceError(await errorMessage(response), field);
  }

  return (await response.json()) as T;
}

export { SourceError };

/** A link to a work on a supported site → the work, with its volume plan. */
export function lookUpWork(url: string) {
  if (standalone) return local().then((l) => l.lookUpWork(url));
  return call<SourceWork>('POST', 'lookup', { url });
}

export function getWork(id: number) {
  if (standalone) return local().then((l) => l.getWork(id));
  return call<SourceWork>('GET', `works/${id}`);
}

/** A site's work by its key (a search result) → the work, with its volume plan. */
export function resolveWork(site: string, workKey: string) {
  if (standalone) return local().then((l) => l.resolveWork(site, workKey));
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
  if (standalone) return local().then((l) => l.browseSite(site, kind, page, q));
  const query = new URLSearchParams({ page: String(page), ...(kind === 'search' ? { q } : {}) });

  return call<SourceSearch>('GET', `sites/${site}/${kind}?${query}`);
}

/** The work's cover image, fetched once by the server (an image URL, so the CSP stays as it is). */
export function coverSrc(workId: number) {
  if (standalone) return local().then((l) => l.coverSrc(workId));
  return Promise.resolve(`${apiUrl}covers/${workId}`);
}

/**
 * Queues the volumes for fetching; the server skips ones in the library or on their way. `per`
 * (manga from a server as pages) is the CBZ size the volume numbers are counted in.
 */
export function addVolumes(workId: number, volumes: number[], per?: 'volume' | 'chapter') {
  if (standalone) return local().then((l) => l.addVolumes(workId, volumes, per));
  return call<{ job: SourceJob }>('POST', `works/${workId}/add`, { volumes, ...(per && { per }) });
}

export function listServers() {
  if (standalone) return local().then((l) => l.listServers());
  return call<{ servers: SourceServer[] }>('GET', 'servers');
}

export interface NewServer {
  type: 'opds' | 'suwayomi';
  url: string;
  name: string;
  user: string;
  password: string;
}

/** Tests the server with these credentials, then adds it; a SourceError names the field to fix. */
export function addServer(server: NewServer) {
  if (standalone) return local().then((l) => l.addServer(server));
  return call<{ server: SourceServer; tested: { title: string; entries: number } }>(
    'POST',
    'servers',
    server
  );
}

/** Removes the server; its follows and waiting jobs go, its volumes stay in the library. */
export function removeServer(id: number) {
  if (standalone) return local().then((l) => l.removeServer(id));
  return call<object>('DELETE', `servers/${id}`);
}

/** A feed of the server's catalog: its root, a section (a path from an earlier answer) or a search. */
export function browseServer(id: number, section = '', q = '') {
  if (standalone) return local().then((l) => l.browseServer(id, section, q));
  const query = new URLSearchParams({ ...(section && { section }), ...(q && { q }) });

  return call<SourceServerFeed>('GET', `servers/${id}/browse?${query}`);
}

/** An image on the server (a browse cover), through the import service. */
export function serverImageSrc(id: number, href: string) {
  if (standalone) return local().then((l) => l.serverImageSrc(id, href));
  return Promise.resolve(`${apiUrl}servers/${id}/image?href=${encodeURIComponent(href)}`);
}

/** This account's jobs, newest first, and the seconds between two requests to one site. */
export function getQueue() {
  if (standalone) return local().then((l) => l.getQueue());
  return call<{ jobs: SourceJob[]; interval: number }>('GET', 'queue');
}

export function retryJob(id: string) {
  if (standalone) return local().then((l) => l.retryJob(id));
  return call<{ job: SourceJob }>('POST', `jobs/${id}/retry`, {});
}

export function cancelJob(id: string) {
  if (standalone) return local().then((l) => l.cancelJob(id));
  return call<{ job: SourceJob }>('POST', `jobs/${id}/cancel`, {});
}

export function removeJob(id: string) {
  if (standalone) return local().then((l) => l.removeJob(id));
  return call<object>('DELETE', `jobs/${id}`);
}

/** Follows the work, or pauses/resumes it; a new follow is checked at once. */
export function followWork(workId: number, paused = false) {
  if (standalone) return local().then((l) => l.followWork(workId, paused));
  return call<{ follow: SourceFollow }>('PUT', `follows/${workId}`, { paused });
}

/** Stops checking the work; its volumes stay in the library. */
export function unfollowWork(workId: number) {
  if (standalone) return local().then((l) => l.unfollowWork(workId));
  return call<object>('DELETE', `follows/${workId}`);
}

type Following = { follows: SourceFollow[]; checkHours: number };

/** This account's follows and the hours between two checks. */
export function getFollowing() {
  if (standalone) return local().then((l) => l.getFollowing());
  return call<Following>('GET', 'following');
}

/** Check now: every unpaused follow, or the one work. */
export function checkNow(workId?: number) {
  if (standalone) return local().then((l) => l.checkNow(workId));
  return call<Following>('POST', 'check', workId === undefined ? {} : { work: workId });
}

/** "about 4 min" for this many requests at one per `interval` seconds. */
export function timeLeft(requests: number, interval: number) {
  const minutes = Math.ceil((requests * interval) / 60);

  return minutes <= 1 ? 'about 1 min' : `about ${minutes} min`;
}
