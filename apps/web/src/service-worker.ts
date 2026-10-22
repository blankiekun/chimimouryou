/// <reference lib="webworker" />

import { build, files, prerendered, version } from '$service-worker';

import { pagePath } from '$lib/data/env';
import { toSearchParams } from '$lib/functions/to-search-params';
import { userFontsCacheName } from '$lib/data/fonts';

// eslint-disable-next-line no-restricted-globals
const worker = self as unknown as ServiceWorkerGlobalScope;
const BUILD_CACHE_NAME = `build:${version}`;
// The visual novel engine can be replaced on the server without a new build (admin panel),
// so it is fetched network-first and kept across builds for offline play.
const ENGINE_CACHE_NAME = 'vn-engine';
const engineFile = /\/vn\/conscripter(\.js|\.wasm|-version\.txt)$/;
// The UI font is split into unicode-range chunks (4 MB in all); a page loads only the ones it
// shows, so they are cached on first use, across builds, rather than precached. So is KZ UDMincho
// (17 MB), the old Washi & Sumi display font, now only a reader font choice.
const UI_FONT_CACHE_NAME = 'ui-font';
const uiFontFile = /\/(BIZUDPGothic-[^/]+\.woff2|KZUDMincho-[^/]+\.woff2?)$/;
const uiFontFiles = new Set(build.filter((file) => uiFontFile.test(file)));

const prerenderedSet = new Set(prerendered);

// Whisper's worker and runtime (tens of MB) load only when someone transcribes.
const assetsToCache = build
  .filter((file) => !/ort-wasm|whisper\.worker/.test(file) && !uiFontFile.test(file))
  .concat(files.filter((file) => !engineFile.test(file)))
  .concat(prerendered);
const cachedAssets = new Set(assetsToCache);

worker.addEventListener('install', (event) => {
  worker.skipWaiting();
  event.waitUntil(caches.open(BUILD_CACHE_NAME).then((cache) => cache.addAll(assetsToCache)));
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      const keysWithOldCache = keys.filter(
        (key) =>
          key !== BUILD_CACHE_NAME &&
          key !== userFontsCacheName &&
          key !== ENGINE_CACHE_NAME &&
          key !== UI_FONT_CACHE_NAME
      );
      return Promise.all([
        ...keysWithOldCache.map((key) => caches.delete(key)),
        dropOldUiFontChunks()
      ]);
    })
  );
});

worker.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || event.request.headers.has('range')) return;

  const url = new URL(event.request.url);

  // don't try to handle e.g. data: URIs
  const isHttp = url.protocol.startsWith('http');
  const isDevServerRequest =
    url.hostname === worker.location.hostname && url.port !== worker.location.port;
  const isSelfHost = url.host === worker.location.host;
  const isBuildAsset = isSelfHost && cachedAssets.has(url.pathname);
  const skipBecauseUncached = event.request.cache === 'only-if-cached' && !isBuildAsset;

  if (!isHttp || isDevServerRequest || skipBecauseUncached) return;

  if (isSelfHost && prerenderedSet.has(url.pathname)) {
    const requestWithoutParams = new Request(url.pathname);
    event.respondWith(
      networkFirstRaceCache(event.request, false, BUILD_CACHE_NAME, requestWithoutParams)
    );
    return;
  }

  if (isSelfHost && uiFontFile.test(url.pathname)) {
    event.respondWith(cacheFirst(event.request, url.pathname));
    return;
  }

  if (isSelfHost && engineFile.test(url.pathname)) {
    event.respondWith(networkFirst(event.request, url.pathname));
    return;
  }

  if (isSelfHost && url.pathname.startsWith('/userfonts/')) {
    event.respondWith(
      caches
        .match(url.pathname)
        .then((r) => r ?? createRedirectResponse('/fonts/noto-serif-v21-regular.woff2'))
    );
    return;
  }

  if (isSelfHost) {
    // A no-store request (version checks) wants the server's copy: the cache is only as new as this worker.
    const response = !isBuildAsset
      ? selfHostParameterizedUrlResponse(event.request)
      : event.request.cache === 'no-store'
        ? fetch(event.request).catch(
            async (e) => (await caches.match(url.pathname)) ?? Promise.reject(e)
          )
        : caches.match(url.pathname).then((r) => r ?? fetch(event.request));
    if (response) {
      event.respondWith(response);
      return;
    }
  }

  if (url.host === 'fonts.googleapis.com') {
    event.respondWith(networkFirstRaceCache(event.request));
  }
});

async function cacheFirst(request: Request, key: string) {
  const cache = await caches.open(UI_FONT_CACHE_NAME);
  const cached = await cache.match(key);

  if (cached) return cached;

  const response = await fetch(request);

  if (response.ok) await cache.put(key, response.clone());

  return response;
}

/** Chunks of an older build's font (hashed names) are never asked for again. */
async function dropOldUiFontChunks() {
  const cache = await caches.open(UI_FONT_CACHE_NAME);
  const keys = await cache.keys();

  await Promise.all(
    keys
      .filter((request) => !uiFontFiles.has(new URL(request.url).pathname))
      .map((request) => cache.delete(request))
  );
}

async function networkFirst(request: Request, key: string) {
  const cache = await caches.open(ENGINE_CACHE_NAME);

  try {
    const response = await fetch(request);

    if (response.ok) await cache.put(key, response.clone());

    return response;
  } catch (error) {
    return (await cache.match(key)) ?? Promise.reject(error);
  }
}

async function networkFirstRaceCache(
  request: Request,
  storeResponse = true,
  fallbackCacheName?: string,
  fallbackCacheRequest?: Request
) {
  const cache = await caches.open(`other:${version}`);
  const controller = new AbortController();

  let cachedResponse: Response | undefined;

  let done = false;
  let attempted = false;

  const retrieveFromFallbackCache = () =>
    fallbackCacheName
      ? caches.match(fallbackCacheRequest ?? request, { cacheName: fallbackCacheName })
      : undefined;

  const retrieveFromCache = async () => {
    if (!storeResponse) return retrieveFromFallbackCache();
    const response = await cache.match(request);
    if (response) return response;
    if (!fallbackCacheName) return undefined;
    return retrieveFromFallbackCache();
  };

  try {
    const handle = setTimeout(async () => {
      cachedResponse = await retrieveFromCache();
      attempted = true;
      if (!cachedResponse || done) return;
      controller.abort();
    }, 1000);
    const response = await fetch(request, { signal: controller.signal });
    done = true; // avoid Cache.put() was aborted exception
    clearTimeout(handle);
    if (storeResponse) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    if (!attempted) {
      cachedResponse = await retrieveFromCache();
    }
    if (cachedResponse) return cachedResponse;

    throw err;
  }
}

function selfHostParameterizedUrlResponse(request: Request) {
  const url = new URL(request.url);

  const readerRegex = /\/b\/(?<id>\d+)\/?(\?|$)/;
  const readerRegexResult = readerRegex.exec(url.pathname);
  if (readerRegexResult?.groups) {
    return createRedirectResponse(`${[[pagePath]]}/b?${toSearchParams(readerRegexResult.groups)}`);
  }
  return undefined;
}

function createRedirectResponse(location: string) {
  return new Response(null, {
    status: 302,
    headers: {
      location
    }
  });
}
