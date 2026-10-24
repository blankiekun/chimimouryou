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
  cancelCollectionImport,
  deleteAllDictionaries,
  deleteDictionary,
  getMedia,
  importDictionary,
  importDictionaryCollection,
  listDictionaries,
  lookup
} from './dictionary-engine';

export type DictionaryRequest =
  | { id: number; type: 'import'; file: Blob }
  | { id: number; type: 'importCollection'; file: Blob }
  | { id: number; type: 'cancelImport' }
  | { id: number; type: 'list' }
  | { id: number; type: 'delete'; name: string }
  | { id: number; type: 'deleteAll' }
  | { id: number; type: 'lookup'; text: string; options: ProfileOptions }
  | { id: number; type: 'media'; path: string; dictionary: string };

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
    case 'importCollection':
      return importDictionaryCollection(request.file, (done, total) =>
        post({ id: request.id, type: 'progress', done, total })
      );
    case 'cancelImport':
      return cancelCollectionImport();
    case 'list':
      return listDictionaries();
    case 'delete':
      return deleteDictionary(request.name);
    case 'deleteAll':
      return deleteAllDictionaries();
    case 'lookup':
      return lookup(request.text, request.options);
    case 'media':
      return getMedia(request.path, request.dictionary);
  }
}

self.onmessage = async ({ data }: MessageEvent<DictionaryRequest>) => {
  try {
    post({ id: data.id, type: 'result', value: await handle(data) });
  } catch (error: any) {
    post({ id: data.id, type: 'error', message: error?.message ?? String(error) });
  }
};
