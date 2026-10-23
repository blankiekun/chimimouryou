/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Analysis tools (standalone edition, desktop browsers): an optional download (Settings) of
 * Sudachi, Pyodide and yurigana (scripts/analysis-tools/build.sh) that makes a stored book's word
 * list and readings file in the browser, in the formats the server's difficulty service gives
 * (scripts/calibre/jiten/browser.py), so Book words, word coverage and generated furigana work
 * without a server.
 *
 * Sudachi (~250 MB in memory) and Pyodide (~200 MB) run one after the other in their own workers
 * (functions/analysis/): the tokenizer worker tokenizes what the reader worker asks for and is ended
 * before the reader worker starts; texts the reading turns out to need too (parts of words,
 * dictionary forms) go back for another round. One book at a time. Not part of upstream.
 */

import { BehaviorSubject, Observable } from 'rxjs';
import { foldReadings, type BookWord, type WordTotals } from '$lib/data/book-words';
import { pagePath, standalone } from '$lib/data/env';
import {
  endFuriganaProgress,
  furiganaProgress$,
  type CachedReadings,
  type ReadingsFile
} from '$lib/data/generated-furigana';
import { readerDb } from '$lib/data/reader-db';
import type { ReadMessage, ReadRequest } from '$lib/functions/analysis/analysis-read.worker';
import type {
  TokenizeMessage,
  TokenizeRequest
} from '$lib/functions/analysis/analysis-tokenize.worker';
import {
  analysisToolsCacheName,
  rawFolder,
  rawName,
  removeTokenFile,
  type AnalysisToolsManifest
} from '$lib/functions/analysis/tools-files';

const base = () => new URL(`${pagePath}/analysis-tools/`, location.href).href;
const manifestName = 'manifest.json';
/** Rows kept per word list, as the server keeps (WORDS_PER_BOOK, wordsPerBook in book-words.ts) */
const wordsPerBook = 2000;
// Texts still missing after this many readings would mean they never settle.
const maxRounds = 6;
// Time for the browser to take back the ended worker's memory before the next one starts.
const settlePause = 5000;

/**
 * Desktop browsers only: the dictionary alone takes ~200 MB of memory. Browsers that don't report
 * their memory (Firefox, Safari) count as having enough.
 */
export function analysisToolsSupported() {
  if (!standalone || typeof window === 'undefined') return false;

  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  return (
    !window.matchMedia('(pointer: coarse)').matches &&
    (memory === undefined || memory >= 8) &&
    'DecompressionStream' in window &&
    'caches' in window &&
    'createWritable' in (window.FileSystemFileHandle?.prototype ?? {})
  );
}

export type AnalysisToolsState = 'unknown' | 'absent' | 'downloading' | 'ready';

export const analysisToolsState$ = new BehaviorSubject<AnalysisToolsState>('unknown');

/** The manifest of the tools kept in the cache, when every file is there. */
export async function installedTools(): Promise<AnalysisToolsManifest | undefined> {
  try {
    const cache = await caches.open(analysisToolsCacheName);
    const manifest = await (await cache.match(new URL(manifestName, base()).href))?.json();

    if (!manifest) return undefined;

    const folder = await rawFolder();
    const found = await Promise.all(
      (manifest as AnalysisToolsManifest).files.map(async (file) =>
        file.raw
          ? (await (await folder.getFileHandle(rawName(file.name))).getFile()).size === file.raw
          : cache.match(new URL(file.name, base()).href)
      )
    );

    return found.every(Boolean) ? manifest : undefined;
  } catch {
    return undefined;
  }
}

/** Sets `analysisToolsState$` from the cache. */
export async function checkAnalysisTools() {
  if (analysisToolsState$.getValue() === 'downloading') return;
  analysisToolsState$.next((await installedTools()) ? 'ready' : 'absent');
}

/** The download's size in bytes, from the site's manifest. */
export async function analysisToolsSize() {
  const manifest: AnalysisToolsManifest = await (
    await fetch(new URL(manifestName, base()).href, { cache: 'no-cache' })
  ).json();

  return manifest.files.reduce((sum, file) => sum + file.bytes, 0);
}

/**
 * Downloads every file into the cache, the manifest last (so a cut download is never taken for
 * a whole one). Asks the browser to keep the site's storage first.
 */
export async function downloadAnalysisTools(
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal
) {
  analysisToolsState$.next('downloading');

  try {
    await navigator.storage?.persist?.().catch(() => false);

    const manifestResponse = await fetch(new URL(manifestName, base()).href, {
      cache: 'no-cache',
      signal
    });

    if (!manifestResponse.ok) throw new Error(`The analysis tools aren't on this site`);

    const manifest: AnalysisToolsManifest = await manifestResponse.clone().json();
    const total = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
    const cache = await caches.open(analysisToolsCacheName);
    const folder = await rawFolder(true);
    let done = 0;

    for (const file of manifest.files) {
      const url = new URL(file.name, base()).href;
      const response = await fetch(url, { cache: 'no-cache', signal });

      if (!response.ok || !response.body) throw new Error(`${file.name}: ${response.status}`);

      const counted = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            done += chunk.length;
            onProgress(done, total);
            controller.enqueue(chunk);
          }
        })
      );

      if (file.raw) {
        // Kept unpacked in OPFS (rawFolder in tools-files.ts)
        const writable = await (
          await folder.getFileHandle(rawName(file.name), { create: true })
        ).createWritable();

        await counted
          .pipeThrough(
            new DecompressionStream('gzip') as ReadableWritablePair<Uint8Array, Uint8Array>
          )
          .pipeTo(writable);
      } else {
        await cache.put(url, new Response(counted, { headers: response.headers }));
      }
    }

    await cache.put(new URL(manifestName, base()).href, manifestResponse);
    analysisToolsState$.next('ready');
  } catch (error) {
    analysisToolsState$.next((await installedTools()) ? 'ready' : 'absent');
    throw error;
  }
}

export async function removeAnalysisTools() {
  await caches.delete(analysisToolsCacheName);
  await navigator.storage
    .getDirectory()
    .then((root) => root.removeEntry(analysisToolsCacheName, { recursive: true }))
    .catch(() => undefined);
  analysisToolsState$.next('absent');
}

export interface BookAnalysis {
  words: BookWord[];
  /** The word list's rows and occurrences before the cap, without noise (as an estimate's) */
  uniqueWords: number;
  tokens: number;
  readings: ReadingsFile;
}

function run<Message extends { type: string }>(
  worker: Worker,
  request: unknown,
  onMessage: (message: Message) => unknown
) {
  return new Promise<unknown>((resolve, reject) => {
    worker.onerror = (event) => reject(new Error(event.message || 'The analysis stopped'));
    worker.onmessage = ({ data }: MessageEvent<Message>) => {
      try {
        const result = onMessage(data);

        if (result !== undefined) resolve(result);
      } catch (error) {
        reject(error);
      }
    };
    worker.postMessage(request);
  }).finally(() => worker.terminate());
}

const fail = (message: { type: string; message?: string }) => {
  if (message.type === 'error') throw new Error(message.message);

  return undefined;
};

function readWorker(request: ReadRequest) {
  return run<ReadMessage>(
    new Worker(new URL('../functions/analysis/analysis-read.worker.ts', import.meta.url), {
      type: 'module'
    }),
    request,
    (message) => (message.type === 'texts' || message.type === 'result' ? message : fail(message))
  ) as Promise<Extract<ReadMessage, { type: 'texts' | 'result' }>>;
}

function tokenizeWorker(request: TokenizeRequest, onProgress: (share: number) => void) {
  return run<TokenizeMessage>(
    new Worker(new URL('../functions/analysis/analysis-tokenize.worker.ts', import.meta.url), {
      type: 'module'
    }),
    request,
    (message) => {
      if (message.type === 'progress') onProgress(message.done / message.total);

      return message.type === 'done' || fail(message);
    }
  );
}

const settle = () => new Promise((resolve) => setTimeout(resolve, settlePause));

let queue: Promise<unknown> = Promise.resolve();

/**
 * The book's word list and readings file, made from its HTML (the processed book's elementHtml).
 * `onProgress` gets a share from 0 to 1. Books are analysed one at a time.
 */
export function analyseBook(html: string, onProgress: (share: number) => void = () => {}) {
  const next = queue.then(async (): Promise<BookAnalysis> => {
    const manifest = await installedTools();
    const dictionaryBytes = manifest?.files.find((file) => file.name === 'core.dic.gz')?.raw;

    if (!manifest || !dictionaryBytes) throw new Error('The analysis tools are not downloaded');

    onProgress(0);

    const request = { base: base(), manifest, html, wordsPerBook };
    const tokenFile = `analysis-${Date.now()}-${Math.random().toString(36).slice(2)}.tokens`;
    let texts = ((await readWorker(request)) as { texts: string[] }).texts;

    try {
      for (let round = 0; round < maxRounds; round += 1) {
        // The first round tokenizes the book: most of the time; later ones only a few words.
        const [from, to] = round ? [0.75, 0.8] : [0.05, 0.3];

        await settle();
        await tokenizeWorker(
          { base: base(), dictionaryBytes, tokenFile, texts, expand: !round },
          (share) => onProgress(from + (to - from) * share)
        );
        onProgress(to);
        await settle();

        const { json } = (await readWorker({ ...request, tokenFile })) as { json: string };
        const analysis = JSON.parse(json) as BookAnalysis & { misses?: string[] };

        if (!analysis.misses) {
          onProgress(1);
          return analysis;
        }
        texts = analysis.misses;
        onProgress(0.75);
      }
    } finally {
      await removeTokenFile(tokenFile);
    }

    throw new Error('The analysis did not finish');
  });

  queue = next.catch(() => undefined);

  return next;
}

/** A book's analysis kept with its readings file (reader-db `readings`). */
export interface LocalAnalysis extends CachedReadings {
  words: BookWord[];
  uniqueWords: number;
  tokens: number;
  computedAt: number;
}

/** Names the analysis of this HTML by these tools: another import or tools version redoes it. */
async function analysisTag(html: string, version: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));

  return `local ${version} ${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** The book's kept analysis, if it has one (it may be from older tools or another import). */
export async function keptAnalysis(title: string) {
  const kept = await (await readerDb()).get('readings', title).catch(() => undefined);

  return kept && 'words' in kept ? (kept as LocalAnalysis) : undefined;
}

/**
 * The book's analysis: the kept one when it was made from this HTML by these tools, else a new
 * one (undefined when the tools aren't downloaded: then the kept one, if any).
 */
export async function localAnalysis(
  title: string,
  html: string,
  onProgress?: (share: number) => void
): Promise<LocalAnalysis | undefined> {
  const [kept, manifest] = await Promise.all([keptAnalysis(title), installedTools()]);

  if (!manifest) return kept;

  const etag = await analysisTag(html, manifest.version);

  if (kept?.etag === etag) return kept;

  const result = await analyseBook(html, onProgress);
  const analysis: LocalAnalysis = {
    title,
    etag,
    file: result.readings,
    words: result.words,
    uniqueWords: result.uniqueWords,
    tokens: result.tokens,
    computedAt: Date.now()
  };

  await (await readerDb()).put('readings', analysis);

  return analysis;
}

/** A local book's word list and its totals, from its kept analysis (as an estimate's). */
export async function localWordList(
  title: string
): Promise<{ words: BookWord[]; totals: WordTotals } | undefined> {
  const kept = await keptAnalysis(title);

  return (
    kept && {
      words: foldReadings(kept.words),
      totals: { uniqueWords: kept.uniqueWords, tokens: kept.tokens }
    }
  );
}

/**
 * A local book's readings file, for the reader: the kept one at once (undefined if none), then
 * a new one when the book or the tools changed. Analysing shows in furiganaProgress$ and goes on
 * when unsubscribed, so its word list is kept for the book's page.
 */
export function localReadings$(title: string, html: string) {
  return new Observable<ReadingsFile | undefined>((subscriber) => {
    keptAnalysis(title)
      .then(async (kept) => {
        subscriber.next(kept?.file);

        const analysis = await localAnalysis(title, html, (share) =>
          furiganaProgress$.next({ title, progress: share })
        );

        if (analysis && analysis !== kept) subscriber.next(analysis.file);
      })
      .catch(() => undefined)
      .finally(() => {
        endFuriganaProgress(title);
        subscriber.complete();
      });
  });
}
