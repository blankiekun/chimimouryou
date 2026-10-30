/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { pagePath } from '$lib/data/env';
import { importDictionary } from '$lib/data/dictionary/dictionary';

/**
 * JMdict (EDRDG, CC BY-SA 4.0) as jmdict-yomitan's English zip, served same-origin: the Pages
 * workflow and the web image download it at build time (not in git). Dev builds have none, and
 * Settings → Dictionary links to its releases instead. Not part of upstream.
 */
export const jmdictReleases = 'https://github.com/yomidevs/jmdict-yomitan/releases/latest';

const jmdictUrl = () => new URL(`${pagePath}/dictionaries/JMdict_english.zip`, location.href).href;

let size: Promise<number | undefined> | undefined;

/** The bundled zip's size in bytes (0 when the server doesn't say), or undefined without one. */
export function bundledJmdictSize() {
  size ??= fetch(jmdictUrl(), { method: 'HEAD' })
    .then((response) =>
      // An HTML page is a fallback, not the zip.
      response.ok && !response.headers.get('content-type')?.includes('text/html')
        ? Number(response.headers.get('content-length')) || 0
        : undefined
    )
    .catch(() => undefined);

  return size;
}

/** A JMdict is installed (any of jmdict-yomitan's, or one imported by hand). */
export const hasJmdict = (titles: { title: string }[]) =>
  titles.some(({ title }) => /^jmdict/i.test(title));

/** Downloads the bundled zip and imports it (enabled, last in the order). */
export async function installJmdict(onProgress?: (done: number, total: number) => void) {
  const response = await fetch(jmdictUrl());

  if (!response.ok) throw new Error(`The download failed (${response.status}).`);

  await navigator.storage?.persist?.().catch(() => false);

  return importDictionary(await response.blob(), onProgress);
}
