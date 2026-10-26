/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * A book's analysis (lib/data/analysis-tools.ts): Pyodide runs yurigana and the difficulty service's
 * own Python (scripts/calibre/jiten/browser.py), which asks Sudachi (wasm, SudachiDict-core read
 * into its memory, split mode C) for each text's tokens as it reads, giving the book's word list
 * (with the difficulty model's input) or its readings file in one pass. Both are loaded on the first
 * request and kept for the next ones, until the page ends the worker. Every file comes from the
 * tools' cache (`fetch` is routed through it). Not part of upstream.
 */

import {
  bookCore,
  chunks,
  coreText,
  countCharacters,
  parseCoreTable,
  tokensOf,
  type CoreNumbers,
  type CoreTable
} from './core';
import {
  importToolsModule,
  readRawInto,
  toolsFile,
  type AnalysisToolsManifest
} from './tools-files';

export interface AnalysisRequest {
  base: string;
  manifest: AnalysisToolsManifest;
  html: string;
  /**
   * browser.py's part: the word list and the difficulty model's input, or the readings file; or
   * `core` (core.ts: Sudachi and the core frequency list only, no Pyodide)
   */
  part: 'words' | 'readings' | 'core';
  wordsPerBook: number;
  /** Whether the part runs yurigana's Reader (usesReader in analysis-tools.ts) */
  reader: boolean;
  /** core: start loading Pyodide meanwhile (the book's word list follows) */
  python?: boolean;
}

/** Loads the tools without a book (prewarmAnalysis in analysis-tools.ts): the job that follows skips the ~2 s start */
export interface AnalysisLoad {
  base: string;
  manifest: AnalysisToolsManifest;
}

export type AnalysisMessage =
  /** The share of the book's text read so far; also shows the page's watchdog it is alive */
  | { type: 'progress'; share: number }
  /** browser.analyse's JSON; `timings`: where the request's time went (ms), for the analysis bench */
  | { type: 'result'; json: string; timings: Record<string, number> }
  | { type: 'error'; message: string };

const post = (message: AnalysisMessage) => self.postMessage(message);

/** Load times of the request that loaded the tools (analysis-bench.browser.ts) */
let loadTimes: Record<string, number> = {};
let sudachiMemory: WebAssembly.Memory | undefined;
const since = (start: number) => performance.now() - start;

let base = '';
const networkFetch = self.fetch.bind(self);

// Pyodide fetches its wasm, standard library and lock file itself.
self.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);

  return base && url.startsWith(base)
    ? toolsFile(base, url.slice(base.length))
    : networkFetch(input, init);
};

interface Morpheme {
  surface: string;
  dictionary_form: string;
  normalized_form: string;
  reading_form: string;
  poses: string[];
}

async function loadSudachi(manifest: AnalysisToolsManifest) {
  const start = performance.now();
  const bytes = manifest.files.find((file) => file.name === 'core.dic.gz')?.raw;

  if (!bytes) throw new Error('core.dic.gz: not in the tools');

  const glue = await importToolsModule(base, 'sudachi.js');
  const wasm = await glue.default({ module_or_path: await toolsFile(base, 'sudachi_bg.wasm') });
  const address = glue.dict_alloc(bytes);

  await readRawInto('core.dic.gz', new Uint8Array(wasm.memory.buffer, address, bytes));

  const sudachi = new glue.SudachiStateless();

  sudachi.initialize_from_ptr(address, bytes);
  sudachiMemory = wasm.memory;
  loadTimes.sudachi = since(start);

  // A text's morphemes as browser.py's BrowserTokens reads them: tokenize_rows builds the same
  // string in wasm; tools installed before it have only tokenize_raw.
  if (sudachi.tokenize_rows) return (text: string) => sudachi.tokenize_rows(text) as string;

  return (text: string) =>
    (sudachi.tokenize_raw(text, 2) as Morpheme[])
      .map((m) =>
        [m.surface, m.dictionary_form, m.normalized_form, m.reading_form, m.poses.join(',')].join(
          '\x1f'
        )
      )
      .join('\x1e');
}

/** The core's frequency list (build.sh's core-frequency.tsv.gz) */
let coreTable: Promise<CoreTable> | undefined;

async function loadCoreTable() {
  const start = performance.now();
  const response = await toolsFile(base, 'core-frequency.tsv.gz');
  const table = parseCoreTable(
    await new Response(
      response.body!.pipeThrough(
        new DecompressionStream('gzip') as ReadableWritablePair<Uint8Array, Uint8Array>
      )
    ).text()
  );

  loadTimes.coreTable = since(start);

  return table;
}

async function loadPython() {
  const start = performance.now();
  const { loadPyodide } = await importToolsModule(base, 'pyodide/pyodide.mjs');
  const asm = await importToolsModule(base, 'pyodide/pyodide.asm.mjs');
  const py = await loadPyodide({
    indexURL: new URL('pyodide/', base).href,
    createPyodideModule: asm.default
  });
  const booted = performance.now();

  loadTimes.pyodide = booted - start;

  py.unpackArchive(await (await toolsFile(base, 'analysis.zip')).arrayBuffer(), 'zip', {
    extractDir: '/home/pyodide/analysis'
  });
  py.runPython("import sys; sys.path.insert(0, '/home/pyodide/analysis')");

  const browser = py.pyimport('browser');

  loadTimes.python = since(booted);

  return { py, browser };
}

let sudachi: ReturnType<typeof loadSudachi> | undefined;
let python: ReturnType<typeof loadPython> | undefined;
const packed = new Set<string>();
/**
 * The last book's texts and their tokens: yurigana asks for most texts twice in a part, and the
 * book's other part asks for them again.
 */
let memo = { html: '', tokens: new Map<string, string>() };

/** Reads a pack once into the bytearray browser.py hands Packed instead of a file. */
async function loadPack(
  { py, browser }: Awaited<ReturnType<typeof loadPython>>,
  manifest: AnalysisToolsManifest,
  name: string,
  path: string
) {
  if (packed.has(name)) return;

  const size = manifest.files.find((file) => file.name === name)?.raw;

  if (!size) throw new Error(`${name}: not in the tools`);

  // Allocated first: it grows Pyodide's memory, which detaches the old HEAPU8 buffer.
  const address = browser.pack_buffer(path, size);

  await readRawInto(name, new Uint8Array(py._module.HEAPU8.buffer, address, size));
  packed.add(name);
}

self.onmessage = async ({ data }: MessageEvent<AnalysisRequest | AnalysisLoad>) => {
  try {
    const start = performance.now();

    base = data.base;
    sudachi ??= loadSudachi(data.manifest);
    // The core needs no Python: Pyodide starts only for browser.py's parts (or a load).
    if (!('part' in data) || data.part !== 'core' || data.python) python ??= loadPython();
    if (!('part' in data)) {
      // Load only: a failed load fails the job that follows (the same promises).
      Promise.all([sudachi, python]).catch(() => undefined);
      return;
    }
    if (memo.html !== data.html) memo = { html: data.html, tokens: new Map() };

    const { tokens } = memo;

    if (data.part === 'core') {
      const [tokenize, table] = await Promise.all([sudachi, (coreTable ??= loadCoreTable())]);
      const loaded = performance.now();
      const text = coreText(data.html);
      const bookTokens = [...chunks(text)].flatMap(([chunk, at]) => {
        let found = tokens.get(chunk);

        if (found === undefined) tokens.set(chunk, (found = tokenize(chunk)));

        return tokensOf(found, at);
      });
      const tokenized = performance.now();
      const core: CoreNumbers = bookCore(bookTokens, table);

      post({
        type: 'result',
        json: JSON.stringify({ core, characters: countCharacters(text) }),
        timings: {
          ...loadTimes,
          load: loaded - start,
          tokenize: tokenized - loaded,
          analyse: since(tokenized),
          wasm: sudachiMemory?.buffer.byteLength ?? 0
        }
      });
      loadTimes = {};
      return;
    }

    const [tokenize, py] = await Promise.all([sudachi, python!]);
    const loaded = performance.now();

    if (data.reader) {
      await loadPack(py, data.manifest, 'reader.ygp.gz', py.browser.READER_PACK);
    }
    // Only the word list ranks words.
    if (data.part === 'words') {
      await loadPack(py, data.manifest, 'frequency.ygp.gz', py.browser.FREQUENCY_PACK);
    }

    // Progress: the book's text met so far (texts asked for again, or words, add little).
    const length = data.html.replace(/<rt[^>]*>.*?<\/rt>|<[^>]+>/gs, '').length || 1;
    const seen = new Set<string>();
    let read = 0;
    let posted = 0;
    let tokenizing = 0;
    const packs = since(loaded);
    const analysing = performance.now();
    const json = py.browser.analyse(
      data.html,
      (text: string) => {
        if (!seen.has(text)) {
          seen.add(text);
          read += text.length;
        }
        if (Date.now() - posted > 2000) {
          posted = Date.now();
          post({ type: 'progress', share: Math.min(read / length, 0.99) });
        }

        let found = tokens.get(text);

        if (found === undefined) {
          const asked = performance.now();

          tokens.set(text, (found = tokenize(text)));
          tokenizing += since(asked);
        }

        return found;
      },
      data.part,
      data.wordsPerBook,
      // Only when false: browser.py from tools older than the flag takes four arguments.
      ...(data.reader ? [] : [false])
    );

    post({
      type: 'result',
      json,
      timings: {
        ...loadTimes,
        load: loaded - start,
        packs,
        analyse: since(analysing),
        tokenize: tokenizing,
        // Sudachi's and Pyodide's wasm memory (bytes): it only grows, so this is its peak so far.
        wasm: (sudachiMemory?.buffer.byteLength ?? 0) + py.py._module.HEAPU8.buffer.byteLength
      }
    });
    loadTimes = {};
  } catch (error) {
    post({ type: 'error', message: String((error as Error)?.message ?? JSON.stringify(error)) });
  }
};
