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
// The standalone build's Sources, and in both editions the works of extensions (they run here).
const local = () => import('./local-sources');
const extensions = () => import('./extensions');

/*
 * Server edition: extension works and their jobs live on this device (local-sources.ts) beside
 * the server's, so their ids are told apart: works negative, jobs prefixed.
 */
const onDevice = (id: number) => !standalone && id < 0;
const DEVICE_JOB = 'device:';
const deviceWork = (work: SourceWork) => (standalone ? work : { ...work, id: -work.id });
const deviceJob = (job: SourceJob) =>
  standalone ? job : { ...job, id: `${DEVICE_JOB}${job.id}`, workId: -job.workId };
const deviceJobId = (id: string) => !standalone && id.startsWith(DEVICE_JOB);
const deviceFollow = (follow: SourceFollow) => ({ ...follow, workId: -follow.workId });

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
  if (onDevice(id)) return local().then(async (l) => deviceWork(await l.getWork(-id)));
  return call<SourceWork>('GET', `works/${id}`);
}

/** A site's work by its key (a search result) → the work, with its volume plan. */
export function resolveWork(site: string, workKey: string) {
  if (standalone || site.startsWith('ext:')) {
    return local().then(async (l) => deviceWork(await l.resolveWork(site, workKey)));
  }
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
  if (onDevice(workId)) return local().then((l) => l.coverSrc(-workId));
  return Promise.resolve(`${apiUrl}covers/${workId}`);
}

/**
 * Queues the volumes for fetching; the server skips ones in the library or on their way. `per`
 * (manga from a server as pages) is the CBZ size the volume numbers are counted in.
 */
export function addVolumes(workId: number, volumes: number[], per?: 'volume' | 'chapter') {
  if (standalone) return local().then((l) => l.addVolumes(workId, volumes, per));
  if (onDevice(workId)) {
    return local().then(async (l) => {
      const { job } = await l.addVolumes(-workId, volumes, per);
      return { job: deviceJob(job) };
    });
  }
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
export async function getQueue() {
  if (standalone) return local().then((l) => l.getQueue());
  const [server, device] = await Promise.all([
    call<{ jobs: SourceJob[]; interval: number }>('GET', 'queue'),
    local().then(async (l) => {
      await l.resumeDeviceJobs();
      return (await l.getQueue()).jobs.map(deviceJob);
    })
  ]);
  return {
    ...server,
    jobs: [...server.jobs, ...device].sort((a, b) => b.created - a.created)
  };
}

export function retryJob(id: string) {
  if (standalone) return local().then((l) => l.retryJob(id));
  if (deviceJobId(id)) {
    return local().then(async (l) => ({
      job: deviceJob((await l.retryJob(id.slice(DEVICE_JOB.length))).job)
    }));
  }
  return call<{ job: SourceJob }>('POST', `jobs/${id}/retry`, {});
}

export function cancelJob(id: string) {
  if (standalone) return local().then((l) => l.cancelJob(id));
  if (deviceJobId(id)) {
    return local().then(async (l) => ({
      job: deviceJob((await l.cancelJob(id.slice(DEVICE_JOB.length))).job)
    }));
  }
  return call<{ job: SourceJob }>('POST', `jobs/${id}/cancel`, {});
}

export function removeJob(id: string) {
  if (standalone) return local().then((l) => l.removeJob(id));
  if (deviceJobId(id)) return local().then((l) => l.removeJob(id.slice(DEVICE_JOB.length)));
  return call<object>('DELETE', `jobs/${id}`);
}

/** Follows the work, or pauses/resumes it; a new follow is checked at once. */
export function followWork(workId: number, paused = false) {
  if (standalone) return local().then((l) => l.followWork(workId, paused));
  if (onDevice(workId)) {
    return local().then(async (l) => ({
      follow: deviceFollow((await l.followWork(-workId, paused)).follow)
    }));
  }
  return call<{ follow: SourceFollow }>('PUT', `follows/${workId}`, { paused });
}

/** Stops checking the work; its volumes stay in the library. */
export function unfollowWork(workId: number) {
  if (standalone) return local().then((l) => l.unfollowWork(workId));
  if (onDevice(workId)) return local().then((l) => l.unfollowWork(-workId));
  return call<object>('DELETE', `follows/${workId}`);
}

/** Another device's follow of its server (SourceFollow.shared): sources.json in both editions. */
export function unfollowShared(key: string) {
  return local().then((l) => l.unfollowShared(key));
}

type Following = { follows: SourceFollow[]; checkHours: number };

/** This account's follows and the hours between two checks. */
export function getFollowing() {
  if (standalone) return local().then((l) => l.getFollowing());
  return withDevice(call<Following>('GET', 'following'), (l) => l.getFollowing());
}

/** Check now: every unpaused follow, or the one work. */
export function checkNow(workId?: number) {
  if (standalone) return local().then((l) => l.checkNow(workId));
  if (workId !== undefined && onDevice(workId)) {
    return withDevice(call<Following>('GET', 'following'), (l) => l.checkNow(-workId));
  }
  return withDevice(
    call<Following>('POST', 'check', workId === undefined ? {} : { work: workId }),
    (l) => (workId === undefined ? l.checkNow() : l.getFollowing())
  );
}

/** Server edition: the server's follows with this device's (extension works) after them. */
async function withDevice(
  server: Promise<Following>,
  device: (l: Awaited<ReturnType<typeof local>>) => Promise<Following>
): Promise<Following> {
  const [own, here] = await Promise.all([server, local().then(device)]);
  return {
    ...own,
    follows: [...own.follows, ...here.follows.map(deviceFollow)].sort((a, b) =>
      a.title.localeCompare(b.title)
    )
  };
}

/** "about 4 min" for this many requests at one per `interval` seconds. */
export function timeLeft(requests: number, interval: number) {
  const minutes = Math.ceil((requests * interval) / 60);

  return minutes <= 1 ? 'about 1 min' : `about ${minutes} min`;
}

// Extension repositories: on this device in both editions (extensions.ts).

export const lookUpRepo = (url: string) => extensions().then((e) => e.lookUpRepo(url));
export const addRepo = (url: string, on: number[]) => extensions().then((e) => e.addRepo(url, on));
export const listRepos = () => extensions().then((e) => e.listRepos());
export const getRepo = (id: number) => extensions().then((e) => e.getRepo(id));
export const removeRepo = (id: number) => extensions().then((e) => e.removeRepo(id));
export const extensionSites = () => extensions().then((e) => e.extensionSites());
export const setExtension = (repo: number, id: number, on: boolean) =>
  extensions().then((e) => e.setExtension(repo, id, on));
export const updateExtension = (repo: number, id: number) =>
  extensions().then((e) => e.updateExtension(repo, id));

/** A page of an extension's popular or latest works, or a search. */
export const browseExtension = (
  site: string,
  mode: 'popular' | 'latest' | 'search',
  page: number,
  q = ''
) => local().then((l) => l.browseExtension(site, mode, page, q));

export const extensionImageSrc = (site: string, url: string) =>
  local().then((l) => l.extensionImageSrc(site, url));
