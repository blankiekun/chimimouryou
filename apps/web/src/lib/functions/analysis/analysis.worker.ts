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
  importToolsModule,
  readRawInto,
  toolsFile,
  type AnalysisToolsManifest
} from './tools-files';

export interface AnalysisRequest {
  base: string;
  manifest: AnalysisToolsManifest;
  html: string;
  /** browser.py's part: the word list and the difficulty model's input, or the readings file */
  part: 'words' | 'readings';
  wordsPerBook: number;
}

export type AnalysisMessage =
  /** The share of the book's text read so far; also shows the page's watchdog it is alive */
  | { type: 'progress'; share: number }
  /** browser.analyse's JSON */
  | { type: 'result'; json: string }
  | { type: 'error'; message: string };

const post = (message: AnalysisMessage) => self.postMessage(message);

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
  const bytes = manifest.files.find((file) => file.name === 'core.dic.gz')?.raw;

  if (!bytes) throw new Error('core.dic.gz: not in the tools');

  const glue = await importToolsModule(base, 'sudachi.js');
  const wasm = await glue.default({ module_or_path: await toolsFile(base, 'sudachi_bg.wasm') });
  const address = glue.dict_alloc(bytes);

  await readRawInto('core.dic.gz', new Uint8Array(wasm.memory.buffer, address, bytes));

  const sudachi = new glue.SudachiStateless();

  sudachi.initialize_from_ptr(address, bytes);

  // A text's morphemes as browser.py's BrowserTokens reads them
  return (text: string) =>
    (sudachi.tokenize_raw(text, 2) as Morpheme[])
      .map((m) =>
        [m.surface, m.dictionary_form, m.normalized_form, m.reading_form, m.poses.join(',')].join(
          '\x1f'
        )
      )
      .join('\x1e');
}

async function loadPython() {
  const { loadPyodide } = await importToolsModule(base, 'pyodide/pyodide.mjs');
  const asm = await importToolsModule(base, 'pyodide/pyodide.asm.mjs');
  const py = await loadPyodide({
    indexURL: new URL('pyodide/', base).href,
    createPyodideModule: asm.default
  });

  py.unpackArchive(await (await toolsFile(base, 'analysis.zip')).arrayBuffer(), 'zip', {
    extractDir: '/home/pyodide/analysis'
  });
  py.runPython("import sys; sys.path.insert(0, '/home/pyodide/analysis')");

  return { py, browser: py.pyimport('browser') };
}

let tools: Promise<
  [Awaited<ReturnType<typeof loadSudachi>>, Awaited<ReturnType<typeof loadPython>>]
>;
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

self.onmessage = async ({ data }: MessageEvent<AnalysisRequest>) => {
  try {
    base = data.base;
    tools ??= Promise.all([loadSudachi(data.manifest), loadPython()]);

    const [tokenize, python] = await tools;

    await loadPack(python, data.manifest, 'reader.ygp.gz', python.browser.READER_PACK);
    // Only the word list ranks words.
    if (data.part === 'words') {
      await loadPack(python, data.manifest, 'frequency.ygp.gz', python.browser.FREQUENCY_PACK);
    }

    // Progress: the book's text met so far (texts asked for again, or words, add little).
    const length = data.html.replace(/<rt[^>]*>.*?<\/rt>|<[^>]+>/gs, '').length || 1;
    if (memo.html !== data.html) memo = { html: data.html, tokens: new Map() };

    const { tokens } = memo;
    const seen = new Set<string>();
    let read = 0;
    let posted = 0;
    const json = python.browser.analyse(
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

        if (found === undefined) tokens.set(text, (found = tokenize(text)));

        return found;
      },
      data.part,
      data.wordsPerBook
    );

    post({ type: 'result', json });
  } catch (error) {
    post({ type: 'error', message: String((error as Error)?.message ?? JSON.stringify(error)) });
  }
};
