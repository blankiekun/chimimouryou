/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The built-in dictionary (lib/data/dictionary.ts): Yomitan's database, importer and translator
 * (lib/vendor/yomitan, GPL-3.0-or-later) wired together without the extension's backend. Runs in
 * dictionary.worker.ts; the tests call it directly. Not part of upstream.
 */

import { DictionaryDatabase } from '$lib/vendor/yomitan/dictionary/dictionary-database';
import {
  DictionaryImporter,
  type DictionarySummary,
  type MediaLoader
} from '$lib/vendor/yomitan/dictionary/dictionary-importer';
import { Translator } from '$lib/vendor/yomitan/language/translator';
import { getTranslatorFindTermsOptions } from '$lib/vendor/yomitan/background/find-terms-options';
import type { ProfileOptions } from '$lib/vendor/yomitan/types/settings';
import type { TermDictionaryEntry } from '$lib/vendor/yomitan/types/dictionary';

/** The Yomitan release the engine was ported from (lib/vendor/yomitan/README.md). */
export const yomitanVersion = '26.10.12.0';

export interface LookupResult {
  dictionaryEntries: TermDictionaryEntry[];
  /** Characters of the text the longest match covers */
  originalTextLength: number;
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

let database: DictionaryDatabase | undefined;
let translator: Translator | undefined;

async function ready() {
  if (!database) {
    const db = new DictionaryDatabase();
    await db.prepare();
    const tr = new Translator(db);
    tr.prepare();
    database = db;
    translator = tr;
  }
  return { database, translator: translator as Translator };
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
 * Terms at the start of `text`, longest match first, as Yomitan's `termsFind` API returns them
 * (backend.js `_onApiTermsFind`): deinflected, with frequencies and pitch accents.
 */
export async function lookup(text: string, options: ProfileOptions): Promise<LookupResult> {
  const { translator } = await ready();
  const {
    general: { resultOutputMode: mode, maxResults }
  } = options;
  const findTermsOptions = getTranslatorFindTermsOptions(mode, {}, options);
  const { dictionaryEntries, originalTextLength } = await translator.findTerms(
    mode,
    text,
    findTermsOptions
  );
  dictionaryEntries.splice(maxResults);
  return { dictionaryEntries, originalTextLength };
}
