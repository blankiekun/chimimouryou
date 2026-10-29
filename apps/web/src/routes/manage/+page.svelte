<script lang="ts">
  import { browser } from '$app/env';
  import { goto, pushState } from '$app/navigation';
  import { page } from '$lib/data/page-store';
  import {
    faCalendarXmark,
    faChartLine,
    faCircleXmark,
    faCloudArrowUp,
    faBookOpen,
    faGaugeHigh,
    faLayerGroup,
    faPlus,
    faRotateLeft,
    faTrash
  } from '@fortawesome/free-solid-svg-icons';
  import BookCardList from '$lib/components/book-card/book-card-list.svelte';
  import BookCardTable from '$lib/components/book-card/book-card-table.svelte';
  import BookDetails from '$lib/components/book-card/book-details.svelte';
  import BookWords from '$lib/components/book-card/book-words.svelte';
  import ContinueReadingShelf from '$lib/components/book-card/continue-reading-shelf.svelte';
  import LearnerDashboard from '$lib/components/book-card/learner-dashboard.svelte';
  import PlacementOffer from '$lib/components/book-card/placement-offer.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import ReadNextShelf from '$lib/components/book-card/read-next-shelf.svelte';
  import HomeSocial from '$lib/components/social/home-social.svelte';
  import { activePlugins$ } from '$lib/plugins';
  import { readingActivity } from '$lib/data/reader-hooks';
  import LibrarySortMenu from '$lib/components/book-card/library-sort-menu.svelte';
  import SeriesGrid from '$lib/components/book-card/series-grid.svelte';
  import SeriesResults from '$lib/components/book-card/series-results.svelte';
  import {
    addImportsToHome,
    addToHome,
    continueReading,
    homeBookTitles$,
    homeRemovedTitles$,
    libraryTab$,
    matchingSeries,
    readNext,
    readNextPool,
    recentLevels,
    removeFromHome,
    seriesGroups,
    storeView$,
    takePendingImport
  } from '$lib/data/library-home';
  import { homeOfflineTitles, keepBooksOffline } from '$lib/data/offline-books';
  import { onLaunchFiles, takeSharedFiles } from '$lib/data/launch-files';
  import { t$, tr, type MessageKey } from '$lib/i18n';
  import {
    cacheCoverage,
    knownCoverage$,
    loadCoverageCache,
    refreshKnownWordsIfStale
  } from '$lib/data/known-words';
  import { deleteCachedReadings, prefetchReadings } from '$lib/data/generated-furigana';
  import { deleteBookKanji } from '$lib/data/book-kanji';
  import { deleteVnCache } from '$lib/data/vn';
  import DifficultyDialog from '$lib/components/book-card/difficulty-dialog.svelte';
  import {
    allBooksFilter,
    filterBookCards,
    isReading,
    seriesFilterKey
  } from '$lib/components/book-card/library-filters';
  import LibrarySidebar from '$lib/components/book-card/library-sidebar.svelte';
  import LibrarySkeleton from '$lib/components/book-card/library-skeleton.svelte';
  import {
    compareBookCards,
    nextSortOption,
    orderSeries
  } from '$lib/components/book-card/library-sort';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import BookManagerHeader from '$lib/components/book-card/book-manager-header.svelte';
  import SeriesDialog from '$lib/components/book-card/series-dialog.svelte';
  import SeriesSuggestionsDialog from '$lib/components/book-card/series-suggestions-dialog.svelte';
  import BookExportDialog from '$lib/components/book-export/book-export-dialog.svelte';
  import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
  import WindowsGameDialog from '$lib/components/book-card/windows-game-dialog.svelte';
  import { deleteWindowsGame, windowsGameFolder } from '$lib/data/windows-game';
  import type { LoadData } from '$lib/functions/file-loaders/types';
  import ExternalReadDialog from '$lib/components/external-read-dialog.svelte';
  import LogReportDialog from '$lib/components/log-report-dialog.svelte';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import { preFilteredTitlesForStatistics$ } from '$lib/components/statistics/statistics-types';
  import type { BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';
  import { saveSeriesOverrides, seriesForTitle } from '$lib/data/series-overrides';
  import { account$, currentAccount, hasPermission } from '$lib/data/account';
  import {
    importServiceRunning,
    isFinished,
    removeFromCalibre,
    uploadToCalibre,
    waitForImportJobs,
    type CalibreImportJob
  } from '$lib/data/calibre-import';
  import { clearReadingProgress } from '$lib/functions/clear-reading-progress';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { pagePath, selfHostingGuideUrl, standalone } from '$lib/data/env';
  import { bookRoute, readerPath, readerRoute, type ReaderRoute } from '$lib/data/reader-route';
  import FirstRun from '$lib/components/standalone/first-run.svelte';
  import { backgroundAnalysis$, catchUpAnalysis } from '$lib/data/background-analysis';
  import InstallHint from '$lib/components/standalone/install-hint.svelte';
  import LibraryEmpty from '$lib/components/standalone/library-empty.svelte';
  import AnalysisToolsOffer from '$lib/components/standalone/analysis-tools-offer.svelte';
  import {
    needsFirstRun,
    showsExternalReadHint,
    storageChosen$
  } from '$lib/data/standalone-storage';
  import { logger } from '$lib/data/logger';
  import type { SortOption } from '$lib/data/sort-types';
  import { ApiStorageHandler } from '$lib/data/storage/handler/api-handler';
  import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
  import { asksBeforeVnUpload, StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
  import {
    vnsKeptOnDevice,
    vnUploadQuestion,
    vnFolders,
    vnZipFiles,
    zipVnFolder,
    formatBytes,
    type VnUpload
  } from '$lib/data/vn-upload';
  import { importMokuroFiles } from '$lib/data/mokuro';
  import { storageSource$ } from '$lib/data/storage/storage-view';
  import {
    booklistSortOptions$,
    cacheStorageData$,
    confirmStatisticsDeletion$,
    database,
    fileCountData$,
    hideExternalReadHint$,
    isOnline$,
    keepLocalStatisticsOnDeletion$,
    libraryBuilding$,
    libraryOffline$,
    librarySignInNeeded,
    libraryDisplayMode$,
    lastExportedTarget$,
    lastExportedTypes$,
    readingGoalsMergeMode$,
    replicationSaveBehavior$,
    showExternalPlaceholder$,
    statisticsMergeMode$
  } from '$lib/data/store';
  import { cloneMutateSet } from '$lib/functions/clone-mutate-set';
  import { getDropEventFiles } from '$lib/functions/file-dom/get-drop-event-files';
  import { inputFile } from '$lib/functions/file-dom/input-file';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { keyBy } from '$lib/functions/key-by';
  import { handleErrorDuringReplication } from '$lib/functions/replication/error-handler';
  import { importBackup, importData, replicateData } from '$lib/functions/replication/replicator';
  import { throwIfAborted } from '$lib/functions/replication/replication-error';
  import {
    replicationProgress$,
    executeReplicate$,
    type BytesPhase,
    type ReplicationProgress
  } from '$lib/functions/replication/replication-progress';
  import { pluralize } from '$lib/functions/utils';
  import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';
  import pLimit from 'p-limit';
  import { combineLatest, map, Observable, share, Subject, switchMap, takeUntil } from 'rxjs';
  import { onDestroy, onMount, tick } from 'svelte';
  import Fa from 'svelte-fa';

  const booksAreLoading$ = database.listLoading$.pipe(map((isLoading) => isLoading));

  const bookCards$: Observable<BookCardProps[]> = combineLatest([
    database.dataList$,
    database.bookmarks$,
    booklistSortOptions$,
    knownCoverage$
  ]).pipe(
    map(([dataList, bookmarks, , coverage]) => {
      const sortProp = $booklistSortOptions$[$storageSource$];

      if (sortProp.property === 'coverage') {
        dataList = dataList.map((d: BookCardProps) =>
          d.calibreId === undefined || coverage[d.calibreId] === undefined
            ? d
            : { ...d, coverage: coverage[d.calibreId] }
        );
      }

      if ($storageSource$ === StorageKey.BROWSER) {
        const bookmarkMap = keyBy(bookmarks, 'dataId');

        return [
          ...dataList
            .filter((d) => $showExternalPlaceholder$ || !d.isPlaceholder)
            .map((d) => ({
              ...d,
              ...bookmarkToProgress(bookmarkMap.get(d.id))
            }))
            .sort((card1: BookCardProps, card2: BookCardProps) =>
              compareBookCards(card1, card2, sortProp)
            )
        ];
      }

      return [
        ...dataList.sort((card1: BookCardProps, card2: BookCardProps) =>
          compareBookCards(card1, card2, sortProp)
        )
      ];
    }),
    share()
  );

  const currentBookId$ = database.lastItem$.pipe(
    map((item) => item?.dataId),
    share()
  );

  const renderStep = 120;

  let selectedBookIds: ReadonlySet<number> = new Set();
  let renderLimit = renderStep;
  let activeFilter = allBooksFilter.key;
  let searchTerm = '';
  let selectMode = false;
  let cancelToken = new AbortController();
  let cancelSignal = cancelToken.signal;
  let cancelTooltip = '';
  let replicationProgress = 0;
  let replicationToProgress = 0;
  let replicationProgressRemaining = 'Estimating…';
  let replicationDone = new Subject<void>();
  let progressBase = 0;
  let executionStart: number;
  /** Part of the current step done in a long phase measured in bytes (large visual novels) */
  let bytesBonus = 0;
  let bytesPhase: { key: string; start: number; startDone: number } | undefined;

  $: {
    if (!selectMode) {
      selectedBookIds = new Set();
    }
  }

  // One series (Store → Series) is shown in reading order rather than the chosen sort.
  $: visibleBookCards = activeFilter.startsWith('series:')
    ? orderSeries(filterBookCards($bookCards$ ?? [], activeFilter, searchTerm))
    : filterBookCards($bookCards$ ?? [], activeFilter, searchTerm);
  // Large libraries (Calibre) are rendered in steps to keep the DOM small.
  $: (activeFilter, searchTerm, $storageSource$, (renderLimit = renderStep));
  $: renderedBookCards = visibleBookCards.slice(0, renderLimit);
  $: isLoading = !$bookCards$ || $booksAreLoading$;
  $: activeSeries = activeFilter.startsWith('series:') ? activeFilter.slice('series:'.length) : '';
  $: seriesMissing = activeSeries
    ? visibleBookCards.filter((card) => !$homeBookTitles$.includes(card.title))
    : [];
  $: hasActiveFilter = activeFilter !== allBooksFilter.key || !!searchTerm.trim();
  $: isHome = $libraryTab$ !== 'store';
  $: showSeriesGrid = !isHome && $storeView$ === 'series' && activeFilter !== 'vn';
  $: seriesMatches = isHome || showSeriesGrid ? [] : matchingSeries($bookCards$ ?? [], searchTerm);

  function showSeries(series: string) {
    activeFilter = seriesFilterKey(series);
    searchTerm = '';
    $storeView$ = 'books';
  }

  function setStoreView(view: 'books' | 'series') {
    if (view === 'series' && activeFilter.startsWith('series:')) {
      activeFilter = allBooksFilter.key;
    }
    $storeView$ = view;
  }
  $: if ($bookCards$ && !isLoading && $storageSource$ === StorageKey.CALIBRE) {
    if ($isOnline$ && !$libraryOffline$) {
      const titles = homeOfflineTitles($bookCards$, $homeBookTitles$, $homeRemovedTitles$);

      // Furigana after the books: a book's first processing is what they are made from.
      keepBooksOffline(window, titles).then(() => prefetchReadings(titles));
    }
  }
  // Known-word coverage for Home's books and Read next's, so the Store can sort by it.
  $: knownWordsOn = $storageSource$ === StorageKey.CALIBRE;
  $: if (knownWordsOn) {
    refreshKnownWordsIfStale().then(loadCoverageCache, () => {});
  }
  $: if (knownWordsOn && $bookCards$ && !isLoading) {
    const onHome = new Set(homeOfflineTitles($bookCards$, $homeBookTitles$, $homeRemovedTitles$));
    const { next, pool } = readNextPool($bookCards$);

    [...next, ...pool].forEach((card) => onHome.add(card.title));
    cacheCoverage(
      $bookCards$
        .filter(
          (card) =>
            onHome.has(card.title) && card.calibreId !== undefined && card.difficulty !== undefined
        )
        .map((card) => card.calibreId!)
    );
  }
  $: readNextCards = isHome && $bookCards$ ? readNext($bookCards$, $knownCoverage$, 3) : [];
  $: readNextReason = (() => {
    if (!readNextCards.length) return '';
    if (standalone) return $t$('home.readNextReasonNext');
    const levels = recentLevels($bookCards$);
    const low = levels[0].toFixed(1);
    const high = levels[levels.length - 1].toFixed(1);
    const next = new Set(readNextPool($bookCards$).next.map((card) => card.id));

    return $t$(
      readNextCards.some((card) => next.has(card.id))
        ? 'home.readNextReasonSeries'
        : 'home.readNextReason',
      { range: low === high ? low : `${low}–${high}` }
    );
  })();
  $: firstRun = !continueCards.length && !readNextCards.length && !homeCards.length;
  $: socialNumber =
    1 + Number(firstRun) + Number(!!continueCards.length) + Number(!!readNextCards.length);
  $: socialOn = $activePlugins$.some((plugin) => plugin.id === 'social');
  let socialSections = 0;
  $: myBooksNumber = socialNumber + (socialOn ? socialSections : 0);
  $: continueCards = isHome && $bookCards$ ? continueReading($bookCards$, $homeRemovedTitles$) : [];
  $: homeCards = (() => {
    const byTitle = new Map(($bookCards$ ?? []).map((card) => [card.title, card]));

    return $homeBookTitles$
      .map((title) => byTitle.get(title))
      .filter((card): card is BookCardProps => !!card && !isReading(card));
  })();

  function addSelectedToHome() {
    addToHome(
      ($bookCards$ ?? []).filter((card) => selectedBookIds.has(card.id)).map((card) => card.title)
    );
    selectMode = false;
  }

  // The server's first catalog build: look again until catalog.json is there.
  let catalogPoll: ReturnType<typeof setInterval> | undefined;
  $: {
    clearInterval(catalogPoll);
    catalogPoll =
      $libraryBuilding$ && $storageSource$ === StorageKey.CALIBRE
        ? setInterval(() => database.dataListChanged$.next(undefined), 15000)
        : undefined;
  }
  // An empty Calibre library: Import is offered only when this account may and the service runs.
  $: calibreImportReady =
    !standalone &&
    $storageSource$ === StorageKey.CALIBRE &&
    !$libraryBuilding$ &&
    $bookCards$?.length === 0 &&
    hasPermission($account$, 'import')
      ? importServiceRunning()
      : Promise.resolve(false);

  onDestroy(() => {
    clearInterval(catalogPoll);
    dialogManager.dialogs$.next([]);
    readingActivity();
  });
  // In the library, for the plugins (Discord's idle status).
  onMount(() => readingActivity({ kind: 'idle' }));
  // Standalone: estimates and furigana still missing are made in the background, once per start.
  $: if (standalone && $bookCards$ && !isLoading) catchUpAnalysis();

  onMount(() => {
    const pending = takePendingImport();
    if (pending && 'files' in pending) onFilesChange(pending.files);
    else if (pending) onImportBackup(pending.backup);
    // Books shared with or opened by the installed app (manifest.webmanifest).
    takeSharedFiles().then(
      (files) => {
        if (files.length) onFilesChange(files);
      },
      () => {}
    );
    onLaunchFiles(onFilesChange);
    tidyVnFilesOnce();
  });

  /** Visual novels' files out of their book records, once per start (vn-files.ts) */
  function tidyVnFilesOnce() {
    setTimeout(
      () => database.tidyVnFiles().catch((error) => logger.warn(`Visual novel files: ${error}`)),
      5000
    );
  }

  function retryLibrary() {
    if ($libraryOffline$) {
      database.dataListChanged$.next(getStorageHandler(window, $storageSource$, ''));
    }
  }

  function bookmarkToProgress(b: BooksDbBookmarkData | undefined) {
    return b?.progress
      ? {
          progress: typeof b.progress === 'string' ? +b.progress.slice(0, -1) : b.progress,
          lastBookmarkModified: b.lastBookmarkModified || 0
        }
      : { progress: 0, lastBookmarkModified: 0 };
  }

  async function onBookClick(bookId: number) {
    if (!operationAllowed()) {
      return;
    }

    if (!selectMode) {
      dialogManager.dialogs$.next([
        {
          component: '<div/>',
          disableCloseOnClick: true
        }
      ]);

      let idToOpen = bookId;
      let route: ReaderRoute = 'b';

      try {
        const bookItem = $bookCards$.find((book) => book.id === bookId);

        if (!bookItem) {
          throw new Error('Book title not found');
        }

        const isForBrowser = $storageSource$ === StorageKey.BROWSER;
        const handler = getStorageHandler(
          window,
          $storageSource$,
          '',
          isForBrowser,
          $cacheStorageData$,
          $replicationSaveBehavior$,
          $statisticsMergeMode$,
          $readingGoalsMergeMode$
        );

        if (!cacheStorageData$) {
          handler.clearData(false);
        }

        handler.startContext({
          id: isForBrowser ? bookItem.id : 0,
          title: bookItem.title,
          imagePath: bookItem.imagePath
        });

        idToOpen = await handler.prepareBookForReading();
        // Straight to the manga or VN player when this browser has it; else the reader syncs it down first.
        const local = readerRoute(bookItem) === 'b' ? undefined : await database.getData(idToOpen);

        route = local ? bookRoute(local) : 'b';

        if (
          showsExternalReadHint(
            standalone,
            $hideExternalReadHint$,
            handler.storageType,
            handler instanceof ApiStorageHandler
          )
        ) {
          const nextAction = await new Promise<string>((resolver) => {
            dialogManager.dialogs$.next([
              {
                component: ExternalReadDialog,
                props: { resolver },
                disableCloseOnClick: true
              }
            ]);
          });

          if (nextAction === 'cancel') {
            return;
          }

          if (nextAction === 'export') {
            selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
              set.add(bookId);
            });
            selectMode = true;

            await tick();

            return onReplicateData();
          }
        }

        dialogManager.dialogs$.next([]);
      } catch (error: any) {
        const message = `Error opening book: ${error.message}`;

        logger.warn(message);

        dialogManager.dialogs$.next([
          {
            component: MessageDialog,
            props: {
              title: 'Error',
              message
            }
          }
        ]);

        return;
      }

      openBook(idToOpen, route);
      return;
    }

    selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
      if (set.has(bookId)) {
        set.delete(bookId);
        return;
      }
      set.add(bookId);
    });
  }

  // Cover clicks show the book's page (Resume buttons open the book); a long press selects.
  function onCoverClick(bookId: number) {
    if (selectMode) {
      onBookClick(bookId);
    } else {
      // A history entry, so Back (also on phones) closes the page.
      pushState('', { bookDetails: bookId });
    }
  }

  function showSeriesFromDetails(series: string) {
    history.back();
    $libraryTab$ = 'store';
    showSeries(series);
  }

  $: detailsBook =
    $page.state.bookDetails === undefined
      ? undefined
      : $bookCards$?.find((card) => card.id === $page.state.bookDetails);

  /** Selects a book without toggling (long press can fire twice). */
  function selectBook(bookId: number) {
    selectMode = true;
    selectedBookIds = new Set([...selectedBookIds, bookId]);
  }

  function readSelected() {
    const [bookId] = selectedBookIds;

    selectMode = false;
    onBookClick(bookId);
  }

  function operationAllowed() {
    const connectivityPass = !(
      ($storageSource$ === StorageKey.GDRIVE || $storageSource$ === StorageKey.ONEDRIVE) &&
      !$isOnline$
    );

    if (!connectivityPass && !replicationToProgress) {
      const message = 'You have to be online for this operation';

      logger.warn(message);

      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: 'Failure',
            message
          }
        }
      ]);
    }

    return !replicationToProgress && connectivityPass;
  }

  function openBook(bookId: number, route: ReaderRoute) {
    if (!bookId) {
      return;
    }

    database.putLastItem(bookId, route);
    goto(readerPath(bookId, route));
  }

  async function onFilesChange(fileList: FileList | File[]) {
    if (!operationAllowed()) {
      return;
    }

    cancelTooltip = `Cancels the current Import\nAlready imported data will not be deleted`;

    initializeReplicationProgressData();

    const supportedExtRegex = /\.(?:htmlz|epub|txt|cbz|zip)$/;
    // Unpacked game folders become one visual novel each, like a ZIP of them.
    const { games, rest } = vnFolders(Array.from(fileList));
    const files = rest.filter((f) => supportedExtRegex.test(f.name));
    // A .mokuro beside its CBZ is that manga's text (mokuro.ts).
    const mokuroFiles = rest.filter((f) => /\.mokuro$/i.test(f.name));
    const errorTitle = 'Bookimport failed';

    if (!files.length && !games.length) {
      resetProgress();

      showError(errorTitle, 'File(s) must be HTMLZ, TXT, EPUB, CBZ or ZIP', '');
      return;
    }

    if ($storageSource$ === StorageKey.CALIBRE) {
      await addFilesToCalibre([...files, ...(await Promise.all(games.map(zipVnFolder)))]);
      return;
    }

    const importedTitles: string[] = [];
    const keepOnDevice = asksBeforeVnUpload($storageSource$)
      ? await vnsKeptOnDevice(
          $storageSource$,
          [...(await vnZipFiles(files)), ...games].map(({ name, size }) => ({ name, size })),
          askVnUpload
        )
      : undefined;

    const error = await importData(
      document,
      getStorageHandler(
        window,
        $storageSource$,
        '',
        $storageSource$ === StorageKey.BROWSER,
        $cacheStorageData$,
        $replicationSaveBehavior$,
        $statisticsMergeMode$,
        $readingGoalsMergeMode$
      ),
      [...files, ...games],
      cancelSignal,
      $fileCountData$,
      importedTitles,
      keepOnDevice
    ).catch((catchedError) => catchedError.message);
    const textError = mokuroFiles.length
      ? await importMokuroFiles(mokuroFiles, importedTitles)
      : '';

    addImportsToHome(importedTitles);
    resetProgress();

    if (textError && !error) showError(errorTitle, textError, textError);
    if (error) {
      showError(errorTitle, error, 'Error(s) occurred during bookimport');
    }
  }

  /** Import → Windows game: the dialog copies the folder, this adds the game to the library. */
  function openWindowsGame() {
    dialogManager.dialogs$.next([
      {
        component: WindowsGameDialog as any,
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
    const handler = getStorageHandler(window, $storageSource$, '');

    if (handler instanceof ApiStorageHandler) {
      await handler.keepOnDevice(book);
    } else {
      await getStorageHandler(
        window,
        StorageKey.BROWSER,
        undefined,
        true,
        $cacheStorageData$,
        $replicationSaveBehavior$
      ).saveBook(book, false, false);
    }

    addImportsToHome([book.title]);
    database.dataListChanged$.next(handler);
  }

  /** Asks whether visual novels go up to a cloud provider; true = upload (vn-upload.ts). */
  function askVnUpload(games: VnUpload[], target: StorageKey) {
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
  async function vnSizes(titles: string[]) {
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
   * library by the server's import queue (data/calibre-import.ts), which skips books
   * already there. The library is refreshed once they are in the catalog.
   */
  async function addFilesToCalibre(files: File[]) {
    if (!hasPermission(currentAccount(), 'import')) {
      resetProgress();
      showError(
        'Adding to Calibre failed',
        currentAccount()
          ? 'This account may not add books to Calibre. Ask an admin for the "Add books" permission.'
          : 'Sign in (Settings → Account, on the HTTPS address) to add books to Calibre',
        ''
      );
      return;
    }

    cancelTooltip = 'Stops uploading\nBooks already uploaded are still added to Calibre';
    replicationProgress$.next({ progressBase: 1, maxProgress: files.length * 2 });

    const ids: string[] = [];
    const failures: string[] = [];
    let jobs: CalibreImportJob[] = [];

    for (const file of files) {
      if (cancelSignal.aborted) {
        break;
      }

      try {
        ids.push((await uploadToCalibre(file, cancelSignal)).id);
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

    resetProgress();

    const added = jobs.filter((job) => job.state === 'added');
    const duplicates = jobs.filter((job) => job.state === 'duplicate');

    jobs
      .filter((job) => job.state === 'failed')
      .forEach((job) => failures.push(`${job.name}: ${job.error}`));

    let books = $bookCards$ ?? [];

    if (added.length) {
      const handler = getStorageHandler(window, $storageSource$, '');

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

    await offerSeriesForImports(books, newTitles);

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
  async function offerSeriesForImports(libraryBooks: BookCardProps[], titles: string[]) {
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
      database.dataListChanged$.next(getStorageHandler(window, $storageSource$, ''));
    } catch (error: any) {
      showError('Adding to series failed', error.message, '');
    }
  }

  async function onMakeSeries() {
    const books = $bookCards$ ?? [];
    const book = books.find((card) => selectedBookIds.has(card.id));

    if (!book) {
      return;
    }

    const saved = await new Promise<boolean>((resolver) => {
      dialogManager.dialogs$.next([
        {
          component: SeriesDialog,
          props: { book, books, resolver, local: $storageSource$ === StorageKey.BROWSER }
        }
      ]);
    });

    if (saved) {
      selectMode = false;
      database.dataListChanged$.next(getStorageHandler(window, $storageSource$, ''));
    }
  }

  function renderMoreOnVisible(node: HTMLElement) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          renderLimit += renderStep;
        }
      },
      { rootMargin: '800px' }
    );

    observer.observe(node);

    return { destroy: () => observer.disconnect() };
  }

  function showError(title: string, message: string, fallbackMessage: string) {
    const showReport = logger.errorCount > 1;

    logger.warn(message);

    dialogManager.dialogs$.next([
      {
        component: showReport ? LogReportDialog : MessageDialog,
        props: {
          title,
          message: showReport ? fallbackMessage : message
        }
      }
    ]);
  }

  function initializeReplicationProgressData() {
    replicationDone = new Subject<void>();
    replicationProgress$.pipe(takeUntil(replicationDone)).subscribe(updateProgress);
    replicationProgressRemaining = 'Estimating…';
    replicationProgress = 0;
    replicationToProgress = 1;
    bytesBonus = 0;
    bytesPhase = undefined;
    executionStart = Date.now();

    logger.clearHistory();

    cancelToken = new AbortController();
    cancelSignal = cancelToken.signal;
  }

  function resetProgress() {
    replicationDone.next();
    replicationDone.complete();
    replicationToProgress = 0;
    replicationProgress = 0;
    cancelTooltip = '';
  }

  function onSelectAllBooks() {
    const bookCards = visibleBookCards;
    selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
      bookCards.forEach((x) => set.add(x.id));
    });
  }

  function onSortChange(property: SortOption['property']) {
    booklistSortOptions$.next({
      ...$booklistSortOptions$,
      [$storageSource$]: nextSortOption($booklistSortOptions$[$storageSource$], property)
    });
  }

  function onSelectionToStatistics() {
    $preFilteredTitlesForStatistics$ = new Set(
      $bookCards$.filter((card) => selectedBookIds.has(card.id)).map((book) => book.title)
    );

    goto(`${pagePath}${mergeEntries.STATISTICS.routeId}`);
  }

  function clearFilters() {
    activeFilter = allBooksFilter.key;
    searchTerm = '';
  }

  async function removeBooks(bookIds: number[]) {
    if (!operationAllowed()) {
      return;
    }

    const cards = $bookCards$.filter((card) => bookIds.includes(card.id));
    // Not part of upstream: admins delete Calibre books and games from the library itself;
    // otherwise only their synced data goes and the catalog lists them again.
    const fromLibrary = $storageSource$ === StorageKey.CALIBRE && !!currentAccount()?.admin;

    if (
      fromLibrary &&
      (await new Promise<boolean>((resolver) => {
        dialogManager.dialogs$.next([
          {
            component: ConfirmDialog,
            props: {
              dialogHeader: `Delete ${pluralize(cards.length, 'title')} from the library?`,
              dialogMessage: `This removes them from the Calibre library for every reader, with their shared reader data.\n\nBooks go to Calibre's recycle bin; visual novel folders are deleted for good.`,
              contentStyles: 'white-space: pre-line;',
              confirmLabel: `Delete ${pluralize(cards.length, 'title')}`,
              danger: true,
              resolver
            }
          }
        ]);
      }))
    ) {
      return;
    }

    cancelTooltip = `Cancels the Deletion\nAlready deleted data will not be restored`;

    initializeReplicationProgressData();

    const currentBookCount = $bookCards$.length;
    const handler = getStorageHandler(window, $storageSource$, '');
    let { error, deleted } = await handler.deleteBookData(
      cards.map((card) => card.title),
      cancelSignal,
      $keepLocalStatisticsOnDeletion$
    );

    cards
      .filter((card) => deleted.includes(card.id))
      .forEach((card) => {
        deleteVnCache(card.title).catch(() => {});
        deleteWindowsGame(windowsGameFolder(card.title)).catch(() => {});
        deleteCachedReadings(card.title).catch(() => {});
        deleteBookKanji(card.title).catch(() => {});
      });

    if (fromLibrary && !cancelSignal.aborted) {
      const calibreIds = cards
        .filter((card) => deleted.includes(card.id) && card.calibreId !== undefined)
        .map((card) => card.calibreId!);

      try {
        const { failed } = calibreIds.length ? await removeFromCalibre(calibreIds) : { failed: [] };

        if (failed.length) {
          error = `${pluralize(failed.length, 'title', false)} could not be removed from Calibre`;
        }
      } catch (removeError: any) {
        error = removeError.message;
      }
      handler.clearData();
      await handler.getBookList().catch(() => {});
      database.dataListChanged$.next(handler);
    }

    resetProgress();

    await tick();

    if (deleted.length === currentBookCount) {
      selectMode = false;
    } else {
      selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
        deleted.forEach((deletedBookId) => set.delete(deletedBookId));
      });
    }

    if (error) {
      showError('Deletion failed', error, 'Error(s) occurred during deletion');
    }
  }

  async function onImportBackup(file: File) {
    if (!operationAllowed()) {
      return;
    }

    const errorTitle = 'Import failed';

    cancelTooltip = `Cancels the current Import\nAlready imported data will not be deleted`;

    initializeReplicationProgressData();

    if (!/\.zip$/i.test(file.name)) {
      resetProgress();

      showError(errorTitle, 'Invalid file - expected zip archive', '');
      return;
    }

    const error = await importBackup(
      getStorageHandler(
        window,
        StorageKey.BACKUP,
        undefined,
        $storageSource$ === StorageKey.BROWSER,
        $cacheStorageData$,
        $replicationSaveBehavior$,
        $statisticsMergeMode$,
        $readingGoalsMergeMode$
      ),
      getStorageHandler(
        window,
        $storageSource$,
        '',
        $storageSource$ === StorageKey.BROWSER,
        $cacheStorageData$,
        $replicationSaveBehavior$,
        $statisticsMergeMode$,
        $readingGoalsMergeMode$
      ),
      file,
      cancelSignal
    ).catch((err) => err.message);

    resetProgress();

    if (error) {
      showError(errorTitle, error, 'Error(s) occurred during import');
    }
  }

  function onDifficultyClick() {
    const books = ($bookCards$ ?? []).filter(
      (card) => selectedBookIds.has(card.id) && card.calibreId
    );

    dialogManager.dialogs$.next([{ component: DifficultyDialog, props: { books } }]);
  }

  function onReplicateData() {
    dialogManager.dialogs$.next([{ component: BookExportDialog, disableCloseOnClick: true }]);
  }

  async function onDeleteStatistics() {
    const titles = $bookCards$
      .filter((card) => selectedBookIds.has(card.id))
      .map((book) => book.title);

    let wasCanceled = false;

    if ($confirmStatisticsDeletion$) {
      wasCanceled = await new Promise((resolver) => {
        dialogManager.dialogs$.next([
          {
            component: ConfirmDialog,
            props: {
              dialogHeader: 'Delete Data',
              dialogMessage: `This will delete all Statistics for the selected ${pluralize(
                titles.length,
                'Title',
                false
              )} (which may include start and/or completion Data)\n\nExecute a one time Sync with an export behavior of "replace" and/or statistics merge mode of "replace" to apply deletions to other devices`,
              contentStyles: 'white-space: pre-line;',
              resolver
            }
          }
        ]);
      });
    }

    if (wasCanceled) {
      return;
    }

    cancelTooltip = `Cancels the current Process`;

    initializeReplicationProgressData();

    const limiter = pLimit(1);
    const tasks: Promise<void>[] = [];

    let failed = 0;

    replicationProgress$.next({ progressBase: 1, maxProgress: titles.length });

    titles.forEach((title) => {
      tasks.push(
        limiter(async () => {
          try {
            throwIfAborted(cancelSignal);
            await database.deleteStatisticEntries([title], true);

            replicationProgress$.next({ progressToAdd: 1 });
          } catch (error) {
            handleErrorDuringReplication(error, `Error on deleting statistics for ${title}: `, [
              limiter
            ]);

            failed += 1;
          }
        })
      );
    });

    await Promise.all(tasks).catch(() => {});

    resetProgress();

    if (failed) {
      const errorMessage = `Unable to delete statistics of ${pluralize(failed, 'Title')}`;

      showError('Deletion Failed', errorMessage, errorMessage);
    }
  }

  async function onClearProgress() {
    const titles = $bookCards$
      .filter((card) => selectedBookIds.has(card.id))
      .map((book) => book.title);
    const wasCanceled = await new Promise<boolean>((resolver) => {
      dialogManager.dialogs$.next([
        {
          component: ConfirmDialog,
          props: {
            dialogHeader: 'Clear Progress',
            dialogMessage: `Start ${pluralize(titles.length, 'Title', false)} from the beginning?\n\nThe reading position is reset on all devices. Statistics and highlights are kept.`,
            contentStyles: 'white-space: pre-line;',
            resolver
          }
        }
      ]);
    });

    if (wasCanceled || !operationAllowed()) {
      return;
    }

    cancelTooltip = `Cancels the current Process\nAlready reset books stay reset`;

    initializeReplicationProgressData();
    replicationProgress$.next({ progressBase: 1, maxProgress: titles.length });

    const handler = getStorageHandler(window, $storageSource$, '');
    const failedTitles: string[] = [];

    for (const title of titles) {
      if (cancelSignal.aborted) {
        break;
      }

      try {
        await clearReadingProgress(handler, title);
      } catch (error: any) {
        logger.error(`Error clearing progress of ${title}: ${error.message}`);
        failedTitles.push(title);
      }

      replicationProgress$.next({ progressToAdd: 1 });
    }

    database.dataListChanged$.next(handler);
    resetProgress();

    if (failedTitles.length) {
      const errorMessage = `Unable to clear progress of ${pluralize(failedTitles.length, 'Title')}`;

      showError('Clear Progress Failed', errorMessage, errorMessage);
    }
  }

  function updateProgress(replicationProgressData: ReplicationProgress) {
    if (cancelSignal.aborted) {
      return;
    }

    progressBase = replicationProgressData.progressBase || progressBase || 0;
    replicationToProgress = replicationProgressData.maxProgress || replicationToProgress || 0;

    if (replicationProgressData.bytes) {
      updateBytesProgress(replicationProgressData.bytes.phase, replicationProgressData.bytes);
      return;
    }

    if (replicationProgressData.progressToAdd || replicationProgressData.completeStep) {
      bytesBonus = 0;
    }

    if (replicationProgressData.completeStep || replicationProgressData.skipStep) {
      bytesPhase = undefined;
    }

    if (replicationProgressData.skipStep) {
      const progressDiffToAdd =
        Math.ceil(replicationProgress / progressBase) * progressBase - replicationProgress;

      replicationProgress =
        Math.floor(
          (replicationProgress + (progressDiffToAdd || progressBase) + Number.EPSILON) * 1000
        ) / 1000;
    } else if (replicationProgressData.completeStep) {
      const progressDiffToAdd = Math.ceil(replicationProgress) - replicationProgress;

      replicationProgress =
        Math.floor((replicationProgress + progressDiffToAdd + Number.EPSILON) * 1000) / 1000;
    } else if (replicationProgressData.progressToAdd && replicationProgressData.progressToAdd > 0) {
      replicationProgress =
        Math.floor(
          (replicationProgress + replicationProgressData.progressToAdd + Number.EPSILON) * 1000
        ) / 1000;
    }

    if (replicationProgressData.progressToAdd && !bytesPhase) {
      const duration = (Date.now() - executionStart) / 1000;
      const processPerSecond = replicationProgress / duration;
      const remainingTime = (replicationToProgress - replicationProgress) / processPerSecond;

      replicationProgressRemaining =
        replicationToProgress > replicationProgress
          ? getTimestamp(Math.ceil(remainingTime))
          : '~ 00:00:01';
    }
  }

  const replicator$ = executeReplicate$.pipe(
    switchMap(async () => {
      if (!operationAllowed()) {
        return;
      }

      const books = $bookCards$.filter((card) => selectedBookIds.has(card.id));
      const kept = $lastExportedTypes$.includes(StorageDataType.DATA)
        ? await vnsKeptOnDevice(
            $lastExportedTarget$,
            await vnSizes(books.filter((book) => book.vn).map((book) => book.title)),
            askVnUpload
          )
        : new Set<string>();

      cancelTooltip = 'Cancels the current export';

      initializeReplicationProgressData();

      const handlers = [$storageSource$, $lastExportedTarget$].map((storageType) =>
        getStorageHandler(
          window,
          storageType,
          '',
          $lastExportedTarget$ === StorageKey.BROWSER,
          $cacheStorageData$,
          $replicationSaveBehavior$,
          $statisticsMergeMode$,
          $readingGoalsMergeMode$
        )
      );
      const error = await replicateData(
        handlers[0],
        handlers[1],
        false,
        books.map((book) => ({
          title: book.title,
          imagePath: book.imagePath,
          keepOnDevice: kept.has(book.title)
        })),
        $lastExportedTypes$,
        cancelSignal
      ).catch((err) => err.message);

      resetProgress();

      if (error) {
        showError('Export failed', error, 'Error(s) occurred during export');
      }
    }),
    reduceToEmptyString()
  );

  const bytesPhaseLabels: Record<BytesPhase, MessageKey> = {
    reading: 'library.progress.reading',
    saving: 'library.progress.saving',
    packing: 'library.progress.packing',
    uploading: 'library.progress.uploading'
  };

  /** "Saving to this browser 1.2 GB / 3.0 GB", with the time left once there is a rate */
  function updateBytesProgress(
    phase: BytesPhase,
    { done, total }: { done: number; total: number }
  ) {
    const now = Date.now();
    const key = `${phase}:${total}`;

    if (bytesPhase?.key !== key) bytesPhase = { key, start: now, startDone: done };

    // Reading and saving have no other progress inside their step: the bytes move the bar.
    if (phase === 'reading' || phase === 'saving') {
      const stepLeft = Math.ceil(replicationProgress) - replicationProgress || 1;

      bytesBonus = Math.max(bytesBonus, (total ? Math.min(done / total, 0.99) : 0) * stepLeft);
    }

    const elapsed = (now - bytesPhase.start) / 1000;
    const moved = done - bytesPhase.startDone;
    const progress = tr('library.progress.bytes', {
      phase: tr(bytesPhaseLabels[phase]),
      done: formatBytes(done),
      total: formatBytes(total)
    });

    replicationProgressRemaining =
      elapsed >= 3 && moved > 0 && done < total
        ? tr('library.progress.left', {
            progress,
            time: getTimestamp(Math.ceil(((total - done) * elapsed) / moved))
          })
        : progress;
  }

  function getTimestamp(seconds: number) {
    return seconds && Number.isFinite(seconds)
      ? `~ ${new Date(seconds * 1000).toISOString().substr(11, 8)}`
      : 'Estimating…';
  }
</script>

<svelte:window on:online={retryLibrary} />

<svelte:head>
  <title>{formatPageTitle('Book Manager')}</title>
</svelte:head>

{$replicator$ ?? ''}

<!-- The standalone's first run covers the library until a place for books is chosen. -->
{#if browser && needsFirstRun(standalone, $storageChosen$)}
  <FirstRun />
{/if}

<div class="app-page-shell">
  <BookManagerHeader
    currentBookId={$currentBookId$}
    disabled={!!replicationToProgress}
    on:filesChange={(ev) => onFilesChange(ev.detail)}
    on:importBackup={(ev) => onImportBackup(ev.detail)}
    on:windowsGame={openWindowsGame}
  />

  <div class="library-layout" class:library-layout-home={isHome}>
    {#if !isHome}
      <LibrarySidebar
        bookCards={$bookCards$ ?? []}
        loading={isLoading}
        bind:activeFilter
        bind:searchTerm
      />
    {/if}

    <main
      class="library-main"
      aria-label="Book library"
      on:dragenter={(ev) => ev.preventDefault()}
      on:dragover={(ev) => ev.preventDefault()}
      on:dragend={(ev) => ev.preventDefault()}
      on:drop={(ev) => ev.preventDefault()}
      on:drop={(ev) => getDropEventFiles(ev).then(onFilesChange)}
    >
      <!-- Visual novels aren't grouped in series -->
      {#if !isHome && activeSeries && !showSeriesGrid && visibleBookCards.length}
        <div class="series-header">
          <div class="min-w-0">
            <h1 class="series-header-title" lang="ja">{activeSeries}</h1>
            <p class="series-header-meta" lang="ja">
              {[
                visibleBookCards[0].authors !== 'Unknown' ? visibleBookCards[0].authors : '',
                $t$('store.seriesMeta', {
                  count: visibleBookCards.length,
                  started: visibleBookCards.filter((card) => card.progress > 0).length,
                  missing: seriesMissing.length
                })
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <button
            type="button"
            class="app-button app-button-primary"
            disabled={!seriesMissing.length}
            on:click={() => addToHome(seriesMissing.map((card) => card.title))}
          >
            {seriesMissing.length
              ? $t$('store.addAll', { count: seriesMissing.length })
              : $t$('store.allOnHome')}
          </button>
        </div>
      {/if}
      {#if !isHome}
        <div class="store-bar">
          {#if activeFilter !== 'vn'}
            <div class="app-segmented" role="radiogroup" aria-label={$t$('store.view')}>
              <button
                type="button"
                role="radio"
                class="app-segment"
                class:app-segment-selected={!showSeriesGrid}
                aria-checked={!showSeriesGrid}
                on:click={() => setStoreView('books')}
              >
                {$t$('store.books')}
              </button>
              <button
                type="button"
                role="radio"
                class="app-segment"
                class:app-segment-selected={showSeriesGrid}
                aria-checked={showSeriesGrid}
                on:click={() => setStoreView('series')}
              >
                {$t$('store.series')}
              </button>
            </div>
          {/if}
          {#if !isLoading && $bookCards$?.length}
            <span class="store-count">
              {$t$(visibleBookCards.length === 1 ? 'store.titlesOne' : 'store.titles', {
                count: visibleBookCards.length.toLocaleString('en-US')
              })}
            </span>
          {/if}
          {#if !showSeriesGrid}
            <span class="store-sort">
              <button
                type="button"
                class="app-button app-button-quiet"
                disabled={!$bookCards$?.length}
                on:click={() => (selectMode = true)}
              >
                {$t$('library.select')}
              </button>
              <LibrarySortMenu />
            </span>
          {/if}
        </div>
      {/if}
      {#if replicationToProgress}
        <div class="library-toolbar" role="status">
          <button
            type="button"
            class="library-toolbar-button"
            title={cancelTooltip}
            aria-label="Cancel operation"
            on:click={() => {
              if (!cancelSignal.aborted) {
                cancelToken.abort();
                replicationProgressRemaining = 'Canceling ...';
              }
            }}
          >
            <Fa icon={faCircleXmark} />
          </button>
          <progress
            class="library-progress"
            value={Math.min(replicationToProgress, replicationProgress + bytesBonus)}
            max={replicationToProgress}
          />
          <span class="library-progress-label text-sm font-bold tabular-nums">
            {replicationProgressRemaining}
          </span>
        </div>
      {:else if selectMode}
        <div class="library-select-bar" role="toolbar" aria-label={$t$('library.selectBooks')}>
          <span class="library-select-count">
            {$t$('library.selected', { count: selectedBookIds.size })}
          </span>
          <!-- Home's shelves aren't the list Select all works on -->
          {#if !isHome}
            <button
              type="button"
              class="app-button app-button-quiet"
              title={$t$('library.selectAllHint')}
              on:click={onSelectAllBooks}
            >
              {$t$('library.selectAll')}
            </button>
          {/if}
          <button
            type="button"
            class="app-button app-button-quiet"
            title={$t$('library.stopSelecting')}
            on:click={() => (selectMode = false)}
          >
            {$t$('library.cancel')}
          </button>
          <span class="library-select-actions">
            <button
              type="button"
              class="library-toolbar-button library-toolbar-button-primary"
              title={$t$('home.addSelected')}
              disabled={!selectedBookIds.size}
              on:click={addSelectedToHome}
            >
              <Fa icon={faPlus} />
              <span class="library-toolbar-label">{$t$('home.add')}</span>
            </button>
            <button
              type="button"
              class="library-toolbar-button"
              title={$t$('library.readSelected')}
              disabled={selectedBookIds.size !== 1}
              on:click={readSelected}
            >
              <Fa icon={faBookOpen} />
              <span class="library-toolbar-label">{$t$('book.read')}</span>
            </button>
            {#if $storageSource$ === StorageKey.BROWSER || ($storageSource$ === StorageKey.CALIBRE && hasPermission($account$, 'series'))}
              <button
                type="button"
                class="library-toolbar-button"
                title={$t$('library.makeSeriesHint')}
                disabled={selectedBookIds.size !== 1}
                on:click={onMakeSeries}
              >
                <Fa icon={faLayerGroup} />
                <span class="library-toolbar-label">{$t$('library.makeSeries')}</span>
              </button>
            {/if}
            {#if $storageSource$ !== StorageKey.FS}
              <button
                type="button"
                class="library-toolbar-button"
                title={$t$('library.clearProgressHint')}
                disabled={!selectedBookIds.size}
                on:click={onClearProgress}
              >
                <Fa icon={faRotateLeft} />
                <span class="library-toolbar-label">{$t$('library.clearProgress')}</span>
              </button>
            {/if}
            <button
              type="button"
              class="library-toolbar-button"
              title={$t$('library.exportHint')}
              disabled={!selectedBookIds.size}
              on:click={onReplicateData}
            >
              <Fa icon={faCloudArrowUp} />
              <span class="library-toolbar-label">{$t$('library.export')}</span>
            </button>
            {#if $storageSource$ === StorageKey.BROWSER}
              <button
                type="button"
                class="library-toolbar-button"
                title={$t$('library.statisticsHint')}
                aria-label={$t$('library.statisticsHint')}
                disabled={!selectedBookIds.size}
                on:click={onSelectionToStatistics}
              >
                <Fa icon={faChartLine} />
              </button>
              <button
                type="button"
                class="library-toolbar-button"
                title={$t$('library.deleteStatisticsHint')}
                aria-label={$t$('library.deleteStatisticsHint')}
                disabled={!selectedBookIds.size}
                on:click={onDeleteStatistics}
              >
                <Fa icon={faCalendarXmark} />
              </button>
            {/if}
            {#if $storageSource$ === StorageKey.CALIBRE}
              <button
                type="button"
                class="library-toolbar-button"
                title={$t$('library.difficultyHint')}
                disabled={!selectedBookIds.size}
                on:click={onDifficultyClick}
              >
                <Fa icon={faGaugeHigh} />
                <span class="library-toolbar-label">{$t$('library.sortDifficulty')}</span>
              </button>
            {/if}
            <button
              type="button"
              class="library-toolbar-button library-toolbar-button-danger"
              title={$t$('library.deleteSelected')}
              disabled={!selectedBookIds.size}
              on:click={() => removeBooks(Array.from(selectedBookIds))}
            >
              <Fa icon={faTrash} />
              <span class="library-toolbar-label">{$t$('library.delete')}</span>
            </button>
          </span>
        </div>
      {/if}

      {#if $libraryOffline$ && $storageSource$ === StorageKey.CALIBRE && !isLoading}
        <div class="library-banner" role="status">
          <p>{$t$('home.offline')}</p>
          <button type="button" class="app-button" on:click={retryLibrary}
            >{$t$('home.retry')}</button
          >
        </div>
      {/if}
      {#if standalone && $backgroundAnalysis$}
        <p class="library-analysing" role="status">
          {$t$('home.analysing', $backgroundAnalysis$)}
        </p>
      {/if}
      {#if isLoading}
        <LibrarySkeleton mode={$libraryDisplayMode$} />
      {:else if $bookCards$.length && isHome}
        <div class="home">
          <LearnerDashboard
            books={standalone || $storageSource$ === StorageKey.CALIBRE ? $bookCards$ : undefined}
          />
          <PlacementOffer />
          {#if firstRun}
            <section class="home-start" aria-label={$t$('home.startReading')}>
              <SectionHead number={1} title={$t$('home.startReading')} />
              <span class="home-start-actions">
                <button
                  type="button"
                  class="app-button app-button-primary"
                  on:click={() => ($libraryTab$ = 'store')}
                >
                  {$t$(standalone ? 'home.openLibrary' : 'home.openStore')}
                </button>
                <label class="app-button">
                  <input
                    type="file"
                    accept="application/epub+zip,.epub,.htmlz,plain/text,.txt,.cbz,.zip,.mokuro"
                    multiple
                    hidden
                    use:inputFile={onFilesChange}
                  />
                  {$t$('home.importBook')}
                </label>
              </span>
            </section>
          {/if}
          <div class="home-pair">
            <ContinueReadingShelf
              books={continueCards}
              number={1}
              heading={$t$('home.continueReading')}
              currentBookId={$currentBookId$}
              selectedBookIds={selectMode ? selectedBookIds : undefined}
              on:bookClick={(ev) => onCoverClick(ev.detail.id)}
              on:bookRead={(ev) => onBookClick(ev.detail.id)}
              on:bookSelect={(ev) => selectBook(ev.detail.id)}
              removeTitle={$t$('home.remove')}
              on:remove={(ev) => removeFromHome(ev.detail.title)}
            />
            <ReadNextShelf
              books={readNextCards}
              number={continueCards.length ? 2 : 1}
              coverage={$knownCoverage$}
              reason={readNextReason}
              currentBookId={$currentBookId$}
              selectedBookIds={selectMode ? selectedBookIds : undefined}
              on:bookClick={(ev) => onCoverClick(ev.detail.id)}
              on:bookRead={(ev) => onBookClick(ev.detail.id)}
              on:bookSelect={(ev) => selectBook(ev.detail.id)}
            />
          </div>
          {#if socialOn}
            <HomeSocial
              books={$bookCards$}
              number={socialNumber}
              bind:sections={socialSections}
              on:bookClick={(ev) => onCoverClick(ev.detail.id)}
            />
          {/if}
          {#if homeCards.length}
            <ContinueReadingShelf
              books={homeCards}
              number={myBooksNumber}
              heading={$t$('home.myBooks')}
              removeTitle={$t$('home.remove')}
              currentBookId={$currentBookId$}
              selectedBookIds={selectMode ? selectedBookIds : undefined}
              on:bookClick={(ev) => onCoverClick(ev.detail.id)}
              on:bookSelect={(ev) => selectBook(ev.detail.id)}
              on:remove={(ev) => removeFromHome(ev.detail.title)}
            />
          {:else}
            <section class="home-start" aria-label={$t$('home.myBooks')}>
              <SectionHead number={myBooksNumber} title={$t$('home.myBooks')} count={0} />
              <p class="library-empty-text">
                {$t$(standalone ? 'home.myBooksEmptyLibrary' : 'home.myBooksEmpty')}
              </p>
            </section>
          {/if}
          {#if standalone}
            <AnalysisToolsOffer />
            <InstallHint />
          {/if}
        </div>
      {:else if $bookCards$.length && showSeriesGrid}
        <SeriesGrid
          groups={seriesGroups(visibleBookCards)}
          on:showSeries={(ev) => showSeries(ev.detail)}
        />
      {:else if $bookCards$.length}
        <SeriesResults matches={seriesMatches} on:showSeries={(ev) => showSeries(ev.detail)} />
        {#if !visibleBookCards.length}
          <div class="library-empty">
            <p class="library-empty-title">No books match this filter</p>
            <button type="button" class="library-toolbar-button" on:click={clearFilters}>
              Show all books
            </button>
          </div>
        {:else if $libraryDisplayMode$ === 'list'}
          <BookCardTable
            currentBookId={$currentBookId$}
            {selectedBookIds}
            {selectMode}
            sortOption={$booklistSortOptions$[$storageSource$]}
            bookCards={renderedBookCards}
            on:bookClick={(ev) => onCoverClick(ev.detail.id)}
            on:bookSelect={(ev) => selectBook(ev.detail.id)}
            on:removeBookClick={(ev) => removeBooks([ev.detail.id])}
            on:sort={(ev) => onSortChange(ev.detail)}
          />
        {:else}
          <BookCardList
            currentBookId={$currentBookId$}
            {selectedBookIds}
            {selectMode}
            compact={$libraryDisplayMode$ === 'covers-compact'}
            bookCards={renderedBookCards}
            on:bookClick={(ev) => onCoverClick(ev.detail.id)}
            on:bookSelect={(ev) => selectBook(ev.detail.id)}
            on:removeBookClick={(ev) => removeBooks([ev.detail.id])}
          />
        {/if}
        {#if renderedBookCards.length < visibleBookCards.length}
          {#key renderLimit}
            <div class="flex justify-center pb-4" use:renderMoreOnVisible>
              <button
                type="button"
                class="library-toolbar-button"
                on:click={() => (renderLimit += renderStep)}
              >
                Show more ({visibleBookCards.length - renderedBookCards.length} remaining)
              </button>
            </div>
          {/key}
        {/if}
        {#if hasActiveFilter && visibleBookCards.length}
          <p class="pb-4 text-center text-small font-semibold text-[color:var(--app-muted-fg)]">
            Showing {visibleBookCards.length} of {$bookCards$.length} books ·
            <button type="button" class="underline" on:click={clearFilters}>show all</button>
          </p>
        {/if}
      {:else if $storageSource$ === StorageKey.CALIBRE && librarySignInNeeded($account$, $libraryOffline$)}
        <div class="library-signed-out">
          <h1 class="library-signed-out-title">Sign in to see the library</h1>
          <p class="library-empty-text">Ask the server's admin for an account.</p>
          <a
            class="app-button app-button-primary"
            href="{pagePath}/settings?section={standalone
              ? 'sync#sync-server'
              : 'general#general-account'}">Sign in</a
          >
        </div>
      {:else if $storageSource$ === StorageKey.CALIBRE && $libraryOffline$}
        <div class="library-signed-out">
          <h1 class="library-signed-out-title">The server can't be reached</h1>
          <p class="library-empty-text">No books downloaded to this browser yet.</p>
        </div>
      {:else if standalone}
        <LibraryEmpty onFiles={onFilesChange} />
      {:else if $storageSource$ === StorageKey.CALIBRE && $libraryBuilding$}
        <div class="library-empty" role="status">
          <span class="library-empty-title">{$t$('library.calibreBuilding')}</span>
          <span class="library-empty-text">{$t$('library.calibreBuildingText')}</span>
        </div>
      {:else if $storageSource$ === StorageKey.CALIBRE}
        {#await calibreImportReady then importReady}
          {#if importReady}
            <label class="library-empty library-empty-import">
              <input
                type="file"
                accept="application/epub+zip,.epub,.htmlz,plain/text,.txt,.cbz,.zip"
                multiple
                hidden
                use:inputFile={onFilesChange}
              />
              <span class="library-empty-title">{$t$('library.calibreEmpty')}</span>
              <span class="library-empty-text">{$t$('library.calibreEmptyImport')}</span>
            </label>
          {:else}
            <div class="library-empty">
              <span class="library-empty-title">{$t$('library.calibreEmpty')}</span>
              <span class="library-empty-text">
                {$t$('library.calibreEmptyNoImport')}
                <a
                  class="underline"
                  href="{selfHostingGuideUrl}#what-runs"
                  target="_blank"
                  rel="noreferrer">{$t$('library.calibreProfiles')}</a
                >
              </span>
            </div>
          {/if}
        {/await}
      {:else}
        <label class="library-empty library-empty-import">
          <input
            type="file"
            accept="application/epub+zip,.epub,.htmlz,plain/text,.txt,.cbz,.zip,.mokuro"
            multiple
            hidden
            use:inputFile={onFilesChange}
          />
          <span class="library-empty-title">Your library is empty</span>
          <span class="library-empty-text">Drop EPUB, HTMLZ or TXT files, or click to import</span>
        </label>
      {/if}
    </main>
  </div>
</div>

{#if detailsBook}
  <BookDetails
    book={detailsBook}
    bookCards={$bookCards$}
    isCalibre={$storageSource$ === StorageKey.CALIBRE}
    localSeries={$storageSource$ === StorageKey.BROWSER}
    covered={$page.state.bookWords !== undefined}
    on:close={() => history.back()}
    on:words={() => pushState('', { bookDetails: detailsBook?.id, bookWords: detailsBook?.id })}
    on:read={(ev) => onBookClick(ev.detail.id)}
    on:showBook={(ev) => pushState('', { bookDetails: ev.detail.id })}
    on:showSeries={(ev) => showSeriesFromDetails(ev.detail)}
    on:changed={() =>
      database.dataListChanged$.next(getStorageHandler(window, $storageSource$, ''))}
  />
  {#if $page.state.bookWords === detailsBook.id}
    <BookWords book={detailsBook} on:close={() => history.back()} />
  {/if}
{/if}

<style>
  .library-layout {
    --library-header-height: 4rem;
    --library-sidebar-width: 275px;

    display: grid;
    grid-template-columns: var(--library-sidebar-width) minmax(0, 1fr);
    gap: 1.35rem;
    padding-top: 4.65rem;
    padding-right: clamp(1rem, 3.125vw, 2.5rem);
    padding-bottom: 3rem;
  }

  @media (min-width: 1280px) {
    .library-layout {
      --library-header-height: 3.25rem;

      padding-top: 4.25rem;
    }
  }

  .library-layout-home {
    grid-template-columns: minmax(0, 1fr);
    padding-left: clamp(1rem, 3.125vw, 2.5rem);
  }

  .library-layout-home .library-main {
    grid-column: auto;
  }

  .library-main {
    grid-column: 2;
    min-width: 0;
    min-height: calc(100dvh - 8rem);
    padding-top: 1.75rem;
  }

  @media (max-width: 900px) {
    .library-layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 1rem;
      padding-inline: 1rem;
    }

    .library-main {
      grid-column: auto;
      padding-top: 0.5rem;
    }
  }

  .home {
    display: flex;
    max-width: 75rem;
    flex-direction: column;
    gap: 3.5rem;
    margin: 0 auto;
    padding-top: 1.25rem;
  }

  /* Continue reading and Read next side by side while both fit */
  .home-pair {
    display: flex;
    flex-wrap: wrap;
    gap: 3.5rem 4rem;
  }

  /* Grown, so every section head's rule runs to the column's right edge */
  .home-pair > :global(*) {
    flex: 1 1 auto;
    max-width: 100%;
  }

  .home-pair:not(:has(> *)) {
    display: none;
  }

  @media (max-width: 639px) {
    .home {
      gap: 2.5rem;
      padding-top: 0.5rem;
    }

    .home-pair {
      gap: 2.5rem;
    }

    .home-pair > :global(*) {
      flex-basis: 100%;
    }
  }

  .home-start {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }

  .home-start :global(.section-head) {
    align-self: stretch;
  }

  .home-start > p {
    max-width: 40rem;
  }

  .home-start-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .series-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem 2rem;
    margin-bottom: 1.5rem;
  }

  .series-header-title {
    font-size: var(--type-h1);
    font-weight: 700;
    line-height: 1.3;
  }

  .series-header-meta {
    margin-top: 0.25rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .store-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1.25rem;
    margin-bottom: 1.5rem;
  }

  .store-sort {
    display: flex;
    gap: 0.5rem;
    margin-left: auto;
  }

  .store-count {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  /* Select mode and progress: a ruled bar that sticks under the top bar */
  .library-toolbar {
    position: sticky;
    top: var(--library-header-height);
    z-index: 15;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    padding: 0.5rem 0;
    border-top: 2px solid var(--font-color);
    border-bottom: 1px solid var(--border-color);
    background: var(--background-color);
    color: var(--font-color);
  }

  /* Select mode: a ruled action bar fixed to the bottom (above the phone tab bar) */
  .library-select-bar {
    position: fixed;
    inset: auto 0 0;
    z-index: 30;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1.25rem;
    padding: 0.75rem clamp(1rem, 3.125vw, 2.5rem) calc(0.75rem + env(safe-area-inset-bottom));
    border-top: 2px solid var(--font-color);
    background: var(--background-color);
  }

  @media (max-width: 639px) {
    .library-select-bar {
      bottom: calc(3.5rem + env(safe-area-inset-bottom));
      gap: 0.5rem 1rem;
      padding-bottom: 0.75rem;
    }

    .library-toolbar-label {
      display: none;
    }
  }

  @media (min-width: 640px) {
    .library-toolbar-button:has(.library-toolbar-label) :global(svg) {
      display: none;
    }
  }

  .library-select-count {
    font-size: var(--type-body);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .library-select-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-left: auto;
  }

  /* Room under the last row for the bar */
  .library-main:has(.library-select-bar) {
    padding-bottom: 6rem;
  }

  .library-toolbar-button {
    display: inline-flex;
    min-height: var(--app-control-height);
    min-width: var(--app-control-height);
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0 0.75rem;
    border: 1px solid var(--font-color);
    border-radius: 2px;
    background: transparent;
    font-size: var(--type-button);
    font-weight: 700;
    transition: background-color 0.15s ease;
  }

  .library-toolbar-button:hover:not(:disabled) {
    background: var(--surface-color);
  }

  .library-toolbar-button-primary {
    border-color: var(--accent-color);
    background: var(--accent-color);
    color: var(--app-accent-fg);
  }

  .library-toolbar-button-primary:hover:not(:disabled) {
    border-color: var(--app-accent-hover);
    background: var(--app-accent-hover);
  }

  .library-toolbar-button:disabled {
    cursor: not-allowed;
    border-color: var(--border-color);
    background: transparent;
    color: var(--app-muted-fg);
  }

  .library-toolbar-button-danger:not(:disabled) {
    border-color: var(--app-danger-color);
    color: var(--app-danger-color);
  }

  .library-progress {
    flex: 1 1 auto;
    min-width: 4rem;
    height: 3px;
    border: 0;
    appearance: none;
    background: var(--app-progress-track);
  }

  /* Long byte labels wrap on phones rather than pushing the bar out */
  .library-progress-label {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .library-progress::-webkit-progress-bar {
    background: var(--app-progress-track);
  }

  .library-progress::-webkit-progress-value {
    background: var(--app-progress-fill);
  }

  .library-progress::-moz-progress-bar {
    background: var(--app-progress-fill);
  }

  /* Banner (States & specs): a paper-2 band between a 2px ink rule and a 1px rule */
  .library-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem 1.5rem;
    margin-bottom: 1.5rem;
    padding: 0.6rem 1rem;
    border-top: 2px solid var(--font-color);
    border-bottom: 1px solid var(--border-color);
    background: var(--surface-color);
    font-size: var(--type-small);
  }

  @media (max-width: 639px) {
    .library-banner {
      flex-direction: column;
      align-items: flex-start;
    }
  }

  .library-analysing {
    margin-bottom: 1rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .library-empty {
    display: flex;
    max-width: 32rem;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
    margin: 1rem 0 3rem;
    padding: 1.5rem 0;
    border-top: 2px solid var(--font-color);
    border-bottom: 1px solid var(--border-color);
  }

  .library-empty-title {
    font-size: var(--type-h2);
    font-weight: 700;
  }

  .library-empty-text {
    color: var(--app-muted-fg);
    font-size: var(--type-body);
    line-height: 1.6;
  }

  .library-empty-import {
    cursor: pointer;
  }

  .library-signed-out {
    display: flex;
    max-width: 75rem;
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
    margin: 0 auto;
    padding-top: 1.5rem;
  }

  .library-signed-out p {
    max-width: 34rem;
  }

  .library-signed-out-title {
    font-size: var(--type-h1);
    font-weight: 700;
  }

  .library-empty-import:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }
</style>
