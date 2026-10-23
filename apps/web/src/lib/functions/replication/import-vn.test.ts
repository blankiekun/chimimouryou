/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { File as NodeFile } from 'node:buffer';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter, configure } from '@zip.js/zip.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageKey } from '$lib/data/storage/storage-types';
import type { BytesProgress } from '$lib/functions/replication/replication-progress';

vi.mock('$lib/data/background-analysis', () => ({ analyseInBackground: vi.fn() }));

const { getStorageHandler } = await import('$lib/data/storage/storage-handler-factory');
const { database } = await import('$lib/data/store');
const { importData } = await import('$lib/functions/replication/replicator');
const { default: loadCbz } = await import('$lib/functions/file-loaders/cbz/load-cbz');
const { replicationProgress$ } = await import('$lib/functions/replication/replication-progress');
const { vnBatch, dropOrphanVnFiles, putVnFiles } = await import('$lib/data/database/vn-files');

const MB = 64 * 1024;

vnBatch.bytes = 16 * MB;
/** A game a little over two save batches: a script and 64 KB files */
const fileCount = Math.ceil((2 * vnBatch.bytes) / MB) + 4;

function gameFiles() {
  const script = new File(['*define\nこんにちは'], '0.txt');
  // jsdom's Blob has no arrayBuffer().
  Object.defineProperty(script, 'arrayBuffer', {
    value: async () => new TextEncoder().encode('*define\nこんにちは').buffer
  });

  const files: Record<string, File> = { '0.txt': script };

  for (let index = 0; index < fileCount; index += 1) {
    files[`arc/${index}.png`] = new File([new Uint8Array(MB)], `${index}.png`);
  }

  return files;
}

const folder = () => {
  const files = gameFiles();

  return {
    name: 'game',
    size: Object.values(files).reduce((sum, file) => sum + file.size, 0),
    files
  };
};

/** Node's File: zip.js can't read jsdom's */
async function gameZip() {
  const writer = new ZipWriter(new Uint8ArrayWriter());

  await writer.add('game/0.txt', new Uint8ArrayReader(new TextEncoder().encode('*define\n本')));

  for (let index = 0; index < fileCount; index += 1) {
    await writer.add(`game/arc/${index}.png`, new Uint8ArrayReader(new Uint8Array(MB)), {
      level: 0
    });
  }

  return new NodeFile([await writer.close()], 'game.zip') as unknown as File;
}

async function storedFileKeys() {
  const db = await openDB('chimi-vn-files', 1);
  const keys = await db.getAllKeys('files');

  db.close();
  return keys;
}

const browser = () => getStorageHandler(window, StorageKey.BROWSER, '');

function recordBytes() {
  const events: BytesProgress[] = [];
  const subscription = replicationProgress$.subscribe(({ bytes }) => bytes && events.push(bytes));

  return { events, stop: () => subscription.unsubscribe() };
}

beforeEach(async () => {
  // After load-cbz's initZipSettings
  configure({ useWebWorkers: false });
  await (await database.db).clear('data');
  await dropOrphanVnFiles(new Set(), Date.now() + 2 * 24 * 3600 * 1000);
});

describe('importing a large visual novel', () => {
  it('reports monotonic bytes while reading and saving, and stores the files apart', async () => {
    const { events, stop } = recordBytes();
    // The import's two steps (importData tells ZIPs by jsdom's File class)
    const book = await loadCbz(await gameZip(), 1, new AbortController().signal);

    await browser().saveBook(book, false, undefined, new AbortController().signal);
    stop();

    const phases = [...new Set(events.map((event) => event.phase))];

    expect(phases).toEqual(['reading', 'saving']);

    for (const phase of phases) {
      const done = events.filter((event) => event.phase === phase).map((event) => event.done);

      expect(done).toEqual([...done].sort((a, b) => a - b));
      expect(done.at(-1)).toBe(events.find((event) => event.phase === phase)!.total);
    }

    // The library reads the records whole: a visual novel's holds no files.
    const [record] = await (await database.db).getAll('data');

    expect(record.title).toBe('game');
    expect(record.blobs).toEqual({});
    expect(record.vnFiles).toBeTruthy();
    expect(Object.keys(await database.getBlobs(record))).toHaveLength(fileCount + 1);
  });

  it('leaves neither a book nor files when cancelled while saving', async () => {
    const controller = new AbortController();
    const subscription = replicationProgress$.subscribe(({ bytes }) => {
      if (bytes?.phase === 'saving' && bytes.done > 0) controller.abort();
    });
    const error = await importData(document, browser(), [folder()], controller.signal);

    subscription.unsubscribe();
    expect(controller.signal.aborted).toBe(true);
    expect(error).toBe('');
    expect(await (await database.db).getAll('data')).toEqual([]);
    expect(await storedFileKeys()).toEqual([]);
  });

  it('deletes the files with the book', async () => {
    expect(await importData(document, browser(), [folder()], new AbortController().signal)).toBe(
      ''
    );

    const [record] = await (await database.db).getAll('data');

    await database.deleteData(
      [record.id],
      new Map([[record.id, record.title]]),
      new AbortController().signal,
      false
    );
    expect(await storedFileKeys()).toEqual([]);
  });
});

describe('tidying visual novel files', () => {
  it('moves the files of a visual novel stored the old way out of its record', async () => {
    const db = await database.db;

    await db.add('data', {
      title: 'old',
      styleSheet: '',
      elementHtml: '<!--ttu-vn-->{"encoding":"sjis","files":["0.txt"]}',
      blobs: { '0.txt': new Blob(['x']) },
      hasThumb: false,
      characters: 1,
      lastBookModified: 1,
      lastBookOpen: 0,
      storageSource: 'My Drive'
    } as any);
    await database.tidyVnFiles();

    const [record] = await db.getAll('data');

    expect(record.blobs).toEqual({});
    expect(record.storageSource).toBe('My Drive');
    expect(Object.keys(await database.getBlobs(record))).toEqual(['0.txt']);
  });

  it('drops files no book points to once they are a day old', async () => {
    const key = await putVnFiles({ a: new Blob(['a']) });

    expect(await dropOrphanVnFiles(new Set())).toEqual([]);
    expect(await dropOrphanVnFiles(new Set([key]), Date.now() + 2 * 24 * 3600 * 1000)).toEqual([]);
    expect(await dropOrphanVnFiles(new Set(), Date.now() + 2 * 24 * 3600 * 1000)).toEqual([key]);
    expect(await storedFileKeys()).toEqual([]);
  });
});
