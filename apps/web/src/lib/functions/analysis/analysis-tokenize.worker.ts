/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Stage 1 of a book's analysis (lib/data/analysis-tools.ts): Sudachi (wasm, SudachiDict-core
 * read into its memory) tokenizes the texts asked for, split mode C, appending each one's
 * rows to the analysis' token file (tools-files.ts) as it goes, so no copy of them stays in
 * memory. The page then ends the worker, which frees the dictionary before Pyodide starts
 * (analysis-read.worker.ts). Not part of upstream.
 */

import { importToolsModule, openTokenFile, readRawInto, toolsFile } from './tools-files';

export interface TokenizeRequest {
  base: string;
  dictionaryBytes: number;
  tokenFile: string;
  texts: string[];
  /** Also the dictionary forms and kanji + い/え met: yurigana and the Analyzer ask for them later */
  expand: boolean;
}

export type TokenizeMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done' }
  | { type: 'error'; message: string };

const post = (message: TokenizeMessage) => self.postMessage(message);

interface Morpheme {
  surface: string;
  dictionary_form: string;
  normalized_form: string;
  reading_form: string;
  poses: string[];
}

self.onmessage = async ({ data }: MessageEvent<TokenizeRequest>) => {
  let file: Awaited<ReturnType<typeof openTokenFile>> | undefined;

  try {
    const glue = await importToolsModule(data.base, 'sudachi.js');
    const wasm = await glue.default({
      module_or_path: await toolsFile(data.base, 'sudachi_bg.wasm')
    });
    const address = glue.dict_alloc(data.dictionaryBytes);

    await readRawInto(
      'core.dic.gz',
      new Uint8Array(wasm.memory.buffer, address, data.dictionaryBytes)
    );

    const sudachi = new glue.SudachiStateless();

    sudachi.initialize_from_ptr(address, data.dictionaryBytes);
    file = await openTokenFile(data.tokenFile);

    const done = new Set<string>();
    const tokenize = (text: string) => {
      const morphemes: Morpheme[] = sudachi.tokenize_raw(text, 2);

      done.add(text);
      file!.append(
        text,
        morphemes
          .map((m) =>
            [
              m.surface,
              m.dictionary_form,
              m.normalized_form,
              m.reading_form,
              m.poses.join(',')
            ].join('\x1f')
          )
          .join('\x1e')
      );

      return morphemes;
    };
    const more = new Set<string>();

    data.texts.forEach((text, index) => {
      for (const m of tokenize(text)) {
        if (!data.expand) continue;
        if (m.dictionary_form !== m.surface) more.add(m.dictionary_form);
        if (m.surface.length === 1) more.add(`${m.surface}い`).add(`${m.surface}え`);
      }
      if (index % 200 === 0) post({ type: 'progress', done: index, total: data.texts.length });
    });
    more.forEach((text) => done.has(text) || tokenize(text));
    file.close();
    post({ type: 'done' });
  } catch (error) {
    file?.close();
    post({ type: 'error', message: String((error as Error)?.message ?? JSON.stringify(error)) });
  }
};
