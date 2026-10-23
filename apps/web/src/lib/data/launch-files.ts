/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { pagePath } from '$lib/data/env';
import { swCachePrefix } from '$lib/functions/service-worker-caches';

/**
 * Books handed to the installed app by the system (manifest.webmanifest): `share_target`
 * POSTs them to /share, where the service worker keeps them in this cache until the library
 * takes them; `file_handlers` give them to `launchQueue`. Not part of upstream.
 */
export const shareCacheName = `${swCachePrefix}share`;
export const sharePath = `${pagePath}/share`;

/** Service worker side: keeps the shared files and sends the browser on to the library. */
export async function stashSharedFiles(request: Request) {
  const form = await request.formData();
  const cache = await caches.open(shareCacheName);
  const files = form.getAll('books').filter((entry): entry is File => entry instanceof File);

  await Promise.all(
    files.map((file, index) =>
      cache.put(
        `${sharePath}/${index}`,
        new Response(file, { headers: { 'x-file-name': encodeURIComponent(file.name) } })
      )
    )
  );

  return Response.redirect(`${pagePath}/manage`, 303);
}

/** Page side: the files shared since the last call, removed from the cache. */
export async function takeSharedFiles(): Promise<File[]> {
  if (!('caches' in window) || !(await caches.has(shareCacheName))) return [];

  const cache = await caches.open(shareCacheName);
  const files = await Promise.all(
    (await cache.keys()).map(async (request) => {
      const response = await cache.match(request);
      const name = decodeURIComponent(response?.headers.get('x-file-name') || 'book');

      return new File([await response!.blob()], name);
    })
  );

  await caches.delete(shareCacheName);

  return files;
}

interface LaunchParams {
  files: { getFile(): Promise<File> }[];
}

/** Files opened with the installed app (desktop Chromium's file handlers). */
export function onLaunchFiles(handle: (files: File[]) => void) {
  const launchQueue = (
    window as unknown as {
      launchQueue?: { setConsumer(consumer: (params: LaunchParams) => void): void };
    }
  ).launchQueue;

  launchQueue?.setConsumer(async ({ files }) => {
    const opened = await Promise.all(files.map((file) => file.getFile()));

    if (opened.length) handle(opened);
  });
}
