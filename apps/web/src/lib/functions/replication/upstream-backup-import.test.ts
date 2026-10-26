/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { File as NodeFile } from 'node:buffer';
import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
  configure
} from '@zip.js/zip.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { StorageKey } from '$lib/data/storage/storage-types';

vi.mock('$lib/data/background-analysis', () => ({ analyseInBackground: vi.fn() }));

const { getStorageHandler } = await import('$lib/data/storage/storage-handler-factory');
const { database } = await import('$lib/data/store');
const { importBackup } = await import('$lib/functions/replication/replicator');

// A 1x1 PNG: the cover and the book's one image
const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  ),
  (c) => c.charCodeAt(0)
);
const title = '吾輩は猫である: 上';
// sanitizeForFilename: ':' is URI-encoded
const folder = '吾輩は猫である%3A 上';

/** A backup as ッツ Reader (upstream, exporterVersion 1, DB version 6) writes it in backup-handler.ts */
async function upstreamBackup() {
  const book = new ZipWriter(new Uint8ArrayWriter());

  await book.add('blobs/image0.png', new Uint8ArrayReader(png));
  await book.add('cover.png', new Uint8ArrayReader(png));
  await book.add(
    'staticdata.json',
    new TextReader(
      JSON.stringify({
        title,
        styleSheet: '.a{}',
        elementHtml:
          '<div id="ttu-0"><p>吾輩は猫である。</p><img src="ttu:image0.png"></div><div id="ttu-1"><p>名前はまだ無い。</p></div>',
        sections: [
          {
            reference: 'ttu-0',
            charactersWeight: 7,
            label: '一',
            startCharacter: 0,
            characters: 7
          },
          { reference: 'ttu-1', charactersWeight: 7, label: '二', startCharacter: 7, characters: 7 }
        ]
      })
    )
  );

  const statistics = [
    {
      title,
      dateKey: '2026-10-01',
      charactersRead: 7,
      readingTime: 60,
      minReadingSpeed: 420,
      altMinReadingSpeed: 420,
      lastReadingSpeed: 420,
      maxReadingSpeed: 420,
      lastStatisticModified: 1700000002000
    }
  ];
  const goals = [
    {
      timeGoal: 3600,
      characterGoal: 0,
      goalFrequency: 'daily',
      goalStartDate: '2026-10-01',
      goalEndDate: '',
      goalOriginalEndDate: '',
      lastGoalModified: 1700000003000
    }
  ];
  const backup = new ZipWriter(new Uint8ArrayWriter());

  await backup.add(
    `${folder}/bookdata_1_6_14_1700000000000_1700000001000.zip`,
    new Uint8ArrayReader(await book.close())
  );
  await backup.add(
    `${folder}/progress_1_6_1700000001500_0.5.json`,
    new TextReader(
      JSON.stringify({
        dataId: 42,
        exploredCharCount: 7,
        progress: 0.5,
        lastBookmarkModified: 1700000001500
      })
    )
  );
  await backup.add(
    `${folder}/statistics_1_6_1700000002000_7_60_420_420_420_420_60_60_7_7_420_420_na.json`,
    new TextReader(JSON.stringify(statistics))
  );
  await backup.add(`${folder}/cover_1_6.png`, new Uint8ArrayReader(png));
  await backup.add('ttu-user-goals_1_6_1700000003000.json', new TextReader(JSON.stringify(goals)));

  // Node's File: zip.js can't read jsdom's
  return new NodeFile([await backup.close()], 'ttu-reader-export.zip') as unknown as File;
}

beforeAll(() => {
  configure({ useWebWorkers: false });
});

describe('importing an upstream ッツ Reader backup', () => {
  it('stores the book, its progress, statistics and reading goals in the browser', async () => {
    const error = await importBackup(
      getStorageHandler(window, StorageKey.BACKUP, undefined, true),
      getStorageHandler(window, StorageKey.BROWSER, '', true),
      await upstreamBackup(),
      new AbortController().signal
    );

    expect(error).toBe('');

    const book = await database.getDataByTitle(title);

    expect(book).toMatchObject({
      title,
      styleSheet: '.a{}',
      characters: 14,
      lastBookModified: 1700000000000,
      lastBookOpen: 1700000001000
    });
    expect(book!.elementHtml).toContain('名前はまだ無い');
    expect(book!.sections!.map((section) => section.reference)).toEqual(['ttu-0', 'ttu-1']);
    expect(Object.keys(book!.blobs)).toEqual(['image0.png']);
    expect(book!.coverImage).toBeTruthy();

    const db = await database.db;
    const progress = await db.get('bookmark', book!.id);

    // dataId is rewritten to this browser's id
    expect(progress).toMatchObject({
      dataId: book!.id,
      exploredCharCount: 7,
      progress: 0.5,
      lastBookmarkModified: 1700000001500
    });
    expect(await database.getStatisticsForBook(title)).toMatchObject([
      { title, dateKey: '2026-10-01', charactersRead: 7, readingTime: 60 }
    ]);
    expect(await database.getReadingGoals()).toMatchObject([
      { goalStartDate: '2026-10-01', timeGoal: 3600, goalFrequency: 'daily' }
    ]);
  });
});
