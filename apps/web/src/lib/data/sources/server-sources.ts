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
import type { SourceJob, SourceWork } from './types';

const apiUrl = '/calibre/import/api/sources/';

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
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

/** "about 4 min" for this many requests at one per `interval` seconds. */
export function timeLeft(requests: number, interval: number) {
  const minutes = Math.ceil((requests * interval) / 60);

  return minutes <= 1 ? 'about 1 min' : `about ${minutes} min`;
}
