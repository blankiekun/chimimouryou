/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type {
  BooksDbAudioBook,
  BooksDbBookData,
  BooksDbBookmarkData,
  BooksDbReadingGoal,
  BooksDbStatistic,
  BooksDbStorageSource,
  BooksDbSubtitleData
} from '$lib/data/database/books-db/versions/books-db';
import { Observable, Subject, from } from 'rxjs';
import { StorageDataType } from '$lib/data/storage/storage-types';
import type { ReaderRoute } from '$lib/data/reader/reader-route';
import {
  deletedStatistic,
  getDateKey,
  isDeletedStatistic,
  mergeStatistics,
  updateStatisticToStore
} from '$lib/functions/statistic-util';
import { catchError, map, shareReplay, startWith, switchMap, tap } from 'rxjs/operators';
import {
  deletedGoal,
  getCurrentReadingGoal,
  isDeletedGoal,
  mergeReadingGoals,
  readingGoalSortFunction
} from '$lib/data/reading-goal';
import {
  lastReadingGoalsModified$,
  libraryOffline$,
  readingGoal$,
  syncTarget$
} from '$lib/data/store';

import type { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
import type { BookStatistic } from '$lib/components/statistics/statistics-types';
import type BooksDb from '$lib/data/database/books-db/versions/books-db';
import type { IDBPDatabase } from 'idb';
import LogReportDialog from '$lib/components/log-report-dialog.svelte';
import { MergeMode } from '$lib/data/merge-mode';
import MessageDialog from '$lib/components/message-dialog.svelte';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
import { dialogManager } from '$lib/data/dialog-manager';
import { getDefaultStatistic } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
import { handleErrorDuringReplication } from '$lib/functions/replication/error-handler';
import { iffBrowser } from '$lib/functions/rxjs/iff-browser';
import { logger } from '$lib/data/logger';
import pLimit from 'p-limit';
import { replicationProgress$ } from '$lib/functions/replication/replication-progress';
import { setStorageSourceDefault } from '$lib/data/storage/storage-source-manager';
import { fallbackStorageSource, storageSource$ } from '$lib/data/storage/storage-view';
import { throwIfAborted } from '$lib/functions/replication/replication-error';
import { isVn } from '$lib/data/vn/vn';
import { deleteVnFiles, dropOrphanVnFiles, getVnFiles, putVnFiles } from '$lib/data/vn/vn-files';

const LAST_ITEM_KEY = 0;

/** A stored book is kept over `data` (ReplicationSaveBehavior.NewOnly and not older) */
function keepsStored(
  stored: BooksDbBookData,
  data: Omit<BooksDbBookData, 'id'>,
  saveBehavior: ReplicationSaveBehavior
) {
  return (
    saveBehavior === ReplicationSaveBehavior.NewOnly &&
    !!stored.lastBookModified &&
    !!data.lastBookModified &&
    stored.lastBookModified >= data.lastBookModified &&
    (stored.lastBookOpen || 0) >= (data.lastBookOpen || 0)
  );
}

/** No signal or a server failure: says nothing about the source itself. */
function isOutOfReach(error: unknown) {
  const status = (error as { status?: number })?.status;

  return !navigator.onLine || error instanceof TypeError || status === 0 || (status ?? 0) >= 500;
}

export class DatabaseService {
  private db$: Observable<Awaited<typeof this.db>>;

  isReady$: Observable<boolean>;

  listLoading$ = new Subject<boolean>();

  private vnFilesTidied = false;

  dataListChanged$ = new Subject<BaseStorageHandler | undefined>();

  lastHandler: BaseStorageHandler | undefined;

  dataList$ = iffBrowser(() =>
    this.dataListChanged$.pipe(
      startWith(undefined),
      tap((handler) => {
        this.lastHandler = handler;
      }),
      switchMap(() => storageSource$),
      switchMap((storageSource) =>
        from(
          Promise.resolve(
            this.lastHandler ||
              import('$lib/data/storage/storage-handler-factory').then(({ getStorageHandler }) =>
                getStorageHandler(window, storageSource, '')
              )
          ).then((handler) => {
            logger.clearHistory();

            return handler.getBookList();
          })
        ).pipe(
          catchError((error: unknown) => {
            // The header and the empty library offer the sign-in, which only a click can open.
            const signInNeeded = (error as Error)?.message === 'Sign in to Drive again';

            if (error instanceof Error && !signInNeeded) {
              const showReport = logger.errorCount > 1;

              logger.warn(error.message);

              dialogManager.dialogs$.next([
                {
                  component: showReport ? LogReportDialog : MessageDialog,
                  props: {
                    title: 'Failure',
                    message: showReport ? 'Error(s) occurred' : `An Error occured: ${error.message}`
                  }
                }
              ]);
            }

            if (storageSource !== fallbackStorageSource) {
              this.lastHandler = undefined;

              // Out of reach for now: the source stays, and `online` lists it again (/manage).
              if (signInNeeded || isOutOfReach(error)) libraryOffline$.next(true);
              else storageSource$.next(fallbackStorageSource);
            }

            return [[]];
          })
        )
      ),
      tap(() => {
        this.lastHandler = undefined;
        this.listLoading$.next(false);
      }),
      shareReplay({ refCount: true, bufferSize: 1 })
    )
  );

  bookmarksChanged$ = new Subject<void>();

  bookmarks$ = this.bookmarksChanged$.pipe(
    startWith(0),
    switchMap(() => this.db$),
    switchMap((db) => db.getAll('bookmark')),
    shareReplay({ refCount: true, bufferSize: 1 })
  );

  lastItemChanged$ = new Subject<void>();

  lastItem$ = this.lastItemChanged$.pipe(
    startWith(0),
    switchMap(() => this.db$),
    switchMap((db) => db.get('lastItem', LAST_ITEM_KEY)),
    shareReplay({ refCount: true, bufferSize: 1 })
  );

  storageSourcesChanged$ = new Subject<BooksDbStorageSource[]>();

  constructor(public db: Promise<IDBPDatabase<BooksDb>>) {
    this.db$ = from(db).pipe(shareReplay({ refCount: true, bufferSize: 1 }));
    this.isReady$ = this.db$.pipe(map((x) => !!x));
  }

  async getLastModifiedForType(title: string, dataType: string) {
    const db = await this.db;
    const result = await db.get('lastModified', [title, dataType]);

    return result?.lastModifiedValue || 0;
  }

  async getData(dataId: number) {
    if (!Number.isNaN(dataId)) {
      const db = await this.db;
      return db.get('data', dataId);
    }
    return undefined;
  }

  /** Every stored book's title, from the title index (no book read). */
  async getTitles() {
    const db = await this.db;
    const titles: string[] = [];

    for (
      let cursor = await db
        .transaction('data')
        .store.index('title')
        .openKeyCursor(null, 'nextunique');
      cursor;
      cursor = await cursor.continue()
    ) {
      titles.push(cursor.key);
    }
    return titles;
  }

  async getDataByTitle(title: string) {
    if (title) {
      const db = await this.db;
      return db.getFromIndex('data', 'title', title);
    }

    return undefined;
  }

  async setFirstBookRead(
    bookTitle: string,
    startDaysHoursForTracker: number,
    existingStatistic?: BooksDbStatistic
  ) {
    const db = await this.db;

    let firstStatistic = existingStatistic;

    if (!firstStatistic) {
      [firstStatistic] = await this.getStatisticsForBook(bookTitle);
    }

    if (firstStatistic) {
      return [firstStatistic.dateKey, false];
    }

    const dateKey = getDateKey(startDaysHoursForTracker);
    const tx = db.transaction(['statistic', 'lastModified'], 'readwrite');

    try {
      const statisticsStore = tx.objectStore('statistic');
      const lastModifiedStore = tx.objectStore('lastModified');
      const newStatistic = getDefaultStatistic(bookTitle, dateKey);

      // Today's deletion stands until there's real reading to replace it (`storeStatistics`).
      if (await statisticsStore.get([bookTitle, dateKey])) {
        await tx.done;
        return [dateKey, false];
      }

      await statisticsStore.put(newStatistic);
      await lastModifiedStore.put({
        title: bookTitle,
        dataType: StorageDataType.STATISTICS,
        lastModifiedValue: newStatistic.lastStatisticModified
      });

      await tx.done;
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }

    return [dateKey, true];
  }

  async upsertData(
    data: Omit<BooksDbBookData, 'id'>,
    saveBehavior: ReplicationSaveBehavior,
    skipTimestampFallback = true,
    removeStorageContext = true,
    cancelSignal?: AbortSignal
  ) {
    const db = await this.db;

    let dataId: number;
    let bookData: BooksDbBookData;
    let staleVnFiles: string | undefined;

    // A visual novel's files go to their own database first, the record last: whole or nothing.
    if (isVn(data) && Object.keys(data.blobs).length) {
      const stored = await db.getFromIndex('data', 'title', data.title);

      if (stored && keepsStored(stored, data, saveBehavior)) {
        return stored;
      }

      data = { ...data, blobs: {}, vnFiles: await putVnFiles(data.blobs, cancelSignal) };
    }

    const tx = db.transaction('data', 'readwrite');
    const { store } = tx;
    const oldData = await store.index('title').get(data.title);

    if (oldData) {
      if (removeStorageContext) {
        oldData.storageSource = undefined;
      }

      if (keepsStored(oldData, data, saveBehavior)) {
        bookData = oldData;
        dataId = oldData.id;
        staleVnFiles = data.vnFiles !== oldData.vnFiles ? data.vnFiles : undefined;
      } else {
        if (oldData.vnFiles && data.vnFiles && oldData.vnFiles !== data.vnFiles) {
          staleVnFiles = oldData.vnFiles;
        }

        bookData = {
          ...data,
          id: oldData.id,
          ...(skipTimestampFallback
            ? { lastBookModified: data.lastBookModified, lastBookOpen: data.lastBookOpen }
            : {
                lastBookModified: data.lastBookModified || oldData.lastBookModified,
                lastBookOpen: data.lastBookOpen || oldData.lastBookOpen
              }),
          ...(removeStorageContext ? { storageSource: undefined } : {})
        };
        dataId = await store.put(bookData);
      }
    } else {
      // Until https://github.com/jakearchibald/idb/issues/150 resolves
      const bookDataWithoutKey: Omit<BooksDbBookData, 'id'> = data;
      dataId = await store.add(bookDataWithoutKey as BooksDbBookData);
      bookData = { ...data, id: dataId };
    }

    try {
      await tx.done;
    } catch (error) {
      if (data.vnFiles !== oldData?.vnFiles) staleVnFiles = data.vnFiles;
      throw error;
    } finally {
      if (staleVnFiles) await deleteVnFiles(staleVnFiles).catch(() => undefined);
    }

    return bookData;
  }

  /** A book's blobs: a visual novel's from the vn-files database, others' from the record */
  async getBlobs(book: Pick<BooksDbBookData, 'blobs' | 'vnFiles'>) {
    return book.vnFiles ? getVnFiles(book.vnFiles) : book.blobs;
  }

  /**
   * Once per start: visual novels stored with their files in the record (before vn-files.ts)
   * move them out, so listing the library stops reading them, and files of imports that never
   * finished are dropped.
   */
  async tidyVnFiles() {
    if (this.vnFilesTidied) return;
    this.vnFilesTidied = true;

    const db = await this.db;
    const books = await db.getAll('data');

    await dropOrphanVnFiles(new Set(books.flatMap((book) => book.vnFiles || [])));

    for (const book of books) {
      if (isVn(book) && !book.vnFiles && Object.keys(book.blobs || {}).length) {
        await this.upsertData(book, ReplicationSaveBehavior.Overwrite, false, false);
      }
    }
  }

  async deleteData(
    dataIds: number[],
    idsToTitles: Map<number, string>,
    cancelSignal: AbortSignal,
    keepLocalStatistics: boolean
  ) {
    const db = await this.db;
    const lastItemObj = await db.get('lastItem', LAST_ITEM_KEY);
    const bookmarkIdData = await db.getAllKeys('bookmark');
    const lastItem = lastItemObj?.dataId;
    const bookmarkIds = new Set(bookmarkIdData);
    const deleted: number[] = [];
    const limiter = pLimit(1);
    const tasks: Promise<void>[] = [];

    let errorMessage = '';

    replicationProgress$.next({ progressBase: 1, maxProgress: dataIds.length });

    dataIds.forEach((id) =>
      tasks.push(
        limiter(async () => {
          try {
            throwIfAborted(cancelSignal);

            deleted.push(
              await this.deleteSingleData(
                db,
                id,
                idsToTitles.get(id),
                { lastItem, bookmarkIds },
                !keepLocalStatistics
              )
            );
          } catch (error) {
            errorMessage = handleErrorDuringReplication(
              error,
              `Error deleting Book with id ${id}: `,
              [limiter]
            );
          }
        })
      )
    );

    await Promise.all(tasks).catch(() => {});

    return { error: errorMessage, deleted };
  }

  async getBookmark(dataId: number) {
    const db = await this.db;
    return db.get('bookmark', dataId);
  }

  async putBookmark(bookmarkData: BooksDbBookmarkData) {
    const db = await this.db;

    return db.put('bookmark', bookmarkData);
  }

  async putAudioBook(audioBook: BooksDbAudioBook) {
    const db = await this.db;

    return db.put('audioBook', audioBook);
  }

  async putSubtitleData(subtitleData: BooksDbSubtitleData) {
    const db = await this.db;

    return db.put('subtitle', subtitleData);
  }

  async putLastItem(dataId: number, route?: ReaderRoute) {
    const db = await this.db;
    const result = await db.put('lastItem', route ? { dataId, route } : { dataId }, LAST_ITEM_KEY);
    this.lastItemChanged$.next();
    return result;
  }

  async deleteLastItem() {
    const db = await this.db;
    await db.delete('lastItem', LAST_ITEM_KEY);
    this.lastItemChanged$.next();
  }

  /**
   * Removes one reader's progress, statistics and reading goals for these titles (and all
   * reading goals) when another reader takes over the browser; the books themselves stay.
   */
  async clearReaderData(titles: Set<string>) {
    const db = await this.db;
    const tx = db.transaction(
      ['data', 'bookmark', 'statistic', 'lastModified', 'readingGoal'],
      'readwrite'
    );
    const deletes: Promise<unknown>[] = [];

    for (const book of await tx.objectStore('data').getAll()) {
      if (titles.has(book.title) && book.id !== undefined) {
        deletes.push(tx.objectStore('bookmark').delete(book.id));
      }
    }

    for (const store of ['statistic', 'lastModified'] as const) {
      for (const key of await tx.objectStore(store).getAllKeys()) {
        if (titles.has(key[0])) {
          deletes.push(tx.objectStore(store).delete(key));
        }
      }
    }

    deletes.push(tx.objectStore('readingGoal').clear());
    await Promise.all(deletes);
    await tx.done;
    lastReadingGoalsModified$.next(0);
  }

  private async deleteSingleData(
    db: IDBPDatabase<BooksDb>,
    dataId: number,
    title: string | undefined,
    cachedData: { bookmarkIds: Set<number>; lastItem: number | undefined },
    shouldDeleteStatistics: boolean
  ) {
    const storeNames: (
      | 'data'
      | 'bookmark'
      | 'statistic'
      | 'lastItem'
      | 'lastModified'
      | 'audioBook'
      | 'subtitle'
      | 'handle'
    )[] = ['data', 'audioBook', 'subtitle', 'handle'];
    const shouldDeleteLastItem = cachedData.lastItem === dataId;
    const shouldDeleteBookmark = cachedData.bookmarkIds.has(dataId);

    let bookTitle = title;

    if (shouldDeleteLastItem) {
      storeNames.push('lastItem');
    }

    if (shouldDeleteBookmark) {
      storeNames.push('bookmark');
    }

    if (shouldDeleteStatistics) {
      storeNames.push('statistic');
      storeNames.push('lastModified');
    }

    const tx = db.transaction(storeNames, 'readwrite');

    let vnFiles: string | undefined;

    try {
      const record = await tx.objectStore('data').get(dataId);

      bookTitle ||= record?.title;
      vnFiles = record?.vnFiles;

      if (shouldDeleteLastItem) {
        await tx.objectStore('lastItem').delete(LAST_ITEM_KEY);
      }

      if (shouldDeleteBookmark) {
        await tx.objectStore('bookmark').delete(dataId);
      }

      if (shouldDeleteStatistics && bookTitle) {
        await tx.objectStore('statistic').delete(IDBKeyRange.bound([bookTitle], [bookTitle, []]));
        await tx.objectStore('lastModified').delete([bookTitle, StorageDataType.STATISTICS]);
      }

      if (bookTitle) {
        await tx.objectStore('audioBook').delete(bookTitle);
        await tx.objectStore('subtitle').delete(bookTitle);
        await tx.objectStore('handle').delete(IDBKeyRange.bound([bookTitle], [bookTitle, []]));
      }

      await tx.objectStore('data').delete(dataId);
      await tx.done;

      if (vnFiles) await deleteVnFiles(vnFiles).catch(() => undefined);

      if (shouldDeleteLastItem) {
        this.lastItemChanged$.next();
      }
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }

    replicationProgress$.next({ progressToAdd: 1 });

    return dataId;
  }

  async getStorageSources() {
    const db = await this.db;

    return db.getAll('storageSource');
  }

  async saveStorageSource(
    storageSource: BooksDbStorageSource,
    oldName: string,
    isSyncTarget: boolean,
    isStorageSourceDefault: boolean
  ) {
    const db = await this.db;
    const tx = db.transaction(['storageSource'], 'readwrite');

    try {
      const store = tx.objectStore('storageSource');

      if (oldName && storageSource.name !== oldName) {
        await store.delete(oldName);
      }

      if (storageSource.name === oldName) {
        await store.put(storageSource);
      } else {
        await store.add(storageSource);
      }

      await tx.done;

      if (isSyncTarget) {
        syncTarget$.next(storageSource.name);
      } else if (oldName) {
        syncTarget$.next('');
      }

      if (isStorageSourceDefault) {
        setStorageSourceDefault(storageSource.name, storageSource.type);
      } else if (oldName) {
        setStorageSourceDefault('', storageSource.type);
      }
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }
  }

  async deleteStorageSource(
    toDelete: BooksDbStorageSource,
    wasSyncTarget: boolean,
    wasStorageSourceDefault: boolean
  ) {
    const db = await this.db;

    await db.delete('storageSource', toDelete.name);

    if (wasSyncTarget) {
      syncTarget$.next('');
    }

    if (wasStorageSourceDefault) {
      setStorageSourceDefault('', toDelete.type);
    }
  }

  async getStatisticsForBook(bookTitle: string) {
    return (await this.getSyncedStatisticsForBook(bookTitle)).filter(
      (statistic) => !isDeletedStatistic(statistic)
    );
  }

  /** With the deleted days, which only sync should see. */
  async getSyncedStatisticsForBook(bookTitle: string) {
    const db = await this.db;

    return db.getAll('statistic', IDBKeyRange.bound([bookTitle], [bookTitle, []]));
  }

  async getStatisticForCompletedBook(bookTitle: string) {
    const db = await this.db;

    return db.getFromIndex('statistic', 'completedBook', [1, bookTitle]);
  }

  async getStatisticsForTimeWindow(startDate: string, endDate: string) {
    const db = await this.db;

    return (
      await db.getAllFromIndex('statistic', 'dateKey', IDBKeyRange.bound(startDate, endDate))
    ).filter((statistic) => !isDeletedStatistic(statistic));
  }

  async getStatisticsUntilDate(bookTitle: string, maxDate: string) {
    const db = await this.db;

    const results = await db.getAllFromIndex(
      'statistic',
      'dateKey',
      IDBKeyRange.upperBound(maxDate)
    );

    return results.filter((result) => result.title === bookTitle && !isDeletedStatistic(result));
  }

  async storeStatistics(
    bookTitle: string,
    statistics: BooksDbStatistic[],
    saveBehavior: ReplicationSaveBehavior,
    statisticsMergeMode: MergeMode,
    currentLastModified = Date.now(),
    raiseDaysOnlyHere = false
  ) {
    const db = await this.db;

    let statisticsToStore: BooksDbStatistic[] = statistics;
    let newStatisticModified = currentLastModified;

    // The reads belong to the write: a pull in one tab must not overwrite another tab's last save.
    const tx = db.transaction(['statistic', 'lastModified'], 'readwrite');

    try {
      const statisticsStore = tx.objectStore('statistic');
      const lastModifiedStore = tx.objectStore('lastModified');
      const readStored = () =>
        statisticsStore.getAll(IDBKeyRange.bound([bookTitle], [bookTitle, []]));

      if (statisticsMergeMode === MergeMode.LOCAL) {
        // Reading on a day deleted elsewhere must beat the deletion, on a slow clock too.
        const stored = new Map((await readStored()).map((row) => [row.dateKey, row]));

        statistics.forEach((statistic) => {
          const row = stored.get(statistic.dateKey);

          if (
            row &&
            (statistic.lastStatisticModified < row.lastStatisticModified ||
              (statistic.lastStatisticModified === row.lastStatisticModified &&
                isDeletedStatistic(row)))
          ) {
            statistic.lastStatisticModified = row.lastStatisticModified + 1;
          }
        });
      }

      if (statisticsMergeMode === MergeMode.MERGE) {
        const existingStatistics = await readStored();

        statisticsToStore = mergeStatistics(
          statistics,
          existingStatistics,
          saveBehavior === ReplicationSaveBehavior.NewOnly
        );

        if (raiseDaysOnlyHere) {
          const incoming = new Set(statistics.map((statistic) => statistic.dateKey));
          const newest = Math.max(
            currentLastModified,
            ...statistics.map((statistic) => statistic.lastStatisticModified)
          );

          existingStatistics.forEach((statistic) => {
            if (!incoming.has(statistic.dateKey) && statistic.lastStatisticModified <= newest) {
              statistic.lastStatisticModified = newest + 1;
            }
          });
        }
      }

      ({ newStatisticModified, statisticsToStore } = updateStatisticToStore(
        statisticsToStore,
        newStatisticModified
      ));

      if (statisticsMergeMode === MergeMode.LOCAL) {
        // Reading here after pulling a future-dated row (another device's fast clock): below that
        // time the sync file would look up to date, and this reading would never be uploaded.
        const known = (await lastModifiedStore.get([bookTitle, StorageDataType.STATISTICS]))
          ?.lastModifiedValue;

        if (known && known >= newStatisticModified) newStatisticModified = known + 1;
      }

      const limiter = pLimit(1);
      const tasks: Promise<void>[] = [];

      if (statisticsMergeMode !== MergeMode.LOCAL) {
        tasks.push(
          limiter(async () => {
            try {
              await statisticsStore.delete(IDBKeyRange.bound([bookTitle], [bookTitle, []]));
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        );
      }

      statisticsToStore.forEach((statistic) =>
        tasks.push(
          limiter(async () => {
            try {
              await statisticsStore.put(statistic);
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        )
      );

      tasks.push(
        limiter(async () => {
          try {
            await lastModifiedStore.put({
              title: bookTitle,
              dataType: StorageDataType.STATISTICS,
              lastModifiedValue: newStatisticModified
            });
          } catch (error: any) {
            limiter.clearQueue();

            throw error;
          }
        })
      );

      await Promise.all(tasks);
      await tx.done;
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }
  }

  async updateStatistic(newStatistic: BookStatistic) {
    const db = await this.db;
    const tx = db.transaction(['statistic', 'lastModified'], 'readwrite');
    const statisticsStore = tx.objectStore('statistic');

    let existingStatistic = await statisticsStore.get([newStatistic.title, newStatistic.dateKey]);

    if (!existingStatistic) {
      tx.abort();
      await tx.done.catch(() => {});
      throw new Error('Unable to find record in the database');
    }

    existingStatistic = {
      ...existingStatistic,
      charactersRead: newStatistic.charactersRead,
      readingTime: newStatistic.readingTime,
      minReadingSpeed: newStatistic.minReadingSpeed,
      altMinReadingSpeed: newStatistic.altMinReadingSpeed,
      lastReadingSpeed: newStatistic.lastReadingSpeed,
      maxReadingSpeed: newStatistic.maxReadingSpeed,
      lastStatisticModified: newStatistic.lastStatisticModified
    };

    await statisticsStore.put(existingStatistic);
    // Without this a finished book's edit never looks newer than the synced copy.
    await tx.objectStore('lastModified').put({
      title: newStatistic.title,
      dataType: StorageDataType.STATISTICS,
      lastModifiedValue: newStatistic.lastStatisticModified
    });
    await tx.done;
  }

  async clearZombieStatistics() {
    try {
      const db = await this.db;
      const books = await db.getAll('data');
      const titles = new Set(books.map((book) => book.title));
      const statistics = await db.getAll('statistic');
      const lastModifiedForStatistics = await db.getAll('lastModified');
      const statisticsToDelete: BooksDbStatistic[] = [];
      const lastModifiedItemsToDelete = new Set<string>();

      for (let index = 0, { length } = statistics; index < length; index += 1) {
        const entry = statistics[index];

        if (!titles.has(entry.title)) {
          statisticsToDelete.push(entry);
        }
      }

      for (let index = 0, { length } = lastModifiedForStatistics; index < length; index += 1) {
        const entry = lastModifiedForStatistics[index];

        if (!titles.has(entry.title)) {
          lastModifiedItemsToDelete.add(entry.title);
        }
      }

      await this.deleteStatistics(statisticsToDelete, [...lastModifiedItemsToDelete]);
    } catch (error: any) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: 'Failure',
            message: `Error on Deletion: ${error.message}`
          }
        }
      ]);
    }
  }

  async deleteStatistics(statistics: BooksDbStatistic[], lastModifiedTitlesToDelete: string[]) {
    if (!statistics.length && !lastModifiedTitlesToDelete.length) {
      return;
    }

    const db = await this.db;
    const tx = db.transaction(['statistic', 'lastModified'], 'readwrite');
    const titlesToDelete = new Set<string>();

    try {
      const statisticsStore = tx.objectStore('statistic');
      const lastModifiedStore = tx.objectStore('lastModified');
      const limiter = pLimit(1);
      const tasks: Promise<void>[] = [];

      for (let index = 0, { length } = lastModifiedTitlesToDelete; index < length; index += 1) {
        titlesToDelete.add(lastModifiedTitlesToDelete[index]);
      }

      statistics.forEach((statistic) =>
        tasks.push(
          limiter(async () => {
            try {
              titlesToDelete.add(statistic.title);
              await statisticsStore.delete([statistic.title, statistic.dateKey]);
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        )
      );

      [...titlesToDelete].forEach((titleToDelete) =>
        tasks.push(
          limiter(async () => {
            try {
              await lastModifiedStore.delete([titleToDelete, StorageDataType.STATISTICS]);
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        )
      );

      await Promise.all(tasks);
      await tx.done;
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }
  }

  async deleteStatisticEntries(
    bookTitles: string[],
    checkExistingData: boolean,
    startDateString = '',
    endDateString = ''
  ) {
    if (!bookTitles.length || (startDateString && !endDateString)) {
      throw new Error('Received invalid Arguments for deleteStatisticEntries');
    }

    const db = await this.db;
    const tx = db.transaction(['statistic', 'lastModified'], 'readwrite');

    try {
      const statisticsStore = tx.objectStore('statistic');
      const lastModifiedStore = tx.objectStore('lastModified');
      const now = Date.now();

      for (const bookTitle of bookTitles) {
        const rows = (
          await statisticsStore.getAll(
            startDateString
              ? IDBKeyRange.bound([bookTitle, startDateString], [bookTitle, endDateString])
              : IDBKeyRange.bound([bookTitle], [bookTitle, []])
          )
        ).filter((statistic) => !isDeletedStatistic(statistic));
        const deleted = rows.map((statistic) => deletedStatistic(statistic, now));

        await Promise.all(deleted.map((statistic) => statisticsStore.put(statistic)));

        if (!checkExistingData || deleted.length) {
          await lastModifiedStore.put({
            title: bookTitle,
            dataType: StorageDataType.STATISTICS,
            lastModifiedValue: Math.max(
              now,
              ...deleted.map((statistic) => statistic.lastStatisticModified)
            )
          });
        }
      }

      await tx.done;
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }
  }

  async getReadingGoals() {
    return (await this.getSyncedReadingGoals()).filter((goal) => !isDeletedGoal(goal));
  }

  /** With the deleted goals, which only sync should see. */
  async getSyncedReadingGoals() {
    const db = await this.db;

    return db.getAll('readingGoal');
  }

  async getOpenReadingGoals() {
    const db = await this.db;

    return (await db.getAllFromIndex('readingGoal', 'goalEndDate', '')).filter(
      (goal) => !isDeletedGoal(goal)
    );
  }

  async getCurrentClosedReadingGoal(referenceDate: string) {
    const db = await this.db;
    const readingGoals = await db.getAll('readingGoal', IDBKeyRange.upperBound(referenceDate));

    return readingGoals.find(
      (readingGoal) => readingGoal.goalEndDate >= referenceDate && !isDeletedGoal(readingGoal)
    );
  }

  async getReadingGoalsForDateWindow(startDate: string, newStartDate = '', endDate = '') {
    const readingGoals = await this.getReadingGoals();

    if (newStartDate) {
      return readingGoals.filter(
        (readingGoal) =>
          !readingGoal.goalEndDate ||
          (startDate >= readingGoal.goalStartDate && startDate <= readingGoal.goalEndDate) ||
          (readingGoal.goalStartDate >= startDate &&
            (!endDate || readingGoal.goalStartDate <= endDate)) ||
          (newStartDate >= readingGoal.goalStartDate && newStartDate <= readingGoal.goalEndDate) ||
          readingGoal.goalStartDate >= newStartDate
      );
    }

    return readingGoals.filter(
      (readingGoal) =>
        !readingGoal.goalEndDate ||
        (startDate >= readingGoal.goalStartDate && startDate <= readingGoal.goalEndDate) ||
        (readingGoal.goalStartDate >= startDate &&
          (!endDate || readingGoal.goalStartDate <= endDate))
    );
  }

  async updateReadingGoals(
    readingGoalsToDelete: string[],
    readingGoalsToInsert: BooksDbReadingGoal[]
  ) {
    if (!readingGoalsToDelete.length && !readingGoalsToInsert.length) {
      return;
    }

    const db = await this.db;
    const tx = db.transaction(['readingGoal'], 'readwrite');

    try {
      const store = tx.objectStore('readingGoal');
      const limiter = pLimit(1);
      const tasks: Promise<void>[] = [];
      const now = Date.now();
      let newest = Math.max(now, lastReadingGoalsModified$.getValue());
      const endOf = (goal: BooksDbReadingGoal) => goal.goalEndDate || '9999-99-99';

      readingGoalsToDelete.forEach((readingGoal) =>
        tasks.push(
          limiter(async () => {
            try {
              const stored = await store.get(readingGoal);

              // A goal an inserted one overlaps goes in the merge anyway, and a deletion dated
              // like the new goal could beat it there.
              if (
                !stored ||
                isDeletedGoal(stored) ||
                readingGoalsToInsert.some(
                  (goal) =>
                    goal.goalStartDate <= endOf(stored) && stored.goalStartDate <= endOf(goal)
                )
              ) {
                if (!stored || !isDeletedGoal(stored)) await store.delete(readingGoal);
                return;
              }

              const deleted = deletedGoal(stored, now);

              newest = Math.max(newest, deleted.lastGoalModified);
              await store.put(deleted);
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        )
      );

      readingGoalsToInsert.forEach((readingGoal) =>
        tasks.push(
          limiter(async () => {
            try {
              const stored = await store.get(readingGoal.goalStartDate);

              // Set again after its deletion: must beat it, on a slow clock too.
              if (stored && isDeletedGoal(stored)) {
                readingGoal.lastGoalModified = Math.max(
                  readingGoal.lastGoalModified,
                  stored.lastGoalModified + 1
                );
                newest = Math.max(newest, readingGoal.lastGoalModified);
              }

              await store.put(readingGoal);
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        )
      );

      await Promise.all(tasks);
      await tx.done;

      lastReadingGoalsModified$.next(newest);
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }
  }

  async storeReadingGoals(
    readingGoals: BooksDbReadingGoal[],
    saveBehavior: ReplicationSaveBehavior,
    readingGoalsMergeMode: MergeMode,
    lastGoalModified: number
  ) {
    const db = await this.db;

    let readingGoalsToStore: BooksDbReadingGoal[] = readingGoals;
    let newReadingGoalModified = lastGoalModified;

    if (readingGoalsMergeMode === MergeMode.MERGE) {
      const existingReadingGoals = await this.getSyncedReadingGoals();

      ({ readingGoalsToStore, newReadingGoalModified } = mergeReadingGoals(
        readingGoals,
        existingReadingGoals,
        saveBehavior === ReplicationSaveBehavior.NewOnly,
        newReadingGoalModified
      ));
    }

    const tx = db.transaction(['readingGoal'], 'readwrite');

    try {
      const readingGoalStore = tx.objectStore('readingGoal');
      const limiter = pLimit(1);
      const tasks: Promise<void>[] = [];

      readingGoalsToStore.sort(readingGoalSortFunction);

      tasks.push(
        limiter(async () => {
          try {
            await readingGoalStore.clear();
          } catch (error: any) {
            limiter.clearQueue();

            throw error;
          }
        })
      );

      readingGoalsToStore.forEach((readingGoal) =>
        tasks.push(
          limiter(async () => {
            try {
              await readingGoalStore.put(readingGoal);
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        )
      );

      await Promise.all(tasks);
      await tx.done;

      lastReadingGoalsModified$.next(newReadingGoalModified);

      const currentUserGoal = await getCurrentReadingGoal();

      readingGoal$.next(currentUserGoal);
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }
  }

  async deleteReadingGoal(dateKey?: string) {
    const db = await this.db;
    const tx = db.transaction('readingGoal', 'readwrite');
    const now = Date.now();
    const deleted = (await tx.store.getAll(dateKey ? IDBKeyRange.only(dateKey) : undefined))
      .filter((goal) => !isDeletedGoal(goal))
      .map((goal) => deletedGoal(goal, now));

    await Promise.all(deleted.map((goal) => tx.store.put(goal)));
    await tx.done;

    lastReadingGoalsModified$.next(
      Math.max(
        now,
        lastReadingGoalsModified$.getValue(),
        ...deleted.map((goal) => goal.lastGoalModified)
      )
    );
  }

  async getAudioBook(title: string) {
    const db = await this.db;

    return db.get('audioBook', title);
  }

  async getSubtitleData(title: string) {
    const db = await this.db;

    return db.get('subtitle', title);
  }
}
