/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Stage 2 of a book's analysis (lib/data/analysis-tools.ts): Pyodide runs yurigana and the
 * difficulty service's own Python (scripts/calibre/jiten/browser.py) over the tokens stage 1 made,
 * giving the book's word list and readings file, or the texts it still needs tokenized. Every file
 * comes from the tools' cache (`fetch` is routed through it). Not part of upstream.
 */

import {
  importToolsModule,
  openTokenIndex,
  readRawInto,
  toolsFile,
  type AnalysisToolsManifest
} from './tools-files';

export interface ReadRequest {
  base: string;
  manifest: AnalysisToolsManifest;
  html: string;
  /** Stage 1's token file; none for the first call, which only lists the texts to tokenize */
  tokenFile?: string;
  wordsPerBook: number;
}

export type ReadMessage =
  | { type: 'loaded' }
  | { type: 'texts'; texts: string[] }
  /** browser.analyse's JSON */
  | { type: 'result'; json: string }
  | { type: 'error'; message: string };

const post = (message: ReadMessage) => self.postMessage(message);

let base = '';
const networkFetch = self.fetch.bind(self);

// Pyodide fetches its wasm, standard library and lock file itself.
self.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);

  return base && url.startsWith(base)
    ? toolsFile(base, url.slice(base.length))
    : networkFetch(input, init);
};

async function loadPython(manifest: AnalysisToolsManifest) {
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

  return { py, browser: py.pyimport('browser'), manifest };
}

/** Reads the packs into the bytearrays browser.py hands Packed instead of files. */
async function loadPacks({ py, browser, manifest }: Awaited<ReturnType<typeof loadPython>>) {
  for (const [name, path] of [
    ['reader.ygp.gz', browser.READER_PACK],
    ['frequency.ygp.gz', browser.FREQUENCY_PACK]
  ]) {
    const size = manifest.files.find((file) => file.name === name)?.raw;

    if (!size) throw new Error(`${name}: not in the tools`);

    const address = browser.pack_buffer(path, size);

    await readRawInto(name, new Uint8Array(py._module.HEAPU8.buffer, address, size));
  }
}

self.onmessage = async ({ data }: MessageEvent<ReadRequest>) => {
  try {
    base = data.base;

    const python = await loadPython(data.manifest);

    if (!data.tokenFile) {
      post({ type: 'texts', texts: python.browser.first_texts(data.html).toJs() });
      return;
    }

    await loadPacks(python);
    post({ type: 'loaded' });

    const tokens = await openTokenIndex(data.tokenFile);
    // undefined is None in Python: a text not tokenized yet
    const json = python.browser.analyse(
      data.html,
      (text: string) => tokens.get(text),
      data.wordsPerBook
    );

    tokens.close();

    post({ type: 'result', json });
  } catch (error) {
    post({ type: 'error', message: String((error as Error)?.message ?? error) });
  }
};
