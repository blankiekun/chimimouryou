/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Server connect (standalone edition): a chimimouryou server at another origin that lists this
 * app in its CORS_ORIGINS. The app signs in for a token (`POST /account/api/token`) and sends it
 * as `Authorization: Bearer` on every request to the server's `/calibre/` and `/account/` paths,
 * never in a URL and never with cookies. Images and other elements can't send headers, so they
 * load server files as blobs (`serverImage`). The self-hosted build never connects: its paths
 * stay relative and use the session cookie. Not part of upstream.
 *
 * The token is this device's own sign-in (the server lists it under Devices), so it is not one
 * of the synced `secretSettings`: it stays in this browser's localStorage, out of every sync file.
 */

import { browser } from '$app/env';
import { standalone } from '$lib/data/env';

const baseKey = 'serverBase';
const tokenKey = 'serverToken';
const serverPath = /^\/(calibre|account)\//;

function read(key: string) {
  try {
    return (browser && window.localStorage.getItem(key)) || '';
  } catch {
    return '';
  }
}

// Fixed per page load: connecting and disconnecting reload the page, as signing in does.
const token = standalone ? read(tokenKey) : '';

/** The connected server's origin, or '' (no server, or this site's own in the self-hosted build). */
export const serverBase = token ? read(baseKey) : '';

/** The standalone is signed in to a server: its Calibre library and account sync are on. */
export const serverConnected = !!serverBase;

/** The last server connected to, for the address field (kept after disconnecting). */
export function rememberedServer() {
  return read(baseKey);
}

/** A server path ('/calibre/…', '/account/…') as the URL to request; other URLs as they are. */
export function serverUrl(path: string) {
  return serverBase && serverPath.test(path) ? `${serverBase}${path}` : path;
}

/** The headers a request to a server path needs besides its own (none in the self-hosted build). */
export function serverHeaders(path: string): Record<string, string> {
  return serverBase && serverPath.test(path) ? { Authorization: `Bearer ${token}` } : {};
}

/** fetch() for server paths: the connected server with its token, else this site as before. */
export function serverFetch(path: string, init: RequestInit = {}) {
  if (!serverBase || !serverPath.test(path)) return fetch(path, init);

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);

  return fetch(`${serverBase}${path}`, { ...init, headers, credentials: 'omit' });
}

const blobUrls = new Map<string, Promise<string>>();

/** A server file as a blob: URL for <img>; cached for the page's lifetime. */
export function serverBlobUrl(path: string) {
  let url = blobUrls.get(path);

  if (!url) {
    url = serverFetch(path).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return URL.createObjectURL(await response.blob());
    });
    url.catch(() => blobUrls.delete(path));
    blobUrls.set(path, url);
  }

  return url;
}

/** Whether an image path must be loaded through `serverImage` (connected and on the server). */
export function needsServerImage(path: unknown): path is string {
  return !!serverBase && typeof path === 'string' && serverPath.test(path);
}

/**
 * Svelte action: loads a server image into an <img> once it comes near the screen, as
 * `loading="lazy"` would (a library lists thousands of covers). Does nothing for other paths.
 */
export function serverImage(img: HTMLImageElement, path: string | undefined) {
  let current = path;
  const observer =
    typeof IntersectionObserver === 'undefined'
      ? undefined
      : new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
              observer?.disconnect();
              load();
            }
          },
          { rootMargin: '400px' }
        );

  function load() {
    const wanted = current;
    if (!needsServerImage(wanted)) return;
    serverBlobUrl(wanted)
      .then((url) => {
        if (current === wanted) img.src = url;
      })
      .catch(() => {});
  }

  function watch() {
    if (!needsServerImage(current)) return;
    if (observer) observer.observe(img);
    else load();
  }

  watch();

  return {
    update(next: string | undefined) {
      if (next === current) return;
      current = next;
      observer?.disconnect();
      watch();
    },
    destroy() {
      observer?.disconnect();
    }
  };
}

/** The address as typed → the server's origin; https only (an https app can't reach http). */
export function serverOrigin(address: string) {
  const trimmed = address.trim().replace(/\/+$/, '');
  let url: URL;

  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error('Enter the server’s address, like https://books.example');
  }

  if (url.protocol !== 'https:') {
    throw new Error(
      'Needs HTTPS: this app can’t reach a server on http://. Use the server’s https:// address.'
    );
  }

  return url.origin;
}

/** Why connecting failed, from the token endpoint's answer. */
function connectError(status: number, message: string, retryAfter: string | null, app: string) {
  if (status === 401) return 'Incorrect username or password.';
  if (status === 429) {
    const minutes = Math.ceil(Number(retryAfter) / 60);
    return minutes > 0
      ? `Too many attempts. Wait ${minutes} min, then try again.`
      : 'Too many attempts. Wait a few minutes, then try again.';
  }
  if (status === 403 && /allow/i.test(message)) {
    return `This server doesn’t allow chimimouryou at ${app}. Ask its admin to add it to CORS_ORIGINS.`;
  }
  if (status === 404) return 'No chimimouryou server answers at this address.';
  return message || `The server answered HTTP ${status}.`;
}

/** Signs in to a server and keeps its token; the caller reloads the page. */
export async function connectServer(address: string, username: string, password: string) {
  const base = serverOrigin(address);
  const app = window.location.origin;
  const platform = ((navigator as any).userAgentData?.platform || navigator.platform || '').trim();
  let response: Response;

  try {
    response = await fetch(`${base}/account/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, label: platform.slice(0, 60) || 'Browser' }),
      credentials: 'omit',
      cache: 'no-store'
    });
  } catch {
    // CORS refusals look like network errors to the page.
    throw new Error(
      `Couldn’t reach ${base}. Check the address, and that the server allows this app (${app}).`
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok || typeof data.token !== 'string') {
    const retryAfter = response.headers.get('Retry-After');
    throw new Error(connectError(response.status, String(data.error || ''), retryAfter, app));
  }

  window.localStorage.setItem(baseKey, base);
  window.localStorage.setItem(tokenKey, data.token);

  return data.user as { id: string; username: string };
}

/** Forgets the token, so the next page load has no server; the address stays for next time. */
export function forgetServerToken() {
  window.localStorage.removeItem(tokenKey);
}

/** Signs this device out on the server (best effort: it may be unreachable) and forgets the token. */
export async function disconnectServer() {
  await serverFetch('/account/api/token/revoke', { method: 'POST' }).catch(() => undefined);
  forgetServerToken();
}

/** The standalone without a server: server features stay off and send no request. */
export const serverless = standalone && !serverConnected;
