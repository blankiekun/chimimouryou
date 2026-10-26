/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Manga text made in this browser (standalone, desktop browsers; Settings → Analysis tools →
 * Manga text): the models' download from huggingface.co at pinned revisions into the `manga-text`
 * cache, and one volume at a time read by functions/manga-ocr/manga-ocr.worker.ts into the
 * browser's mokuro store (mokuro.ts), which the manga reader lays over the pages. The text stays
 * in this browser: not synced, never sent anywhere. Not part of upstream.
 */

import { BehaviorSubject } from 'rxjs';
import {
  analysisToolsSupported,
  runWorker,
  type AnalysisToolsState
} from '$lib/data/analysis-tools';
import { mangaPages } from '$lib/data/manga';
import { saveLocalMokuro, type MokuroPage } from '$lib/data/mokuro';
import { database } from '$lib/data/store';
import type { MangaOcrMessage, MangaOcrRequest } from '$lib/functions/manga-ocr/manga-ocr.worker';

export const mangaTextCacheName = 'manga-text';

const hf = (repo: string, revision: string, file: string) =>
  `https://huggingface.co/${repo}/resolve/${revision}/${file}`;
const detectorRepo = 'ogkalu/comic-text-and-bubble-detector';
const ocrRepo = 'onnx-community/manga-ocr-base-ONNX';

/** Apache-2.0 models, pinned so a change upstream can't change what runs here */
export const mangaTextModels = {
  detector: {
    url: hf(detectorRepo, '16e8a622f91fabc6b5b65c96d32d1183f8843546', 'detector_int8.onnx'),
    bytes: 43_838_857
  },
  encoder: {
    url: hf(
      ocrRepo,
      'f9023406bb2f6b17df67bc4a327c56ecd20611f0',
      'onnx/encoder_model_quantized.onnx'
    ),
    bytes: 86_967_767
  },
  decoder: {
    url: hf(
      ocrRepo,
      'f9023406bb2f6b17df67bc4a327c56ecd20611f0',
      'onnx/decoder_model_quantized.onnx'
    ),
    bytes: 29_627_936
  },
  vocab: {
    url: hf('kha-white/manga-ocr-base', 'aa6573bd10b0d446cbf622e29c3e084914df9741', 'vocab.txt'),
    bytes: 24_072
  }
};
const models = Object.values(mangaTextModels);

export const mangaTextBytes = models.reduce((sum, model) => sum + model.bytes, 0);

/** As the other analysis tools: desktop browsers with the memory for it (~700 MB while reading) */
export const mangaTextSupported = analysisToolsSupported;

export const mangaTextState$ = new BehaviorSubject<AnalysisToolsState>('unknown');
export const mangaTextDownload$ = new BehaviorSubject<
  { done: number; total: number; error?: string } | undefined
>(undefined);
let downloadController: AbortController | undefined;

export async function checkMangaText() {
  if (downloadController) return;

  try {
    const cache = await caches.open(mangaTextCacheName);
    const found = await Promise.all(models.map(({ url }) => cache.match(url)));

    mangaTextState$.next(found.every(Boolean) ? 'ready' : 'absent');
  } catch {
    mangaTextState$.next('absent');
  }
}

export function cancelMangaTextDownload() {
  downloadController?.abort();
}

/** Downloads the models the cache lacks, in mangaTextDownload$. Never throws. */
export async function downloadMangaText() {
  if (downloadController) return;

  const controller = new AbortController();
  const { signal } = controller;

  downloadController = controller;
  mangaTextState$.next('downloading');
  mangaTextDownload$.next({ done: 0, total: mangaTextBytes });

  try {
    await navigator.storage?.persist?.().catch(() => false);

    const cache = await caches.open(mangaTextCacheName);
    let done = 0;

    for (const { url, bytes } of models) {
      if (await cache.match(url)) {
        done += bytes;
        continue;
      }

      const response = await fetch(url, { signal });

      if (!response.ok || !response.body) throw new Error(`${url}: ${response.status}`);

      const counted = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, stream) {
            done += chunk.length;
            mangaTextDownload$.next({ done, total: mangaTextBytes });
            stream.enqueue(chunk);
          }
        })
      );

      // The cache keeps a file only once its body is whole, so a cut download is never taken for one.
      await cache.put(url, new Response(counted, { headers: response.headers }));
    }
    mangaTextDownload$.next(undefined);
  } catch (error) {
    mangaTextDownload$.next(
      signal.aborted ? undefined : { done: 0, total: 0, error: (error as Error).message }
    );
  } finally {
    downloadController = undefined;
    await checkMangaText();
  }
}

export async function removeMangaText() {
  await caches.delete(mangaTextCacheName);
  await checkMangaText();
}

/** The volume being read: its title, pages done and total */
export const mangaTextJob$ = new BehaviorSubject<
  { title: string; done: number; total: number } | undefined
>(undefined);
let jobController: AbortController | undefined;

export function cancelMangaTextJob() {
  jobController?.abort();
}

/**
 * Reads a browser-stored volume's pages and keeps the text (mokuro.ts). One volume at a time;
 * rejects with an AbortError when cancelled.
 * shortcut: pages read are lost when cancelled or the tab closes; keep them per page if volumes need resuming.
 */
export async function makeMangaText(title: string) {
  if (mangaTextJob$.getValue()) throw new Error('Another volume’s text is being made');

  const book = await database.getDataByTitle(title);
  const names = book ? mangaPages(book) : [];
  const pages = names.map((name) => ({ name, blob: book!.blobs[name] as Blob }));

  if (!pages.length || pages.some(({ blob }) => !(blob instanceof Blob))) {
    throw new Error('Open the volume once so its pages are in this browser');
  }

  const controller = new AbortController();
  const read: MokuroPage[] = [];

  jobController = controller;
  mangaTextJob$.next({ title, done: 0, total: pages.length });

  try {
    await runWorker<MangaOcrMessage>(
      new Worker(new URL('../functions/manga-ocr/manga-ocr.worker.ts', import.meta.url), {
        type: 'module'
      }),
      {
        cacheName: mangaTextCacheName,
        models: {
          detector: mangaTextModels.detector.url,
          encoder: mangaTextModels.encoder.url,
          decoder: mangaTextModels.decoder.url,
          vocab: mangaTextModels.vocab.url
        },
        pages
      } satisfies MangaOcrRequest,
      (message) => {
        if (message.type === 'error') throw new Error(message.message);
        if (message.type === 'page') {
          read[message.index] = message.page;
          mangaTextJob$.next({ title, done: message.index + 1, total: pages.length });
        }

        return message.type === 'done' ? true : undefined;
      },
      controller.signal
    );
    await saveLocalMokuro(title, {
      source: 'browser',
      mokuro: 'manga-ocr',
      created: Date.now(),
      pages: read
    });
  } finally {
    jobController = undefined;
    mangaTextJob$.next(undefined);
  }
}
