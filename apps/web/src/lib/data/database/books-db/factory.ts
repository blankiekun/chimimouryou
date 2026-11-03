/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type BooksDb from './versions/books-db';
import { openDB } from 'idb';
import upgradeBooksDbFromV2 from './versions/v2/upgrade';

export function createBooksDb(name = 'books') {
  return openDB<BooksDb>(name, 6, {
    async upgrade(oldDb, oldVersion, newVersion, transaction) {
      if (oldVersion === 0) {
        const dataStore = oldDb.createObjectStore('data', {
          keyPath: 'id',
          autoIncrement: true
        });
        dataStore.createIndex('title', 'title');

        oldDb.createObjectStore('bookmark', {
          keyPath: 'dataId'
        });

        oldDb.createObjectStore('lastItem');
      }

      if (oldVersion === 2) {
        await upgradeBooksDbFromV2(oldDb, oldVersion, newVersion, transaction);
      }

      if (oldVersion < 4) {
        oldDb.createObjectStore('storageSource', {
          keyPath: 'name'
        });
      }

      if (oldVersion < 5) {
        const statisticsStore = oldDb.createObjectStore('statistic', {
          keyPath: ['title', 'dateKey']
        });

        statisticsStore.createIndex('dateKey', 'dateKey');
        statisticsStore.createIndex('completedBook', ['completedBook', 'title']);

        const readingGoalsStore = oldDb.createObjectStore('readingGoal', {
          keyPath: 'goalStartDate'
        });

        readingGoalsStore.createIndex('goalEndDate', 'goalEndDate');

        oldDb.createObjectStore('lastModified', {
          keyPath: ['title', 'dataType']
        });
      }

      if (oldVersion < 6) {
        oldDb.createObjectStore('audioBook', { keyPath: 'title' });

        oldDb.createObjectStore('subtitle', { keyPath: 'title' });

        oldDb.createObjectStore('handle', { keyPath: ['title', 'dataType'] });
      }
    }
  });
}
