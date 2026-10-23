/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Analysis tools (standalone edition, desktop browsers): optional downloads (Settings) of Sudachi,
 * Pyodide and yurigana (scripts/analysis-tools/build.sh) that make a stored book's data in the
 * browser, in the formats the server's difficulty service gives (scripts/calibre/jiten/browser.py).
 * Two features, each its own pipeline and download: difficulty estimates (the estimate, and the
 * word list for Book words and word coverage; also the frequency pack and the models) and
 * generated furigana (the readings file). Files both use are kept while either is installed.
 *
 * Sudachi (~250 MB in memory) and Pyodide (~200 MB) run one after the other in their own workers
 * (functions/analysis/): the tokenizer worker tokenizes what the reader worker asks for and is ended
 * before the reader worker starts; texts the reading turns out to need too (parts of words,
 * dictionary forms) go back for another round. One book at a time. Not part of upstream.
 */

import { BehaviorSubject, Observable } from 'rxjs';
import { foldReadings, type BookWord, type WordTotals } from '$lib/data/book-words';
import type { CalibreDifficulty } from '$lib/data/calibre';
import { pagePath, standalone } from '$lib/data/env';
import {
  endFuriganaProgress,
  furiganaProgress$,
  type ReadingsFile
} from '$lib/data/generated-furigana';
import { readerDb } from '$lib/data/reader-db';
import type { ReadMessage, ReadRequest } from '$lib/functions/analysis/analysis-read.worker';
import type { ScoreMessage, ScoreRequest } from '$lib/functions/analysis/analysis-score.worker';
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

export type AnalysisFeature = 'difficulty' | 'furigana';
export const analysisFeatures: AnalysisFeature[] = ['difficulty', 'furigana'];
type Part = ReadRequest['part'];

/** The tools' manifest as kept in the cache: the site's, plus the features installed from it. */
interface KeptManifest extends AnalysisToolsManifest {
  installed?: AnalysisFeature[];
}

type ToolsFile = AnalysisToolsManifest['files'][number];

const needs = (file: ToolsFile, features: AnalysisFeature[]) =>
  !file.features || features.some((feature) => file.features!.includes(feature));

export type AnalysisToolsState = 'unknown' | 'absent' | 'downloading' | 'ready';

export const analysisToolsState$ = new BehaviorSubject<Record<AnalysisFeature, AnalysisToolsState>>(
  { difficulty: 'unknown', furigana: 'unknown' }
);

function setState(feature: AnalysisFeature, state: AnalysisToolsState) {
  analysisToolsState$.next({ ...analysisToolsState$.getValue(), [feature]: state });
}

async function keptManifest(): Promise<KeptManifest | undefined> {
  const cache = await caches.open(analysisToolsCacheName);

  return (await cache.match(new URL(manifestName, base()).href))?.json();
}

async function hasFile(cache: Cache, file: ToolsFile) {
  if (!file.raw) return !!(await cache.match(new URL(file.name, base()).href));

  const folder = await rawFolder();

  return (await (await folder.getFileHandle(rawName(file.name))).getFile()).size === file.raw;
}

/** The kept manifest when `feature` is installed and every file it needs is there. */
export async function installedTools(
  feature: AnalysisFeature
): Promise<AnalysisToolsManifest | undefined> {
  try {
    const manifest = await keptManifest();

    if (!manifest?.installed?.includes(feature)) return undefined;

    const cache = await caches.open(analysisToolsCacheName);
    const found = await Promise.all(
      manifest.files
        .filter((file) => needs(file, [feature]))
        .map((file) => hasFile(cache, file).catch(() => false))
    );

    return found.every(Boolean) ? manifest : undefined;
  } catch {
    return undefined;
  }
}

/** Sets `analysisToolsState$` from the cache. */
export async function checkAnalysisTools() {
  for (const feature of analysisFeatures) {
    if (analysisToolsState$.getValue()[feature] !== 'downloading') {
      setState(feature, (await installedTools(feature)) ? 'ready' : 'absent');
    }
  }
}

async function siteManifest(signal?: AbortSignal) {
  const response = await fetch(new URL(manifestName, base()).href, { cache: 'no-cache', signal });

  if (!response.ok) throw new Error(`The analysis tools aren't on this site`);

  return (await response.json()) as AnalysisToolsManifest;
}

/**
 * What downloading `feature` fetches: its files the installed features don't have already (all it
 * needs, and the installed features' files again, when the site has another version).
 */
async function toDownload(feature: AnalysisFeature, site: AnalysisToolsManifest) {
  const kept = await keptManifest().catch(() => undefined);
  const same = kept?.version === site.version;
  const features = [...new Set([...(kept?.installed ?? []), feature])];
  const cache = await caches.open(analysisToolsCacheName);
  const files: ToolsFile[] = [];

  for (const file of site.files) {
    if (needs(file, features) && !(same && (await hasFile(cache, file).catch(() => false)))) {
      files.push(file);
    }
  }

  return { files, features, same };
}

/** The download's size in bytes for `feature`, from the site's manifest. */
export async function analysisToolsSize(feature: AnalysisFeature) {
  const { files } = await toDownload(feature, await siteManifest());

  return files.reduce((sum, file) => sum + file.bytes, 0);
}

/**
 * Downloads the files `feature` needs into the cache, the manifest last (so a cut download is never
 * taken for a whole one). Asks the browser to keep the site's storage first.
 */
export async function downloadAnalysisTools(
  feature: AnalysisFeature,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal
) {
  setState(feature, 'downloading');

  try {
    await navigator.storage?.persist?.().catch(() => false);

    const site = await siteManifest(signal);
    const { files, features, same } = await toDownload(feature, site);

    // Another version: the installed features are fetched again with this one.
    if (!same) await removeAll();

    const total = files.reduce((sum, file) => sum + file.bytes, 0);
    const cache = await caches.open(analysisToolsCacheName);
    const folder = await rawFolder(true);
    let done = 0;

    for (const file of files) {
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

    await cache.put(
      new URL(manifestName, base()).href,
      new Response(JSON.stringify({ ...site, installed: features } satisfies KeptManifest))
    );
  } finally {
    await checkAnalysisTools();
  }
}

async function removeAll() {
  await caches.delete(analysisToolsCacheName);
  await navigator.storage
    .getDirectory()
    .then((root) => root.removeEntry(analysisToolsCacheName, { recursive: true }))
    .catch(() => undefined);
}

/** Removes `feature` and the files no other installed feature needs. */
export async function removeAnalysisTools(feature: AnalysisFeature) {
  const kept = await keptManifest().catch(() => undefined);
  const others = (kept?.installed ?? []).filter((installed) => installed !== feature);

  if (!kept || !others.length) {
    await removeAll();
  } else {
    const cache = await caches.open(analysisToolsCacheName);
    const folder = await rawFolder(true);

    await cache.put(
      new URL(manifestName, base()).href,
      new Response(JSON.stringify({ ...kept, installed: others } satisfies KeptManifest))
    );
    for (const file of kept.files.filter(
      (file) => needs(file, [feature]) && !needs(file, others)
    )) {
      await (
        file.raw
          ? folder.removeEntry(rawName(file.name))
          : cache.delete(new URL(file.name, base()).href)
      ).catch(() => undefined);
    }
  }
  await checkAnalysisTools();
}

/** browser.py's word list, the difficulty model's input row and the estimate's counts */
interface WordsResult {
  words: BookWord[];
  uniqueWords: number;
  tokens: number;
  features: number[];
  words95: number | null;
  characters: number;
  uniqueKanji: number;
}

const abortError = () => new DOMException('The analysis was stopped', 'AbortError');

function run<Message extends { type: string }>(
  worker: Worker,
  request: unknown,
  onMessage: (message: Message) => unknown,
  signal?: AbortSignal
) {
  return new Promise<unknown>((resolve, reject) => {
    const stop = () => reject(abortError());

    if (signal?.aborted) return stop();
    signal?.addEventListener('abort', stop, { once: true });
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

function readWorker(request: ReadRequest, signal?: AbortSignal) {
  return run<ReadMessage>(
    new Worker(new URL('../functions/analysis/analysis-read.worker.ts', import.meta.url), {
      type: 'module'
    }),
    request,
    (message) => (message.type === 'texts' || message.type === 'result' ? message : fail(message)),
    signal
  ) as Promise<Extract<ReadMessage, { type: 'texts' | 'result' }>>;
}

function tokenizeWorker(
  request: TokenizeRequest,
  onProgress: (share: number) => void,
  signal?: AbortSignal
) {
  return run<TokenizeMessage>(
    new Worker(new URL('../functions/analysis/analysis-tokenize.worker.ts', import.meta.url), {
      type: 'module'
    }),
    request,
    (message) => {
      if (message.type === 'progress') onProgress(message.done / message.total);

      return message.type === 'done' || fail(message);
    },
    signal
  );
}

function scoreWorker(request: ScoreRequest) {
  return run<ScoreMessage>(
    new Worker(new URL('../functions/analysis/analysis-score.worker.ts', import.meta.url), {
      type: 'module'
    }),
    request,
    (message) => (message.type === 'scores' ? message : fail(message))
  ) as Promise<Extract<ScoreMessage, { type: 'scores' }>>;
}

const settle = (signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, settlePause);

    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true }
    );
  });

/** Analyses waiting, one at a time; readings files go ahead of word lists (a reader waits for them). */
const pending: { part: Part; start: () => Promise<void> }[] = [];
let running = false;

async function pump() {
  if (running) return;
  running = true;
  while (pending.length) await pending.shift()!.start();
  running = false;
}

function enqueue<T>(part: Part, task: () => Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    const job = { part, start: () => task().then(resolve, reject) };
    const at = part === 'readings' ? pending.findIndex((queued) => queued.part === 'words') : -1;

    if (at < 0) {
      pending.push(job);
    } else {
      pending.splice(at, 0, job);
    }
    pump();
  });
}

/**
 * One part of the book's analysis from its HTML (the processed book's elementHtml): browser.py's
 * JSON. `onProgress` gets a share from 0 to 1; `signal` stops it (between and inside stages).
 */
function analyseBook(
  html: string,
  part: Part,
  manifest: AnalysisToolsManifest,
  onProgress: (share: number) => void,
  signal?: AbortSignal
) {
  return enqueue(part, async () => {
    const dictionaryBytes = manifest.files.find((file) => file.name === 'core.dic.gz')?.raw;

    if (!dictionaryBytes) throw new Error('The analysis tools are not downloaded');
    if (signal?.aborted) throw abortError();

    onProgress(0);

    const request = { base: base(), manifest, html, part, wordsPerBook };
    const tokenFile = `analysis-${Date.now()}-${Math.random().toString(36).slice(2)}.tokens`;
    let texts = ((await readWorker(request, signal)) as { texts: string[] }).texts;

    try {
      for (let round = 0; round < maxRounds; round += 1) {
        // The first round tokenizes the book: most of the time; later ones only a few words.
        const [from, to] = round ? [0.75, 0.8] : [0.05, 0.3];

        await settle(signal);
        await tokenizeWorker(
          { base: base(), dictionaryBytes, tokenFile, texts, expand: !round },
          (share) => onProgress(from + (to - from) * share),
          signal
        );
        onProgress(to);
        await settle(signal);

        const { json } = (await readWorker({ ...request, tokenFile }, signal)) as { json: string };
        const analysis = JSON.parse(json) as { misses?: string[] };

        if (!analysis.misses) {
          onProgress(1);
          return analysis as unknown;
        }
        texts = analysis.misses;
        onProgress(0.75);
      }
    } finally {
      await removeTokenFile(tokenFile);
    }

    throw new Error('The analysis did not finish');
  });
}

/** Names the analysis of this HTML by these tools: another import or tools version redoes it. */
async function analysisTag(html: string, version: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));

  return `local ${version} ${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** A local book's difficulty estimate (reader-db `estimates`), shaped like the server's. */
export interface LocalEstimate extends CalibreDifficulty {
  title: string;
  etag: string;
}

/** A local book's word list (reader-db `wordLists`), made with its estimate. */
export interface LocalWordList {
  title: string;
  etag: string;
  words: BookWord[];
}

export async function keptEstimate(title: string) {
  return (await readerDb()).get('estimates', title).catch(() => undefined);
}

/** Every local book's estimate, by title (for the library's cards). */
export async function localEstimates() {
  const estimates = await (await readerDb()).getAll('estimates').catch(() => []);

  return new Map(estimates.map((estimate) => [estimate.title, estimate]));
}

/**
 * The book's difficulty estimate and word list: the kept one when made from this HTML by these
 * tools, else a new one (undefined when the difficulty tools aren't downloaded: then the kept one).
 */
export async function localEstimate(
  title: string,
  html: string,
  onProgress: (share: number) => void = () => {},
  signal?: AbortSignal
): Promise<LocalEstimate | undefined> {
  const [kept, manifest] = await Promise.all([keptEstimate(title), installedTools('difficulty')]);

  if (!manifest) return kept;

  const etag = await analysisTag(html, manifest.version);

  if (kept?.etag === etag) return kept;

  const result = (await analyseBook(
    html,
    'words',
    manifest,
    (share) => onProgress(share * 0.95),
    signal
  )) as WordsResult;
  const scores = await scoreWorker({ base: base(), features: result.features });
  const estimate: LocalEstimate = {
    title,
    etag,
    difficulty: scores.difficulty,
    low: scores.low,
    high: scores.high,
    words95: result.words95,
    characters: result.characters,
    uniqueKanji: result.uniqueKanji,
    uniqueWords: result.uniqueWords,
    tokens: result.tokens,
    computedAt: Date.now()
  };
  const db = await readerDb();

  await db.put('wordLists', { title, etag, words: result.words });
  await db.put('estimates', estimate);
  onProgress(1);

  return estimate;
}

/** A local book's word list and its totals, from its kept estimate. */
export async function localWordList(
  title: string
): Promise<{ words: BookWord[]; totals: WordTotals } | undefined> {
  const db = await readerDb();
  const [estimate, list] = await Promise.all([
    db.get('estimates', title),
    db.get('wordLists', title)
  ]);

  if (!estimate || list?.etag !== estimate.etag) return undefined;

  return {
    words: foldReadings(list.words),
    totals: { uniqueWords: estimate.uniqueWords, tokens: estimate.tokens }
  };
}

/**
 * A local book's readings file, for the reader: the kept one at once (undefined if none), then
 * a new one when the book or the tools changed. Analysing shows in furiganaProgress$;
 * unsubscribing stops it.
 */
export function localReadings$(title: string, html: string) {
  return new Observable<ReadingsFile | undefined>((subscriber) => {
    const controller = new AbortController();

    (async () => {
      const db = await readerDb();
      const kept = await db.get('readings', title).catch(() => undefined);

      subscriber.next(kept?.file);

      const manifest = await installedTools('furigana');

      if (!manifest) return;

      const etag = await analysisTag(html, manifest.version);

      if (kept?.etag === etag) return;

      const { readings } = (await analyseBook(
        html,
        'readings',
        manifest,
        (share) => furiganaProgress$.next({ title, progress: share }),
        controller.signal
      )) as { readings: ReadingsFile };

      await db.put('readings', { title, etag, file: readings });
      subscriber.next(readings);
    })()
      .catch(() => undefined)
      .finally(() => {
        endFuriganaProgress(title);
        subscriber.complete();
      });

    return () => controller.abort();
  });
}
