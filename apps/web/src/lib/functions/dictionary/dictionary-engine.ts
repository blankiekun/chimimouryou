/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The built-in dictionary (lib/data/dictionary/dictionary.ts): Yomitan's database, importer and translator
 * (lib/vendor/yomitan, GPL-3.0-or-later) wired together without the extension's backend. Runs in
 * dictionary.worker.ts; the tests call it directly. Not part of upstream.
 */

import { importCollection } from './collection-import';
import { DictionaryStore } from './collection-store';
import {
  DictionaryImporter,
  type DictionarySummary,
  type MediaLoader
} from '$lib/vendor/yomitan/dictionary/dictionary-importer';
import { Translator } from '$lib/vendor/yomitan/language/translator';
import {
  getTranslatorFindKanjiOptions,
  getTranslatorFindTermsOptions
} from '$lib/vendor/yomitan/background/find-terms-options';
import type { ProfileOptions } from '$lib/vendor/yomitan/types/settings';
import type {
  KanjiDictionaryEntry,
  TermDictionaryEntry
} from '$lib/vendor/yomitan/types/dictionary';

/** The Yomitan release the engine was ported from (lib/vendor/yomitan/README.md). */
export const yomitanVersion = '26.10.12.0';

export type LookupResult =
  | {
      type: 'terms';
      dictionaryEntries: TermDictionaryEntry[];
      /** Characters of the text the longest match covers */
      originalTextLength: number;
    }
  | { type: 'kanji'; dictionaryEntries: KanjiDictionaryEntry[]; originalTextLength: number };

/** What a scanning input searches for (Yomitan's `searchTerms`, `searchKanji`, `matchTypePrefix`). */
export interface LookupSearch {
  searchTerms?: boolean;
  searchKanji?: boolean;
  matchType?: 'exact' | 'prefix';
}

/** Image sizes for structured-content images, as Yomitan's media loader reads them. */
const mediaLoader: MediaLoader = {
  async getImageDetails(content, mediaType) {
    const bitmap = await createImageBitmap(new Blob([content], { type: mediaType }));
    const { width, height } = bitmap;
    bitmap.close();
    return { content, width, height };
  }
};

let engine: Promise<{ database: DictionaryStore; translator: Translator }> | undefined;

/** One store and translator, however many calls come first; a failed setup is tried again. */
function ready() {
  engine ??= (async () => {
    const database = new DictionaryStore();
    await database.prepare();
    const translator = new Translator(database);
    translator.prepare();
    return { database, translator };
  })().catch((error) => {
    engine = undefined;
    throw error;
  });
  return engine;
}

export async function importDictionary(
  archive: ArrayBuffer,
  onProgress: (done: number, total: number) => void
) {
  const { database, translator } = await ready();
  const importer = new DictionaryImporter(mediaLoader, ({ index, count }) =>
    onProgress(index, count)
  );
  const { result, errors } = await importer.importDictionary(database, archive, {
    prefixWildcardsSupported: false,
    yomitanVersion
  });
  translator.clearDatabaseCaches();
  return { result, errors: errors.map((error) => error.message) };
}

let collectionCancelled = false;

/** Imports a Yomitan dictionary collection export (collection-import.ts), streamed. */
export async function importDictionaryCollection(
  file: Blob,
  onProgress: (read: number, total: number) => void
) {
  const { database, translator } = await ready();
  collectionCancelled = false;
  try {
    return await importCollection(database, file, onProgress, () => collectionCancelled);
  } finally {
    translator.clearDatabaseCaches();
  }
}

export function cancelCollectionImport() {
  collectionCancelled = true;
}

export async function listDictionaries(): Promise<DictionarySummary[]> {
  return (await ready()).database.getDictionaryInfo();
}

export async function deleteDictionary(name: string) {
  const { database, translator } = await ready();
  await database.deleteDictionary(name, 1000, () => undefined);
  translator.clearDatabaseCaches();
}

export async function deleteAllDictionaries() {
  const { database, translator } = await ready();
  await database.purge();
  translator.clearDatabaseCaches();
}

/** A structured-content image or other file from a dictionary, as a Blob (null if missing). */
export async function getMedia(path: string, dictionary: string) {
  const [media] = await (await ready()).database.getMedia([{ path, dictionary }]);
  return media ? new Blob([media.content], { type: media.mediaType }) : null;
}

/**
 * What Yomitan's TextScanner finds at the start of `text` (`_findDictionaryEntries`): terms
 * (`termsFind`: deinflected, with frequencies and pitch accents, longest match first) and, when
 * none match, the first character's kanji (`kanjiFind`).
 */
export async function lookup(
  text: string,
  options: ProfileOptions,
  { searchTerms = true, searchKanji = true, matchType = 'exact' }: LookupSearch = {}
): Promise<LookupResult> {
  const { translator } = await ready();
  const {
    general: { resultOutputMode: mode, maxResults }
  } = options;
  if (searchTerms) {
    const findTermsOptions = getTranslatorFindTermsOptions(mode, { matchType }, options);
    const { dictionaryEntries, originalTextLength } = await translator.findTerms(
      mode,
      text,
      findTermsOptions
    );
    const sorted = demoteUnlikely(dictionaryEntries).slice(0, maxResults);
    if (sorted.length) {
      return {
        type: 'terms',
        dictionaryEntries: sorted,
        originalTextLength: sorted[0].maxOriginalTextLength ?? originalTextLength
      };
    }
  }
  const [character] = text;
  if (searchKanji && character) {
    const entries = await translator.findKanji(character, getTranslatorFindKanjiOptions(options));
    if (entries.length) {
      return {
        type: 'kanji',
        dictionaryEntries: entries.slice(0, maxResults),
        originalTextLength: 1
      };
    }
  }
  return { type: 'terms', dictionaryEntries: [], originalTextLength: 0 };
}

const kanji = /[\u3400-\u9fff\uf900-\ufaff々]/;
const kanaOnly = /^[\u3040-\u30ff]+$/;
const katakanaOnly = /^[\u30a0-\u30ff]+$/;

/**
 * Yomitan ranks ties by frequency, which many dictionaries lack (Wiktionary's, measured), so
 * entries a reader rarely means can come first (stable re-sort, measured on Aozora Bunko texts):
 * - a kanji word with no reading (reading = term) or a kanji's on'yomi in katakana (口[ク]) goes
 *   after the other entries of the same length;
 * - a name matched from kana (ことは → 詞葉) goes after every other entry.
 */
function demoteUnlikely(entries: TermDictionaryEntry[]) {
  const rank = (entry: TermDictionaryEntry) => {
    const { term, reading, sources } = entry.headwords[0];
    const name = entry.definitions.every(({ tags }) => tags.some((tag) => tag.name === 'name'));
    if (name && sources.every(({ originalText }) => kanaOnly.test(originalText))) return 2;
    const noReading = reading === term && kanji.test(term);
    const onyomi = katakanaOnly.test(reading) && !/[\u3040-\u30ff]/.test(term);
    return noReading || onyomi ? 1 : 0;
  };
  const ranked = entries.map((entry, index) => ({ entry, index, rank: rank(entry) }));
  ranked.sort(
    (a, b) =>
      Number(a.rank === 2) - Number(b.rank === 2) ||
      (a.rank !== 2 && b.rank !== 2
        ? b.entry.maxOriginalTextLength - a.entry.maxOriginalTextLength || a.rank - b.rank
        : 0) ||
      a.index - b.index
  );
  return ranked.map(({ entry }) => entry);
}
