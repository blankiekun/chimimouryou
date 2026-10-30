/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * How Sources fetch a URL on this device (standalone), the browser's side of the server's
 * fetcher.py: one request per `interval` seconds per host, Retry-After on 429/503, a size cap,
 * and the final address checked against the hosts the caller allows (sites) or its origin (a
 * reader's own server). A plain browser can only read sites that allow CORS; any other answers
 * NeedsAppError ("Fetching from this site needs the desktop app"), never a failure. The desktop
 * app fetches through its main process (chimiDesktop.fetch, apps/desktop/main.js) and the APK
 * through CapacitorHttp, so every site works there.
 * VITE_SOURCES_FIXTURE_URL (test builds only) sends https://<host>/<path> of sites to
 * <fixture>/<host>/<path> (server/tests/fixtures/sources/serve.py), as SOURCES_FIXTURE_URL does.
 */

import { Capacitor, CapacitorHttp, type HttpResponse } from '@capacitor/core';

/** Seconds between two requests to one site, or to a reader's own server (tests set 0). */
export const pacing = { site: 2, server: 0.2 };
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_RETRY_AFTER = 600;
const RETRIES = 3;

/** The site answered with an error, or couldn't be reached. */
export class FetchError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
  }
}

export const needsAppMessage = 'Fetching from this site needs the desktop app';

/** This site doesn't let a browser read it (no CORS): the desktop app or the APK can. */
export class NeedsAppError extends Error {
  constructor(public host: string) {
    super(needsAppMessage);
  }
}

export interface FetchOptions {
  /** Hosts a site's request and its redirects may reach */
  hosts?: Set<string>;
  /** A reader's server: only this scheme://host:port passes, never rewritten to the fixture */
  origin?: string;
  headers?: Record<string, string>;
  maxBytes?: number;
}

const next = new Map<string, number>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** scheme://host:port with the default port filled in, '' for anything but http(s). */
export function originOf(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    const port = parsed.port || (parsed.protocol === 'http:' ? '80' : '443');
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}:${port}`;
  } catch {
    return '';
  }
}

function fixture(url: string) {
  const base = (import.meta.env.VITE_SOURCES_FIXTURE_URL || '').replace(/\/$/, '');
  if (!base) return url;
  const parsed = new URL(url);
  return `${base}/${parsed.host}${parsed.pathname}${parsed.search}`;
}

async function pace(key: string, interval: number) {
  const now = Date.now();
  const at = Math.max(now, next.get(key) ?? 0);
  next.set(key, at + interval * 1000);
  if (at > now) await sleep(at - now);
}

interface NativeAnswer {
  status: number;
  url: string;
  type: string;
  retryAfter: string;
  body?: ArrayBuffer;
  tooBig?: boolean;
}

type DesktopFetch = (
  url: string,
  options: { headers?: Record<string, string>; maxBytes: number }
) => Promise<NativeAnswer>;

const desktopFetch = () =>
  (globalThis as { chimiDesktop?: { fetch?: DesktopFetch } }).chimiDesktop?.fetch;

/** The desktop app or the APK: fetched outside the page, so CORS doesn't apply. */
export const nativeFetch = () => !!desktopFetch() || Capacitor.isNativePlatform();

async function viaApp(
  url: string,
  headers: Record<string, string> = {},
  maxBytes: number
): Promise<NativeAnswer> {
  const desktop = desktopFetch();
  if (desktop) return desktop(url, { headers, maxBytes });
  // Called directly: CapacitorHttp's patching of fetch stays off (capacitor.config.json).
  // Redirects are followed here, so a cookie or password never goes on to another origin.
  for (let hop = 0; hop < 10; hop += 1) {
    if (!/^https?:\/\//.test(url)) throw new Error('Only http and https');
    const answer = await CapacitorHttp.request({
      url,
      headers,
      responseType: 'arraybuffer',
      disableRedirects: true
    });
    const header = (name: string) =>
      Object.entries(answer.headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? '';
    const location = header('location');
    if (answer.status >= 300 && answer.status < 400 && location) {
      const to = new URL(location, url).href;
      if (originOf(to) !== originOf(url)) headers = {};
      url = to;
      continue;
    }
    return capacitorAnswer(answer, url, header, maxBytes);
  }
  throw new Error('Too many redirects');
}

function capacitorAnswer(
  answer: HttpResponse,
  url: string,
  header: (name: string) => string,
  maxBytes: number
): NativeAnswer {
  // Binary answers come base64-encoded.
  const body =
    typeof answer.data === 'string'
      ? Uint8Array.from(atob(answer.data), (c) => c.charCodeAt(0)).buffer
      : new TextEncoder().encode(JSON.stringify(answer.data)).buffer;
  return {
    status: answer.status,
    url,
    type: header('content-type'),
    retryAfter: header('retry-after'),
    ...(body.byteLength > maxBytes ? { tooBig: true } : { body })
  };
}

/** A plain fetch failed: a site without CORS (needs the app) or one that can't be reached. */
async function blocked(url: string, host: string) {
  try {
    await fetch(url, { mode: 'no-cors', credentials: 'omit', cache: 'no-store' });
  } catch {
    return new FetchError(`Can't reach ${host}`);
  }
  return new NeedsAppError(host);
}

/** The body and final address of url; FetchError for an error answer, NeedsAppError without CORS. */
export async function sourceFetch(url: string, options: FetchOptions = {}) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if (options.origin ? originOf(url) !== options.origin : !options.hosts?.has(host)) {
    throw new FetchError(`Not a link this source may fetch (${host})`);
  }
  const target = options.origin ? url : fixture(url);
  const maxBytes = options.maxBytes ?? MAX_BYTES;

  for (let attempt = 0; ; attempt += 1) {
    await pace(options.origin || host, options.origin ? pacing.server : pacing.site);
    let response: NativeAnswer;
    if (nativeFetch()) {
      try {
        response = await viaApp(target, options.headers, maxBytes);
      } catch {
        throw new FetchError(`Can't reach ${host}`);
      }
    } else {
      try {
        const answer = await fetch(target, {
          headers: options.headers,
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'follow'
        });
        const tooBig = Number(answer.headers.get('Content-Length') || 0) > maxBytes;
        response = {
          status: answer.status,
          url: answer.url,
          type: answer.headers.get('Content-Type') || '',
          retryAfter: answer.headers.get('Retry-After') || '',
          ...(answer.ok && !tooBig ? { body: await answer.arrayBuffer() } : { tooBig })
        };
      } catch {
        throw await blocked(target, host);
      }
    }

    if ((response.status === 429 || response.status === 503) && attempt < RETRIES) {
      const wait = Number(response.retryAfter || 5);
      if (Number.isFinite(wait) && wait <= MAX_RETRY_AFTER) {
        await sleep(Math.max(1, wait) * 1000);
        continue;
      }
    }
    if (response.status < 200 || response.status > 299) {
      throw new FetchError(`${host} answered ${response.status}`, response.status);
    }

    // Redirects stay within the site's hosts or the server's origin.
    const final = response.url || target;
    const allowed = options.origin
      ? originOf(final) === options.origin
      : target !== url
        ? originOf(final) === originOf(target)
        : options.hosts?.has(new URL(final).hostname.toLowerCase());
    if (!allowed) throw new FetchError(`${host} sent this app to another site`);

    const body = response.body;
    if (!body || response.tooBig || body.byteLength > maxBytes) {
      throw new FetchError(`${host} sent more than ${Math.round(maxBytes / 1048576)} MB`);
    }
    return { body, url: target === url ? final : url, type: response.type };
  }
}

/** sourceFetch's body as UTF-8 text. */
export async function sourceText(url: string, options: FetchOptions = {}) {
  return new TextDecoder().decode((await sourceFetch(url, options)).body);
}
