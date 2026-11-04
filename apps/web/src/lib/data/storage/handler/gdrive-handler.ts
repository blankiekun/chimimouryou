/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import type {
  BooksDbAudioBook,
  BooksDbBookData,
  BooksDbBookmarkData,
  BooksDbReadingGoal,
  BooksDbStatistic,
  BooksDbSubtitleData
} from '$lib/data/database/books-db/versions/books-db';
import { gDriveRefreshEndpoint } from '$lib/data/env';
import { logger } from '$lib/data/logger';
import { MergeMode } from '$lib/data/merge-mode';
import { mergeReadingGoals, readingGoalSortFunction } from '$lib/data/reading-goal';
import { driveCoverPrefix } from '$lib/data/remote/server-connect';
import {
  BaseStorageHandler,
  FilePrefix,
  SyncConflictError,
  type ExternalFile,
  type SyncFileOptions,
  type SyncFileStore
} from '$lib/data/storage/handler/base-handler';
import { StorageOAuthManager, storageOAuthTokens } from '$lib/data/storage/storage-oauth-manager';
import { StorageKey } from '$lib/data/storage/storage-types';
import { database, gDriveStorageSource$ } from '$lib/data/store';
import { isVn } from '$lib/data/vn/vn';
import {
  convertAuthErrorResponse,
  handleErrorDuringReplication
} from '$lib/functions/replication/error-handler';
import { AbortError, throwIfAborted } from '$lib/functions/replication/replication-error';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
import { replicationProgress$, reportBytes } from '$lib/functions/replication/replication-progress';
import { mergeStatistics, updateStatisticToStore } from '$lib/functions/statistic-util';
import pLimit from 'p-limit';

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: XMLHttpRequestBodyInit | null | undefined;
  trackDownload?: boolean;
  trackUpload?: boolean;
  /** Resolve with the status and response headers too (`FullResponse`) */
  fullResponse?: boolean;
}

interface FullResponse {
  status: number;
  response: any;
  header: (name: string) => string | null;
}

interface GDriveFile extends ExternalFile {
  parents: string[];
}

const coverLimiter = pLimit(4);

/**
 * A book's cover file for `serverImage`. Only with a token still live: a cover never renews one or
 * opens a sign-in, and fails quietly until the next sync or listing has renewed it.
 */
export function driveCoverBlob(path: string) {
  const [id, ...source] = path.slice(driveCoverPrefix.length).split(':');

  return coverLimiter(async () => {
    const token = storageOAuthTokens.get(source.join(':'));

    if (!token || token.expiration <= Date.now()) throw new Error('No live Drive token');

    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
      headers: { Authorization: `Bearer ${token.accessToken}` }
    });

    if (!response.ok) throw new Error(`Received Status ${response.status}`);

    return response.blob();
  });
}

export class GDriveStorageHandler extends BaseStorageHandler implements SyncFileStore {
  private baseFileApiUrl = 'https://www.googleapis.com/drive/v3/files';

  private baseUploadApiUrl = 'https://www.googleapis.com/upload/drive/v3/files';

  static multipartLimit = 5 * 1024 * 1024;

  /** A multiple of 256 KiB, as Google requires for every chunk but the last */
  static chunkSize = 8 * 1024 * 1024;

  static chunkRetries = 3;

  private authManager = new StorageOAuthManager(gDriveRefreshEndpoint);

  private rootId = '';

  private titleToId = new Map<string, string>();

  private titleToFiles = new Map<string, ExternalFile[]>();

  /** Listed even with the cache on (`listFresh`). */
  private freshTitle = '';

  constructor(window: Window) {
    super(window, StorageKey.GDRIVE);
  }

  updateSettings(
    window: Window,
    isForBrowser: boolean,
    saveBehavior: ReplicationSaveBehavior,
    statisticsMergeMode: MergeMode,
    readingGoalsMergeMode: MergeMode,
    cacheStorageData: boolean,
    askForStorageUnlock: boolean,
    storageSourceName: string
  ) {
    this.window = window;
    this.isForBrowser = isForBrowser;
    this.saveBehavior = saveBehavior;
    this.cacheStorageData = cacheStorageData;
    this.askForStorageUnlock = askForStorageUnlock;
    this.statisticsMergeMode = statisticsMergeMode;
    this.readingGoalsMergeMode = readingGoalsMergeMode;
    this.setInternalSettings(storageSourceName);
  }

  listFresh() {
    this.titleToFiles.delete(this.currentContext.title);
    this.freshTitle = this.currentContext.title;
  }

  clearData(clearAll = true) {
    this.titleToFiles.clear();
    this.rootFiles.clear();
    this.rootFileListFetched = false;

    if (clearAll) {
      this.rootId = '';
      this.titleToId.clear();
      this.titleToBookCard.clear();
      this.dataListFetched = false;
    }
  }

  async hasLocalBookData(): Promise<boolean> {
    const data = await database.getDataByTitle(this.currentContext.title);

    return !!data?.elementHtml;
  }

  async prepareBookForReading(): Promise<number> {
    const data = await database.getDataByTitle(this.currentContext.title);

    let idToReturn = 0;
    let bookData: Omit<BooksDbBookData, 'id'> | undefined = data;

    if (!bookData || !bookData.elementHtml) {
      const { file } = await this.getExternalFile('bookdata_');

      bookData = file
        ? bookData || {
            title: this.currentContext.title,
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
          }
        : undefined;
    }

    if (!bookData) {
      throw new Error('No local or external book data found');
    }

    if (bookData.storageSource !== this.storageSourceName) {
      bookData.storageSource = this.storageSourceName;

      const { getStorageHandler } = await import('$lib/data/storage/storage-handler-factory');
      idToReturn = await getStorageHandler(
        this.window,
        StorageKey.BROWSER,
        undefined,
        true,
        this.cacheStorageData,
        ReplicationSaveBehavior.Overwrite
      ).saveBook(bookData, true, false);
    } else if (data?.id) {
      idToReturn = data.id;
    }

    return idToReturn;
  }

  async updateLastRead(book: BooksDbBookData) {
    const { titleId, files, file } = await this.getExternalFile('bookdata_');

    if (!file) {
      return;
    }

    const filename = BaseStorageHandler.getBookFileName(book);
    const { characters, lastBookModified, lastBookOpen } =
      BaseStorageHandler.getBookMetadata(filename);

    await this.upload(titleId, filename, files, file, undefined);

    this.addBookCard(this.currentContext.title, { characters, lastBookModified, lastBookOpen });
  }

  async getFilenameForRecentCheck(fileIdentifier: string) {
    if (this.saveBehavior === ReplicationSaveBehavior.Overwrite) {
      BaseStorageHandler.reportProgress();
      return undefined;
    }

    const { file } = this.validRootFiles.includes(fileIdentifier)
      ? await this.getRootFile(fileIdentifier)
      : await this.getExternalFile(fileIdentifier);

    BaseStorageHandler.completeStep();

    return file?.name;
  }

  async isBookPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return false;
    }

    const { file } = await this.getExternalFile('bookdata_');

    let isPresentAndUpToDate = false;

    if (file) {
      const { lastBookModified, lastBookOpen } =
        BaseStorageHandler.getBookMetadata(referenceFilename);
      const { lastBookModified: existingBookModified, lastBookOpen: existingBookOpen } =
        BaseStorageHandler.getBookMetadata(file.name);

      isPresentAndUpToDate = !!(
        existingBookModified &&
        lastBookModified &&
        existingBookModified >= lastBookModified &&
        (existingBookOpen || 0) >= (lastBookOpen || 0)
      );
    }

    BaseStorageHandler.completeStep();

    return isPresentAndUpToDate;
  }

  async isProgressPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return false;
    }

    // Asked when uploading: with a cached list, a retry of an older place replaces a newer one.
    if (this.cacheStorageData) this.listFresh();

    const { file } = await this.getExternalFile('progress_');

    return BaseStorageHandler.checkIsPresentAndUpToDate(
      BaseStorageHandler.getProgressMetadata,
      'lastBookmarkModified',
      referenceFilename,
      file?.name
    );
  }

  async areStatisticsPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return false;
    }

    const { file } = await this.getExternalFile('statistics_');

    return BaseStorageHandler.checkIsPresentAndUpToDate(
      BaseStorageHandler.getStatisticsMetadata,
      'lastStatisticModified',
      referenceFilename,
      file?.name
    );
  }

  async areReadingGoalsPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return false;
    }

    const { file } = await this.getRootFile(BaseStorageHandler.readingGoalsFilePrefix);

    return BaseStorageHandler.checkIsPresentAndUpToDate(
      BaseStorageHandler.getReadingGoalsMetadata,
      'lastGoalModified',
      referenceFilename,
      file?.name
    );
  }

  async isAudioBookPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();

      return false;
    }

    const { file } = await this.getExternalFile(FilePrefix.AUDIO_BOOK);

    return BaseStorageHandler.checkIsPresentAndUpToDate<BooksDbAudioBook>(
      BaseStorageHandler.getAudioBookMetadata,
      'lastAudioBookModified',
      referenceFilename,
      file?.name
    );
  }

  async isSubtitleDataPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();

      return false;
    }

    const { file } = await this.getExternalFile(FilePrefix.SUBTITLE);

    return BaseStorageHandler.checkIsPresentAndUpToDate<BooksDbSubtitleData>(
      BaseStorageHandler.getSubtitleDataMetadata,
      'lastSubtitleDataModified',
      referenceFilename,
      file?.name
    );
  }

  /**
   * In the browser, a copy cached for this source that is at least as new as the remote one is
   * used as is (undefined: nothing to take over), so opening a book doesn't download it again.
   */
  async getBook() {
    if (this.isForBrowser) {
      const localData = await database.getDataByTitle(this.currentContext.title);

      if (localData?.elementHtml && localData.storageSource === this.storageSourceName) {
        const { file } = await this.getExternalFile('bookdata_');
        const remoteModified = file
          ? BaseStorageHandler.getBookMetadata(file.name).lastBookModified
          : 0;

        if ((localData.lastBookModified || 0) >= (remoteModified || 0)) {
          return undefined;
        }
      }
    }

    return this.downloadBook();
  }

  private async downloadBook() {
    const { file, data } = await this.getExternalFile(
      'bookdata_',
      'blob',
      this.isForBrowser ? 0.7 : 1
    );

    if (!file) {
      return undefined;
    }

    return this.isForBrowser
      ? this.extractBookData(data, file.name, 0.3)
      : new File([data], file.name, { type: 'application/zip' });
  }

  async getProgress() {
    const { file, data } = await this.getExternalFile('progress_', 'json');

    if (!file) {
      return undefined;
    }

    return this.isForBrowser
      ? data
      : new File([new Blob([JSON.stringify(data)])], file.name, { type: 'application/json' });
  }

  /** Older duplicates (two devices uploading at once) can hold days the newest lacks. */
  private async withDuplicateStatistics(
    files: ExternalFile[],
    file: ExternalFile | undefined,
    data: BooksDbStatistic[] | undefined
  ) {
    const others = files.filter((other) => other !== file && other.name.startsWith('statistics_'));

    if (!others.length) return data;

    const rows = await Promise.all(
      others.map((other) => this.retrieve(other, 'json').catch(() => undefined))
    );

    return rows.reduce<BooksDbStatistic[] | undefined>(
      (merged, row) => (Array.isArray(row) ? mergeStatistics(row, merged) : merged),
      data
    );
  }

  async getStatistics() {
    const { file, files, data } = await this.getExternalFile('statistics_', 'json');

    if (!file) {
      return { statistics: undefined, lastStatisticModified: 0 };
    }

    return {
      statistics: await this.withDuplicateStatistics(files, file, data),
      lastStatisticModified: BaseStorageHandler.getStatisticsMetadata(file.name)
        .lastStatisticModified
    };
  }

  async getCover() {
    if (this.currentContext.imagePath instanceof Blob) {
      BaseStorageHandler.reportProgress();

      return this.currentContext.imagePath;
    }

    const { data } = await this.getExternalFile('cover_', 'blob');

    return data;
  }

  async getReadingGoals() {
    const { file, data } = await this.getRootFile(
      BaseStorageHandler.readingGoalsFilePrefix,
      'json'
    );

    if (!file) {
      return { readingGoals: undefined, lastGoalModified: 0 };
    }

    return {
      readingGoals: data,
      lastGoalModified: BaseStorageHandler.getReadingGoalsMetadata(file.name).lastGoalModified
    };
  }

  async getAudioBook() {
    const { file, data } = await this.getExternalFile(FilePrefix.AUDIO_BOOK, 'json');

    if (!file) {
      return undefined;
    }

    return this.isForBrowser
      ? data
      : new File([new Blob([JSON.stringify(data)])], file.name, { type: 'application/json' });
  }

  async getSubtitleData() {
    const { file, data } = await this.getExternalFile(FilePrefix.SUBTITLE, 'json');

    if (!file) {
      return undefined;
    }

    return this.isForBrowser
      ? data
      : new File([new Blob([JSON.stringify(data)])], file.name, { type: 'application/json' });
  }

  async saveBook(data: Omit<BooksDbBookData, 'id'> | File, skipTimestampFallback = true) {
    const { titleId, files, file } = await this.getExternalFile('bookdata_', '', 0.2, false);
    const filename = BaseStorageHandler.getBookFileName(
      data,
      skipTimestampFallback ? '' : file?.name
    );
    const { characters, lastBookModified, lastBookOpen } =
      BaseStorageHandler.getBookMetadata(filename);

    if (file && this.saveBehavior === ReplicationSaveBehavior.NewOnly) {
      const { lastBookModified: existingBookModified, lastBookOpen: existingBookOpen } =
        BaseStorageHandler.getBookMetadata(file.name);

      if (
        existingBookModified &&
        lastBookModified &&
        existingBookModified >= lastBookModified &&
        (existingBookOpen || 0) >= (lastBookOpen || 0)
      ) {
        return 0;
      }
    }

    if (data instanceof File) {
      await this.upload(titleId, filename, files, file, data);
    } else {
      await this.upload(titleId, filename, files, file, await this.zipBookData(data, 0.2), '', 0.6);
    }

    this.addBookCard(this.currentContext.title, { characters, lastBookModified, lastBookOpen });

    return 0;
  }

  /** Lists the visual novels this browser keeps for this source (`keepOnDevice`). */
  private async addDeviceVns(only = isVn) {
    const books = await (await database.db).getAll('data');

    books
      .filter((book) => book.storageSource === this.storageSourceName && only(book))
      .forEach((book) => this.addDeviceVnCard(book));
  }

  async saveProgress(data: File | BooksDbBookmarkData) {
    const filename = BaseStorageHandler.getProgressFileName(data);
    const progressData = data instanceof File ? data : JSON.stringify(data);
    const { titleId, files, file } = await this.getExternalFile('progress_', '', 0.2, false);
    const { lastBookmarkModified, progress } = BaseStorageHandler.getProgressMetadata(filename);

    await this.upload(titleId, filename, files, file, progressData);
    await this.deleteOlderProgress(files, file, lastBookmarkModified);

    this.addBookCard(this.currentContext.title, { lastBookmarkModified, progress });
  }

  /**
   * Leftover progress files (a failed DELETE, two devices saving at once) older than the one just
   * saved: best effort, the reader picks the newest anyway. Not statistics: an older duplicate can
   * hold days the newest lacks.
   */
  private async deleteOlderProgress(
    files: ExternalFile[],
    replaced: ExternalFile | undefined,
    savedTime: number
  ) {
    const older = files.filter(
      (other) =>
        other !== replaced &&
        other.name.startsWith('progress_') &&
        BaseStorageHandler.getProgressMetadata(other.name).lastBookmarkModified < savedTime
    );

    if (!older.length) return;

    const deleted = new Set<ExternalFile>();

    await Promise.all(
      older.map((other) =>
        this.executeDelete(other.id).then(
          () => deleted.add(other),
          () => {}
        )
      )
    );
    this.titleToFiles.set(
      this.currentContext.title,
      (this.titleToFiles.get(this.currentContext.title) || files).filter(
        (other) => !deleted.has(other)
      )
    );
  }

  async saveStatistics(statistics: BooksDbStatistic[], lastStatisticModified: number) {
    const isMerge = this.statisticsMergeMode === MergeMode.MERGE;
    const {
      titleId,
      files,
      file,
      data: existingData
    } = await this.getExternalFile('statistics_', isMerge ? 'json' : '', 0.2, false);

    let statisticsToStore: BooksDbStatistic[] = statistics;
    let newStatisticModified = lastStatisticModified;

    if (isMerge) {
      statisticsToStore = mergeStatistics(
        statistics,
        await this.withDuplicateStatistics(files, file, existingData),
        this.saveBehavior === ReplicationSaveBehavior.NewOnly
      );
    }

    ({ statisticsToStore, newStatisticModified } = updateStatisticToStore(
      statisticsToStore,
      newStatisticModified
    ));

    // The source's own time too: it can be above every row after reading below a future-dated one
    // or a deletion, and other devices pull only for a newer name.
    const filename = BaseStorageHandler.getStatisticsFileName(
      statisticsToStore,
      Math.max(newStatisticModified, lastStatisticModified)
    );

    await this.upload(titleId, filename, files, file, JSON.stringify(statisticsToStore));

    this.addBookCard(this.currentContext.title, {});
  }

  async saveCover(data: Blob | undefined) {
    if (!data) {
      BaseStorageHandler.reportProgress();
      return;
    }

    const { titleId, files, file } = await this.getExternalFile('cover_', '', 0.2, false);

    if (!file?.id) {
      const filename = await BaseStorageHandler.getCoverFileName(data);

      await this.upload(titleId, filename, files, undefined, data);
    }

    if (this.titleToBookCard.has(this.currentContext.title)) {
      this.addBookCard(this.currentContext.title, { imagePath: data });
    }
  }

  async saveReadingGoals(readingGoals: BooksDbReadingGoal[], lastGoalModified: number) {
    const isMerge = this.readingGoalsMergeMode === MergeMode.MERGE;
    const { file, data: existingData } = await this.getRootFile(
      BaseStorageHandler.readingGoalsFilePrefix,
      isMerge ? 'json' : '',
      0.2
    );

    let readingGoalsToStore: BooksDbReadingGoal[] = readingGoals;
    let newReadingGoalModified = lastGoalModified;

    if (isMerge) {
      ({ readingGoalsToStore, newReadingGoalModified } = mergeReadingGoals(
        readingGoals,
        existingData,
        this.saveBehavior === ReplicationSaveBehavior.NewOnly,
        lastGoalModified
      ));
    }

    const filename = BaseStorageHandler.getReadingGoalsFileName(newReadingGoalModified);

    readingGoalsToStore.sort(readingGoalSortFunction);

    await this.upload(
      this.rootId,
      filename,
      [],
      file,
      JSON.stringify(readingGoalsToStore),
      BaseStorageHandler.readingGoalsFilePrefix
    );
  }

  async saveAudioBook(data: BooksDbAudioBook | File) {
    const filename = BaseStorageHandler.getAudioBookFileName(data);
    const audioBookData = data instanceof File ? data : JSON.stringify(data);
    const { titleId, files, file } = await this.getExternalFile(
      FilePrefix.AUDIO_BOOK,
      '',
      0.2,
      false
    );

    await this.upload(titleId, filename, files, file, audioBookData);
  }

  async saveSubtitleData(data: BooksDbSubtitleData | File) {
    const filename = BaseStorageHandler.getSubtitleDataFileName(data);
    const subtitleData = data instanceof File ? data : JSON.stringify(data);
    const { titleId, files, file } = await this.getExternalFile(
      FilePrefix.SUBTITLE,
      '',
      0.2,
      false
    );

    await this.upload(titleId, filename, files, file, subtitleData);
  }

  async deleteBookData(
    booksToDelete: string[],
    cancelSignal: AbortSignal,
    keepLocalStatistics = false
  ) {
    await this.ensureTitle();

    let error = '';

    const deleted: number[] = [];
    const removedTitles: string[] = [];
    const deletionLimiter = pLimit(1);
    const deleteTasks: Promise<void>[] = [];

    replicationProgress$.next({ progressBase: 1, maxProgress: booksToDelete.length });

    booksToDelete.forEach((bookToDelete) =>
      deleteTasks.push(
        deletionLimiter(async () => {
          try {
            throwIfAborted(cancelSignal);

            const externalId = this.titleToId.get(bookToDelete);

            if (externalId) {
              await this.executeDelete(externalId);
            }

            removedTitles.push(bookToDelete);

            this.titleToFiles.delete(bookToDelete);

            const deletedBookCard = this.titleToBookCard.get(bookToDelete);

            if (deletedBookCard) {
              deleted.push(deletedBookCard.id);
            }

            this.titleToId.delete(bookToDelete);
            this.titleToBookCard.delete(bookToDelete);

            database.dataListChanged$.next(this);

            BaseStorageHandler.reportProgress();
          } catch (err) {
            error = handleErrorDuringReplication(err, `Error deleting ${bookToDelete}: `, [
              deletionLimiter
            ]);
          }
        })
      )
    );

    await Promise.all(deleteTasks).catch(() => {});

    error =
      (await this.deleteDeviceVns(removedTitles, cancelSignal, keepLocalStatistics).catch(
        (err) => err.message
      )) || error;

    return { error, deleted };
  }

  private async request(
    url: string,
    options: RequestOptions = {},
    type: XMLHttpRequestResponseType = 'json',
    progressBase = 1
  ): Promise<any> {
    const token = await this.authManager.getToken(
      this.window,
      this.storageSourceName,
      this.askForStorageUnlock
    );
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.responseType = type;

      xhr.addEventListener('abort', () => {
        reject(new AbortError());
      });

      if (options.trackDownload) {
        this.currentLastProgressValue = 0;
        this.currentProgressBase = progressBase;

        xhr.onprogress = (event: ProgressEvent) => {
          if (self.cancelSignal?.aborted) {
            xhr.abort();
            return;
          }

          if (event.lengthComputable) {
            self.reportFunction(event.loaded, event.total);
          }
        };
      }

      if (options.trackUpload) {
        this.currentLastProgressValue = 0;
        this.currentProgressBase = progressBase;

        xhr.upload.onprogress = (event: ProgressEvent) => {
          if (self.cancelSignal?.aborted) {
            xhr.abort();
            return;
          }

          if (event.lengthComputable) {
            self.reportFunction(event.loaded, event.total);
          }
        };
      }

      xhr.addEventListener(
        'readystatechange',
        async function stateHandler() {
          if (this.readyState === 4) {
            if (this.status >= 200 && this.status < 400) {
              resolve(
                options.fullResponse
                  ? {
                      status: this.status,
                      response: this.response,
                      header: (name: string) => this.getResponseHeader(name)
                    }
                  : this.response
              );
            } else {
              const errorMessage = await convertAuthErrorResponse(this);

              if (this.status === 404) {
                logger.error(errorMessage);
                reject(new Error('Resource not found. Refresh your current tab and try again'));
              } else {
                reject(Object.assign(new Error(errorMessage), { status: this.status }));
              }
            }
          }
        },
        false
      );

      xhr.open(options.method || 'GET', url, true);

      if (options.headers) {
        const entries = Object.entries(options.headers);

        for (let index = 0, { length } = entries; index < length; index += 1) {
          const [headerName, headerValue] = entries[index];

          xhr.setRequestHeader(headerName, headerValue);
        }
      }

      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      xhr.send(options.body || null);
    });
  }

  private async getExternalFile(
    fileIdentifier: string,
    typeToRetrieve: XMLHttpRequestResponseType = '',
    progressBase = 1,
    readOnly = true
  ) {
    const progressPerStep = progressBase / 5;

    await this.ensureTitle();

    BaseStorageHandler.reportProgress(progressPerStep);

    const titleId = await this.ensureTitle(this.currentContext.title, this.rootId, readOnly);

    BaseStorageHandler.reportProgress(progressPerStep);

    if (!titleId) {
      return { titleId: '', file: undefined, files: [], data: undefined };
    }

    const files = await this.getExternalFiles(titleId);
    const file = BaseStorageHandler.findFile(files, fileIdentifier);

    BaseStorageHandler.reportProgress(progressPerStep);

    if (!file) {
      return { titleId, file: undefined, files, data: undefined };
    }

    let data;

    if (typeToRetrieve) {
      data = await this.retrieve(file, typeToRetrieve, progressPerStep * 2);
    }

    return { titleId, file, files, data };
  }

  private async getRootFile(
    fileIdentifier: string,
    typeToRetrieve: XMLHttpRequestResponseType = '',
    progressBase = 1
  ) {
    const progressPerStep = progressBase / 3;

    await this.ensureTitle();

    BaseStorageHandler.reportProgress(progressPerStep);

    await this.setRootFiles();

    const file = this.rootFiles.get(fileIdentifier);

    BaseStorageHandler.reportProgress(progressPerStep);

    if (!file) {
      return { file: undefined, data: undefined };
    }

    let data;

    if (typeToRetrieve) {
      data = await this.retrieve(file, typeToRetrieve, progressPerStep);
    }

    return { file, data };
  }

  private updateAfterUpload(
    id: string,
    name: string,
    files: ExternalFile[],
    remoteFile: ExternalFile | undefined,
    extraData = {},
    rootFilePrefix?: string
  ) {
    if (rootFilePrefix) {
      this.rootFiles.set(rootFilePrefix, { id, name });
    } else if (remoteFile) {
      const titleFiles = files.map((file) => {
        const updatedFile = file;
        if (file.name === remoteFile.name) {
          updatedFile.name = name;
        }

        return updatedFile;
      });

      this.titleToFiles.set(this.currentContext.title, titleFiles);
    } else {
      files.push({ id, name, ...extraData });

      this.titleToFiles.set(this.currentContext.title, files);
    }
  }

  private setInternalSettings(storageSourceName: string) {
    const newStorageSource = storageSourceName || gDriveStorageSource$.getValue();

    if (newStorageSource !== this.storageSourceName) {
      this.clearData();
    }

    this.storageSourceName = newStorageSource;
  }

  async getBookList() {
    if (!this.dataListFetched) {
      database.listLoading$.next(true);

      try {
        await this.ensureTitle();

        const titles = await this.list(
          `trashed=false and mimeType='application/vnd.google-apps.folder' and '${this.rootId}' in parents`,
          'files(id,name),nextPageToken'
        );
        const titleIdToName = new Map<string, string>();

        for (let index = 0, { length } = titles; index < length; index += 1) {
          const title = titles[index];
          const desanitizedTitle = BaseStorageHandler.desanitizeFilename(title.name);

          // Two devices can make a book's folder at once: the oldest is the one, as in `ensureTitle`.
          if (!this.titleToId.has(desanitizedTitle)) this.titleToId.set(desanitizedTitle, title.id);
          titleIdToName.set(title.id, desanitizedTitle);
        }

        if (titles.length) {
          const titleIdChunks = [];

          for (let index = 0, { length } = titles; index < length; index += 50) {
            titleIdChunks.push(titles.slice(index, index + 50).map((title) => title.id));
          }

          const listLimiter = pLimit(1);
          const listTasks: Promise<void>[] = [];

          titleIdChunks.forEach((titleIdChunk) =>
            listTasks.push(
              listLimiter(async () => {
                this.setTitleData(
                  this.groupExternalFiles(
                    await this.list(
                      `trashed=false and ('${titleIdChunk.join(`' in parents or '`)}' in parents)`,
                      'files(id,name,parents),nextPageToken'
                    ),
                    titleIdToName
                  )
                );
              })
            )
          );

          await Promise.all(listTasks).catch((error) => {
            listLimiter.clearQueue();
            throw error;
          });
        }

        await this.addDeviceVns();
        this.dataListFetched = true;
      } catch (error) {
        this.clearData();
        throw error;
      }
    }

    return [...this.titleToBookCard.values()];
  }

  private async ensureTitle(name = BaseStorageHandler.rootName, parent = 'root', readOnly = false) {
    if (name === BaseStorageHandler.rootName && this.rootId) {
      return this.rootId;
    }

    const externalId = this.titleToId.get(name);

    if (externalId) {
      return externalId;
    }

    const sanitizedName = BaseStorageHandler.sanitizeForFilename(name);
    const params = new URLSearchParams();

    params.append('corpora', 'user');
    params.append('spaces', 'drive');
    params.append('fields', 'files(id)');
    params.append('orderBy', 'createdTime');
    params.append(
      'q',
      `trashed=false and '${parent}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = "${sanitizedName}"`
    );

    let titleId: string = (await this.request(`${this.baseFileApiUrl}?${params.toString()}`))
      ?.files?.[0]?.id;

    if (!titleId && !readOnly) {
      const body = JSON.stringify({
        mimeType: 'application/vnd.google-apps.folder',
        name: sanitizedName,
        parents: [parent]
      });

      const response = await this.request(this.baseFileApiUrl, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' }
      });

      titleId = response.id;
    }

    if (titleId) {
      this.titleToId.set(name, titleId);
    }

    if (titleId && name === BaseStorageHandler.rootName) {
      this.rootId = titleId;
    }

    if (!titleId && name === BaseStorageHandler.rootName) {
      throw new Error('Root folder not found');
    }

    return titleId;
  }

  private async getExternalFiles(remoteTitleId: string) {
    if (
      (!this.cacheStorageData ||
        !this.dataListFetched ||
        this.freshTitle === this.currentContext.title) &&
      !this.titleToFiles.has(this.currentContext.title)
    ) {
      const externalFiles = await this.list(
        `trashed=false and '${remoteTitleId}' in parents`,
        'files(id,name,parents)'
      );

      if (externalFiles.length) {
        const groupedExternalFiles = new Map<string, GDriveFile[]>();

        groupedExternalFiles.set(this.currentContext.title, externalFiles);
        this.setTitleData(groupedExternalFiles);
      }
    }

    return this.titleToFiles.get(this.currentContext.title) || [];
  }

  private async setRootFiles() {
    if ((!this.cacheStorageData || !this.rootFileListFetched) && !this.rootFiles.size) {
      const rootFiles = await this.list(
        `trashed=false and mimeType!='application/vnd.google-apps.folder' and '${this.rootId}' in parents`,
        'files(id,name)'
      );

      for (let index = 0, { length } = rootFiles; index < length; index += 1) {
        const rootFile = rootFiles[index];

        this.setRootFile(rootFile.name, rootFile);
      }

      this.rootFileListFetched = true;
    }
  }

  private retrieve(
    file: ExternalFile,
    typeToRetrieve: XMLHttpRequestResponseType,
    progressBase = 1
  ) {
    const params = new URLSearchParams();
    params.append('fields', 'files(name)');
    params.append('alt', 'media');

    return this.request(
      `${this.baseFileApiUrl}/${file.id}?${params.toString()}`,
      { trackDownload: true },
      typeToRetrieve,
      progressBase
    );
  }

  private async upload(
    folderId: string,
    name: string,
    files: ExternalFile[],
    externalFile: ExternalFile | undefined,
    data: Blob | string | undefined,
    rootFilePrefix?: string,
    progressBase = 0.8
  ): Promise<GDriveFile> {
    const metadata = JSON.stringify(externalFile ? { name } : { name, parents: [folderId] });
    const url = `${this.baseUploadApiUrl}${externalFile ? `/${externalFile.id}` : ''}`;
    const method = externalFile ? 'PATCH' : 'POST';
    const blob = data instanceof Blob ? data : undefined;
    let response;

    // Google takes multipart uploads only up to 5 MB: larger files go up in resumable chunks.
    if (blob && blob.size > GDriveStorageHandler.multipartLimit) {
      response = await this.uploadResumable(url, method, metadata, blob, progressBase);
    } else {
      const form = new FormData();

      form.append('resource', new Blob([metadata], { type: 'application/json' }));

      if (data) {
        form.append('file', data);
      }

      response = await this.request(
        `${url}?uploadType=multipart`,
        { method, body: form, trackUpload: true },
        'json',
        progressBase
      );
    }

    this.updateAfterUpload(
      response.id,
      response.name,
      files,
      externalFile,
      {
        parents: [folderId]
      },
      rootFilePrefix
    );

    return response;
  }

  /**
   * The place in one request that outlives the page, only with the file's id and a live token in
   * hand: a phone may freeze or end a hidden page before a lookup returns. The name carries the
   * time and fraction other devices read. Anything else is left to the normal sync.
   */
  async sendProgressNow(title: string, progress: BooksDbBookmarkData) {
    const token = storageOAuthTokens.get(this.storageSourceName);
    const file = BaseStorageHandler.findFile(this.titleToFiles.get(title) || [], 'progress_');
    const name = BaseStorageHandler.getProgressFileName(progress);
    const { lastBookmarkModified, progress: fraction } =
      BaseStorageHandler.getProgressMetadata(name);

    if (
      !file ||
      !token ||
      token.expiration <= Date.now() ||
      BaseStorageHandler.getProgressMetadata(file.name).lastBookmarkModified >= lastBookmarkModified
    ) {
      return;
    }

    const form = new FormData();

    form.append('resource', new Blob([JSON.stringify({ name })], { type: 'application/json' }));
    form.append('file', JSON.stringify(progress));

    try {
      const response = await fetch(`${this.baseUploadApiUrl}/${file.id}?uploadType=multipart`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token.accessToken}` },
        body: form,
        keepalive: true
      });

      if (!response.ok) throw new Error(`Received Status ${response.status}`);

      file.name = name;
      this.addBookCard(title, { lastBookmarkModified, progress: fraction });
    } catch (error: any) {
      logger.warn(`Progress not sent yet: ${error.message}`);
    }
  }

  /** Resumable upload: open a session, then PUT `chunkSize` slices until Google answers 200/201. */
  private async uploadResumable(
    url: string,
    method: string,
    metadata: string,
    blob: Blob,
    progressBase: number
  ) {
    const { size } = blob;
    const session: FullResponse = await this.request(`${url}?uploadType=resumable`, {
      method,
      body: metadata,
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': blob.type || 'application/octet-stream',
        'X-Upload-Content-Length': `${size}`
      },
      fullResponse: true
    });
    const sessionUrl = session.header('Location');

    if (!sessionUrl) {
      throw new Error('Upload url was not returned');
    }

    let start = 0;
    let failures = 0;

    for (;;) {
      const end = Math.min(start + GDriveStorageHandler.chunkSize, size);
      let result: FullResponse | undefined;
      let sent = true;

      try {
        result = await this.request(
          sessionUrl,
          {
            method: 'PUT',
            body: blob.slice(start, end),
            headers: { 'Content-Range': `bytes ${start}-${end - 1}/${size}` },
            trackUpload: true,
            fullResponse: true
          },
          'json',
          (progressBase * (end - start)) / size
        );
      } catch (error) {
        sent = false;
        failures += 1;

        if (error instanceof AbortError || failures > GDriveStorageHandler.chunkRetries) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** failures));

        // Ask how much arrived; on failure the same chunk is sent again.
        result = await this.request(sessionUrl, {
          method: 'PUT',
          headers: { 'Content-Range': `bytes */${size}` },
          fullResponse: true
        }).catch(() => undefined);
      }

      if (result && result.status !== 308) {
        return result.response;
      }

      if (result) {
        // No Range header: nothing was received yet.
        const range = result.header('Range');
        const received = range ? Number(range.slice(range.lastIndexOf('-') + 1)) + 1 : 0;

        if (received > start) {
          failures = 0;
        } else if (sent && ++failures > GDriveStorageHandler.chunkRetries) {
          throw new Error('Google Drive did not accept the upload');
        }

        start = received;
        reportBytes('uploading', start, size);
      }
    }
  }

  /** An extra file in the root folder or a book's folder (`sync-files.ts`); its version is Drive's. */
  async readSyncFile(name: string, title?: string) {
    const file = await this.findSyncFile(name, await this.syncFolder(title));

    if (!file) return undefined;

    const text: string = await this.request(
      `${this.baseFileApiUrl}/${file.id}?alt=media`,
      {},
      'text'
    );

    return { text, version: file.version };
  }

  /** Writes into books already on Drive only; looks the file up again, as Drive allows two of one name. */
  async writeSyncFile(name: string, text: string, { title, version }: SyncFileOptions = {}) {
    const folderId = await this.syncFolder(title);

    if (!folderId) return;

    const file = await this.findSyncFile(name, folderId);

    if (version !== undefined && (file?.version ?? '') !== version) {
      throw new SyncConflictError();
    }

    await this.upload(folderId, name, [], file, new Blob([text], { type: 'application/json' }));
  }

  private async syncFolder(title?: string) {
    const rootId = await this.ensureTitle();

    return title === undefined ? rootId : this.ensureTitle(title, rootId, true);
  }

  private async findSyncFile(name: string, folderId: string) {
    if (!folderId) return undefined;

    const [file] = await this.list(
      `trashed=false and '${folderId}' in parents and name='${name}'`,
      'files(id,name,version)'
    );

    return file as (GDriveFile & { version: string }) | undefined;
  }

  private executeDelete(id: string) {
    return this.request(`${this.baseFileApiUrl}/${id}`, { method: 'DELETE' });
  }

  private async list(
    query: string,
    fields: string,
    files: GDriveFile[] = [],
    pageToken = ''
  ): Promise<GDriveFile[]> {
    const params = new URLSearchParams();
    params.append('corpora', 'user');
    params.append('spaces', 'drive');
    params.append('fields', fields);
    // Folders: the oldest first, so every device picks the same one of two.
    params.append('orderBy', 'createdTime');
    params.append('q', query);

    if (pageToken) {
      params.append('pageToken', pageToken);
    }

    const response = await this.request(`${this.baseFileApiUrl}?${params.toString()}`);

    if (response) {
      files.push(...(response.files || []));

      if (response.nextPageToken) {
        await this.list(query, fields, files, response.nextPageToken);
      }
    }

    return files;
  }

  private groupExternalFiles(remoteFiles: GDriveFile[], titleIdToName: Map<string, string>) {
    const groupedExternalFiles = new Map<string, GDriveFile[]>();

    for (let index = 0, { length } = remoteFiles; index < length; index += 1) {
      const remoteFile = remoteFiles[index];
      const title = titleIdToName.get(remoteFile.parents[0]);

      if (title) {
        const groupedFiles = groupedExternalFiles.get(title) || [];

        groupedFiles.push(remoteFile);
        groupedExternalFiles.set(title, groupedFiles);
      }
    }

    return groupedExternalFiles;
  }

  private setTitleData(groupedExternalFiles: Map<string, GDriveFile[]>) {
    const entries = [...groupedExternalFiles.entries()];

    for (let index = 0, { length } = entries; index < length; index += 1) {
      const [title, files] = entries[index];

      if (!files.length) {
        return;
      }

      const bookCard: BookCardProps = {
        id: BaseStorageHandler.getDummyId(),
        title,
        imagePath: '',
        characters: 0,
        lastBookModified: 0,
        lastBookOpen: 0,
        progress: 0,
        lastBookmarkModified: 0,
        isPlaceholder: false
      };

      for (let index2 = 0, { length: length2 } = files; index2 < length2; index2 += 1) {
        const file = files[index2];

        if (file.name.startsWith('bookdata_')) {
          const { characters, lastBookModified, lastBookOpen } = BaseStorageHandler.getBookMetadata(
            file.name
          );

          bookCard.characters = characters;
          bookCard.lastBookModified = lastBookModified;
          bookCard.lastBookOpen = lastBookOpen;
        } else if (file.name.startsWith('progress_')) {
          const { progress, lastBookmarkModified } = BaseStorageHandler.getProgressMetadata(
            file.name
          );

          bookCard.progress = progress;
          bookCard.lastBookmarkModified = lastBookmarkModified;
        } else if (file.name.startsWith('cover_')) {
          bookCard.imagePath = `${driveCoverPrefix}${file.id}:${this.storageSourceName}`;
        }
      }

      this.titleToFiles.set(title, files);
      this.titleToBookCard.set(title, bookCard);
    }
  }
}
