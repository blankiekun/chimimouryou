/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Storage source backed by the self-hosted Calibre library. Not part of upstream.
 *
 * The book list is the Calibre catalog. Reader data (processed books, progress,
 * statistics, ...) is stored on the server through nginx WebDAV at /calibre/sync/,
 * using the same folder-per-title layout as the GDrive/OneDrive handlers.
 * A book is processed from its Calibre file the first time it is opened.
 *
 * While signed in to an account (lib/data/account.ts), the files that belong to a
 * reader rather than to the book (progress, statistics, reading goals and
 * highlights) live in the same layout under the account's /account/sync/ folder.
 */

import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import { accountReady, accountSyncUrl, currentAccount } from '$lib/data/account';
import { readerDataOwner } from '$lib/data/reader-data-owner';
import {
  calibreCoverUrl,
  calibreVnUrl,
  downloadCalibreBook,
  loadCalibreCatalog,
  loadCalibreDifficulty,
  type CalibreBook
} from '$lib/data/calibre';
import { ApiStorageHandler, type RequestOptions } from '$lib/data/storage/handler/api-handler';
import { serverConnected, serverFetch, serverHeaders, serverUrl } from '$lib/data/server-connect';
import {
  BaseStorageHandler,
  type ExternalFile,
  type SyncFileOptions
} from '$lib/data/storage/handler/base-handler';
import { BrowserStorageHandler } from '$lib/data/storage/handler/browser-handler';
import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import { StorageKey, StorageSourceDefault } from '$lib/data/storage/storage-types';
import { applySeriesOverride, loadSeriesOverrides } from '$lib/data/series-overrides';
import { applyMetadata, loadBookMetadata } from '$lib/data/book-metadata';
import {
  database,
  libraryBuilding$,
  libraryOffline$,
  readingGoalsMergeMode$,
  statisticsMergeMode$
} from '$lib/data/store';
import { storage } from '$lib/data/window/navigator/storage';
import loadEpub from '$lib/functions/file-loaders/epub/load-epub';
import loadHtmlz from '$lib/functions/file-loaders/htmlz/load-htmlz';
import loadTxt from '$lib/functions/file-loaders/txt/load-txt';
import loadCbz from '$lib/functions/file-loaders/cbz/load-cbz';
import { loadVnFolder } from '$lib/functions/file-loaders/vn/load-vn';
import { deleteOrphanVnCaches, isVn, vnInfo } from '$lib/data/vn';
import { isManga } from '$lib/data/manga';
import { levelOf } from '$lib/data/difficulty-core';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
import { writableArrayLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';
import pLimit from 'p-limit';

/**
 * Titles of books friends sent (book-transfer.ts) that this browser keeps for the Calibre source:
 * listed with the library but never uploaded, since the shared sync folder is everyone's.
 */
export const calibreReceivedBooks$ = writableArrayLocalStorageSubject<string>()(
  'calibreReceivedBooks',
  []
);

interface DirectoryEntry {
  name: string;
  type: 'file' | 'directory' | 'other';
}

const syncBaseUrl = '/calibre/sync/';
/**
 * The server's sync root, whatever this build's VITE_STORAGE_ROOT_NAME: the standalone names its
 * Drive and folder root differently, and the server's paths (difficulty readings) expect this one.
 */
const serverRootName = 'ttu-reader-data';
/** Where readers sign in: Settings → Sync in the standalone, Settings → General otherwise. */
const signInPlace = serverConnected ? 'Settings → Sync → Server' : 'Settings → General → Account';

/** 401 from the sync folder: an expired session, or a signed-out reader outside the trusted networks. */
function unauthorizedError(expired = !!currentAccount()) {
  return Object.assign(
    new Error(
      expired
        ? `Your sign-in has expired. Sign in again in ${signInPlace}.`
        : `Using the library from this network needs an account. Sign in in ${signInPlace}.`
    ),
    { status: 401 }
  );
}

/** Bookmark progress as a fraction; old bookmarks store a percentage string like "42.5%". */
function bookmarkFraction(progress: number | string | undefined) {
  return typeof progress === 'string' ? Number.parseFloat(progress) / 100 || 0 : progress || 0;
}

function filesIn(folderId: string, entries: DirectoryEntry[] = []): ExternalFile[] {
  return entries
    .filter((entry) => entry.type === 'file')
    .map((entry) => ({ id: `${folderId}${encodeURIComponent(entry.name)}`, name: entry.name }));
}

export class CalibreStorageHandler extends ApiStorageHandler {
  /**
   * URL of an extra per-reader file (e.g. annotations) in a book's sync folder.
   * Call after accountReady().
   */
  static syncFileUrl(title: string, fileName: string) {
    const { folderName } = CalibreStorageHandler;

    return `${currentAccount() ? accountSyncUrl : syncBaseUrl}${folderName(
      serverRootName
    )}/${folderName(title)}/${encodeURIComponent(fileName)}`;
  }

  /**
   * Extra sync files (`sync-files.ts`): a book's in its sync folder (`syncFileUrl`), root files
   * (kanji.json, words.json, settings.json) at the root of the account's folder, so only while
   * signed in. Static: no handler context. The ETag is the version, but nginx's WebDAV can't
   * refuse a changed file, so writes don't check it; the merges make up for it on the next sync.
   */
  static async readSyncFile(name: string, title?: string) {
    const url = await CalibreStorageHandler.syncUrl(name, title);
    const response = await serverFetch(url, { cache: 'no-store' });

    if (response.status === 404) return undefined;

    if (!response.ok) {
      throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
    }

    return { text: await response.text(), version: response.headers.get('ETag') ?? '' };
  }

  static async writeSyncFile(
    name: string,
    text: string,
    { title, keepalive }: SyncFileOptions = {}
  ) {
    const response = await serverFetch(await CalibreStorageHandler.syncUrl(name, title), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: text,
      // Browsers keep requests alive after the tab closes only up to 64 KiB in total.
      ...(keepalive && new Blob([text]).size <= 60_000 ? { keepalive } : {})
    });

    if (!response.ok) {
      throw Object.assign(new Error(`upload failed (HTTP ${response.status})`), {
        status: response.status
      });
    }
  }

  /** Root files are personal: callers only sync them while signed in (`readerSyncStore`). */
  private static async syncUrl(name: string, title?: string) {
    if (title === undefined) return `${accountSyncUrl}${encodeURIComponent(name)}`;

    if (await CalibreStorageHandler.holdsAccountData()) throw unauthorizedError(true);

    return CalibreStorageHandler.syncFileUrl(title, name);
  }

  /** URL path segment of a title's (or the root's) sync folder. */
  private static folderName(name: string) {
    return encodeURIComponent(BaseStorageHandler.sanitizeForFilename(name));
  }

  /** Files stored per account while signed in; everything else is shared. */
  private static isPersonalFile(name: string) {
    return (
      name.startsWith('progress_') ||
      name.startsWith('statistics_') ||
      name.startsWith(BaseStorageHandler.readingGoalsFilePrefix)
    );
  }

  /**
   * Signed out while this browser still holds an account's data (its session expired): that
   * reader's files wait in the browser for sign-in, never mixing with the shared folder's.
   */
  private static async holdsAccountData() {
    return !(await accountReady()) && !!(await readerDataOwner());
  }

  /**
   * Whether personal files go to the account folder. Refreshed in ensureTitle,
   * which every storage operation calls first.
   */
  private useAccountFolder = false;

  /** holdsAccountData(), refreshed with useAccountFolder: shared personal files are skipped. */
  private holdPersonal = false;

  private titleToCalibreBook = new Map<string, CalibreBook>();

  private nextCardId = Date.now();

  constructor(window: Window) {
    super(StorageKey.CALIBRE, window, '');
  }

  setInternalSettings() {
    this.storageSourceName = StorageSourceDefault.CALIBRE_DEFAULT;
  }

  async getBookList() {
    if (!this.dataListFetched) {
      database.listLoading$.next(true);

      try {
        const [books, , , difficulty, personalTitles] = await Promise.all([
          loadCalibreCatalog(true),
          loadSeriesOverrides(true).catch(() => ({})),
          loadBookMetadata(true).catch(() => ({})),
          loadCalibreDifficulty().catch(
            () => ({}) as Awaited<ReturnType<typeof loadCalibreDifficulty>>
          ),
          this.listRoot()
        ]);
        const listLimiter = pLimit(6);
        const catalogTitles = new Set(books.map((book) => book.title));
        // Account files of a book that is neither in the catalog nor in the shared folder
        // (deleted, or imported earlier under another title) are kept but not listed:
        // without book data or a cover the card couldn't be opened.
        const titles = new Set([
          ...this.titleToId.keys(),
          ...personalTitles.filter((title) => catalogTitles.has(title))
        ]);

        await Promise.all(
          [...titles].map((title) =>
            listLimiter(async () => {
              const titleId = this.titleToId.get(title) || this.sharedTitleId(title);

              this.setTitleFiles(title, await this.listTitleFiles(titleId));
            })
          )
        );

        for (let index = 0, { length } = books; index < length; index += 1) {
          const book = books[index];
          const bookCard = this.titleToBookCard.get(book.title) || this.createBookCard(book.title);

          this.titleToCalibreBook.set(book.title, book);
          this.titleToBookCard.set(book.title, {
            ...bookCard,
            // Unopened books sort by when they were added to Calibre.
            lastBookModified: bookCard.lastBookModified || book.added,
            imagePath: calibreCoverUrl(book) || bookCard.imagePath,
            // Unopened books: the difficulty service's count, so length filters see them.
            characters: bookCard.characters || difficulty[book.id]?.characters || 0,
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

        // No catalog.json yet (nginx 404): the first build is running; the manage page looks again.
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

  /** Books from this source processed and stored in the browser, with their local progress. */
  private async cachedBookList(): Promise<BookCardProps[]> {
    const db = await database.db;
    const [data, bookmarks] = await Promise.all([db.getAll('data'), db.getAll('bookmark')]);
    const progress = new Map(bookmarks.map((bookmark) => [bookmark.dataId, bookmark]));

    return data
      .filter(
        (book) => book.storageSource === StorageSourceDefault.CALIBRE_DEFAULT && book.elementHtml
      )
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
    const localData = await database.getDataByTitle(title);
    // A book imported with an existing title is its new version (build-catalog.py's unique_titles):
    // book data processed before the Calibre file was added came from the old one.
    const added =
      (
        this.titleToCalibreBook.get(title) ||
        (await loadCalibreCatalog().catch((): CalibreBook[] => [])).find(
          (book) => book.title === title
        )
      )?.added || 0;

    if (!localData?.elementHtml || (localData.lastBookModified || 0) < added) {
      const { file } = await this.getExternalFile('bookdata_');

      if (!file || BaseStorageHandler.getBookMetadata(file.name).lastBookModified < added) {
        await this.processCalibreBook();
      }
    }

    return super.prepareBookForReading();
  }

  /**
   * Books are cached in the browser, so they are only downloaded again when the
   * server copy is newer (e.g. re-processed on another device).
   */
  async getBook() {
    if (!this.isForBrowser) {
      return this.downloadBook();
    }

    const localData = await database.getDataByTitle(this.currentContext.title);
    const { file } = await this.getExternalFile('bookdata_');
    const remoteModified = file
      ? BaseStorageHandler.getBookMetadata(file.name).lastBookModified
      : 0;

    if (localData?.elementHtml && (localData.lastBookModified || 0) >= (remoteModified || 0)) {
      return undefined;
    }

    const book = await this.downloadBook();

    if (book && !(book instanceof File)) {
      await this.saveLocally(book);
    }

    return book;
  }

  protected async ensureTitle(name = BaseStorageHandler.rootName, _parent = '', readOnly = false) {
    this.useAccountFolder = !!(await accountReady());
    this.holdPersonal = await CalibreStorageHandler.holdsAccountData();

    if (name === BaseStorageHandler.rootName) {
      if (!this.rootId) {
        const rootId = `${syncBaseUrl}${CalibreStorageHandler.folderName(serverRootName)}/`;

        if (!(await this.listDirectory(rootId))) {
          await this.davRequest(rootId, { method: 'MKCOL' }, [405]);
        }

        this.rootId = rootId;
      }

      return this.rootId;
    }

    const knownId = this.titleToId.get(name);

    if (knownId) {
      return knownId;
    }

    const titleId = this.sharedTitleId(name);
    const exists = !!(await this.listDirectory(titleId));

    if (!exists && readOnly) {
      return '';
    }

    if (!exists) {
      // 405: created in the meantime, e.g. by another device.
      await this.davRequest(titleId, { method: 'MKCOL' }, [405]);
    }

    this.titleToId.set(name, titleId);

    return titleId;
  }

  protected async getExternalFiles(remoteTitleId: string) {
    if (
      (!this.cacheStorageData || !this.dataListFetched) &&
      !this.titleToFiles.has(this.currentContext.title)
    ) {
      this.setTitleFiles(this.currentContext.title, await this.listTitleFiles(remoteTitleId));
    }

    return this.titleToFiles.get(this.currentContext.title) || [];
  }

  protected async setRootFiles() {
    if ((!this.cacheStorageData || !this.rootFileListFetched) && !this.rootFiles.size) {
      await this.listRoot();
    }
  }

  protected retrieve(
    file: ExternalFile,
    typeToRetrieve: XMLHttpRequestResponseType,
    progressBase = 1
  ) {
    return this.request(file.id, { trackDownload: true }, typeToRetrieve, progressBase);
  }

  protected async upload(
    folderId: string,
    name: string,
    files: ExternalFile[],
    externalFile: ExternalFile | undefined,
    data: Blob | string | undefined,
    rootFilePrefix?: string,
    progressBase = 0.8
  ): Promise<ExternalFile> {
    if (this.holdPersonal && CalibreStorageHandler.isPersonalFile(name)) {
      throw unauthorizedError(true);
    }

    const id = this.fileId(folderId, name);

    // Metadata lives in the filename, so an update usually means a new name.
    if (data !== undefined) {
      await this.request(
        id,
        { method: 'PUT', body: data, trackUpload: true },
        'text',
        progressBase
      );

      if (externalFile && externalFile.id !== id) {
        await this.davRequest(externalFile.id, { method: 'DELETE' }, [404]);
      }
    } else if (externalFile && externalFile.id !== id) {
      await this.davRequest(externalFile.id, {
        method: 'MOVE',
        headers: {
          // A path: nginx refuses an https:// Destination when TLS ends before it (a proxy).
          Destination: id,
          Overwrite: 'T'
        }
      });
    }

    if (externalFile) {
      externalFile.id = id;
    }

    this.updateAfterUpload(id, name, files, externalFile, {}, rootFilePrefix);

    return { id, name };
  }

  protected async executeDelete(id: string) {
    await this.davRequest(id, { method: 'DELETE' }, [404]);
  }

  protected request(
    url: string,
    options: RequestOptions = {},
    type: XMLHttpRequestResponseType = 'json',
    progressBase = 1
  ) {
    return super.request(
      serverUrl(url),
      { ...options, headers: { ...options.headers, ...serverHeaders(url) }, skipAuth: true },
      type,
      progressBase
    );
  }

  private async processCalibreBook() {
    const { title } = this.currentContext;
    const calibreBook =
      this.titleToCalibreBook.get(title) ||
      (await loadCalibreCatalog()).find((book) => book.title === title);

    if (!calibreBook) {
      throw new Error(`${title} was not found in the Calibre library`);
    }

    // Not before `added`: a device clock behind the server's would make prepareBookForReading
    // take this book data for the old version and process the book again on every open.
    const lastBookModified = Math.max(Date.now(), calibreBook.added || 0);

    if (calibreBook.format === 'VN') {
      const game = await loadVnFolder(title, calibreVnUrl(calibreBook), lastBookModified);

      await this.saveBook(game, false);
      await this.saveLocally(game);
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

    // A manga's book data is just its pages, which the server already has as the CBZ:
    // re-zipping and uploading them doubled a first open, so other devices load the CBZ too.
    if (!isManga(bookContent)) {
      await this.saveBook(bookContent, false);
    }
    await this.saveCover(bookContent.coverImage);
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

  /** Lists the shared root, and the account root while signed in; returns titles found only there. */
  private async listRoot() {
    const rootId = await this.ensureTitle();
    const [entries, personalEntries] = await Promise.all([
      this.listDirectory(rootId).then((list) => list || []),
      this.useAccountFolder ? this.listDirectory(this.toPersonal(rootId)) : undefined
    ]);
    const personalTitles: string[] = [];

    for (let index = 0, { length } = entries; index < length; index += 1) {
      const entry = entries[index];

      if (entry.type === 'directory') {
        this.titleToId.set(
          BaseStorageHandler.desanitizeFilename(entry.name),
          `${rootId}${encodeURIComponent(entry.name)}/`
        );
      }
    }

    filesIn(rootId, entries)
      .filter((file) => !this.belongsInAccount(file.name))
      .forEach((file) => this.setRootFile(file.name, file));

    if (personalEntries) {
      personalEntries
        .filter((entry) => entry.type === 'directory')
        .forEach((entry) => personalTitles.push(BaseStorageHandler.desanitizeFilename(entry.name)));
      filesIn(this.toPersonal(rootId), personalEntries)
        .filter((file) => CalibreStorageHandler.isPersonalFile(file.name))
        .forEach((file) => this.setRootFile(file.name, file));
    }

    this.rootFileListFetched = true;

    return personalTitles;
  }

  /** Titles with a folder in the account's sync root; empty while signed out. */
  async listAccountTitles() {
    const rootId = await this.ensureTitle();

    if (!this.useAccountFolder) {
      return [];
    }

    const entries = (await this.listDirectory(this.toPersonal(rootId))) || [];

    return entries
      .filter((entry) => entry.type === 'directory')
      .map((entry) => BaseStorageHandler.desanitizeFilename(entry.name));
  }

  /** Files of a title: the shared folder, with personal files from the account while signed in. */
  private async listTitleFiles(titleId: string): Promise<ExternalFile[]> {
    if (!this.useAccountFolder) {
      return filesIn(titleId, await this.listDirectory(titleId)).filter(
        (file) => !this.belongsInAccount(file.name)
      );
    }

    const personalId = this.toPersonal(titleId);
    const [shared, personal] = await Promise.all([
      this.listDirectory(titleId),
      this.listDirectory(personalId)
    ]);

    return [
      ...filesIn(titleId, shared).filter(
        (file) => !CalibreStorageHandler.isPersonalFile(file.name)
      ),
      ...filesIn(personalId, personal).filter((file) =>
        CalibreStorageHandler.isPersonalFile(file.name)
      )
    ];
  }

  private sharedTitleId(title: string) {
    return `${this.rootId}${CalibreStorageHandler.folderName(title)}/`;
  }

  private belongsInAccount(name: string) {
    return (
      (this.useAccountFolder || this.holdPersonal) && CalibreStorageHandler.isPersonalFile(name)
    );
  }

  /** Maps a shared /calibre/sync/ URL to the same path in the account folder. */
  private toPersonal(id: string) {
    return id.startsWith(syncBaseUrl) ? `${accountSyncUrl}${id.slice(syncBaseUrl.length)}` : id;
  }

  private fileId(folderId: string, name: string) {
    const id = `${folderId}${encodeURIComponent(name)}`;

    return this.belongsInAccount(name) ? this.toPersonal(id) : id;
  }

  private setTitleFiles(title: string, files: ExternalFile[]) {
    if (!files.length) {
      return;
    }

    const bookCard = { ...(this.titleToBookCard.get(title) || this.createBookCard(title)) };
    const progressFile = BaseStorageHandler.findFile(files, 'progress_');

    for (let index = 0, { length } = files; index < length; index += 1) {
      const file = files[index];

      if (file.name.startsWith('bookdata_')) {
        const { characters, lastBookModified, lastBookOpen } = BaseStorageHandler.getBookMetadata(
          file.name
        );

        bookCard.characters = characters;
        bookCard.lastBookModified = lastBookModified;
        bookCard.lastBookOpen = lastBookOpen;
      } else if (file === progressFile) {
        const { progress, lastBookmarkModified } = BaseStorageHandler.getProgressMetadata(
          file.name
        );

        bookCard.progress = progress;
        bookCard.lastBookmarkModified = lastBookmarkModified;
      } else if (file.name.startsWith('cover_') && !bookCard.imagePath) {
        bookCard.imagePath = file.id;
      }
    }

    this.titleToFiles.set(title, files);
    this.titleToBookCard.set(title, bookCard);
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

  /** JSON directory listing from nginx autoindex, or undefined if the directory is missing. */
  private async listDirectory(url: string): Promise<DirectoryEntry[] | undefined> {
    const response = await serverFetch(url, { cache: 'no-store' });

    if (response.status === 404) {
      return undefined;
    }

    if (response.status === 401) {
      throw unauthorizedError();
    }

    if (!response.ok) {
      throw new Error(`Calibre sync listing failed (HTTP ${response.status})`);
    }

    return response.json();
  }

  private async davRequest(url: string, init: RequestInit, allowedStatuses: number[] = []) {
    const response = await serverFetch(url, init);

    if (response.status === 401) {
      throw unauthorizedError();
    }

    if (!response.ok && !allowedStatuses.includes(response.status)) {
      throw new Error(`Calibre sync ${init.method} failed (HTTP ${response.status})`);
    }
  }
}
