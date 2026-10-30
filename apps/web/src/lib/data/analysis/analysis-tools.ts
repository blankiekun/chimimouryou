/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Analysis tools (standalone edition, desktop browsers): optional downloads (Settings) of Sudachi,
 * Pyodide and yurigana (scripts/analysis-tools/build.sh) that make a stored book's data in the
 * browser, in the formats the server's difficulty service gives (engine/browser.py).
 * Two features, each its own pipeline and download: difficulty estimates (the estimate: the fast
 * core's numbers, core.ts, without Pyodide; and the word list for Book words and word coverage;
 * also the frequency pack and the core's list) and generated furigana (the readings file). Files
 * both use are kept while either is installed.
 *
 * One worker runs both Sudachi (~250 MB in memory) and Pyodide (~200 MB)
 * (functions/analysis/analysis.worker.ts): Python asks Sudachi for each text as it reads, so a part
 * is one pass; the worker keeps the last book's tokens for its other part. One job at a time, two
 * on large machines (analysisWorkers: a background batch analyses two books at once); the workers
 * stay for the next job as long as analysisKeepAlive says
 * (analysis-capacity.ts). Not part of upstream.
 */

import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  map,
  Observable,
  of,
  Subject,
  switchMap
} from 'rxjs';
import { foldReadings, type BookWord, type WordTotals } from '$lib/data/words/book-words';
import type { CalibreDifficulty } from '$lib/data/remote/calibre';
import { pagePath, standalone } from '$lib/data/env';
import { StorageSourceDefault } from '$lib/data/storage/storage-types';
import {
  endFuriganaProgress,
  furiganaProgress$,
  generatedReadings$,
  type ReadingsFile
} from '$lib/data/words/generated-furigana';
import { chapterPrimer$, generatedFurigana$, unknownWordUnderline$ } from '$lib/data/store';
import { readerDb } from '$lib/data/reader-db';
import type {
  AnalysisLoad,
  AnalysisMessage,
  AnalysisRequest
} from '$lib/functions/analysis/analysis.worker';
import {
  analysisToolsCacheName,
  rawFolder,
  rawName,
  toolsFile,
  type AnalysisToolsManifest
} from '$lib/functions/analysis/tools-files';
import { analysisKeepAlive, analysisWorkers } from '$lib/data/analysis/analysis-capacity';
import { CORE_VERSION, type CoreNumbers } from '$lib/functions/analysis/core';

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

/** Where a book's readings file comes from (the reader), if it can have one. */
export function readingsAvailable(book: { storageSource?: string }) {
  if (book.storageSource === StorageSourceDefault.CALIBRE_DEFAULT) return 'server';

  return analysisToolsSupported() ? 'local' : undefined;
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
    import('$lib/data/analysis/background-analysis')
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

/** browser.py's word list and the estimate's counts */
interface WordsResult {
  words: BookWord[];
  uniqueWords: number;
  tokens: number;
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
 * The analysis workers (up to analysisWorkers at once), kept between jobs (analysisKeepAlive); one
 * is ended when its job fails. `html` is the last book it read: its tokens are still in it.
 */
interface Session {
  worker: Worker;
  html: string;
  busy: boolean;
  /** the jobs it ran on `html`: small machines end it after the book's two parts */
  parts: number;
}

let sessions: Session[] = [];
/** How long a small machine's worker waits for its book's other part */
const BOOK_PART_WAIT_MS = 10_000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function endSessions() {
  sessions.forEach((session) => session.worker.terminate());
  sessions = [];
}

function analysisWorker(
  session: Session,
  request: AnalysisRequest,
  onProgress: (share: number) => void,
  signal?: AbortSignal
) {
  return (
    runWorker<AnalysisMessage>(
      session.worker,
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
    sessions = sessions.filter((kept) => kept !== session);
    throw error;
  });
}

/**
 * Analyses waiting: readings files go ahead of word lists (a reader waits for them), and both
 * ahead of the background analysis (background-analysis.ts). A job starts on the first free worker
 * (a new one while there are fewer than analysisWorkers), never beside another job of its book, so
 * a book's parts keep their order and its tokens. A reader's job asked for while every worker runs
 * a background job takes the first worker freed (the background never starts ahead of it).
 */
const pending: { rank: number; html: string; start: (session: Session) => Promise<void> }[] = [];

/**
 * The first job in `pending` (in rank order) that can start, and its worker: its book's free one
 * (the tokens of its other part), else null for a new one while there are fewer than `limit`, else
 * any free one. Undefined when none can start.
 */
export function nextJob<S extends { html: string; busy: boolean }>(
  pending: { html: string }[],
  sessions: S[],
  limit: number
) {
  const at = pending.findIndex(
    (job) => !sessions.some((session) => session.busy && session.html === job.html)
  );

  if (at < 0) return undefined;

  const { html } = pending[at];
  const session =
    sessions.find((kept) => !kept.busy && kept.html === html) ??
    (sessions.length < limit ? null : sessions.find((kept) => !kept.busy));

  return session === undefined ? undefined : { at, session };
}

const newSession = (html: string): Session => ({
  worker: new Worker(new URL('../../functions/analysis/analysis.worker.ts', import.meta.url), {
    type: 'module'
  }),
  html,
  busy: false,
  parts: 0
});

function pump() {
  const keepAlive = analysisKeepAlive();

  for (
    let next = nextJob(pending, sessions, analysisWorkers());
    next;
    next = nextJob(pending, sessions, analysisWorkers())
  ) {
    const session = next.session ?? newSession('');

    if (!next.session) sessions = [...sessions, session];

    const [job] = pending.splice(next.at, 1);

    clearTimeout(idleTimer);
    session.busy = true;
    session.parts = session.html === job.html ? session.parts + 1 : 1;
    session.html = job.html;
    job.start(session).finally(() => {
      session.busy = false;
      pump();
    });
  }

  if (pending.length || sessions.some((session) => session.busy)) return;

  if (!keepAlive) {
    // Small machines keep the worker only for its book's other part (its tokens, ~1.9 s start).
    sessions.filter((session) => session.parts > 1).forEach((done) => done.worker.terminate());
    sessions = sessions.filter((session) => session.parts < 2);
  }
  if (sessions.length) idleTimer = setTimeout(endSessions, keepAlive || BOOK_PART_WAIT_MS);
}

function enqueue<T>(
  part: Part,
  background: boolean,
  html: string,
  task: (session: Session) => Promise<T>
) {
  return new Promise<T>((resolve, reject) => {
    // The core (under a second) after the reader's readings file, ahead of the word list: the book page
    // shows its numbers well before the estimate, and furigana don't wait for it.
    const rank = background ? 2 : part === 'readings' ? 0 : part === 'core' ? 0.5 : 1;
    const job = { rank, html, start: (session: Session) => task(session).then(resolve, reject) };
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
 * The reader opening a local book: when its readings file (`readings`: the reader wants one) or
 * estimate will be made, a worker starts loading its tools (~2 s) now, beside the book's first
 * render, instead of when the job is queued. Only while no worker is free and there is room for
 * one (analysisWorkers); unused, it ends as pump's idle workers do.
 */
export async function prewarmAnalysis(title: string, html: string, readings: boolean) {
  const [furigana, difficulty, keptFile, kept] = await Promise.all([
    readings ? installedTools('furigana') : undefined,
    installedTools('difficulty'),
    keptReadings(title),
    keptEstimate(title)
  ]);
  const manifest = furigana ?? difficulty;

  if (!manifest) return;

  const etag = await analysisTag(html, manifest.version);

  if ((!furigana || keptFile?.etag === etag) && (!difficulty || kept?.etag === etag)) return;
  // A free worker, a full house, or this book already being analysed (the background's)
  if (
    sessions.some((session) => !session.busy || session.html === html) ||
    sessions.length >= analysisWorkers()
  ) {
    return;
  }

  const session = newSession(html);

  sessions = [...sessions, session];
  session.worker.postMessage({ base: base(), manifest } satisfies AnalysisLoad);
  pump();
}

/**
 * Whether a part runs yurigana's Reader: the readings file always; the word list only while
 * generated furigana is installed (its rows' readings in context), else its rows take Sudachi's
 * readings and the reader pack is never downloaded or loaded. Tools older than that (their
 * manifest doesn't tag the pack) always need it. The estimate is the same either way, and so is
 * the etag: a word list made without the Reader is kept when furigana is added.
 */
export function usesReader(part: Part, manifest: AnalysisToolsManifest, furigana: boolean) {
  const pack = manifest.files.find((file) => file.name === 'reader.ygp.gz');

  return part === 'readings' || furigana || !pack?.features;
}

/** Tools built before the core have no core frequency list: their estimates have no core numbers. */
const hasCore = (manifest: AnalysisToolsManifest) =>
  manifest.files.some((file) => file.name === 'core-frequency.tsv.gz');

/**
 * The core frequency list's rank of each of `forms` it lists (words known, standalone); undefined
 * without the tools' core list.
 */
export async function coreFormRanks(forms: string[]) {
  const manifest = await installedTools('difficulty');

  if (!manifest || !hasCore(manifest)) return undefined;

  const response = await toolsFile(base(), 'core-frequency.tsv.gz');
  const text = await new Response(
    response.body!.pipeThrough(
      new DecompressionStream('gzip') as ReadableWritablePair<Uint8Array, Uint8Array>
    )
  ).text();
  const end = text.indexOf('\n\n');
  const wanted = new Set(forms);
  const ranks: Record<string, number> = {};

  // The first section of parseCoreTable's format: `term \t rank` lines.
  for (const line of text.slice(0, end < 0 ? undefined : end).split('\n')) {
    const tab = line.lastIndexOf('\t');

    if (wanted.has(line.slice(0, tab))) ranks[line.slice(0, tab)] = +line.slice(tab + 1);
  }

  return ranks;
}

/**
 * One part of the book's analysis from its HTML (the processed book's elementHtml): browser.py's
 * JSON. `onProgress` gets a share from 0 to 1; `signal` stops it (between and inside stages).
 */
function analyseBook(
  html: string,
  part: Part,
  manifest: AnalysisToolsManifest,
  reader: boolean,
  onProgress: (share: number) => void,
  signal?: AbortSignal,
  background = false,
  python = false
) {
  return enqueue(part, background, html, async (session) => {
    if (signal?.aborted) throw abortError();

    onProgress(0);

    const { json } = await analysisWorker(
      session,
      { base: base(), manifest, html, part, wordsPerBook, reader, python },
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
  /** false: made without yurigana's Reader (usesReader), so redoWordList can redo it; older: with */
  reader?: boolean;
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

/** The fast core's result (analysis.worker.ts): its numbers and the book's characters */
export interface CoreResult {
  core: CoreNumbers;
  characters: number;
}

/**
 * The book's difficulty estimate and word list: the kept one when made from this HTML by these
 * tools, else a new one (undefined when the difficulty tools aren't downloaded: then the kept one).
 * `onCore` gets the fast core's numbers first, well before the estimate (tools with the core only).
 * A kept estimate without current core numbers gets only those.
 */
export async function localEstimate(
  title: string,
  html: string,
  onProgress: (share: number) => void = () => {},
  signal?: AbortSignal,
  background = false,
  onCore: (result: CoreResult) => void = () => {}
): Promise<LocalEstimate | undefined> {
  const [kept, manifest] = await Promise.all([keptEstimate(title), installedTools('difficulty')]);

  if (!manifest) return kept;

  const etag = await analysisTag(html, manifest.version);

  if (kept?.etag === etag) {
    if (kept.core?.v === CORE_VERSION || !hasCore(manifest)) return kept;

    return once(`core ${title}`, onProgress, async () => {
      const { core } = await coreJob(html, manifest, signal, background, false);
      const estimate = { ...kept, core };

      await (await readerDb()).put('estimates', estimate);
      localEstimateSaved$.next(title);

      return estimate;
    });
  }

  return once(`words ${title}`, onProgress, (progress) =>
    makeEstimate(title, html, etag, manifest, progress, signal, background, onCore)
  );
}

function coreJob(
  html: string,
  manifest: AnalysisToolsManifest,
  signal: AbortSignal | undefined,
  background: boolean,
  python: boolean
) {
  return analyseBook(
    html,
    'core',
    manifest,
    false,
    () => {},
    signal,
    background,
    python
  ) as Promise<CoreResult>;
}

async function makeEstimate(
  title: string,
  html: string,
  etag: string,
  manifest: AnalysisToolsManifest,
  onProgress: (share: number) => void,
  signal: AbortSignal | undefined,
  background: boolean,
  onCore: (result: CoreResult) => void
) {
  // The core first, on the worker that then reads the word list (Pyodide loads meanwhile).
  const core = hasCore(manifest)
    ? await coreJob(html, manifest, signal, background, true).then((result) => {
        onCore(result);
        return result.core;
      })
    : undefined;
  const reader = usesReader('words', manifest, !!(await installedTools('furigana')));
  const result = (await analyseBook(
    html,
    'words',
    manifest,
    reader,
    (share) => onProgress(share * 0.95),
    signal,
    background
  )) as WordsResult;
  const estimate: LocalEstimate = {
    title,
    etag,
    characters: result.characters,
    uniqueKanji: result.uniqueKanji,
    uniqueWords: result.uniqueWords,
    tokens: result.tokens,
    engine: manifest.engine,
    computedAt: Date.now(),
    ...(core && { core })
  };
  const db = await readerDb();

  await db.put('wordLists', { title, etag, words: result.words, reader });
  await db.put('estimates', estimate);
  onProgress(1);
  localEstimateSaved$.next(title);

  return estimate;
}

export async function keptWordList(title: string) {
  return (await readerDb()).get('wordLists', title).catch(() => undefined);
}

/**
 * Generated furigana installed later: the book's current word list made without the Reader is
 * made again with it (its rows' readings in context; opt-in, never automatic). The estimate's
 * level stays (the core doesn't use the Reader); its word totals and `computedAt` change, so the
 * coverage caches keyed on it are redone. Undefined when there is nothing to redo.
 */
export async function redoWordList(
  title: string,
  html: string,
  onProgress: (share: number) => void = () => {},
  signal?: AbortSignal,
  background = false
): Promise<LocalEstimate | undefined> {
  const [kept, list, manifest, furigana] = await Promise.all([
    keptEstimate(title),
    keptWordList(title),
    installedTools('difficulty'),
    installedTools('furigana')
  ]);

  if (!manifest || !furigana || !kept || list?.reader !== false || list.etag !== kept.etag) {
    return undefined;
  }
  if (kept.etag !== (await analysisTag(html, manifest.version))) return undefined;

  return once(`words ${title}`, onProgress, async (progress) => {
    const result = (await analyseBook(
      html,
      'words',
      manifest,
      true,
      progress,
      signal,
      background
    )) as WordsResult;
    const estimate: LocalEstimate = {
      ...kept,
      uniqueWords: result.uniqueWords,
      tokens: result.tokens,
      computedAt: Date.now()
    };
    const db = await readerDb();

    await db.put('wordLists', { title, etag: kept.etag, words: result.words, reader: true });
    await db.put('estimates', estimate);
    localEstimateSaved$.next(title);

    return estimate;
  });
}

/** A local book's word list and its totals, from its kept estimate. */
export async function localWordList(
  title: string
): Promise<{ words: BookWord[]; totals: WordTotals; withoutReader: boolean } | undefined> {
  const db = await readerDb();
  const [estimate, list] = await Promise.all([
    db.get('estimates', title),
    db.get('wordLists', title)
  ]);

  if (!estimate || list?.etag !== estimate.etag) return undefined;

  return {
    words: foldReadings(list.words),
    totals: { uniqueWords: estimate.uniqueWords, tokens: estimate.tokens },
    withoutReader: list.reader === false
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
      true,
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

type ReaderBook = { title: string; elementHtml: string; storageSource?: string };

/** The reader opening a book: its analysis worker loads beside the sync and the first render. */
export function prewarmBook(book: ReaderBook) {
  if (book.elementHtml && readingsAvailable(book) === 'local') {
    prewarmAnalysis(
      book.title,
      book.elementHtml,
      generatedFurigana$.getValue() || unknownWordUnderline$.getValue() || chapterPrimer$.getValue()
    ).catch(() => {});
  }
}

/**
 * Local books with the analysis tools: the difficulty estimate and word list are made on open
 * (after the furigana, this module's queue).
 */
export function startLocalAnalysis(book: ReaderBook) {
  if (readingsAvailable(book) === 'local') {
    localEstimate(book.title, book.elementHtml).catch(() => {});
  }
}

/** The reader's readings file, while generated furigana, the unknown-word underlines or the chapter primer need it. */
export function readingsFor$(book: ReaderBook) {
  const source = readingsAvailable(book);

  return combineLatest([generatedFurigana$, unknownWordUnderline$, chapterPrimer$]).pipe(
    map((wanted) => wanted.some(Boolean)),
    distinctUntilChanged(),
    switchMap((on) => {
      if (!on || !source) return of(undefined);

      return source === 'server'
        ? generatedReadings$(book.title, true)
        : localReadings$(book.title, book.elementHtml);
    }),
    map((readings) => ({ title: book.title, readings }))
  );
}
