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
 * One worker runs both Sudachi (~250 MB in memory) and Pyodide (~200 MB)
 * (functions/analysis/analysis.worker.ts): Python asks Sudachi for each text as it reads, so a part
 * is one pass; the worker keeps the last book's tokens for its other part. One job at a time; the
 * worker (and the scoring one) stays for the next one as long as analysisKeepAlive says
 * (analysis-capacity.ts). Not part of upstream.
 */

import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { foldReadings, type BookWord, type WordTotals } from '$lib/data/book-words';
import type { CalibreDifficulty } from '$lib/data/calibre';
import { pagePath, standalone } from '$lib/data/env';
import {
  endFuriganaProgress,
  furiganaProgress$,
  type ReadingsFile
} from '$lib/data/generated-furigana';
import { readerDb } from '$lib/data/reader-db';
import type { AnalysisMessage, AnalysisRequest } from '$lib/functions/analysis/analysis.worker';
import type { ScoreMessage, ScoreRequest } from '$lib/functions/analysis/analysis-score.worker';
import {
  analysisToolsCacheName,
  rawFolder,
  rawName,
  type AnalysisToolsManifest
} from '$lib/functions/analysis/tools-files';
import { analysisKeepAlive } from '$lib/data/analysis-capacity';

const base = () => new URL(`${pagePath}/analysis-tools/`, location.href).href;
const manifestName = 'manifest.json';
/** Rows kept per word list, as the server keeps (WORDS_PER_BOOK, wordsPerBook in book-words.ts) */
const wordsPerBook = 2000;

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
type Part = AnalysisRequest['part'];

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
async function toDownload(wanted: AnalysisFeature[], site: AnalysisToolsManifest) {
  const kept = await keptManifest().catch(() => undefined);
  const same = kept?.version === site.version;
  const features = [...new Set([...(kept?.installed ?? []), ...wanted])];
  const cache = await caches.open(analysisToolsCacheName);
  const files: ToolsFile[] = [];

  for (const file of site.files) {
    if (needs(file, features) && !(same && (await hasFile(cache, file).catch(() => false)))) {
      files.push(file);
    }
  }

  return { files, features, same };
}

/** The download's size in bytes for these features, from the site's manifest. */
export async function analysisToolsSize(features: AnalysisFeature[]) {
  const { files } = await toDownload(features, await siteManifest());

  return files.reduce((sum, file) => sum + file.bytes, 0);
}

/**
 * The download running (bytes done of total), or the last one's error, for every page that shows
 * it: one started on the first run carries on in Settings.
 */
export const analysisDownload$ = new BehaviorSubject<
  { features: AnalysisFeature[]; done: number; total: number; error?: string } | undefined
>(undefined);
let downloadController: AbortController | undefined;

export function cancelAnalysisDownload() {
  downloadController?.abort();
}

/**
 * Downloads the files these features need into the cache, the manifest last (so a cut download is
 * never taken for a whole one), in analysisDownload$. Asks the browser to keep the site's storage
 * first. Never throws: a failure stays in analysisDownload$.
 */
export async function downloadAnalysisTools(wanted: AnalysisFeature[]) {
  if (downloadController) return;

  const controller = new AbortController();
  const { signal } = controller;
  const onProgress = (done: number, total: number) =>
    analysisDownload$.next({ features: wanted, done, total });

  downloadController = controller;
  wanted.forEach((feature) => setState(feature, 'downloading'));
  onProgress(0, 0);

  try {
    await navigator.storage?.persist?.().catch(() => false);

    const site = await siteManifest(signal);
    const { files, features, same } = await toDownload(wanted, site);

    // Another version: the installed features are fetched again with this one.
    if (!same) await removeAll();

    const total = files.reduce((sum, file) => sum + file.bytes, 0);

    onProgress(0, total);

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
    analysisDownload$.next(undefined);
    // The books already stored get what the new tools make.
    import('$lib/data/background-analysis')
      .then(({ analyseStoredBooks }) => analyseStoredBooks())
      .catch((error) => console.warn('Background analysis:', error));
  } catch (error) {
    analysisDownload$.next(
      signal.aborted
        ? undefined
        : { features: wanted, done: 0, total: 0, error: downloadError(error) }
    );
  } finally {
    downloadController = undefined;
    // checkAnalysisTools leaves features marked downloading alone.
    wanted.forEach((feature) => setState(feature, 'unknown'));
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

/** Firefox refuses OPFS in private windows or when the site may not keep data (SecurityError). */
function downloadError(error: unknown) {
  if (error instanceof DOMException && error.name === 'SecurityError') {
    return 'this browser won’t let the site store files (a private window, or site data blocked or cleared on close). Use a normal window or allow site data for this site, then try again.';
  }
  return (error as Error).message;
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

/** A worker silent this long (killed by memory pressure, stuck) is stopped and the book skipped. */
export const WORKER_SILENCE_MS = 2 * 60 * 1000;

export function runWorker<Message extends { type: string }>(
  worker: Worker,
  request: unknown,
  onMessage: (message: Message) => unknown,
  signal?: AbortSignal,
  keep = false
) {
  let watchdog: ReturnType<typeof setTimeout> | undefined;

  return new Promise<unknown>((resolve, reject) => {
    const stop = () => reject(abortError());
    // Every message, progress included, shows it is alive.
    const feed = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(
        () => reject(new Error('The analysis stopped answering')),
        WORKER_SILENCE_MS
      );
    };

    if (signal?.aborted) return stop();
    signal?.addEventListener('abort', stop, { once: true });
    feed();
    worker.onerror = (event) => reject(new Error(event.message || 'The analysis stopped'));
    worker.onmessage = ({ data }: MessageEvent<Message>) => {
      feed();

      try {
        const result = onMessage(data);

        if (result !== undefined) resolve(result);
      } catch (error) {
        reject(error);
      }
    };
    worker.postMessage(request);
  }).then(
    (result) => {
      clearTimeout(watchdog);
      if (!keep) worker.terminate();
      return result;
    },
    (error) => {
      clearTimeout(watchdog);
      worker.terminate();
      throw error;
    }
  );
}

const fail = (message: { type: string; message?: string }) => {
  if (message.type === 'error') throw new Error(message.message);

  return undefined;
};

/**
 * The scoring worker, kept like the analysis worker (analysisKeepAlive) so the next book skips
 * onnxruntime's start; its own timer, as it runs after the queue's job.
 */
let scorer: { worker: Worker; timer?: ReturnType<typeof setTimeout> } | undefined;

function endScorer() {
  scorer?.worker.terminate();
  scorer = undefined;
}

async function score(request: ScoreRequest) {
  clearTimeout(scorer?.timer);
  scorer ??= {
    worker: new Worker(new URL('../functions/analysis/analysis-score.worker.ts', import.meta.url), {
      type: 'module'
    })
  };

  try {
    return (await runWorker<ScoreMessage>(
      scorer.worker,
      request,
      (message) => (message.type === 'scores' ? message : fail(message)),
      undefined,
      true
    )) as Extract<ScoreMessage, { type: 'scores' }>;
  } catch (error) {
    // runWorker ended it
    scorer = undefined;
    throw error;
  } finally {
    const keepAlive = analysisKeepAlive();

    if (scorer && keepAlive) {
      scorer.timer = setTimeout(endScorer, keepAlive);
    } else {
      endScorer();
    }
  }
}

/** One at a time: a book's score runs after its queue job, so the next book's could meet it. */
let scoring: Promise<unknown> = Promise.resolve();

function scoreWorker(request: ScoreRequest) {
  const run = scoring.then(() => score(request));

  scoring = run.catch(() => undefined);

  return run;
}

/** The analysis worker, kept between jobs (analysisKeepAlive); ended when a job fails. */
let session: { worker: Worker; timer?: ReturnType<typeof setTimeout> } | undefined;

function endSession() {
  session?.worker.terminate();
  session = undefined;
}

function analysisWorker(
  request: AnalysisRequest,
  onProgress: (share: number) => void,
  signal?: AbortSignal
) {
  clearTimeout(session?.timer);
  session ??= {
    worker: new Worker(new URL('../functions/analysis/analysis.worker.ts', import.meta.url), {
      type: 'module'
    })
  };

  const { worker } = session;

  return (
    runWorker<AnalysisMessage>(
      worker,
      request,
      (message) => {
        if (message.type === 'progress') onProgress(message.share);

        return message.type === 'result' ? message : fail(message);
      },
      signal,
      true
    ) as Promise<Extract<AnalysisMessage, { type: 'result' }>>
  ).catch((error) => {
    // runWorker ended it
    if (session?.worker === worker) session = undefined;
    throw error;
  });
}

/**
 * Analyses waiting, one at a time: readings files go ahead of word lists (a reader waits for them),
 * and both ahead of the background analysis (background-analysis.ts).
 */
const pending: { rank: number; start: () => Promise<void> }[] = [];
let running = false;

async function pump() {
  if (running) return;
  running = true;
  while (pending.length) await pending.shift()!.start();
  running = false;

  const keepAlive = analysisKeepAlive();

  if (!keepAlive) {
    endSession();
  } else if (session) {
    session.timer = setTimeout(endSession, keepAlive);
  }
}

function enqueue<T>(part: Part, background: boolean, task: () => Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    const rank = background ? 2 : part === 'readings' ? 0 : 1;
    const job = { rank, start: () => task().then(resolve, reject) };
    const at = pending.findIndex((queued) => queued.rank > rank);

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
  signal?: AbortSignal,
  background = false
) {
  return enqueue(part, background, async () => {
    if (signal?.aborted) throw abortError();

    onProgress(0);

    const { json } = await analysisWorker(
      { base: base(), manifest, html, part, wordsPerBook },
      onProgress,
      signal
    );

    onProgress(1);

    return JSON.parse(json) as unknown;
  });
}

/** Names the analysis of this HTML by these tools: another import or tools version redoes it. */
export async function analysisTag(html: string, version: string) {
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

/** The jobs running or queued, by part and title: a second ask for the same one waits for it. */
const jobs = new Map<string, { promise: Promise<unknown>; progress: (share: number) => void }>();

function once<T>(
  key: string,
  onProgress: (share: number) => void,
  start: (progress: (share: number) => void) => Promise<T>
): Promise<T> {
  const found = jobs.get(key);

  if (found) {
    // The latest asker sees the progress (the reader that opened the book the background has).
    found.progress = onProgress;
    return found.promise as Promise<T>;
  }

  const job = { progress: onProgress, promise: Promise.resolve() as Promise<unknown> };

  job.promise = start((share) => job.progress(share)).finally(() => jobs.delete(key));
  jobs.set(key, job);

  return job.promise as Promise<T>;
}

/** Titles whose new local estimate was just kept (the book page reloads it). */
export const localEstimateSaved$ = new Subject<string>();

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
  signal?: AbortSignal,
  background = false
): Promise<LocalEstimate | undefined> {
  const [kept, manifest] = await Promise.all([keptEstimate(title), installedTools('difficulty')]);

  if (!manifest) return kept;

  const etag = await analysisTag(html, manifest.version);

  if (kept?.etag === etag) return kept;

  return once(`words ${title}`, onProgress, (progress) =>
    makeEstimate(title, html, etag, manifest, progress, signal, background)
  );
}

async function makeEstimate(
  title: string,
  html: string,
  etag: string,
  manifest: AnalysisToolsManifest,
  onProgress: (share: number) => void,
  signal: AbortSignal | undefined,
  background: boolean
) {
  const result = (await analyseBook(
    html,
    'words',
    manifest,
    (share) => onProgress(share * 0.95),
    signal,
    background
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
    engine: manifest.engine,
    computedAt: Date.now()
  };
  const db = await readerDb();

  await db.put('wordLists', { title, etag, words: result.words });
  await db.put('estimates', estimate);
  onProgress(1);
  localEstimateSaved$.next(title);

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

/** The kept readings file of a local book, with the etag of what it was made from. */
export async function keptReadings(title: string) {
  return (await readerDb()).get('readings', title).catch(() => undefined);
}

/**
 * A local book's readings file made and kept (reader-db `readings`) when there is none from this
 * HTML and these tools: undefined when the furigana tools aren't downloaded or it is current.
 */
export async function makeReadings(
  title: string,
  html: string,
  onProgress: (share: number) => void = () => {},
  signal?: AbortSignal,
  background = false
): Promise<ReadingsFile | undefined> {
  const [kept, manifest] = await Promise.all([keptReadings(title), installedTools('furigana')]);

  if (!manifest) return undefined;

  const etag = await analysisTag(html, manifest.version);

  if (kept?.etag === etag) return undefined;

  return once(`readings ${title}`, onProgress, async (progress) => {
    const { readings } = (await analyseBook(
      html,
      'readings',
      manifest,
      progress,
      signal,
      background
    )) as { readings: ReadingsFile };

    await (await readerDb()).put('readings', { title, etag, file: readings });

    return readings;
  });
}

/**
 * A local book's readings file, for the reader: the kept one at once (undefined if none), then
 * a new one when the book or the tools changed. Analysing shows in furiganaProgress$;
 * unsubscribing stops it (unless the background analysis started it).
 */
export function localReadings$(title: string, html: string) {
  return new Observable<ReadingsFile | undefined>((subscriber) => {
    const controller = new AbortController();

    (async () => {
      subscriber.next((await keptReadings(title))?.file);

      const readings = await makeReadings(
        title,
        html,
        (share) => {
          if (!controller.signal.aborted) furiganaProgress$.next({ title, progress: share });
        },
        controller.signal
      );

      if (readings) subscriber.next(readings);
    })()
      .catch((error) => {
        if (!controller.signal.aborted) console.warn(`Generated furigana for “${title}”:`, error);
      })
      .finally(() => {
        endFuriganaProgress(title);
        subscriber.complete();
      });

    return () => {
      controller.abort();
      endFuriganaProgress(title);
    };
  });
}
