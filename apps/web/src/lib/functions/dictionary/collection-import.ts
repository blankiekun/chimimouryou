/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Imports a Yomitan dictionary collection (Settings → Backup → Export Dictionary Collection: a
 * Dexie export of its `dict` database) into the built-in dictionary, streamed from the file so a
 * multi-GB collection never sits in memory. Unlike Yomitan's own import it adds to the installed
 * dictionaries instead of replacing them: ones already installed are skipped, and a cancelled or
 * failed import leaves nothing behind. The rows go into one pack in the origin private file system
 * (collection-store.ts), listed once it is complete. Runs in the dictionary worker. Not part of
 * upstream.
 */

import type { DictionarySummary } from '$lib/vendor/yomitan/dictionary/dictionary-importer';
import type { DictionaryStore } from './collection-store';
import { DexieJsonReader, type DexieHeader } from './dexie-json';

/** Yomitan's dictionary database version (IndexedDB's; Dexie exports it divided by 10). */
export const yomitanDatabaseVersion = 60;

const rowTables = new Set(['terms', 'termMeta', 'kanji', 'kanjiMeta', 'tagMeta', 'media']);

export class ImportCancelled extends Error {
  constructor() {
    super('Import cancelled');
  }
}

export interface CollectionResult {
  imported: DictionarySummary[];
  /** Titles already installed, left as they were */
  skipped: string[];
  /** Rows of dictionaries the collection doesn't list (left out) */
  orphanRows: number;
}

export function checkHeader(header: DexieHeader) {
  if (header.formatName !== 'dexie' || header.databaseName !== 'dict') {
    throw new Error(
      "This isn't a Yomitan dictionary collection (Yomitan: Settings → Backup → Export Dictionary Collection)."
    );
  }
  const version = Number(header.databaseVersion);
  if (!(version > 0)) throw new Error('The collection has no database version.');
  if (version * 10 > yomitanDatabaseVersion) {
    throw new Error(
      `This collection comes from a newer Yomitan (database version ${version}; this app reads up to ${yomitanDatabaseVersion / 10}). Update the app, or import the dictionaries one by one.`
    );
  }
}

export async function importCollection(
  database: DictionaryStore,
  file: Blob,
  onProgress: (read: number, total: number) => void,
  isCancelled: () => boolean
): Promise<CollectionResult> {
  const installed = new Set((await database.getDictionaryInfo()).map(({ title }) => title));
  const result: CollectionResult = { imported: [], skipped: [], orphanRows: 0 };
  const accepted = new Map<string, number>();
  const pack = await database.createPack();

  const reader = new DexieJsonReader({
    header: checkHeader,
    row(table, row, text) {
      if (table === 'dictionaries') {
        const summary = (Array.isArray(row) ? row[1] : row) as DictionarySummary;
        if (installed.has(summary.title) || accepted.has(summary.title)) {
          result.skipped.push(summary.title);
          return;
        }
        accepted.set(summary.title, accepted.size);
        result.imported.push(summary);
        return;
      }
      if (!rowTables.has(table)) return;
      const value = (Array.isArray(row) ? row[1] : row) as { dictionary: string };
      const dictionary = accepted.get(value.dictionary);
      if (dictionary === undefined) {
        if (!installed.has(value.dictionary)) result.orphanRows++;
        return;
      }
      pack.add(table, value, text, dictionary);
    }
  });

  try {
    const stream = file.stream().getReader();
    const decoder = new TextDecoder();
    let read = 0;
    for (;;) {
      if (isCancelled()) throw new ImportCancelled();
      const { value, done } = await stream.read();
      if (done) break;
      read += value.length;
      reader.push(decoder.decode(value, { stream: true }));
      await pack.drain();
      onProgress(read, file.size);
    }
    reader.push(decoder.decode());
    reader.end();
    await database.addPack(pack, result.imported);
  } catch (error) {
    await pack.abort().catch(() => undefined);
    throw error;
  }
  return result;
}
