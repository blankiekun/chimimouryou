/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { createBooksDb } from './factory';

const allStores = [
  'audioBook',
  'bookmark',
  'data',
  'handle',
  'lastItem',
  'lastModified',
  'readingGoal',
  'statistic',
  'storageSource',
  'subtitle'
];

// Bug it would catch: an old install's upgrade that adds only its own version's stores (`switch`
// with `break`) leaves the app failing on `statistic` and the rest, and nothing repairs them later.
describe('createBooksDb', () => {
  it.each([3, 4, 5])('gives a v%i database every store and keeps its books', async (version) => {
    const name = `books-v${version}`;
    const old = await openDB(name, version, {
      upgrade(db) {
        db.createObjectStore('data', { keyPath: 'id', autoIncrement: true }).createIndex(
          'title',
          'title'
        );
        db.createObjectStore('bookmark', { keyPath: 'dataId' });
        db.createObjectStore('lastItem');

        if (version >= 4) db.createObjectStore('storageSource', { keyPath: 'name' });
        if (version >= 5) {
          const statistic = db.createObjectStore('statistic', { keyPath: ['title', 'dateKey'] });

          statistic.createIndex('dateKey', 'dateKey');
          statistic.createIndex('completedBook', ['completedBook', 'title']);
          db.createObjectStore('readingGoal', { keyPath: 'goalStartDate' }).createIndex(
            'goalEndDate',
            'goalEndDate'
          );
          db.createObjectStore('lastModified', { keyPath: ['title', 'dataType'] });
        }
      }
    });

    await old.put('data', { title: 'kept' });
    old.close();

    const db = await createBooksDb(name);

    expect([...db.objectStoreNames].sort()).toEqual(allStores);
    expect(db.transaction('statistic').store.indexNames).toContain('completedBook');
    expect((await db.getAll('data')).map((book) => book.title)).toEqual(['kept']);
    db.close();
  });

  it('makes every store on a new install', async () => {
    const db = await createBooksDb('books-new');

    expect([...db.objectStoreNames].sort()).toEqual(allStores);
    db.close();
  });
});
