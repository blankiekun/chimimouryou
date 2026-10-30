/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Storage source backed by the self-hosted server's Calibre library and /api/v1. Not part of
 * upstream.
 *
 * The book list is the catalog. Reading data (progress, statistics per day, reading goals,
 * highlights, recaps, lorebook, VN saves, kanji, words, immersion, settings) are rows of the
 * account ('' signed out) in the server's library.db, read through the mirror of `GET /sync`
 * (server-api.ts) and written row by row; a 409 means the server's row is newer. A book is
 * processed from its Calibre file on each device that opens it; only a text copy goes to the
 * server (readings files, difficulty). A Windows game's record (program, hook) is the account's
 * own file (`/api/v1/games`), its progress, statistics and VN saves whole-file game docs.
 */

import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import { accountReady, currentAccount } from '$lib/data/account';
import {
  calibreCoverUrl,
  calibreVnUrl,
  downloadCalibreBook,
  loadCalibreCatalog,
  loadCalibreDifficulty,
  type CalibreBook
} from '$lib/data/calibre';
import {
  apiVersion,
  bookIdOf,
  getFile,
  putFile,
  putRow,
  syncMirror,
  type Mirror,
  type SyncRow
} from '$lib/data/server-api';
import {
  holdsAccountData,
  live,
  newest,
  signedInOr401,
  unauthorizedError,
  writeRows,
  type MediaKind
} from '$lib/data/server-rows';
import { BaseStorageHandler, exporterVersion } from '$lib/data/storage/handler/base-handler';
import { BrowserStorageHandler } from '$lib/data/storage/handler/browser-handler';
import type {
  BooksDbAudioBook,
  BooksDbBookData,
  BooksDbBookmarkData,
  BooksDbReadingGoal,
  BooksDbStatistic,
  BooksDbSubtitleData
} from '$lib/data/database/books-db/versions/books-db';
import { currentDbVersion } from '$lib/data/database/books-db/versions/books-db';
import { StorageDataType, StorageKey, StorageSourceDefault } from '$lib/data/storage/storage-types';
import { applySeriesOverride, loadSeriesOverrides } from '$lib/data/series-overrides';
import { applyMetadata, loadBookMetadata } from '$lib/data/book-metadata';
import {
  database,
  libraryBuilding$,
  libraryOffline$,
  readingGoalsMergeMode$,
  statisticsMergeMode$
} from '$lib/data/store';
import { logger } from '$lib/data/logger';
import { MergeMode } from '$lib/data/merge-mode';
import { mergeReadingGoals } from '$lib/data/reading-goal';
import { storage } from '$lib/data/window/navigator/storage';
import loadEpub from '$lib/functions/file-loaders/epub/load-epub';
import loadHtmlz from '$lib/functions/file-loaders/htmlz/load-htmlz';
import loadTxt from '$lib/functions/file-loaders/txt/load-txt';
import loadCbz from '$lib/functions/file-loaders/cbz/load-cbz';
import { loadVnFolder } from '$lib/functions/file-loaders/vn/load-vn';
import { deleteOrphanVnCaches, isVn, vnInfo } from '$lib/data/vn';
import { isManga } from '$lib/data/manga';
import { levelOf } from '$lib/data/difficulty-core';
import { handleErrorDuringReplication } from '$lib/functions/replication/error-handler';
import { throwIfAborted } from '$lib/functions/replication/replication-error';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
import { replicationProgress$ } from '$lib/functions/replication/replication-progress';
import { mergeStatistics, updateStatisticToStore } from '$lib/functions/statistic-util';
import { writableArrayLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';
import pLimit from 'p-limit';

/**
 * Titles of books friends sent (book-transfer.ts) that this browser keeps for the Calibre source:
 * listed with the library, never uploaded (they have no book id on the server).
 */
export const calibreReceivedBooks$ = writableArrayLocalStorageSubject<string>()(
  'calibreReceivedBooks',
  []
);

/** Bookmark progress as a fraction; old bookmarks store a percentage string like "42.5%". */
function bookmarkFraction(progress: number | string | undefined) {
  return typeof progress === 'string' ? Number.parseFloat(progress) / 100 || 0 : progress || 0;
}

/** A file name in today's format for a game record, for extractBookData's metadata. */
const gameFileName = (modified: number) =>
  `bookdata_${exporterVersion}_${currentDbVersion}_0_${modified}_0.zip`;

export class ServerStorageHandler extends BaseStorageHandler {
  private signedIn = false;

  /** holdsAccountData(), refreshed by `state`: personal rows are neither shown nor written. */
  private holdPersonal = false;

  /** Titles whose rows were brought up to date since the last clearData. */
  private freshTitles = new Set<string>();

  private titleToCalibreBook = new Map<string, CalibreBook>();

  private nextCardId = Date.now();

  constructor(window: Window) {
    super(window, StorageKey.CALIBRE);
    this.storageSourceName = StorageSourceDefault.CALIBRE_DEFAULT;
  }

  updateSettings(
    window: Window,
    isForBrowser: boolean,
    saveBehavior: ReplicationSaveBehavior,
    statisticsMergeMode: MergeMode,
    readingGoalsMergeMode: MergeMode,
    cacheStorageData: boolean,
    askForStorageUnlock: boolean
  ) {
    this.window = window;
    this.isForBrowser = isForBrowser;
    this.saveBehavior = saveBehavior;
    this.statisticsMergeMode = statisticsMergeMode;
    this.readingGoalsMergeMode = readingGoalsMergeMode;
    this.cacheStorageData = cacheStorageData;
    this.askForStorageUnlock = askForStorageUnlock;
  }

  clearData(clearAll = true) {
    this.freshTitles.clear();

    if (clearAll) {
      this.titleToBookCard.clear();
      this.dataListFetched = false;
    }
  }

  /** The account state, then this book's rows: fetched once per book (every call with the cache off). */
  private async mirror() {
    try {
      await this.state();
    } catch (error) {
      // Server out of reach: the stored copy, so books cached in this browser still open.
      if (error instanceof TypeError) return syncMirror(false);
      throw error;
    }

    const { title } = this.currentContext;
    const fresh = this.freshTitles.has(title) || (this.cacheStorageData && this.dataListFetched);
    const mirror = await signedInOr401(syncMirror(!fresh));

    this.freshTitles.add(title);

    return mirror;
  }

  private async state() {
    await apiVersion();
    this.signedIn = !!(await accountReady());
    this.holdPersonal = await holdsAccountData();
  }

  private async bookRows(table: 'progress' | 'statistics' | 'bookDocs') {
    const mirror = await this.mirror();
    const book = await bookIdOf(this.currentContext.title);

    if (this.holdPersonal || book === undefined) return { book, rows: [] as SyncRow[] };

    return { book, rows: mirror[table].filter((row) => row.book === book) };
  }

  /** This book's audiobook position or subtitles (book docs, like recaps). */
  private async mediaRow(kind: MediaKind) {
    const { book, rows } = await this.bookRows('bookDocs');

    return { book, row: rows.find((row) => row.kind === kind) };
  }

  private async goalRows() {
    const mirror = await this.mirror();

    return this.holdPersonal ? [] : mirror.goals;
  }

  /** This reader's Windows game record of a title (signed in only). */
  private gameRow(mirror: Mirror, title = this.currentContext.title) {
    return this.signedIn && !this.holdPersonal
      ? live(mirror.games).find((row) => row.name === title)
      : undefined;
  }

  /**
   * A Windows game's progress or statistics row ({ row: undefined } before the first); undefined for a title
   * that isn't one (a catalog book keeps its own rows).
   */
  private async gameDoc(kind: 'progress' | 'statistics') {
    const { title } = this.currentContext;
    const mirror = await this.mirror();

    if (!this.gameRow(mirror) || (await bookIdOf(title)) !== undefined) return undefined;

    return { row: mirror.gameDocs.find((row) => row.name === title && row.kind === kind) };
  }

  private async recentModified(kind: StorageDataType) {
    switch (kind) {
      case StorageDataType.DATA:
        return this.gameRow(await this.mirror())?.modified;
      case StorageDataType.PROGRESS:
        return (
          (await this.gameDoc('progress'))?.row?.modified ??
          newest((await this.bookRows('progress')).rows)
        );
      case StorageDataType.STATISTICS:
        // Deleted days count: deleting one is a change the other devices must take.
        return (
          (await this.gameDoc('statistics'))?.row?.modified ??
          newest((await this.bookRows('statistics')).rows)
        );
      case StorageDataType.READING_GOALS:
        return newest(await this.goalRows());
      case StorageDataType.AUDIOBOOK:
        return (await this.mediaRow('audiobook')).row?.modified;
      case StorageDataType.SUBTITLE:
        return (await this.mediaRow('subtitles')).row?.modified;
      default:
        return undefined;
    }
  }

  async getRecentModified(kind: StorageDataType) {
    if (this.saveBehavior === ReplicationSaveBehavior.Overwrite) {
      BaseStorageHandler.reportProgress();
      return undefined;
    }

    const modified = await this.recentModified(kind);

    BaseStorageHandler.reportProgress();
    BaseStorageHandler.completeStep();

    return modified;
  }

  async isUpToDate(kind: StorageDataType, modified: number | undefined) {
    if (modified === undefined) {
      BaseStorageHandler.reportProgress();
      return false;
    }

    let upToDate: boolean;

    if (kind === StorageDataType.DATA && !this.gameRow(await this.mirror())) {
      // The library has the book; only a Windows game record that isn't here yet is uploaded.
      upToDate = !!(await bookIdOf(this.currentContext.title));
    } else {
      const existing = await this.recentModified(kind);

      upToDate = !!existing && existing >= modified;
    }

    BaseStorageHandler.reportProgress();
    BaseStorageHandler.completeStep();

    return upToDate;
  }

  async getBookList() {
    if (!this.dataListFetched) {
      database.listLoading$.next(true);

      try {
        const [books, mirror, difficulty, local] = await Promise.all([
          signedInOr401(loadCalibreCatalog(true)),
          this.state().then(() => signedInOr401(syncMirror())),
          loadCalibreDifficulty().catch(
            () => ({}) as Awaited<ReturnType<typeof loadCalibreDifficulty>>
          ),
          this.localCopies(),
          loadSeriesOverrides(true).catch(() => ({})),
          loadBookMetadata(true).catch(() => ({}))
        ]);
        const catalogTitles = new Set(books.map((book) => book.title));
        const progress = new Map(
          this.holdPersonal ? [] : mirror.progress.map((row) => [row.book, row])
        );

        for (let index = 0, { length } = books; index < length; index += 1) {
          const book = books[index];
          const bookCard = this.titleToBookCard.get(book.title) || this.createBookCard(book.title);
          const row = progress.get(book.bookId);
          const copy = local.get(book.title);

          this.titleToCalibreBook.set(book.title, book);
          this.titleToBookCard.set(book.title, {
            ...bookCard,
            ...(row && {
              progress: bookmarkFraction(row.progress),
              lastBookmarkModified: row.modified
            }),
            // Per account now: when this reader last saved a position here, or opened it in this browser.
            lastBookOpen: Math.max(copy?.lastBookOpen || 0, row?.modified || 0),
            // Unopened books sort by when they were added to Calibre.
            lastBookModified: copy?.lastBookModified || book.added,
            imagePath: calibreCoverUrl(book) || copy?.coverImage || '',
            // Unopened books: the difficulty service's count, so length filters see them.
            characters:
              (copy &&
                BaseStorageHandler.getBookCharacters(copy.characters || 0, copy.sections || [])) ||
              difficulty[book.id]?.characters ||
              0,
            authors: book.authors,
            series: book.series,
            seriesIndex: book.seriesIndex,
            seriesInferred: book.seriesInferred,
            tags: book.tags,
            rating: book.rating,
            difficulty: levelOf(difficulty[book.id]),
            manga: (book.format === 'CBZ' || book.format === 'ZIP') && !book.vn,
            vn: !!book.vn,
            // Game folders (format VN) aren't in Calibre, but their catalog ids key estimates too.
            calibreId: book.id
          });
        }

        // This reader's Windows game records (the game files are on each device).
        if (this.signedIn && !this.holdPersonal) {
          live(mirror.games)
            .filter((row) => !catalogTitles.has(row.name!))
            .forEach((row) => {
              const copy = local.get(row.name!);

              this.addBookCard(row.name!, {
                ...(this.titleToBookCard.get(row.name!) || this.createBookCard(row.name!)),
                lastBookModified: row.modified,
                lastBookOpen: copy?.lastBookOpen || 0,
                imagePath: copy?.coverImage || '',
                vn: true
              });
            });
        }

        // Windows games live in this browser only (windows-game.ts), never in the catalog.
        await this.addDeviceVns((book) => isVn(book) && vnInfo(book).engine === 'vnbox');
        this.dataListFetched = true;
        libraryOffline$.next(false);
        libraryBuilding$.next(false);
        // Only after the catalog loaded: a failed or signed-out load must not drop kept games.
        deleteOrphanVnCaches(catalogTitles).catch(() => {});
      } catch (error) {
        this.clearData();
        // Signed out where the library needs an account: an empty library that asks to
        // sign in (manage page), not a failure that switches the source to the browser.
        if (!currentAccount() && (error as { status?: number }).status === 401) {
          libraryOffline$.next(false);
          return [];
        }

        // No catalog yet (404): the first build is running; the manage page looks again.
        if ((error as { status?: number }).status === 404) {
          libraryOffline$.next(false);
          libraryBuilding$.next(true);
          return [];
        }

        // fetch rejects with a TypeError when the server can't be reached (offline, or
        // away from its network): list the books this browser has, so they stay readable.
        if (error instanceof TypeError) {
          libraryOffline$.next(true);
          return this.cachedBookList();
        }

        throw error;
      }
    }

    // Applied on every call, so a saved series shows without refetching the catalog.
    const [overrides, metadata] = await Promise.all([
      loadSeriesOverrides().catch(() => ({})),
      loadBookMetadata().catch(() => ({}))
    ]);

    const received = new Set(calibreReceivedBooks$.getValue());
    const kept = received.size
      ? (await this.cachedBookList()).filter(
          (card) => received.has(card.title) && !this.titleToBookCard.has(card.title)
        )
      : [];

    return [
      ...[...this.titleToBookCard.values()].map((card) =>
        applySeriesOverride(applyMetadata(card, metadata), overrides)
      ),
      ...kept
    ];
  }

  /** Titles of books with statistics rows of this account; none signed out. */
  async statisticsTitles() {
    await this.state();

    if (!this.signedIn) return [];

    const [mirror, books] = await Promise.all([signedInOr401(syncMirror()), loadCalibreCatalog()]);
    const ids = new Set(mirror.statistics.map((row) => row.book));
    const titles = new Set(books.map((book) => book.title));

    return [
      ...books.filter((book) => ids.has(book.bookId)).map((book) => book.title),
      // Windows games' statistics (game docs), unless a catalog book took the name.
      ...mirror.gameDocs
        .filter((row) => row.kind === 'statistics' && !titles.has(row.name!))
        .filter((row) => live(mirror.games).some((game) => game.name === row.name))
        .map((row) => row.name!)
    ];
  }

  /** This source's books processed in this browser, by title. */
  private async localCopies() {
    const data = await (await database.db).getAll('data');

    return new Map(
      data
        .filter((book) => book.storageSource === this.storageSourceName && book.elementHtml)
        .map((book) => [book.title, book])
    );
  }

  /** Books from this source processed and stored in the browser, with their local progress. */
  private async cachedBookList(): Promise<BookCardProps[]> {
    const db = await database.db;
    const [data, bookmarks] = await Promise.all([db.getAll('data'), db.getAll('bookmark')]);
    const progress = new Map(bookmarks.map((bookmark) => [bookmark.dataId, bookmark]));

    return data
      .filter((book) => book.storageSource === this.storageSourceName && book.elementHtml)
      .map((book) => ({
        ...this.createBookCard(book.title),
        imagePath: book.coverImage || '',
        characters: BaseStorageHandler.getBookCharacters(book.characters || 0, book.sections || []),
        lastBookModified: book.lastBookModified || 0,
        lastBookOpen: book.lastBookOpen || 0,
        progress: bookmarkFraction(progress.get(book.id)?.progress),
        lastBookmarkModified: progress.get(book.id)?.lastBookmarkModified || 0,
        manga: isManga(book),
        vn: isVn(book)
      }));
  }

  async prepareBookForReading() {
    const { title } = this.currentContext;
    const game = this.gameRow(await this.mirror());

    if (!game && !(await this.localCopyIsCurrent())) await this.processCalibreBook();

    const data = await database.getDataByTitle(title);
    // A game record not downloaded yet: a placeholder, which the replication fills (getBook).
    const bookData: Omit<BooksDbBookData, 'id'> | undefined =
      data ||
      (game && {
        title,
        styleSheet: '',
        elementHtml: '',
        blobs: {},
        coverImage: '',
        hasThumb: true,
        characters: 0,
        sections: [],
        lastBookModified: 0,
        lastBookOpen: 0,
        storageSource: undefined
      });

    if (!bookData) throw new Error('No local or external book data found');

    if (bookData.storageSource !== this.storageSourceName) {
      const { getStorageHandler } = await import('$lib/data/storage/storage-handler-factory');
      return getStorageHandler(
        this.window,
        StorageKey.BROWSER,
        undefined,
        true,
        this.cacheStorageData,
        ReplicationSaveBehavior.Overwrite
      ).saveBook({ ...bookData, storageSource: this.storageSourceName }, true, false);
    }

    return data?.id || 0;
  }

  /**
   * A copy processed after the book was added to Calibre: a book imported with an existing title
   * is its new version (build-catalog.py's sticky titles).
   */
  private async localCopyIsCurrent() {
    const { title } = this.currentContext;
    const localData = await database.getDataByTitle(title);
    const added =
      (
        this.titleToCalibreBook.get(title) ||
        (await loadCalibreCatalog().catch((): CalibreBook[] => [])).find(
          (book) => book.title === title
        )
      )?.added || 0;

    return !!localData?.elementHtml && (localData.lastBookModified || 0) >= added;
  }

  /**
   * In the browser: a Windows game record newer than the local copy is downloaded; Calibre books
   * are processed here when the copy is missing or older (and are then in the browser already,
   * so undefined). Elsewhere (an export) the local copy as a book data zip.
   */
  async getBook() {
    const { title } = this.currentContext;
    const game = this.gameRow(await this.mirror());

    if (game) {
      const localData = await database.getDataByTitle(title);

      if (
        this.isForBrowser &&
        localData?.elementHtml &&
        (localData.lastBookModified || 0) >= game.modified
      ) {
        return undefined;
      }

      const zip = await signedInOr401(getFile(`games/${encodeURIComponent(title)}`));

      if (!zip) return undefined;
      if (!this.isForBrowser)
        return new File([zip], gameFileName(game.modified), { type: 'application/zip' });

      const book = await this.extractBookData(zip, gameFileName(game.modified));

      if (book) await this.saveLocally(book);

      return book;
    }

    if (!(await this.localCopyIsCurrent())) await this.processCalibreBook();
    if (this.isForBrowser) return undefined;

    const book = await database.getDataByTitle(title);

    if (!book) return undefined;

    return new File([await this.zipBookData(book)], BaseStorageHandler.getBookFileName(book), {
      type: 'application/zip'
    });
  }

  async getProgress() {
    const game = await this.gameDoc('progress');
    const row = game ? game.row : (await this.bookRows('progress')).rows[0];

    if (!row) return undefined;

    return this.isForBrowser
      ? (row.data as BooksDbBookmarkData)
      : new File(
          [JSON.stringify(row.data)],
          BaseStorageHandler.getProgressFileName(row.data as BooksDbBookmarkData),
          { type: 'application/json' }
        );
  }

  async getStatistics() {
    const game = await this.gameDoc('statistics');
    const { title } = this.currentContext;

    if (game) {
      return {
        statistics: (game.row?.data as BooksDbStatistic[] | undefined)?.map((entry) => ({
          ...entry,
          title
        })),
        lastStatisticModified: game.row?.modified || 0
      };
    }

    const { rows } = await this.bookRows('statistics');

    return {
      // All days deleted is still an answer: REPLACE takes the deletions.
      statistics: rows.length
        ? live(rows).map((row) => ({ ...row.data, title }) as BooksDbStatistic)
        : undefined,
      lastStatisticModified: newest(rows) || 0
    };
  }

  async getReadingGoals() {
    const rows = await this.goalRows();

    return {
      readingGoals: rows.length
        ? live(rows).map((row) => row.data as BooksDbReadingGoal)
        : undefined,
      lastGoalModified: newest(rows) || 0
    };
  }

  getCover() {
    BaseStorageHandler.reportProgress();

    const { imagePath } = this.currentContext;

    return Promise.resolve(imagePath instanceof Blob ? imagePath : undefined);
  }

  async getAudioBook() {
    const { row } = await this.mediaRow('audiobook');
    const data = row?.data as BooksDbAudioBook | undefined;

    BaseStorageHandler.reportProgress();

    if (!data || this.isForBrowser) return data;

    return new File([JSON.stringify(data)], BaseStorageHandler.getAudioBookFileName(data), {
      type: 'application/json'
    });
  }

  async getSubtitleData() {
    const { row } = await this.mediaRow('subtitles');
    const data = row?.data as BooksDbSubtitleData | undefined;

    BaseStorageHandler.reportProgress();

    if (!data || this.isForBrowser) return data;

    return new File([JSON.stringify(data)], BaseStorageHandler.getSubtitleDataFileName(data), {
      type: 'application/json'
    });
  }

  /**
   * A Windows game's record goes to the account (never signed out); a Calibre book's text copy
   * (no images) to the server for its readings file and estimate, best effort: reading never
   * waits on it. Manga and game folders send nothing (each device loads the library's files).
   */
  async saveBook(data: Omit<BooksDbBookData, 'id'> | File) {
    if (data instanceof File) {
      BaseStorageHandler.reportProgress();
      return 0;
    }

    const { title } = this.currentContext;

    await this.state();

    if (isVn(data) && vnInfo(data).engine === 'vnbox') {
      if (!this.signedIn || this.holdPersonal) return 0;

      await signedInOr401(
        putFile(
          `games/${encodeURIComponent(title)}?modified=${data.lastBookModified || Date.now()}`,
          await this.zipBookData(data, 0.6),
          'application/zip'
        )
      );
    } else if (this.signedIn && !isVn(data) && !isManga(data)) {
      // The text PUT needs sign-in and shares the readings rate limit, so signed out it only burns that budget.
      const book = await bookIdOf(title);
      const text = JSON.stringify({
        elementHtml: data.elementHtml,
        sections: data.sections || [],
        styleSheet: data.styleSheet || ''
      });

      if (book !== undefined) {
        const gzipped = await new Response(
          new Response(text).body!.pipeThrough(new CompressionStream('gzip'))
        ).blob();

        await putFile(`books/${book}/text`, gzipped, 'application/gzip').catch((error) =>
          logger.warn(`${title}: the text copy wasn't uploaded: ${error.message}`)
        );
      }
    }

    this.addBookCard(title, {
      characters: BaseStorageHandler.getBookCharacters(data.characters || 0, data.sections || []),
      lastBookModified: data.lastBookModified || 0,
      lastBookOpen: data.lastBookOpen || 0
    });

    return 0;
  }

  /**
   * Saves a visual novel in this browser only, for this source: listed with its books, opened
   * from here (a Windows game, manage page).
   */
  async keepOnDevice(data: Omit<BooksDbBookData, 'id'>) {
    const { getStorageHandler } = await import('$lib/data/storage/storage-handler-factory');
    const id = await getStorageHandler(
      this.window,
      StorageKey.BROWSER,
      undefined,
      true,
      this.cacheStorageData,
      this.saveBehavior
    ).saveBook({ ...data, storageSource: this.storageSourceName }, false, false, this.cancelSignal);

    this.addDeviceVnCard(data);

    return id;
  }

  private personalWrite() {
    if (this.holdPersonal) throw unauthorizedError(true);
  }

  async saveProgress(data: BooksDbBookmarkData | File) {
    const progress: BooksDbBookmarkData =
      data instanceof File ? JSON.parse(await data.text()) : data;
    const { book } = await this.bookRows('progress');
    const game = await this.gameDoc('progress');

    this.personalWrite();
    // A book the server doesn't know (one a friend sent): its progress stays in this browser.
    if (book === undefined && !game) return;

    // 409: the server's row is newer and is now in the mirror; the next sync brings it down.
    await signedInOr401(
      putRow(
        game
          ? `games/${encodeURIComponent(this.currentContext.title)}/docs/progress`
          : `books/${book}/progress`,
        {
          modified: progress.lastBookmarkModified || 0,
          progress: bookmarkFraction(progress.progress),
          data: progress
        }
      )
    );

    this.addBookCard(this.currentContext.title, {
      lastBookmarkModified: progress.lastBookmarkModified || 0,
      progress: bookmarkFraction(progress.progress)
    });
  }

  /**
   * Days newer than the server's are written; REPLACE also deletes the server's days missing
   * from the list (in MERGE the list holds them all).
   */
  async saveStatistics(statistics: BooksDbStatistic[], lastStatisticModified: number) {
    const { book, rows } = await this.bookRows('statistics');
    const game = await this.gameDoc('statistics');

    this.personalWrite();
    if (book === undefined && !game) return;

    const isMerge = this.statisticsMergeMode === MergeMode.MERGE;
    const { statisticsToStore, newStatisticModified } = updateStatisticToStore(
      isMerge
        ? mergeStatistics(
            statistics,
            game ? game.row?.data || [] : live(rows).map((row) => row.data),
            this.saveBehavior === ReplicationSaveBehavior.NewOnly
          )
        : statistics,
      lastStatisticModified
    );

    if (game) {
      // The whole file as one row, as the game's sync folder held it.
      await signedInOr401(
        putRow(`games/${encodeURIComponent(this.currentContext.title)}/docs/statistics`, {
          modified: newStatisticModified,
          data: statisticsToStore
        })
      );
      this.addBookCard(this.currentContext.title, {});
      return;
    }

    await writeRows(
      rows,
      statisticsToStore.map((entry) => ({
        key: entry.dateKey,
        modified: entry.lastStatisticModified || lastStatisticModified,
        data: entry
      })),
      (dateKey) => `books/${book}/statistics/${dateKey}`,
      (row) => row.dateKey!,
      !isMerge
    );
    this.addBookCard(this.currentContext.title, {});
  }

  async saveReadingGoals(readingGoals: BooksDbReadingGoal[], lastGoalModified: number) {
    const rows = await this.goalRows();

    this.personalWrite();

    const isMerge = this.readingGoalsMergeMode === MergeMode.MERGE;
    const goals = isMerge
      ? mergeReadingGoals(
          readingGoals,
          live(rows).map((row) => row.data),
          this.saveBehavior === ReplicationSaveBehavior.NewOnly,
          lastGoalModified
        ).readingGoalsToStore
      : readingGoals;

    await writeRows(
      rows,
      goals.map((goal) => ({
        key: goal.goalStartDate,
        modified: goal.lastGoalModified || lastGoalModified,
        data: goal
      })),
      (start) => `goals/${start}`,
      (row) => row.goalStart!,
      !isMerge
    );
  }

  saveCover() {
    // The library has the cover; custom covers (PUT books/{id}/cover) aren't offered yet.
    BaseStorageHandler.reportProgress();
    return Promise.resolve();
  }

  async saveAudioBook(data: BooksDbAudioBook | File) {
    const audioBook: BooksDbAudioBook = data instanceof File ? JSON.parse(await data.text()) : data;

    await this.saveMedia('audiobook', audioBook.lastAudioBookModified, audioBook);
  }

  async saveSubtitleData(data: BooksDbSubtitleData | File) {
    const subtitles: BooksDbSubtitleData =
      data instanceof File ? JSON.parse(await data.text()) : data;

    await this.saveMedia('subtitles', subtitles.lastSubtitleDataModified, subtitles);
  }

  private async saveMedia(kind: MediaKind, modified: number, data: unknown) {
    const { book } = await this.mediaRow(kind);

    BaseStorageHandler.reportProgress();
    this.personalWrite();
    // A book the server doesn't know (one a friend sent): it stays in this browser.
    if (book === undefined) return;

    // 409: the server's row is newer and is now in the mirror; the next sync brings it down.
    await signedInOr401(putRow(`books/${book}/docs/${kind}`, { modified: modified || 0, data }));
  }

  updateLastRead() {
    // The open time is per account: the progress row's time (getBookList).
    return Promise.resolve();
  }

  /**
   * Removing a Calibre book only forgets it here (the library keeps it, and its rows stay for the
   * reader's other devices); a Windows game's record is deleted from the account.
   */
  async deleteBookData(
    booksToDelete: string[],
    cancelSignal: AbortSignal,
    keepLocalStatistics = false
  ) {
    let error = '';

    const deleted: number[] = [];
    const removedTitles: string[] = [];
    const limiter = pLimit(1);
    const mirror = await this.mirror();

    replicationProgress$.next({ progressBase: 1, maxProgress: booksToDelete.length });

    await Promise.all(
      booksToDelete.map((title) =>
        limiter(async () => {
          try {
            throwIfAborted(cancelSignal);

            if (this.gameRow(mirror, title)) {
              await signedInOr401(
                putFile(`games/${encodeURIComponent(title)}?modified=${Date.now()}`, undefined)
              );
            }

            removedTitles.push(title);

            const card = this.titleToBookCard.get(title);

            if (card) deleted.push(card.id);
            this.titleToBookCard.delete(title);
            database.dataListChanged$.next(this);
            BaseStorageHandler.reportProgress();
          } catch (err) {
            error = handleErrorDuringReplication(err, `Error deleting ${title}: `, [limiter]);
          }
        })
      )
    ).catch(() => {});

    error =
      (await this.deleteDeviceVns(removedTitles, cancelSignal, keepLocalStatistics).catch(
        (err) => err.message
      )) || error;

    return { error, deleted };
  }

  /** Lists the visual novels this browser keeps for this source (`keepOnDevice`). */
  private async addDeviceVns(only = isVn) {
    const books = await (await database.db).getAll('data');

    books
      .filter((book) => book.storageSource === this.storageSourceName && only(book))
      .forEach((book) => this.addDeviceVnCard(book));
  }

  /** Deletes the browser copies of visual novels kept on this device, or they would be listed again. */
  private async deleteDeviceVns(
    titles: string[],
    cancelSignal: AbortSignal,
    keepStatistics: boolean
  ) {
    const idToTitle = new Map<number, string>();

    for (const title of titles) {
      const book = await database.getDataByTitle(title);

      if (book?.storageSource === this.storageSourceName && isVn(book)) {
        idToTitle.set(book.id, title);
      }
    }

    if (!idToTitle.size) return '';

    return (
      await database.deleteData([...idToTitle.keys()], idToTitle, cancelSignal, keepStatistics)
    ).error;
  }

  private addDeviceVnCard(book: Omit<BooksDbBookData, 'id'>) {
    this.addBookCard(book.title, {
      imagePath: book.coverImage || '',
      characters: BaseStorageHandler.getBookCharacters(book.characters || 0, book.sections || []),
      lastBookModified: book.lastBookModified || 0,
      lastBookOpen: book.lastBookOpen || 0,
      vn: true
    });
  }

  private async processCalibreBook() {
    const { title } = this.currentContext;
    const calibreBook =
      this.titleToCalibreBook.get(title) ||
      (await loadCalibreCatalog()).find((book) => book.title === title);

    if (!calibreBook) {
      throw new Error(`${title} was not found in the Calibre library`);
    }

    // Not before `added`: a device clock behind the server's would make localCopyIsCurrent
    // take this copy for the old version and process the book again on every open.
    const lastBookModified = Math.max(Date.now(), calibreBook.added || 0);

    if (calibreBook.format === 'VN') {
      await this.saveLocally(
        await loadVnFolder(title, calibreVnUrl(calibreBook), lastBookModified)
      );
      return;
    }

    const file = await downloadCalibreBook(calibreBook);
    const { document } = this.window;

    let bookContent;

    switch (calibreBook.format) {
      case 'EPUB':
        bookContent = await loadEpub(file, document, lastBookModified);
        break;
      case 'TXT':
        bookContent = await loadTxt(file, lastBookModified);
        break;
      case 'CBZ':
      case 'ZIP':
        bookContent = await loadCbz(file, lastBookModified);
        break;
      default:
        bookContent = await loadHtmlz(file, document, lastBookModified);
        break;
    }

    // Keep the Calibre title rather than the one in the file, since titles identify books.
    bookContent.title = title;

    await this.saveBook(bookContent);
    await this.saveLocally(bookContent, bookContent.coverImage);
  }

  private async saveLocally(book: Omit<BooksDbBookData, 'id'>, cover?: Blob) {
    // Own instance: the shared one holds the context of the book being read, and books
    // are also processed in the background (offline-books.ts).
    const browserHandler = new BrowserStorageHandler(this.window, StorageKey.BROWSER);

    browserHandler.updateSettings(
      this.window,
      true,
      ReplicationSaveBehavior.Overwrite,
      statisticsMergeMode$.getValue(),
      readingGoalsMergeMode$.getValue()
    );

    browserHandler.startContext({ title: book.title, imagePath: cover || '' });
    await browserHandler.saveBook({ ...book, storageSource: this.storageSourceName }, false, false);

    if (cover) {
      await browserHandler.saveCover(cover);
    }

    // Ask the browser not to evict cached books. Chrome decides silently; needs HTTPS.
    storage.persist().catch(() => {});
  }

  private createBookCard(title: string): BookCardProps {
    const id = this.nextCardId;

    this.nextCardId += 1;

    return {
      id,
      title,
      imagePath: '',
      characters: 0,
      lastBookModified: 0,
      lastBookOpen: 0,
      progress: 0,
      lastBookmarkModified: 0,
      isPlaceholder: false
    };
  }
}
