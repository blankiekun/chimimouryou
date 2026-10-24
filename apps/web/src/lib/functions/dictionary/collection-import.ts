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
 * failed import removes the dictionaries it had started. Runs in the dictionary worker. Not part
 * of upstream.
 */

import type { DictionarySummary } from '$lib/vendor/yomitan/dictionary/dictionary-importer';
import type { DictionaryDatabase } from '$lib/vendor/yomitan/dictionary/dictionary-database';
import { DexieJsonReader, type DexieHeader } from './dexie-json';

/** Yomitan's dictionary database version (IndexedDB's; Dexie exports it divided by 10). */
export const yomitanDatabaseVersion = 60;

const rowTables = new Set(['terms', 'termMeta', 'kanji', 'kanjiMeta', 'tagMeta', 'media']);
const batchRows = 1000;
const batchChars = 4_000_000;

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
  database: DictionaryDatabase,
  file: Blob,
  onProgress: (read: number, total: number) => void,
  isCancelled: () => boolean
): Promise<CollectionResult> {
  const installed = new Set((await database.getDictionaryInfo()).map(({ title }) => title));
  const result: CollectionResult = { imported: [], skipped: [], orphanRows: 0 };
  const accepted = new Set<string>();

  let batch: { table: string; rows: any[]; chars: number } = { table: '', rows: [], chars: 0 };
  const ready: (typeof batch)[] = [];
  const cut = () => {
    if (batch.rows.length) ready.push(batch);
    batch = { table: batch.table, rows: [], chars: 0 };
  };

  const reader = new DexieJsonReader({
    header: checkHeader,
    row(table, row, size) {
      if (table !== batch.table) {
        cut();
        batch.table = table;
      }
      if (table === 'dictionaries') {
        const summary = (Array.isArray(row) ? row[1] : row) as DictionarySummary;
        if (installed.has(summary.title)) {
          result.skipped.push(summary.title);
          return;
        }
        accepted.add(summary.title);
        result.imported.push(summary);
        row = summary;
      } else {
        if (!rowTables.has(table)) return;
        const value = (Array.isArray(row) ? row[1] : row) as { dictionary: string; id?: number };
        if (!accepted.has(value.dictionary)) {
          if (!installed.has(value.dictionary)) result.orphanRows++;
          return;
        }
        delete value.id; // a new key here
        row = value;
      }
      batch.rows.push(row);
      batch.chars += size;
      if (batch.rows.length >= batchRows || batch.chars >= batchChars) cut();
    }
  });

  // One write in flight while the next text is parsed.
  let writing: Promise<void> = Promise.resolve();
  const write = async () => {
    while (ready.length) {
      const { table, rows } = ready.shift()!;
      await writing;
      writing = database.bulkAdd(table, rows, 0, rows.length);
    }
  };

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
      await write();
      onProgress(read, file.size);
    }
    reader.push(decoder.decode());
    reader.end();
    cut();
    await write();
    await writing;
  } catch (error) {
    await writing.catch(() => undefined);
    for (const title of accepted) await database.deleteDictionary(title, 1000, () => undefined);
    throw error;
  }
  return result;
}
