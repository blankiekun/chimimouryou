/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { expect, it, vi } from 'vitest';
// @ts-expect-error moduleResolution node10 doesn't read package exports (Vitest resolves it)
import { commands } from 'vitest/browser';
import {
  analysisDownload$,
  downloadAnalysisTools,
  installedTools,
  localEstimate,
  makeReadings
} from '$lib/data/analysis-tools';
import { readerDb } from '$lib/data/reader-db';
import type { AnalysisMessage } from './analysis.worker';
import type { ScoreMessage } from './analysis-score.worker';

/*
 * The analysis bench (`pnpm bench:analysis`, vitest.bench.config.js, results also in .analysis-bench/results.txt): the real tools in Chromium on
 * 坊っちゃん, timing each stage in fresh workers, then the whole job through analysis-tools.ts as
 * each device tier runs it (analysis-capacity.ts). Prints the median of RUNS runs. Not a test: never
 * in `pnpm test` or CI.
 */

// No background run of the stored books after the download.
vi.mock('$lib/data/background-analysis', () => ({ analyseStoredBooks: async () => {} }));

const RUNS = 3;
const base = new URL('/analysis-tools/', location.href).href;
const book = (name: string) =>
  fetch(`/analysis-bench-books/${name}.html`).then((response) => response.text());
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const seconds = (ms: number) => (ms / 1000).toFixed(2);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function ask<M extends { type: string }>(worker: Worker, request: unknown, done: M['type']) {
  return new Promise<M>((resolve, reject) => {
    worker.onerror = (event) => reject(new Error(event.message));
    worker.onmessage = ({ data }: MessageEvent<M>) => {
      if (data.type === 'error') reject(new Error((data as { message?: string }).message));
      else if (data.type === done) resolve(data);
    };
    worker.postMessage(request);
  });
}

async function clearAnalyses() {
  const db = await readerDb();

  for (const store of ['readings', 'estimates', 'wordLists'] as const) await db.clear(store);
}

function setMachine(cores: number, memory: number) {
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: cores, configurable: true });
  Object.defineProperty(navigator, 'deviceMemory', { value: memory, configurable: true });
}

const rows: Record<string, number[]> = {};
const lines: string[] = [];
const report = (line: string) => lines.push(line);
const record = (name: string, ms: number) => (rows[name] ??= []).push(ms);

it('times the analysis of a book', async () => {
  const installStart = performance.now();

  await downloadAnalysisTools(['difficulty', 'furigana']);
  expect(analysisDownload$.getValue()?.error).toBeUndefined();
  report(
    `Install (download from the local server, gunzip into OPFS): ${seconds(performance.now() - installStart)} s`
  );

  const manifest = (await installedTools('furigana'))!;
  const html = await book('botchan');
  const other = await book('ginga');
  const request = { base, manifest, html, wordsPerBook: 2000, reader: true };

  report(`Book: 坊っちゃん, ${html.replace(/<rt[^>]*>.*?<\/rt>|<[^>]+>/gs, '').length} characters`);

  // Stages: a fresh analysis worker and scoring worker each run, as a book opened cold.
  for (let run = 0; run < RUNS; run++) {
    const start = performance.now();
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    type Result = Extract<AnalysisMessage, { type: 'result' }>;
    const readings = await ask<Result>(worker, { ...request, part: 'readings' }, 'result');
    const words = await ask<Result>(worker, { ...request, part: 'words' }, 'result');
    const afterWords = performance.now();

    worker.terminate();

    const scorer = new Worker(new URL('./analysis-score.worker.ts', import.meta.url), {
      type: 'module'
    });
    const { features } = JSON.parse(words.json) as { features: number[] };
    const scoreStart = performance.now();

    await ask<ScoreMessage>(scorer, { base, features }, 'scores');

    const warmStart = performance.now();

    await ask<ScoreMessage>(scorer, { base, features }, 'scores');
    record('score: warm (3 models)', performance.now() - warmStart);
    record('score: cold (onnxruntime + 3 sessions)', warmStart - scoreStart);
    scorer.terminate();

    const r = readings.timings;
    const w = words.timings;

    record('load: Sudachi (wasm + 202 MB dictionary), beside Pyodide', r.sudachi);
    record('load: Pyodide boot', r.pyodide);
    record('load: analysis.zip + import browser', r.python);
    record('load: wall (the two in parallel)', r.load);
    record('reader pack', r.packs);
    record('readings part: Python (yurigana)', r.analyse - r.tokenize);
    record('readings part: Sudachi tokenize', r.tokenize);
    record('frequency pack', w.packs);
    record('words part: Python (yurigana + features)', w.analyse - w.tokenize);
    record('words part: Sudachi tokenize', w.tokenize);
    record('total: cold worker, both parts', afterWords - start);
    // Bytes / 1000: the seconds column then shows MB.
    record('worker after both parts: wasm memory (MB)', w.wasm / 1000);
  }

  // Tiers: the same book opened (readings, then the estimate) and a two-book background batch,
  // through analysis-tools.ts. Small: the worker ends after each book, one at a time; large: kept
  // 10 s, two at once. Each run starts cold (the kept workers are waited out).
  for (const [tier, cores] of [
    ['small (4 cores)', 4],
    ['large (8 cores, 8 GB)', 8]
  ] as const) {
    setMachine(cores, 8);
    for (let run = 0; run < RUNS; run++) {
      await clearAnalyses();

      const start = performance.now();

      expect(await makeReadings('botchan', html)).toBeTruthy();
      expect((await localEstimate('botchan', html))?.difficulty).toBeTypeOf('number');
      record(`${tier}: open a book (readings + estimate)`, performance.now() - start);
      await sleep(11_000);
      await clearAnalyses();

      const batch = performance.now();
      // Parts that failed, as background-analysis.ts skips them (two workers starting at once both
      // open the dictionary's OPFS file: read-only handles since this was found).
      let failed = 0;
      const tolerate = (part: Promise<unknown>) =>
        part.catch((error) => {
          failed++;
          console.warn(`${tier}, batch: ${(error as Error).message}`);
        });

      await Promise.all(
        Object.entries({ botchan: html, ginga: other }).map(async ([title, text]) => {
          await tolerate(makeReadings(title, text, undefined, undefined, true));
          await tolerate(localEstimate(title, text, undefined, undefined, true));
        })
      );
      record(`${tier}: background batch (2 books)`, performance.now() - batch);
      record(`${tier}: background batch, failed parts (count)`, failed * 1000);
      await sleep(11_000);
    }
  }

  const width = Math.max(...Object.keys(rows).map((name) => name.length));

  report(
    [
      `${'stage'.padEnd(width)}  median s  (runs)`,
      ...Object.entries(rows).map(
        ([name, values]) =>
          `${name.padEnd(width)}  ${seconds(median(values)).padStart(8)}  (${values.map(seconds).join(', ')})`
      )
    ].join('\n')
  );
  console.log(lines.join('\n'));
  // Vitest doesn't always pass the page's console on: also in .analysis-bench/results.txt
  await commands.writeFile('.analysis-bench/results.txt', `${lines.join('\n')}\n`);
});
