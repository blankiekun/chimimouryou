/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The built-in dictionary's worker (dictionary-engine.ts): imports and lookups run here so a
 * 100 MB dictionary doesn't stall the page. One request at a time per id; lib/data/dictionary.ts
 * is the only caller. Not part of upstream.
 */

import type { ProfileOptions } from '$lib/vendor/yomitan/types/settings';
import {
  deleteAllDictionaries,
  deleteDictionary,
  importDictionary,
  listDictionaries,
  lookup
} from './dictionary-engine';

export type DictionaryRequest =
  | { id: number; type: 'import'; file: Blob }
  | { id: number; type: 'list' }
  | { id: number; type: 'delete'; name: string }
  | { id: number; type: 'deleteAll' }
  | { id: number; type: 'lookup'; text: string; options: ProfileOptions };

export type DictionaryResponse =
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'result'; value: unknown }
  | { id: number; type: 'error'; message: string };

const post = (message: DictionaryResponse) => self.postMessage(message);

async function handle(request: DictionaryRequest) {
  switch (request.type) {
    case 'import':
      return importDictionary(await request.file.arrayBuffer(), (done, total) =>
        post({ id: request.id, type: 'progress', done, total })
      );
    case 'list':
      return listDictionaries();
    case 'delete':
      return deleteDictionary(request.name);
    case 'deleteAll':
      return deleteAllDictionaries();
    case 'lookup':
      return lookup(request.text, request.options);
  }
}

self.onmessage = async ({ data }: MessageEvent<DictionaryRequest>) => {
  try {
    post({ id: data.id, type: 'result', value: await handle(data) });
  } catch (error: any) {
    post({ id: data.id, type: 'error', message: error?.message ?? String(error) });
  }
};
