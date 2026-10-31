/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The library's Import (routes/manage/+page.svelte): files, game folders, Windows and installed
 * games, and under the Calibre source the server's import queue. The page keeps the progress bar
 * and passes it in as `page`.
 */

import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
import SeriesSuggestionsDialog from '$lib/components/library/series-suggestions-dialog.svelte';
import MessageDialog from '$lib/components/message-dialog.svelte';
import NativeGameDialog from '$lib/components/vn/native-game-dialog.svelte';
import WindowsGameDialog from '$lib/components/vn/windows-game-dialog.svelte';
import { currentAccount, hasPermission } from '$lib/data/account/account';
import { dialogManager } from '$lib/data/dialog-manager';
import { addImportsToHome } from '$lib/data/library/library-home';
import { saveSeriesOverrides, seriesForTitle } from '$lib/data/library/series-overrides';
import { logger } from '$lib/data/logger';
import { importMokuroFiles } from '$lib/data/manga/mokuro';
import {
  isFinished,
  uploadToCalibre,
  waitForImportJobs,
  type CalibreImportJob
} from '$lib/data/remote/calibre-import';
import { ApiStorageHandler } from '$lib/data/storage/handler/api-handler';
import { ServerStorageHandler } from '$lib/data/storage/handler/server-handler';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { asksBeforeVnUpload, StorageKey } from '$lib/data/storage/storage-types';
import { storageSource$ } from '$lib/data/storage/storage-view';
import {
  cacheStorageData$,
  database,
  fileCountData$,
  readingGoalsMergeMode$,
  replicationSaveBehavior$,
  statisticsMergeMode$
} from '$lib/data/store';
import {
  vnsKeptOnDevice,
  vnUploadQuestion,
  vnFolders,
  vnZipFiles,
  zipVnFolder,
  type VnUpload
} from '$lib/data/vn/vn-upload';
import type { LoadData } from '$lib/functions/file-loaders/types';
import { importData } from '$lib/functions/replication/replicator';
import { replicationProgress$ } from '$lib/functions/replication/replication-progress';
import { pluralize } from '$lib/functions/utils';

/** The library page's progress bar and book list, which the import runs under. */
export interface ImportPage {
  operationAllowed(): boolean;
  initializeReplicationProgressData(): void;
  resetProgress(): void;
  showError(title: string, message: string, fallbackMessage: string): void;
  /** The Cancel button's title. */
  setCancelTooltip(tooltip: string): void;
  /** Read after initializeReplicationProgressData, which makes a new one. */
  cancelSignal(): AbortSignal;
  bookCards(): BookCardProps[] | undefined;
}

export async function onFilesChange(page: ImportPage, fileList: FileList | File[]) {
  if (!page.operationAllowed()) {
    return;
  }

  page.setCancelTooltip(`Cancels the current Import\nAlready imported data will not be deleted`);

  page.initializeReplicationProgressData();

  const supportedExtRegex = /\.(?:htmlz|epub|txt|cbz|zip)$/;
  // Unpacked game folders become one visual novel each, like a ZIP of them.
  const { games, rest } = vnFolders(Array.from(fileList));
  const files = rest.filter((f) => supportedExtRegex.test(f.name));
  // A .mokuro beside its CBZ is that manga's text (mokuro.ts).
  const mokuroFiles = rest.filter((f) => /\.mokuro$/i.test(f.name));
  const errorTitle = 'Bookimport failed';

  if (!files.length && !games.length) {
    page.resetProgress();

    page.showError(errorTitle, 'File(s) must be HTMLZ, TXT, EPUB, CBZ or ZIP', '');
    return;
  }

  if (storageSource$.getValue() === StorageKey.CALIBRE) {
    await addFilesToCalibre(page, [...files, ...(await Promise.all(games.map(zipVnFolder)))]);
    return;
  }

  const importedTitles: string[] = [];
  const keepOnDevice = asksBeforeVnUpload(storageSource$.getValue())
    ? await vnsKeptOnDevice(
        storageSource$.getValue(),
        [...(await vnZipFiles(files)), ...games].map(({ name, size }) => ({ name, size })),
        askVnUpload
      )
    : undefined;

  const error = await importData(
    document,
    getStorageHandler(
      window,
      storageSource$.getValue(),
      '',
      storageSource$.getValue() === StorageKey.BROWSER,
      cacheStorageData$.getValue(),
      replicationSaveBehavior$.getValue(),
      statisticsMergeMode$.getValue(),
      readingGoalsMergeMode$.getValue()
    ),
    [...files, ...games],
    page.cancelSignal(),
    fileCountData$.getValue(),
    importedTitles,
    keepOnDevice
  ).catch((catchedError) => catchedError.message);
  const textError = mokuroFiles.length ? await importMokuroFiles(mokuroFiles, importedTitles) : '';

  addImportsToHome(importedTitles);
  page.resetProgress();

  if (textError && !error) page.showError(errorTitle, textError, textError);
  if (error) {
    page.showError(errorTitle, error, 'Error(s) occurred during bookimport');
  }
}

/** Import → Windows game: the dialog copies the folder, this adds the game to the library. */
export function openWindowsGame() {
  dialogManager.dialogs$.next([
    {
      component: WindowsGameDialog as any,
      props: { save: saveWindowsGame },
      disableCloseOnClick: true
    }
  ]);
}

/** Import → Installed game (desktop app): a game installed here, played natively. */
export function openInstalledGame() {
  dialogManager.dialogs$.next([
    {
      component: NativeGameDialog as any,
      props: { save: saveWindowsGame },
      disableCloseOnClick: true
    }
  ]);
}

/**
 * A Windows game is only ever in this browser: under a cloud or Calibre source it is kept on
 * this device like a visual novel kept off the cloud (ApiStorageHandler.keepOnDevice).
 */
async function saveWindowsGame(book: LoadData) {
  const handler = getStorageHandler(window, storageSource$.getValue(), '');

  if (handler instanceof ApiStorageHandler || handler instanceof ServerStorageHandler) {
    await handler.keepOnDevice(book);
  } else {
    await getStorageHandler(
      window,
      StorageKey.BROWSER,
      undefined,
      true,
      cacheStorageData$.getValue(),
      replicationSaveBehavior$.getValue()
    ).saveBook(book, false, false);
  }

  addImportsToHome([book.title]);
  database.dataListChanged$.next(handler);
}

/** Asks whether visual novels go up to a cloud provider; true = upload (vn-upload.ts). */
export function askVnUpload(games: VnUpload[], target: StorageKey) {
  return new Promise<boolean>((resolve) => {
    dialogManager.dialogs$.next([
      {
        component: ConfirmDialog,
        props: {
          ...vnUploadQuestion(games, target),
          confirmLabel: 'Upload',
          cancelLabel: 'Keep on this device',
          resolver: (wasCanceled: boolean) => resolve(!wasCanceled)
        },
        disableCloseOnClick: true
      }
    ]);
  });
}

/** The selected visual novels' sizes, from this browser's copies */
export async function vnSizes(titles: string[]) {
  return Promise.all(
    titles.map(async (name) => {
      const data = await database.getDataByTitle(name);

      return {
        name,
        size: Object.values(data ? await database.getBlobs(data) : {}).reduce(
          (sum, blob) => sum + blob.size,
          0
        )
      };
    })
  );
}

/**
 * Not part of upstream: under the Calibre source, imported files are added to the Calibre
 * library by the server's import queue (data/remote/calibre-import.ts), which skips books
 * already there. The library is refreshed once they are in the catalog.
 */
async function addFilesToCalibre(page: ImportPage, files: File[]) {
  if (!hasPermission(currentAccount(), 'import')) {
    page.resetProgress();
    page.showError(
      'Adding to Calibre failed',
      currentAccount()
        ? 'This account may not add books to Calibre. Ask an admin for the "Add books" permission.'
        : 'Sign in (Settings → Account, on the HTTPS address) to add books to Calibre',
      ''
    );
    return;
  }

  page.setCancelTooltip('Stops uploading\nBooks already uploaded are still added to Calibre');
  replicationProgress$.next({ progressBase: 1, maxProgress: files.length * 2 });

  const ids: string[] = [];
  const failures: string[] = [];
  let jobs: CalibreImportJob[] = [];

  for (const file of files) {
    if (page.cancelSignal().aborted) {
      break;
    }

    try {
      ids.push((await uploadToCalibre(file, page.cancelSignal())).id);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        break;
      }
      failures.push(error.message);
      // The import service isn't running: the other files would only repeat it.
      if (error.status === 502) {
        break;
      }
    }

    replicationProgress$.next({ progressToAdd: 1 });
  }

  if (ids.length) {
    let finished = 0;

    try {
      jobs = await waitForImportJobs(ids, (current) => {
        const now = current.filter(isFinished).length;

        replicationProgress$.next({ progressToAdd: now - finished });
        finished = now;
      });
    } catch (error: any) {
      failures.push(error.message);
    }
  }

  page.resetProgress();

  const added = jobs.filter((job) => job.state === 'added');
  const duplicates = jobs.filter((job) => job.state === 'duplicate');

  jobs
    .filter((job) => job.state === 'failed')
    .forEach((job) => failures.push(`${job.name}: ${job.error}`));

  let books = page.bookCards() ?? [];

  if (added.length) {
    const handler = getStorageHandler(window, storageSource$.getValue(), '');

    handler.clearData();

    try {
      books = await handler.getBookList();
    } catch (error: any) {
      failures.push(error.message);
    }
    database.dataListChanged$.next(handler);
  }

  const addedCards = added.flatMap((job) => {
    // Games unpacked into the visual novel folder have no Calibre id.
    const card =
      job.calibreId !== undefined && books.find((book) => book.calibreId === job.calibreId);

    return card ? [card] : [];
  });
  const newTitles = addedCards.filter((card) => !card.series).map((card) => card.title);

  addImportsToHome(addedCards.map((card) => card.title));

  await offerSeriesForImports(page, books, newTitles);

  if (failures.length || duplicates.length) {
    const summary = [
      added.length ? `Added ${pluralize(added.length, 'book')}.` : '',
      duplicates.length
        ? `Already in Calibre: ${duplicates.map((job) => job.name).join(', ')}.`
        : '',
      failures.length ? `Failed: ${failures.join(', ')}` : ''
    ]
      .filter(Boolean)
      .join(' ');

    logger.warn(summary);
    dialogManager.dialogs$.next([
      { component: MessageDialog, props: { title: 'Adding to Calibre', message: summary } }
    ]);
  }
}

/** Asks to add each imported book to the existing series its title names, if any. */
async function offerSeriesForImports(
  page: ImportPage,
  libraryBooks: BookCardProps[],
  titles: string[]
) {
  const suggestions = titles
    .map((title) => ({ title, series: seriesForTitle(libraryBooks, title) }))
    .filter((suggestion) => suggestion.series);

  if (!suggestions.length) {
    return;
  }

  // One dialog for the whole import, not one per book.
  const changes = await new Promise<Record<string, string>>((resolver) => {
    dialogManager.dialogs$.next([
      {
        component: SeriesSuggestionsDialog,
        props: { suggestions, resolver },
        disableCloseOnClick: true
      }
    ]);
  });

  if (!Object.keys(changes).length) {
    return;
  }

  try {
    await saveSeriesOverrides(changes);
    database.dataListChanged$.next(getStorageHandler(window, storageSource$.getValue(), ''));
  } catch (error: any) {
    page.showError('Adding to series failed', error.message, '');
  }
}
