<script lang="ts">
  import {
    auditTime,
    combineLatest,
    debounceTime,
    EMPTY,
    filter,
    fromEvent,
    map,
    merge,
    NEVER,
    of,
    share,
    shareReplay,
    distinctUntilChanged,
    skip,
    startWith,
    Subject,
    switchMap,
    take,
    takeWhile,
    tap,
    timer
  } from 'rxjs';
  import { quintInOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';
  import { browser } from '$app/env';
  import { page } from '$lib/data/page-store';
  import { goto } from '$app/navigation';
  import { faCloudBolt, faPause, faPlay, faSpinner } from '@fortawesome/free-solid-svg-icons';
  import BookReader from '$lib/components/book-reader/book-reader.svelte';
  import WelcomeBackToast from '$lib/components/book-reader/welcome-back-toast.svelte';
  import JumpBackButton from '$lib/components/book-reader/jump-back-button.svelte';
  import { JumpBack } from '$lib/components/book-reader/jump-back';
  import type {
    AutoScroller,
    BookmarkManager,
    PageManager
  } from '$lib/components/book-reader/types';
  import LogReportDialog from '$lib/components/log-report-dialog.svelte';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import StyleSheetRenderer from '$lib/components/style-sheet-renderer.svelte';
  import {
    autoBookmark$,
    autoBookmarkTime$,
    autoPositionOnResize$,
    avoidPageBreak$,
    bookReaderKeybindMap$,
    database,
    enableTapEdgeToFlip$,
    enableTextJustification$,
    enableTextWrapPretty$,
    firstDimensionMargin$,
    fontFamilyGroupOne$,
    fontFamilyGroupTwo$,
    fontSize$,
    fontWeight$,
    furiganaStyle$,
    hideFurigana$,
    hideSpoilerImage$,
    multiplier$,
    pageColumns$,
    prioritizeReaderStyles$,
    secondDimensionMaxValue$,
    showFooterChapterCharacterCounter$,
    showFooterChapterPercentage$,
    textIndentation$,
    textMarginMode$,
    textMarginValue$,
    trackerAutostartTime$,
    trackerStartOnOpen$,
    verticalMode$,
    writingMode$,
    viewMode$,
    selectionToBookmarkEnabled$,
    lineHeight$,
    syncTarget$,
    autoReplication$,
    skipKeyDownListener$,
    replicationSaveBehavior$,
    cacheStorageData$,
    confirmClose$,
    verticalCustomReadingPosition$,
    horizontalCustomReadingPosition$,
    customReadingPointEnabled$,
    statisticsEnabled$,
    openTrackerOnCompletion$,
    addCharactersOnCompletion$,
    statisticsMergeMode$,
    manualBookmark$,
    overwriteBookCompletion$,
    startDayHoursForTracker$,
    readingGoalsMergeMode$,
    pauseTrackerOnCustomPointChange$,
    hideSpoilerImageMode$,
    showCharacterCounter$,
    showPercentage$,
    enableVerticalFontKerning$,
    enableFontVPAL$,
    verticalTextOrientation$,
    generatedFurigana$,
    unknownWordUnderline$,
    chapterPrimer$
  } from '$lib/data/store';
  import { spansOf, unknownWordFlags$ } from '$lib/data/words/unknown-words';
  import { chapterPrimer, type ChapterPrimer } from '$lib/data/words/chapter-primer';
  import { addGeneratedRuby, placeAfterRerender } from '$lib/data/words/generated-furigana';
  import {
    prewarmBook,
    readingsAvailable,
    readingsFor$,
    startLocalAnalysis
  } from '$lib/data/analysis/analysis-tools';
  import BookCompletionConfetti from '$lib/components/book-reader/book-completion-confetti/book-completion-confetti.svelte';
  import ReaderPanel from '$lib/components/book-reader/reader-panel.svelte';
  import MiniPlayer from '$lib/components/audio/mini-player.svelte';
  import {
    absenceTabFor,
    bookProgressLabel,
    chapterProgressLabel,
    currentChapterLabel,
    jumpOffset,
    readerTopInset,
    readerWidth,
    resolvePanelTab,
    tabPausesTracker,
    type PanelTab
  } from '$lib/data/reader/reader-panel';
  import HighlightEditor from '$lib/components/book-reader/highlight-editor.svelte';
  import SelectionToolbar from '$lib/components/book-reader/selection-toolbar.svelte';
  import CommunityMarkers from '$lib/components/community/community-markers.svelte';
  import CommunityMatchToast from '$lib/components/community/community-match-toast.svelte';
  import { communityWorks$ } from '$lib/data/social/community';
  import { lineLinkTarget, matchOffer$ } from '$lib/data/social/community-book';
  import LookupPopup from '$lib/components/dictionary/lookup-popup.svelte';
  import LookupHint from '$lib/components/dictionary/lookup-hint.svelte';
  import {
    AnnotationsController,
    type Highlight,
    type HighlightColor
  } from '$lib/data/reader/annotations';
  import { searchIndexCache, type SearchResult } from '$lib/functions/book-text/book-search';
  import { cssHighlightsSupported } from '$lib/functions/book-text/css-highlights';
  import {
    getTextWithoutFurigana,
    HighlightPainter,
    newHighlight,
    selectedBookRange,
    selectionPassage
  } from '$lib/functions/book-text/reader-highlights';
  import BookReaderHeader from '$lib/components/book-reader/book-reader-header.svelte';
  import AnkiWatcher from '$lib/components/dictionary/anki-watcher.svelte';
  import { bookSentenceAudio, noteSentence } from '$lib/data/dictionary/anki';
  import { enableExtrasSync } from '$lib/data/sync/extras-sync';
  import { bookSyncSource } from '$lib/data/sync/sync-files';
  import { readingActivity, ReaderHooksSession } from '$lib/data/reader/reader-hooks';
  import { selectionForm, WordFormsLoader } from '$lib/data/words/word-marks';
  import type { PassageContext } from '$lib/data/ai/ask-ai';
  import { featureParams } from '$lib/data/ai/ai-connections';
  import { activePlugins$, type SelectionActionContribution } from '$lib/plugins';
  import {
    imageGallerySpoilerSync,
    readerImageGalleryPictures$
  } from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';
  import BookReaderImageGallery from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery.svelte';
  import {
    isTrackerMenuOpen$,
    isTrackerPaused$
  } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
  import BookReadingTracker from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker.svelte';
  import {
    getChapterData,
    nextChapter$,
    sectionList$,
    sectionProgress$,
    type SectionWithProgress
  } from '$lib/components/book-reader/book-toc/book-toc';
  import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
  import NumberDialog from '$lib/components/number-dialog.svelte';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import { preFilteredTitlesForStatistics$ } from '$lib/components/statistics/statistics-types';
  import {
    currentDbVersion,
    type BooksDbBookData,
    type BooksDbBookmarkData
  } from '$lib/data/database/books-db/versions/books-db';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { pagePath } from '$lib/data/env';
  import { DB_VERSION, PAGE_CHANGE, SKIPKEYLISTENER, SYNCED } from '$lib/data/events';
  import { fullscreenManager } from '$lib/data/fullscreen-manager';
  import { logger } from '$lib/data/logger';
  import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
  import { storeBookCompletion } from '$lib/data/stats/book-completion';
  import { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
  import type { BrowserStorageHandler } from '$lib/data/storage/handler/browser-handler';
  import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
  import { storageSource$ } from '$lib/data/storage/storage-view';
  import {
    getStorageHandlerByName,
    saveExternalLastRead,
    syncDownData
  } from '$lib/data/storage/reader-storage';
  import { activeTheme$ } from '$lib/data/theme/theme-store';
  import { toReaderThemeOption } from '$lib/data/theme/themes';
  import { ViewMode } from '$lib/data/view-mode';
  import loadBookData from '$lib/functions/book-data-loader/load-book-data';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { iffBrowser } from '$lib/functions/rxjs/iff-browser';
  import { AutoReplicationType } from '$lib/functions/replication/replication-options';
  import { replicateData } from '$lib/functions/replication/replicator';
  import { readableToObservable } from '$lib/functions/rxjs/readable-to-observable';
  import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';
  import { takeWhenBrowser } from '$lib/functions/rxjs/take-when-browser';
  import { tapDom } from '$lib/functions/rxjs/tap-dom';
  import { multiClickHandler } from '$lib/functions/multi-click-handler';
  import { executeReplicate$ } from '$lib/functions/replication/replication-progress';
  import { clickOutside } from '$lib/functions/use-click-outside';
  import { convertRemToPixels, dummyFn, isMobile$, limitToRange } from '$lib/functions/utils';
  import { isIgnoredReaderKey, isSearchShortcut, onKeydownReader } from './on-keydown-reader';
  import { shouldBookmarkOnLeave } from '$lib/functions/bookmark-on-leave';
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { isManga } from '$lib/data/manga/manga';
  import { isVn } from '$lib/data/vn/vn';
  import { bookRoute, readerPath, replacePage } from '$lib/data/reader/reader-route';
  import { t$, tr } from '$lib/i18n';
  import Fa from 'svelte-fa';
  import {
    clearRange,
    getParagraphToPoint,
    getRangeForUserSelection,
    getReferencePoints,
    pulseElement
  } from '$lib/functions/range-util';

  // Runes: $state.raw keeps the old immutable semantics (only a new object or array re-renders).
  let showSpinner = $state.raw(true);
  let showHeader = $state.raw(false);
  let isBookmarkScreen = $state.raw(false);
  let showFooter = $state.raw(true);
  let exploredCharCount = $state.raw(0);
  let bookCharCount = $state.raw(0);
  let autoScroller = $state.raw<AutoScroller>();
  let bookmarkManager = $state.raw<BookmarkManager>();
  let pageManager = $state.raw<PageManager>();
  let bookmarkData = $state.raw<Promise<BooksDbBookmarkData | undefined>>(
    Promise.resolve(undefined)
  );
  /** bookmarkData once resolved, for a re-render that must decide at once where to reopen */
  let savedBookmark: BooksDbBookmarkData | undefined;
  $effect.pre(() => {
    bookmarkData.then((data) => (savedBookmark = data));
  });
  let customReadingPointTop = $state.raw(-2);
  let customReadingPointLeft = $state.raw(-2);
  let customReadingPoint = $state.raw(
    $verticalMode$ ? $verticalCustomReadingPosition$ : $horizontalCustomReadingPosition$
  );
  let customReadingPointScrollOffset = $state.raw(0);
  /** The side panel (Contents, Search, Highlights, Listen, plugin tabs); mounted once opened */
  let panelOpen = $state.raw(false);
  let panelMounted = $state.raw(false);
  let panelTab = $state.raw<PanelTab>('contents');
  const searchIndexOf = searchIndexCache();
  let annotations = $state.raw<AnnotationsController>();
  let editingHighlight = $state.raw<Highlight>();
  let editingFocusNote = $state.raw(false);
  /** Days since the book was last opened, if long enough to offer a recap */
  let welcomeBackDays = $state.raw(0);
  let selectedRange = $state.raw<Range>();
  let lookupPopup = $state.raw<LookupPopup>();
  let lookupOpen = $state.raw(false);
  /** A plugin's selection action, open with the passage it was given */
  let selectionPanel = $state.raw<{
    action: SelectionActionContribution;
    passage: PassageContext;
  }>();
  let customReadingPointRange = $state.raw<Range>();
  let lastSelectedRange: Range | undefined;
  let lastSelectedRangeWasEmpty = true;
  let isSelectingCustomReadingPoint = $state.raw(false);
  let showCustomReadingPoint = $state.raw(false);
  let localStorageHandler: BrowserStorageHandler;
  let dataToReplicate = $state.raw<StorageDataType[]>([]);
  let dataToReplicateQueue: StorageDataType[] = [];
  let externalStorageHandler = $state.raw<BaseStorageHandler>();
  let externalStorageErrors = $state.raw(0);
  let isReplicating = $state.raw(false);
  let storedExploredCharacter = $state.raw(0);
  let hasBookmarkData = $state.raw(false);
  let blockDataUpdates = $state.raw(false);
  let trackerElm = $state.raw<BookReadingTracker>();
  let showTrackerIcon = $state.raw(false);
  let wasTrackerPaused = $state.raw(true);
  let frozenPosition = $state.raw(-1);
  let skipFirstFreezeChange = false;
  let bookCompleted = $state.raw(false);
  let confettiWidthModifier = $state.raw(36);
  let confettiMaxRuns = $state.raw(0);
  let showReaderImageGallery = $state.raw(false);
  let dismissDialogs = true;
  let syncedResolver: () => void;

  const syncedPromise = new Promise<void>((resolver) => {
    syncedResolver = resolver;
  });
  const fontFeatureSettings = [
    $enableVerticalFontKerning$ && '"vkrn"',
    $enableFontVPAL$ && '"vpal"'
  ]
    .filter((f) => !!f && $verticalMode$)
    .join(', ');
  const verticalTextOrientation = $verticalMode$ ? $verticalTextOrientation$ : '';

  const bookId$ = iffBrowser(() => readableToObservable(page)).pipe(
    map((pageObj) => Number(pageObj.url.searchParams.get('id'))),
    // The page store emits on any URL/state change (hash, ?line=, replaceState): only a new id reloads.
    distinctUntilChanged(),
    shareReplay({ refCount: true, bufferSize: 1 })
  );

  const rawBookData$ = bookId$.pipe(
    switchMap(async (id) => {
      let bookData: BooksDbBookData | undefined;

      // A Community line link without a book: this browser's copy, else the thread.
      const lineTarget = id ? null : await lineLinkTarget(new URL(location.href).searchParams);

      if (lineTarget) {
        goto(lineTarget, { replaceState: true });
        return new Promise<never>(() => {});
      }

      try {
        localStorageHandler = getStorageHandler(
          window,
          StorageKey.BROWSER,
          undefined,
          true,
          $cacheStorageData$,
          $replicationSaveBehavior$,
          $statisticsMergeMode$,
          $readingGoalsMergeMode$
        );

        localStorageHandler.startContext({ id, title: '' });
        bookData = await localStorageHandler.getBook();

        if (!bookData) {
          return bookData;
        }

        if (isManga(bookData) || isVn(bookData)) {
          replacePage(readerPath(id, bookRoute(bookData)));
          return new Promise<never>(() => {});
        }

        // The analysis worker loads beside the sync and the first render (bookData$ queues the jobs).
        prewarmBook(bookData);

        const currentContext = {
          id: bookData.id,
          title: bookData.title,
          imagePath: bookData.coverImage
        };

        localStorageHandler.startContext(currentContext);

        if (bookData.storageSource) {
          externalStorageHandler = await getStorageHandlerByName(bookData.storageSource, true);
        } else if ($autoReplication$ !== AutoReplicationType.Off) {
          externalStorageHandler = await getStorageHandlerByName($syncTarget$);
        }

        const daysAway = (Date.now() - (bookData.lastBookOpen || Date.now())) / 86_400_000;

        bookData.lastBookOpen = new Date().getTime();

        await localStorageHandler.updateLastRead(bookData);

        try {
          await syncDownData(localStorageHandler, externalStorageHandler, currentContext);
          bookData = await saveExternalLastRead(externalStorageHandler, bookData);
        } catch (error: any) {
          // Reading works offline from the browser copy; progress syncs on the next save.
          if (!bookData.elementHtml) throw error;

          logger.warn(`Sync failed, reading the copy in this browser: ${error.message}`);
        }

        if (!$statisticsEnabled$) {
          const wasNew = (
            await database.setFirstBookRead(currentContext.title, $startDayHoursForTracker$)
          )[1];

          if (wasNew) {
            scheduleReplication(StorageDataType.STATISTICS);
          }
        }

        // A synced book not cached here yet only gets its data above.
        if (isManga(bookData) || isVn(bookData)) {
          replacePage(readerPath(id, bookRoute(bookData)));
          return new Promise<never>(() => {});
        }

        if (bookData.language) {
          document.documentElement.lang = bookData.language;
        }

        if (daysAway >= 7) {
          welcomeBackDays = Math.floor(daysAway);
        }
      } catch (error: any) {
        const message = tr('reader.loadErrorMessage', { error: error.message });

        logger.warn(message);

        dialogManager.dialogs$.next([
          {
            component: MessageDialog,
            props: {
              title: tr('reader.loadError'),
              message
            }
          }
        ]);
        return undefined;
      } finally {
        syncedResolver();

        showSpinner = false;
      }

      if (externalStorageHandler) {
        externalStorageHandler.updateSettings(
          window,
          true,
          $replicationSaveBehavior$,
          $statisticsMergeMode$,
          $readingGoalsMergeMode$,
          $cacheStorageData$,
          false,
          bookData.storageSource || $syncTarget$
        );
      }

      return bookData;
    }),
    share()
  );

  const leaveIfBookMissing$ = rawBookData$.pipe(
    tap((data) => {
      if (!data) {
        goto(`${pagePath}${mergeEntries.MANAGE.routeId}`);
      }
    }),
    reduceToEmptyString()
  );

  const initBookmarkData$ = rawBookData$.pipe(
    tap((rawBookData) => {
      if (!rawBookData) return;
      bookmarkData = database.getBookmark(rawBookData.id);
    }),
    reduceToEmptyString()
  );

  const initAnnotations$ = rawBookData$.pipe(
    switchMap(async (rawBookData) => {
      if (!rawBookData) return;

      const syncSource = bookSyncSource(rawBookData.storageSource);
      const controller = new AnnotationsController(rawBookData.title, syncSource);

      // Recaps and lorebook sync like highlights.
      enableExtrasSync(rawBookData.title, syncSource);

      annotations = controller;
      await controller.load();
    }),
    reduceToEmptyString()
  );

  // The readings file, while generated furigana, the unknown-word underlines or the chapter primer need it.
  const bookReadings$ = rawBookData$.pipe(
    switchMap((rawBookData) => (rawBookData ? readingsFor$(rawBookData) : EMPTY)),
    shareReplay({ refCount: true, bufferSize: 1 })
  );

  let primer = $state.raw<ChapterPrimer>();

  const unknownWords$ = combineLatest([
    bookReadings$,
    unknownWordUnderline$,
    chapterPrimer$,
    sectionList$
  ]).pipe(
    switchMap(([{ title, readings }, underline, primerOn, sections]) =>
      (underline || primerOn) && readings
        ? unknownWordFlags$(title, readings).pipe(
            map((flags) => ({ readings, flags, underline, primerOn, sections }))
          )
        : of(undefined)
    ),
    tap((state) => {
      const spans = state?.underline ? spansOf(state.readings, state.flags) : [];

      primer = state?.primerOn
        ? chapterPrimer(state.readings, state.flags, state.sections)
        : undefined;
      painter.setUnknownSpans(spans);
    }),
    reduceToEmptyString()
  );

  const bookData$ = rawBookData$.pipe(
    switchMap((rawBookData) => {
      if (!rawBookData) return EMPTY;

      sectionList$.next(rawBookData.sections || []);

      let rendered = false;

      // Local books with the analysis tools: the difficulty estimate and word list are made on open.
      startLocalAnalysis(rawBookData);

      return combineLatest([bookReadings$, generatedFurigana$]).pipe(
        filter(([book]) => book.title === rawBookData.title),
        map(([{ readings }, on]) => (on ? readings : undefined)),
        distinctUntilChanged(),
        switchMap((readings) => {
          // Re-rendered while reading (switch, or the readings file got ready): keep the place.
          if (rendered && bookmarkManager) {
            const saved = savedBookmark?.exploredCharCount;
            bookmarkData = Promise.resolve(
              placeAfterRerender(
                savedBookmark,
                bookmarkManager.formatBookmarkData(rawBookData.id, readingOffset),
                !!saved && bookmarkManager.isCharCountOnScreen(saved)
              )
            );
          }
          rendered = true;

          return loadBookData(
            readings
              ? { ...rawBookData, elementHtml: addGeneratedRuby(rawBookData.elementHtml, readings) }
              : rawBookData,
            '.book-content',
            document,
            $viewMode$ === ViewMode.Paginated,
            $hideSpoilerImageMode$
          );
        })
      );
    }),
    shareReplay({ refCount: true, bufferSize: 1 })
  );

  const resize$ = iffBrowser(() =>
    visualViewport ? fromEvent(visualViewport, 'resize') : of()
  ).pipe(share());

  const containerViewportWidth$ = resize$.pipe(
    startWith(0),
    map(() => visualViewport?.width || 0),
    takeWhenBrowser()
  );

  const containerViewportHeight$ = resize$.pipe(
    startWith(0),
    map(() => visualViewport?.height || 0),
    takeWhenBrowser()
  );

  const themeOption$ = activeTheme$.pipe(map(toReaderThemeOption), takeWhenBrowser());

  const backgroundColor$ = themeOption$.pipe(map((o) => o.backgroundColor));

  const {
    collect$: collectReaderImageGallerySpoilerToggles$,
    apply$: handleUpdateImageGalleryPictureSpoilers$
  } = imageGallerySpoilerSync();

  const backgroundStyleName = 'background-color';
  const setBackgroundColor$ = backgroundColor$.pipe(
    tapDom(
      () => document.body,
      (backgroundColor, body) => body.style.setProperty(backgroundStyleName, backgroundColor),
      (body) => body.style.removeProperty(backgroundStyleName)
    ),
    reduceToEmptyString(),
    takeWhenBrowser()
  );

  const writingModeStyleName = 'writing-mode';
  const setWritingMode$ = writingMode$.pipe(
    tapDom(
      () => document.documentElement,
      (writingMode, documentElement) =>
        documentElement.style.setProperty(writingModeStyleName, writingMode),
      (documentElement) => documentElement.style.removeProperty(writingModeStyleName)
    ),
    reduceToEmptyString(),
    takeWhenBrowser()
  );

  const sectionData$ = iffBrowser(() => sectionProgress$).pipe(
    map((sectionProgress) => [...sectionProgress.values()])
  );

  const textSelector$ = iffBrowser(() => fromEvent(document, 'selectionchange')).pipe(
    debounceTime(200),
    tap(() => {
      const currentSelected = window.getSelection()?.toString() || '';

      if (!currentSelected && lastSelectedRangeWasEmpty) {
        lastSelectedRange = undefined;
      } else if (currentSelected) {
        lastSelectedRange = window.getSelection()?.getRangeAt(0);
        lastSelectedRangeWasEmpty = false;
      } else {
        lastSelectedRangeWasEmpty = true;
      }
    }),
    reduceToEmptyString()
  );

  const replicator$ = executeReplicate$.pipe(
    auditTime(60000),
    switchMap(() => executeReplication()),
    reduceToEmptyString()
  );

  const autoStartTracker$ = iffBrowser(() =>
    $statisticsEnabled$ && $trackerAutostartTime$ > 0 ? fromEvent(document, PAGE_CHANGE) : NEVER
  ).pipe(
    debounceTime($trackerAutostartTime$ * 1000),
    take(1),
    tap(() => {
      wasTrackerPaused = false;
      isTrackerPaused$.next(wasTrackerPaused);
    }),
    reduceToEmptyString()
  );

  // Starts the tracker once the opened book has settled on its position (1.5 s
  // without a page change), so the jump to the bookmark isn't counted as reading.
  // Only while the page is visible and not being left: a tab restored in the
  // background must not count, and auto-pause only reacts to the page becoming hidden.
  const bookLoaded$ = new Subject<void>();

  $effect.pre(() => {
    if (browser && !showSpinner) {
      untrack(() => bookLoaded$.next());
    }
  });

  const startTrackerOnOpen$ = iffBrowser(() =>
    $statisticsEnabled$ && $trackerStartOnOpen$
      ? merge(
          fromEvent(document, PAGE_CHANGE),
          fromEvent(document, 'visibilitychange'),
          bookLoaded$
        ).pipe(startWith(undefined))
      : NEVER
  ).pipe(
    debounceTime(1500),
    filter(() => !showSpinner && !blockDataUpdates && document.visibilityState === 'visible'),
    take(1),
    tap(() => {
      wasTrackerPaused = false;
      isTrackerPaused$.next(false);
    }),
    reduceToEmptyString()
  );

  // The former `$:` statements: each body runs untracked and only re-runs on what the statement
  // named, as before; the pre effects keep their timing (before the DOM updates).
  $effect.pre(() => {
    if (panelOpen) {
      const scroller = autoScroller;

      untrack(() => scroller?.off());
    }
  });

  $effect.pre(() => {
    if (browser && bookCharCount) {
      const detail = { exploredCharCount };

      untrack(() => document.dispatchEvent(new CustomEvent(PAGE_CHANGE, { detail })));
    }
  });

  $effect.pre(() => {
    if (browser) {
      const detail = { bookCharCount };

      untrack(() => document.dispatchEvent(new CustomEvent(PAGE_CHANGE, { detail })));
    }
  });

  $effect.pre(() => {
    if (showCustomReadingPoint) {
      const pointRange = customReadingPointRange;

      untrack(() => {
        pauseTracker();

        pulseElement(pointRange?.endContainer?.parentElement, 'add', 1);

        fromEvent(document, 'click')
          .pipe(skip(1), take(1))
          .subscribe(() => {
            showCustomReadingPoint = false;
            pulseElement(customReadingPointRange?.endContainer?.parentElement, 'remove', 1);
            restartTrackerAfterCharacterChangeOrTime(1);
          });
      });
    }
  });

  $effect.pre(() => {
    if (frozenPosition !== -1 && exploredCharCount >= frozenPosition) {
      if (skipFirstFreezeChange) {
        skipFirstFreezeChange = false;
      } else {
        frozenPosition = -1;
      }
    }
  });

  const isPaginated = $derived($viewMode$ === ViewMode.Paginated);

  // The book shrinks to the room beside the open panel and always leaves the bar's room above it;
  // the readers keep their place when they re-lay out.
  const bookWidth = $derived(
    browser
      ? readerWidth($containerViewportWidth$ ?? 0, panelOpen, convertRemToPixels(window, 1))
      : 0
  );
  const bookTop = browser ? readerTopInset(convertRemToPixels(window, 1)) : 0;
  /** How far up the docked mini player reaches (mini-player.svelte); 0 while it isn't shown */
  let miniPlayerRoom = $state(0);
  // The book ends above the mini player: its own 2rem bottom padding (book-reader.svelte's py-8)
  // already covers part of it, and about 0.5rem stays free between them (glyph boxes overhang).
  const bookBottom = $derived(
    browser && miniPlayerRoom && !(panelOpen && panelTab === 'listen')
      ? Math.max(0, miniPlayerRoom - convertRemToPixels(window, 1))
      : 0
  );
  // Continuous: scrolled text passes under the panel's chrome, so the visible book (where jumps
  // land and the position is measured) begins this far from the screen's start edge.
  const edgeOffset = $derived(
    browser
      ? jumpOffset(
          { vertical: $verticalMode$, paginated: isPaginated, panelOpen },
          $containerViewportWidth$ ?? 0,
          convertRemToPixels(window, 1)
        )
      : 0
  );
  const readingOffset = $derived(customReadingPointScrollOffset + edgeOffset);

  const firstDimensionMargin = $derived(
    browser && $enableTapEdgeToFlip$ && isPaginated && $verticalMode$
      ? limitToRange(convertRemToPixels(window, 0.5), window.innerWidth, $firstDimensionMargin$)
      : ($firstDimensionMargin$ ?? 0)
  );

  const tapButtonHeight = $derived(`calc(100% - ${showHeader ? 5 : 4}rem)`);

  const tapButtonTop = $derived(`${showHeader ? 3 : 2}rem`);

  const footerChapterProgress = $derived.by(() => {
    const sections = $sectionData$;

    return untrack(() => getCurrentChapterProgress(sections));
  });

  // Books from the Calibre source always sync, since the server is their home.
  const upSyncEnabled = $derived(
    externalStorageHandler &&
      (externalStorageHandler.storageType === StorageKey.CALIBRE ||
        $autoReplication$ === AutoReplicationType.Up ||
        $autoReplication$ === AutoReplicationType.All)
  );

  $effect.pre(() => {
    bookmarkData.then((data) => {
      hasBookmarkData = !!data;
      storedExploredCharacter = data?.exploredCharCount || 0;
    });
  });

  /** Experimental Code - May be removed any time without warning */

  $effect.pre(() => {
    if (browser) {
      const detail = $skipKeyDownListener$;

      untrack(() => document.dispatchEvent(new CustomEvent(SKIPKEYLISTENER, { detail })));
    }
  });

  onMount(() => document.addEventListener('ttu-action', handleAction, false));

  function handleAction({ detail }: any) {
    if (!detail.type) {
      return;
    }

    if (detail.type === 'dbVersion') {
      document.dispatchEvent(new CustomEvent(DB_VERSION, { detail: currentDbVersion }));
    } else if (detail.type === 'waitForSync') {
      syncedPromise.finally(() => document.dispatchEvent(new CustomEvent(SYNCED)));
    } else if (detail.type === 'skipKeyDownListener') {
      skipKeyDownListener$.next(detail.params.value);
    } else if (
      detail.type === 'sync' &&
      (detail.syncType === StorageDataType.AUDIOBOOK ||
        detail.syncType === StorageDataType.SUBTITLE)
    ) {
      scheduleReplication(detail.syncType);
    }
  }
  /** Experimental Code - May be removed any time without warning */

  onDestroy(() => {
    if (browser) {
      document.removeEventListener('ttu-action', handleAction, false);
      document.documentElement.lang = 'ja';
    }

    // Leaving without the close button (browser back) must stop the tracker too;
    // pausing also saves the session's statistics.
    isTrackerPaused$.next(true);
    readerImageGalleryPictures$.next([]);
    painter.destroy();
    annotations?.flush();

    if (dismissDialogs) {
      dialogManager.dialogs$.next([]);
    }
  });

  function handleUnload(event: BeforeUnloadEvent) {
    if (
      $confirmClose$ &&
      (isReplicating ||
        storedExploredCharacter !== exploredCharCount ||
        (upSyncEnabled && dataToReplicate.length) ||
        (upSyncEnabled && dataToReplicateQueue.length))
    ) {
      event.preventDefault();
      // eslint-disable-next-line no-param-reassign
      return (event.returnValue = 'Are you sure you want to exit?');
    }

    return event;
  }

  function trackerSingleClickHandler() {
    if (!statisticsEnabled$) {
      return;
    }

    wasTrackerPaused = $isTrackerPaused$;
    isTrackerPaused$.next(true);
    isTrackerMenuOpen$.next(true);
  }

  function trackerDblClickHandler() {
    if (!statisticsEnabled$) {
      return;
    }

    dialogManager.dialogs$.next([]);
    wasTrackerPaused = !$isTrackerPaused$;
    isTrackerPaused$.next(wasTrackerPaused);
  }

  /** Keep the page in step with what is being read aloud. */
  function followTts(charCount: number) {
    if (charCount > exploredCharCount) {
      scrollToCount(charCount, true);
    }
  }

  /** `listen`: the Listen follow, a page turn like the reader's own (paginated auto-bookmark). */
  function scrollToCount(count: number, listen = false) {
    const dataId = getBookIdSync();

    if (!bookmarkManager || !dataId) {
      return;
    }

    bookmarkManager.scrollToBookmark(
      {
        dataId,
        // The managers take 0 for no bookmark: a line at the book's very start is 1 away.
        exploredCharCount: Math.max(1, count),
        lastBookmarkModified: new Date().getTime(),
        progress: 0
      },
      readingOffset,
      listen
    );
  }

  function onSelectionChange() {
    selectedRange = selectedBookRange();
  }

  /** The book's word list forms, loaded on the first selection ("Mark known") */
  const wordFormsLoader = new WordFormsLoader();
  const wordForms$ = wordFormsLoader.forms$;

  $effect.pre(() => {
    if (selectedRange && $rawBookData$ && $wordForms$?.title !== $rawBookData$.title) {
      const title = $rawBookData$.title;

      untrack(() => wordFormsLoader.load(title));
    }
  });

  const selectedWord = $derived(
    selectedRange && $wordForms$?.forms.size ? getTextWithoutFurigana(selectedRange) : ''
  );

  function openSelectionAction(action: SelectionActionContribution) {
    const content = document.querySelector('.book-content');

    if (!selectedRange || !content) {
      return;
    }

    selectionPanel = {
      action,
      passage: selectionPassage(
        content,
        selectedRange,
        $rawBookData$?.title ?? '',
        featureParams('ask').context ?? 2000,
        bookmarkManager?.getRenderedStartCount()
      )
    };
    panelOpen = true;
    panelMounted = true;
    selectedRange = undefined;
    document.getSelection()?.removeAllRanges();
  }

  // A Community line link (/b?id=&line=): the Community tab opens on its thread.
  let lineLinkOpened = false;

  $effect.pre(() => {
    if ($rawBookData$ && !lineLinkOpened && $page.url.searchParams.get('line')) {
      untrack(() => {
        lineLinkOpened = true;
        openPanel('community');
      });
    }
  });

  /** A plugin tab offered after days away (Story so far) */
  const absenceTab = $derived.by(() => {
    if (!welcomeBackDays) return undefined;

    const plugins = $activePlugins$;

    return untrack(() => absenceTabFor(plugins));
  });

  const highlights$ = $derived(annotations?.highlights$);
  const highlightSyncError$ = $derived(annotations?.syncError$);
  const painter = new HighlightPainter(
    () => bookmarkManager,
    () => $highlights$
  );

  $effect.pre(() => {
    if (bookmarkManager && $highlights$) {
      untrack(() => painter.scheduleHighlights(true));
    }
  });

  const hooks = new ReaderHooksSession(getSearchIndex, () => bookCharCount, jumpToCount);

  // Background work that follows the reading position: kanji seen (Home tab)
  // and the plugins' (e.g. the automatic lorebook update).
  $effect.pre(() => {
    if (exploredCharCount && $rawBookData$ && $bookData$) {
      // Read now so a change of the book's length restarts the wait, as before.
      void bookCharCount;
      hooks.moved($rawBookData$.title, exploredCharCount);
    }
  });

  // What is open, for the plugins (Discord status): each page turn and chapter.
  $effect.pre(() => {
    if ($rawBookData$ && bookCharCount) {
      const activity = {
        kind: 'book' as const,
        title: $rawBookData$.title,
        position: exploredCharCount,
        characters: bookCharCount,
        sections: $sectionData$ ?? []
      };

      untrack(() => readingActivity(activity));
    }
  });

  // The plugins' work on an opened book (Community markers), once it rendered and the browser idles.
  $effect.pre(() => {
    if (bookmarkManager && $bookData$ && $rawBookData$) {
      const title = $rawBookData$.title;

      untrack(() => hooks.opened(title));
    }
  });

  onDestroy(() => hooks.left($rawBookData$?.title, exploredCharCount, bookCharCount));

  function createHighlight(color: HighlightColor, withNote = false) {
    const content = document.querySelector('.book-content');
    const range = selectedRange;

    selectedRange = undefined;
    document.getSelection()?.removeAllRanges();

    if (!range || !content || !bookmarkManager || !annotations) {
      return;
    }

    const highlight = newHighlight(
      content,
      range,
      bookmarkManager.getRenderedStartCount(),
      color,
      sectionList$.getValue()
    );

    if (!highlight) {
      return;
    }

    const created = annotations.add(highlight);

    if (withNote) {
      editingHighlight = created;
      editingFocusNote = true;
    }
  }

  /** Clicking a highlight opens it for editing. */
  function onDocumentClick(event: MouseEvent) {
    if (document.getSelection()?.toString()) {
      return;
    }

    const content = document.querySelector('.book-content');

    if (!(event.target instanceof Node) || !content?.contains(event.target)) {
      return;
    }

    const hit = painter.highlightAt(event.clientX, event.clientY);

    if (hit) {
      editingHighlight = hit;
      editingFocusNote = false;
    } else {
      // A tap on text looks it up (built-in dictionary); elsewhere nothing changes.
      lookupPopup?.tapAt(event.clientX, event.clientY);
    }
  }

  function jumpToCount(count: number, back = false) {
    if (!bookmarkManager || !getBookIdSync()) {
      return;
    }

    if (!back) jumpBack.jumped();
    pauseTracker(true);
    scrollToCount(count);
    painter.scheduleHighlights(true);
  }

  const jumpBack = new JumpBack(
    () => {
      const id = getBookIdSync();
      return bookmarkManager && id
        ? bookmarkManager.formatBookmarkData(id, readingOffset).exploredCharCount
        : undefined;
    },
    (count) => jumpToCount(count, true)
  );
  const jumpBackOrigin$ = jumpBack.origin$;
  onDestroy(() => jumpBack.destroy());

  function jumpToSearchResult(result: SearchResult) {
    painter.searchMatch = {
      start: result.start,
      end: result.end,
      skip: result.skip,
      length: result.match.length
    };
    jumpToCount(result.start);
  }

  function closePanel() {
    panelOpen = false;
    selectionPanel = undefined;
    if (painter.searchMatch) {
      painter.searchMatch = undefined;
      painter.scheduleHighlights(true);
    }
  }

  /** Direction or view from the Aa sheet: save the place, then remount the reader there. */
  async function changeLayout(apply: () => void) {
    await bookmarkPage();
    apply();
  }

  /** Phones: a jump from the sheet closes it, so the place it went to is visible. */
  function closeSheetAfterJump() {
    if (window.innerWidth < 768) {
      panelOpen = false;
    }
  }

  function getSearchIndex() {
    return searchIndexOf($bookData$?.htmlContent ?? '');
  }

  function openPanel(key: PanelTab) {
    const panel = resolvePanelTab(key);
    panelTab = panel;
    panelOpen = true;
    panelMounted = true;
    welcomeBackDays = 0;

    if (tabPausesTracker($activePlugins$, panel)) {
      pauseTracker();
    }
  }

  async function handleJump() {
    const dataId = getBookIdSync();

    if (!bookmarkManager || !dataId) {
      return;
    }

    pauseTracker();
    skipKeyDownListener$.next(true);

    const target = await new Promise<number | undefined>((resolver) => {
      dialogManager.dialogs$.next([
        {
          component: NumberDialog,
          props: {
            dialogHeader: tr('reader.jumpToPosition'),
            minValue: 1,
            maxValue: bookCharCount || 1,
            resolver
          }
        }
      ]);
    });

    skipKeyDownListener$.next(false);

    if (typeof target !== 'number') {
      restartTrackerAfterCharacterChangeOrTime(1);
      return;
    }

    restartTrackerAfterCharacterChangeOrTime(1000);

    jumpBack.jumped();
    bookmarkManager.scrollToBookmark(
      {
        dataId: dataId,
        exploredCharCount: target,
        lastBookmarkModified: new Date().getTime(),
        progress: 0
      },
      readingOffset
    );
  }

  async function completeBook() {
    if (!$rawBookData$) {
      return;
    }

    const wasAutoscrollerEnabled = autoScroller?.wasAutoScrollerEnabled$.getValue();
    const wasTrackerPausedBefore = $statisticsEnabled$ ? $isTrackerPaused$ : true;

    showHeader = false;
    autoScroller?.off();

    if ($statisticsEnabled$) {
      wasTrackerPaused = true;
      isTrackerPaused$.next(true);
    }

    const diffToComplete =
      $statisticsEnabled$ && $addCharactersOnCompletion$
        ? Math.max(0, bookCharCount - exploredCharCount)
        : 0;
    const wasCanceled = await new Promise((resolver) => {
      dialogManager.dialogs$.next([
        {
          component: ConfirmDialog,
          props: {
            dialogHeader: tr('reader.completeBook'),
            dialogMessage: diffToComplete
              ? tr('reader.completeMessageCharacters', { count: diffToComplete })
              : tr('reader.completeMessage'),
            resolver
          }
        }
      ]);
    });

    if (wasCanceled) {
      if ($statisticsEnabled$ && !wasTrackerPausedBefore) {
        wasTrackerPaused = false;
        $isTrackerPaused$ = false;
      }

      if (wasAutoscrollerEnabled) {
        autoScroller?.toggle();
      }

      return;
    }

    dialogManager.dialogs$.next([
      {
        component: '<div/>',
        disableCloseOnClick: true
      }
    ]);

    try {
      if (diffToComplete) {
        const [hadError] = await trackerElm!.processStatistics(diffToComplete);

        if (hadError) {
          throw new Error('Character Update failed');
        }
      }

      const completion = await storeBookCompletion(
        $rawBookData$.title,
        $startDayHoursForTracker$,
        $overwriteBookCompletion$
      );

      if (completion.stored.length) {
        trackerElm?.updateCompletedBook(completion.todayStatistic, completion.finishedStatistic);

        scheduleReplication(StorageDataType.STATISTICS);
      }

      if (bookmarkManager) {
        const data = {
          ...bookmarkManager.formatBookmarkData($rawBookData$.id, readingOffset),
          exploredCharCount: Math.max(0, bookCharCount - 1),
          progress: 1
        };

        await database.putBookmark(data);

        bookmarkData = Promise.resolve(data);

        scheduleReplication(StorageDataType.PROGRESS);
      }

      if ($statisticsEnabled$ && $openTrackerOnCompletion$) {
        confettiWidthModifier = 36;
        confettiMaxRuns = 0;
        bookCompleted = window.matchMedia('(min-width: 900px)').matches;
        isTrackerMenuOpen$.next(true);
      } else {
        dialogManager.dialogs$.next([]);
        confettiWidthModifier = 0;
        confettiMaxRuns = 3;
        bookCompleted = true;

        merge(fromEvent(document, 'pointerup'), timer(10000))
          .pipe(take(1))
          .subscribe(() => {
            bookCompleted = false;
          });
      }
    } catch ({ message }: any) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: tr('reader.error'),
            message: tr('reader.completeError', { error: message })
          }
        }
      ]);
    }
  }

  // Called from a reactive line that only follows the sections, as before the move.
  function getCurrentChapterProgress(sectionData: SectionWithProgress[]) {
    return chapterProgressLabel(
      sectionData,
      exploredCharCount,
      $showFooterChapterCharacterCounter$,
      $showFooterChapterPercentage$
    );
  }

  function copyCurrentProgress(currentProgress: string) {
    try {
      navigator.clipboard.writeText(currentProgress);
    } catch (error: any) {
      logger.error(`Error writing Progress to Clipboard: ${error.message}`);
    }
  }

  function freezeTrackerPosition() {
    if (!$statisticsEnabled$) {
      return;
    }

    if (frozenPosition > -1) {
      frozenPosition = -1;
    } else {
      skipFirstFreezeChange = true;
      frozenPosition = exploredCharCount;
    }
  }

  function onKeydown(ev: KeyboardEvent) {
    if (isSearchShortcut(ev) && !$skipKeyDownListener$ && bookCharCount) {
      ev.preventDefault();
      openPanel('search');
      return;
    }

    if ($skipKeyDownListener$ || isIgnoredReaderKey(ev)) {
      return;
    }

    const result = onKeydownReader(
      ev,
      bookReaderKeybindMap$.getValue(),
      bookmarkPage,
      scrollToBookmark,
      (x) => multiplier$.next(multiplier$.getValue() + x),
      autoScroller,
      pageManager,
      $verticalMode$,
      changeChapter,
      handleSetCustomReadingPoint,
      trackerDblClickHandler,
      freezeTrackerPosition
    );

    if (!result) return;

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    ev.preventDefault();
  }

  function getBookIdSync() {
    let bookId: number | undefined;
    bookId$.subscribe((x) => (bookId = x)).unsubscribe();
    return bookId;
  }

  async function bookmarkPage() {
    const bookId = getBookIdSync();
    if (!bookId || !bookmarkManager) return;

    let data: BooksDbBookmarkData;

    showHeader = false;

    if (isPaginated) {
      const userSelectedRange = $selectionToBookmarkEnabled$
        ? getRangeForUserSelection(window, lastSelectedRange)
        : undefined;
      const bookmarkRange = userSelectedRange || customReadingPointRange;

      pulseElement(bookmarkRange?.endContainer?.parentElement, 'add', 0.5, 500);

      data = bookmarkManager.formatBookmarkDataByRange(bookId, bookmarkRange);

      if (userSelectedRange) {
        clearRange(window);
      }
    } else {
      data = bookmarkManager.formatBookmarkData(bookId, readingOffset);
    }

    await database.putBookmark(data);

    bookmarkData = Promise.resolve(data);

    scheduleReplication(StorageDataType.PROGRESS);
  }

  async function scrollToBookmark() {
    const data = await bookmarkData;
    if (!data || !bookmarkManager) return;

    if (data.exploredCharCount !== exploredCharCount) {
      pauseTracker(true);
    }

    jumpBack.jumped();
    bookmarkManager.scrollToBookmark(data, readingOffset);
  }

  function onFullscreenClick() {
    showHeader = false;

    if (!fullscreenManager.fullscreenElement) {
      fullscreenManager.requestFullscreen(document.documentElement);
      return;
    }
    fullscreenManager.exitFullscreen();
  }

  function onDomainHintClick() {
    dialogManager.dialogs$.next([
      {
        component: MessageDialog,
        props: {
          title: tr('reader.oldDomain'),
          message: tr('reader.oldDomainMessage')
        },
        disableCloseOnClick: true
      }
    ]);
  }

  function changeChapter(offset: number) {
    if (!$sectionData$?.length) {
      return;
    }

    const [mainChapters, currentChapterIndex] = getChapterData($sectionData$);

    if (
      (!currentChapterIndex && offset === -1) ||
      (offset === 1 && currentChapterIndex === mainChapters.length - 1)
    ) {
      return;
    }

    const nextChapter = mainChapters[currentChapterIndex + offset];

    if (!nextChapter) {
      return;
    }

    if (nextChapter.startCharacter !== exploredCharCount) {
      pauseTracker(true);
    }

    nextChapter$.next(nextChapter.reference);
  }

  async function executeReplication(isSilent = true) {
    if (isReplicating || !dataToReplicate.length || !$rawBookData$ || !externalStorageHandler) {
      return;
    }

    isReplicating = true;

    if (!isSilent) {
      skipKeyDownListener$.next(true);
      logger.clearHistory();
      openActionBackdrop();
    }

    const currentHandlerStorageSource = $rawBookData$.storageSource || $syncTarget$;

    externalStorageHandler.updateSettings(
      window,
      false,
      $replicationSaveBehavior$,
      $statisticsMergeMode$,
      $readingGoalsMergeMode$,
      $cacheStorageData$,
      !isSilent,
      currentHandlerStorageSource
    );

    const error = await replicateData(
      localStorageHandler,
      externalStorageHandler,
      !isSilent && $storageSource$ === externalStorageHandler.storageType,
      [
        {
          id: $rawBookData$.id,
          title: $rawBookData$.title,
          imagePath: $rawBookData$.coverImage
        }
      ],
      dataToReplicate
    ).catch((err: any) => err.message);

    externalStorageHandler.updateSettings(
      window,
      true,
      $replicationSaveBehavior$,
      $statisticsMergeMode$,
      $readingGoalsMergeMode$,
      $cacheStorageData$,
      false,
      currentHandlerStorageSource
    );

    isReplicating = false;

    if (error) {
      if (!isSilent) {
        const showReport = logger.errorCount > 1;

        logger.warn(error);

        dialogManager.dialogs$.next([
          {
            component: showReport ? LogReportDialog : MessageDialog,
            props: {
              title: tr('reader.processError'),
              message: showReport ? tr('reader.processErrorReport') : error
            }
          }
        ]);
      }

      externalStorageErrors += 1;
    } else {
      externalStorageErrors = 0;

      if (!isSilent) {
        dialogManager.dialogs$.next([]);
      }

      if (dataToReplicateQueue.length) {
        const isAudioBookOnly =
          dataToReplicate.length === 1 && dataToReplicate[0] === StorageDataType.AUDIOBOOK;
        dataToReplicate = JSON.parse(JSON.stringify(dataToReplicateQueue));
        dataToReplicateQueue = [];

        if (isSilent || isAudioBookOnly) {
          executeReplicate$.next();
        } else if (!isAudioBookOnly) {
          await executeReplication(false);
        } else {
          dataToReplicate = [];
        }
      } else {
        dataToReplicate = [];
      }
    }

    if (!isSilent) {
      skipKeyDownListener$.next(false);
    }
  }

  function openActionBackdrop() {
    dialogManager.dialogs$.next([
      {
        component: '<div/>',
        disableCloseOnClick: true
      }
    ]);
  }

  async function leaveReader(routeId: string, deleteLastItem = true) {
    let message;

    try {
      blockDataUpdates = true;

      await tick();

      autoScroller?.off();
      wasTrackerPaused = true;
      isTrackerPaused$.next(true);

      if ($confirmClose$ && storedExploredCharacter !== exploredCharCount) {
        const wasCanceled = await new Promise((resolver) => {
          dialogManager.dialogs$.next([
            {
              component: ConfirmDialog,
              props: {
                dialogHeader: tr('reader.confirmExit'),
                dialogMessage: tr('reader.confirmExitMessage'),
                resolver
              },

              disableCloseOnClick: true
            }
          ]);
        });

        if (wasCanceled) {
          blockDataUpdates = false;
          return;
        }

        await tick();
      }

      openActionBackdrop();

      if (deleteLastItem) {
        await database.deleteLastItem();
      }

      if (
        shouldBookmarkOnLeave(
          $manualBookmark$,
          (await bookmarkData)?.exploredCharCount,
          (count) => !!bookmarkManager?.isCharCountOnScreen(count)
        )
      ) {
        await bookmarkPage();
      }

      if ($statisticsEnabled$ && trackerElm) {
        const [hadError, updated] = await trackerElm.flushUpdates(true);

        if (hadError) {
          throw new Error('Error updating Statistics');
        }

        if (updated) {
          scheduleReplication(StorageDataType.STATISTICS);
        }
      }

      dialogManager.dialogs$.next([]);

      if (upSyncEnabled) {
        await executeReplication(false);
      }

      await annotations?.flush();
    } catch (error: any) {
      message = error.message;
    }

    if (message) {
      logger.error(message);

      dismissDialogs = false;
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: tr('reader.error'),
            message
          },
          disableCloseOnClick: true
        }
      ]);
    }

    goto(`${pagePath}${routeId}`);
  }

  function handleSetCustomReadingPoint() {
    if (!$customReadingPointEnabled$ && !isPaginated) {
      return;
    }

    const contentEl = document.querySelector('.book-content');

    if (!contentEl) {
      return;
    }

    autoScroller?.off();

    if ($pauseTrackerOnCustomPointChange$) {
      pauseTracker();
    }

    if (isPaginated) {
      customReadingPointTop = window.innerHeight / 2 - 2;
      customReadingPointLeft = window.innerWidth / 2 - 2;
    }

    showHeader = false;
    isSelectingCustomReadingPoint = true;
    document.body.classList.add('cursor-crosshair');

    const {
      elLeftReferencePoint,
      elTopReferencePoint,
      elRightReferencePoint,
      elBottomReferencePoint,
      pointGap
    } = getReferencePoints(window, contentEl, $verticalMode$, firstDimensionMargin);

    merge(fromEvent(document, 'pointerup'), fromEvent(document, 'pointermove'))
      // eslint-disable-next-line rxjs/no-ignored-takewhile-value
      .pipe(takeWhile(() => isSelectingCustomReadingPoint))
      .subscribe((event: Event) => {
        if (!(event instanceof PointerEvent)) {
          return;
        }

        if (event.type === 'pointerup') {
          document.body.classList.remove('cursor-crosshair');
          isSelectingCustomReadingPoint = false;

          tick().then(() => {
            customReadingPointLeft = $verticalMode$ ? event.x : customReadingPointLeft;
            customReadingPointTop = $verticalMode$ ? customReadingPointTop : event.y;

            const result = getParagraphToPoint(customReadingPointLeft, customReadingPointTop);

            if (result) {
              pulseElement(result.parent, 'add', 0.5, 500);
            }

            if (isPaginated) {
              customReadingPointRange = result?.range;
            } else {
              let newPercentage = 0;

              if ($verticalMode$) {
                newPercentage = Math.ceil(
                  (Math.max(0, customReadingPointLeft - elLeftReferencePoint) /
                    (elRightReferencePoint - elLeftReferencePoint)) *
                    100
                );

                verticalCustomReadingPosition$.next(newPercentage);
              } else {
                newPercentage = Math.ceil(
                  (Math.max(0, customReadingPointTop - elTopReferencePoint) /
                    (elBottomReferencePoint - elTopReferencePoint)) *
                    100
                );

                horizontalCustomReadingPosition$.next(newPercentage);
              }

              customReadingPoint = newPercentage;
            }

            if ($pauseTrackerOnCustomPointChange$) {
              restartTrackerAfterCharacterChangeOrTime(1000);
            }
          });
        } else {
          const insideXBound =
            event.x >= elLeftReferencePoint + pointGap && event.x <= elRightReferencePoint;
          const insideYBound =
            event.y >= elTopReferencePoint && event.y <= elBottomReferencePoint - pointGap;

          if (isPaginated) {
            customReadingPointTop = insideYBound ? event.y : customReadingPointTop;
            customReadingPointLeft = insideXBound ? event.x : customReadingPointLeft;
          } else if ($verticalMode$ && insideXBound) {
            customReadingPointLeft = event.x;
          } else if (!$verticalMode$ && insideYBound) {
            customReadingPointTop = event.y;
          }
        }
      });
  }

  function pauseTracker(restartAfterCharacterChange = false) {
    if ($statisticsEnabled$ && !$isTrackerPaused$) {
      wasTrackerPaused = false;
      $isTrackerPaused$ = true;

      if (restartAfterCharacterChange) {
        restartTrackerAfterCharacterChangeOrTime();
      }
    }
  }

  function restartTrackerAfterCharacterChangeOrTime(timerAmount = 0) {
    if (!$statisticsEnabled$ || wasTrackerPaused) {
      return;
    }

    merge(fromEvent(document, PAGE_CHANGE), timerAmount ? timer(timerAmount) : NEVER)
      .pipe(debounceTime(200), take(1))
      .subscribe(() => {
        wasTrackerPaused = false;
        $isTrackerPaused$ = false;
      });
  }

  function scheduleReplication(dataType: StorageDataType) {
    if (upSyncEnabled) {
      const toReplicate = isReplicating ? dataToReplicateQueue : dataToReplicate;

      if (!toReplicate.includes(dataType)) {
        toReplicate.push(dataType);
      }

      if (!isReplicating) {
        dataToReplicate = [...dataToReplicate];
      }

      if (!blockDataUpdates) {
        executeReplicate$.next();
      }
    }
  }
</script>

<svelte:head>
  <title>{formatPageTitle($rawBookData$?.title ?? '')}</title>
</svelte:head>

{$collectReaderImageGallerySpoilerToggles$ ?? ''}
<!-- Subscribed before the book loads, as Svelte 4 did: rawBookData$ and executeReplicate$ don't replay, and Svelte 5 subscribes on first render. -->
{$initBookmarkData$ ?? ''}
{$setBackgroundColor$ ?? ''}
{$setWritingMode$ ?? ''}
{$textSelector$ ?? ''}
{$replicator$ ?? ''}
{$autoStartTracker$ ?? ''}
{$startTrackerOnOpen$ ?? ''}
{$initAnnotations$ ?? ''}
{$unknownWords$ ?? ''}
{$handleUpdateImageGalleryPictureSpoilers$ ?? ''}
<button class="fixed inset-x-0 top-0 z-10 h-8 w-full" onclick={() => (showHeader = true)} />
{#if showHeader || panelOpen}
  <div
    class="writing-horizontal-tb fixed left-0 right-0 top-0 z-[61] {panelOpen
      ? 'md:right-[26.75rem]'
      : ''}"
    transition:fly={{ y: -300, easing: quintInOut }}
    use:clickOutside={() => (showHeader = false)}
  >
    <BookReaderHeader
      title={$rawBookData$?.title ?? ''}
      canUnderlineUnknown={!!$rawBookData$ && !!readingsAvailable($rawBookData$)}
      chapter={$sectionData$ ? currentChapterLabel($sectionData$) : ''}
      progress={bookCharCount ? `${Math.floor((exploredCharCount / bookCharCount) * 100)}%` : ''}
      {panelOpen}
      hasText={!!bookCharCount}
      hasCustomReadingPoint={!!(
        ($customReadingPointEnabled$ || isPaginated) &&
        ((isPaginated && customReadingPointRange) ||
          (!isPaginated && customReadingPointLeft > -1 && customReadingPointTop > -1))
      )}
      canSetReadingPoint={$customReadingPointEnabled$ || isPaginated}
      showFullscreenButton={fullscreenManager.fullscreenEnabled}
      autoScrollMultiplier={isPaginated ? undefined : $multiplier$}
      tracker={$statisticsEnabled$ && showTrackerIcon ? { paused: $isTrackerPaused$ } : undefined}
      {hasBookmarkData}
      on:back={() => leaveReader(mergeEntries.MANAGE.routeId)}
      on:panelClick={() => (panelOpen ? closePanel() : openPanel(panelTab))}
      on:jumpClick={handleJump}
      on:completeBook={completeBook}
      on:setCustomReadingPoint={handleSetCustomReadingPoint}
      on:showCustomReadingPoint={() => {
        showHeader = false;
        showCustomReadingPoint = true;
      }}
      on:resetCustomReadingPoint={() => {
        showHeader = false;

        if ($pauseTrackerOnCustomPointChange$) {
          pauseTracker();
        }

        if (isPaginated) {
          customReadingPointRange = undefined;
        } else if ($verticalMode$) {
          verticalCustomReadingPosition$.next(100);
          customReadingPoint = 100;
        } else {
          horizontalCustomReadingPosition$.next(0);
          customReadingPoint = 0;
        }

        if ($pauseTrackerOnCustomPointChange$) {
          restartTrackerAfterCharacterChangeOrTime(1000);
        }
      }}
      on:autoScrollClick={() => {
        showHeader = false;
        autoScroller?.toggle();
      }}
      on:fullscreenClick={onFullscreenClick}
      on:trackerClick={trackerDblClickHandler}
      on:bookmarkClick={bookmarkPage}
      on:scrollToBookmarkClick={() => {
        showHeader = false;
        scrollToBookmark();
      }}
      on:statisticsClick={() => {
        if ($rawBookData$) {
          $preFilteredTitlesForStatistics$ = new Set([$rawBookData$.title]);
        }

        leaveReader(mergeEntries.STATISTICS.routeId, false);
      }}
      on:readerImageGalleryClick={() => {
        showHeader = false;
        showReaderImageGallery = true;
      }}
      on:settingsClick={() => leaveReader(mergeEntries.SETTINGS.routeId, false)}
      on:wordsClick={() => leaveReader('/words', false)}
      on:domainHintClick={onDomainHintClick}
      on:layoutChange={({ detail }) => changeLayout(detail)}
    />
  </div>
{/if}

{#if $bookData$ && $rawBookData$}
  {#if $statisticsEnabled$}
    <BookReadingTracker
      fontColor={$themeOption$.fontColor}
      backgroundColor={$backgroundColor$}
      bookTitle={$rawBookData$.title}
      sectionData={$sectionData$}
      {frozenPosition}
      {exploredCharCount}
      {bookCharCount}
      {autoScroller}
      {blockDataUpdates}
      bind:wasTrackerPaused
      bind:this={trackerElm}
      on:freezeCurrentLocation={freezeTrackerPosition}
      on:statisticsSaved={() => {
        if (!blockDataUpdates) {
          scheduleReplication(StorageDataType.STATISTICS);
        }
      }}
      on:trackerAvailable={() => (showTrackerIcon = true)}
      on:trackerMenuClosed={() => {
        if (!wasTrackerPaused) {
          isTrackerPaused$.next(false);
        }

        isTrackerMenuOpen$.next(false);

        bookCompleted = false;
      }}
    />
  {/if}
  <StyleSheetRenderer styleSheet={$bookData$.styleSheet} />
  <!-- New HTML (generated furigana): remount, as on opening the book; the readers can't swap it in place. -->
  <!-- Also on a direction or view change from the Aa sheet, after it saved the place. -->
  {#key $bookData$.htmlContent}{#key `${$viewMode$}:${$verticalMode$}`}
      <BookReader
        htmlContent={$bookData$.htmlContent}
        width={bookWidth}
        reserveRight={($containerViewportWidth$ ?? 0) - bookWidth}
        reserveTop={bookTop}
        height={($containerViewportHeight$ ?? 0) - bookTop - bookBottom}
        {edgeOffset}
        {fontFeatureSettings}
        {verticalTextOrientation}
        prioritizeReaderStyles={$prioritizeReaderStyles$}
        enableTextJustification={$enableTextJustification$}
        enableTextWrapPretty={$enableTextWrapPretty$}
        verticalMode={$verticalMode$}
        fontColor={$themeOption$?.fontColor}
        backgroundColor={$backgroundColor$}
        hintFuriganaFontColor={$themeOption$?.hintFuriganaFontColor}
        hintFuriganaShadowColor={$themeOption$?.hintFuriganaShadowColor}
        fontFamilyGroupOne={$fontFamilyGroupOne$}
        fontFamilyGroupTwo={$fontFamilyGroupTwo$}
        fontWeight={$fontWeight$}
        fontSize={$fontSize$}
        lineHeight={$lineHeight$}
        textIndentation={$textIndentation$}
        textMarginMode={$textMarginMode$}
        textMarginValue={$textMarginValue$}
        hideSpoilerImage={$hideSpoilerImage$}
        hideFurigana={$hideFurigana$}
        furiganaStyle={$furiganaStyle$}
        viewMode={$viewMode$}
        secondDimensionMaxValue={$secondDimensionMaxValue$}
        {firstDimensionMargin}
        autoPositionOnResize={$autoPositionOnResize$}
        avoidPageBreak={$avoidPageBreak$}
        pageColumns={$pageColumns$}
        autoBookmark={$autoBookmark$}
        autoBookmarkTime={$autoBookmarkTime$}
        multiplier={$multiplier$}
        bind:exploredCharCount
        bind:bookCharCount
        bind:isBookmarkScreen
        bind:bookmarkData
        bind:autoScroller
        bind:bookmarkManager
        bind:pageManager
        bind:customReadingPoint
        bind:customReadingPointTop
        bind:customReadingPointLeft
        bind:customReadingPointScrollOffset
        bind:customReadingPointRange
        bind:showCustomReadingPoint
        on:bookmark={bookmarkPage}
        on:trackerPause={() => pauseTracker(true)}
      />
    {/key}{/key}
{:else}
  {$leaveIfBookMissing$ ?? ''}
{/if}

{#if showReaderImageGallery}
  <BookReaderImageGallery
    fontColor={$themeOption$.fontColor}
    backgroundColor={$backgroundColor$}
    on:close={() => (showReaderImageGallery = false)}
  />
{/if}

{#if (isSelectingCustomReadingPoint && !$isMobile$) || (!isPaginated && showCustomReadingPoint)}
  <div
    class="fixed left-0 z-20 h-[1px] w-full border border-danger"
    style:top={`${customReadingPointTop}px`}
  />
  <div
    class="fixed top-0 z-20 h-full w-[1px] border border-danger"
    style:left={`${customReadingPointLeft}px`}
  />
{/if}

{#if $enableTapEdgeToFlip$ && isPaginated && !$skipKeyDownListener$}
  <button
    class="fixed left-0 z-10 w-5"
    onclick={$verticalMode$ ? () => pageManager?.nextPage() : () => pageManager?.prevPage()}
    style:height={tapButtonHeight}
    style:top={tapButtonTop}
  />
  <button
    class="fixed right-0 z-10 w-5"
    onclick={$verticalMode$ ? () => pageManager?.prevPage() : () => pageManager?.nextPage()}
    style:height={tapButtonHeight}
    style:top={tapButtonTop}
  />
{/if}

{#if showSpinner}
  <div class="fixed inset-0 flex h-full w-full items-center justify-center text-7xl">
    <Fa icon={faSpinner} spin />
  </div>
{/if}

<div
  id="ttu-page-footer"
  tabindex="0"
  role="button"
  class="writing-horizontal-tb fixed bottom-0 left-0 z-10 flex h-8 w-full items-center justify-between text-small leading-none"
  style:color={$themeOption$?.tooltipTextFontColor}
  onclick={() => (showFooter = !showFooter)}
  onkeyup={dummyFn}
>
  <div class="flex h-full">
    {#if showTrackerIcon}
      <div
        role="button"
        title={$t$('reader.trackerTitle')}
        class="flex h-full w-8 items-center justify-center text-sm sm:text-lg"
        class:text-danger={$isTrackerPaused$}
        class:animate-pulse={frozenPosition > -1}
        use:multiClickHandler={[trackerSingleClickHandler, trackerDblClickHandler]}
      >
        <Fa icon={$isTrackerPaused$ ? faPlay : faPause} />
      </div>
    {/if}
    {#if dataToReplicate.length}
      <div
        tabindex="0"
        role="button"
        class="flex h-full w-8 items-center justify-center text-sm sm:text-lg"
        class:text-danger={externalStorageErrors > 1}
        class:animate-pulse={externalStorageErrors > 1 || isReplicating}
        onclick={(event) => {
          event.stopPropagation();

          if ($statisticsEnabled$) {
            wasTrackerPaused = $isTrackerPaused$;
            isTrackerPaused$.next(true);
          }

          executeReplication(false).finally(() => {
            if ($statisticsEnabled$ && !wasTrackerPaused) {
              isTrackerPaused$.next(false);
            }
          });
        }}
        onkeyup={dummyFn}
      >
        <Fa icon={faCloudBolt} />
      </div>
    {/if}
  </div>
  {#if showFooter && bookCharCount}
    {@const currentProgress = bookProgressLabel(
      exploredCharCount,
      bookCharCount,
      $showCharacterCounter$,
      $showPercentage$,
      $showFooterChapterCharacterCounter$ || $showFooterChapterPercentage$
    )}
    <div
      tabindex="0"
      role="button"
      title={$t$('reader.copyProgress')}
      class="writing-horizontal-tb fixed bottom-2 right-2 z-10 font-sans text-label leading-none tabular-nums select-none whitespace-pre {panelOpen
        ? 'md:right-[27.25rem]'
        : ''}"
      class:invisible={!$showCharacterCounter$ &&
        !$showPercentage$ &&
        !$showFooterChapterCharacterCounter$ &&
        !$showFooterChapterPercentage$}
      style:color={$themeOption$?.tooltipTextFontColor}
      onclick={(event) => {
        event.stopPropagation();

        const { target } = event;

        if (!$showCharacterCounter$ && !$showPercentage$) {
          return;
        }

        copyCurrentProgress(currentProgress.replace(/ T$/, ''));

        if (target instanceof HTMLElement) {
          pulseElement(target.parentElement || target, 'add', 0.5, 500);
        }
      }}
      onkeyup={dummyFn}
    >
      <span class="mr-4" class:invisible={!footerChapterProgress}>{footerChapterProgress}</span>
      <span class:invisible={!$showCharacterCounter$ && !$showPercentage$}>{currentProgress}</span>
    </div>
    <div
      class="reader-progress-line"
      style:width="{Math.min(100, (exploredCharCount / bookCharCount) * 100)}%"
      aria-hidden="true"
    />
  {/if}
</div>

{#if $rawBookData$}
  <AnkiWatcher
    media={async (note) => ({
      audio: await bookSentenceAudio(
        $rawBookData$?.title ?? '',
        noteSentence(note),
        getSearchIndex,
        exploredCharCount
      )
    })}
  />
{/if}

{#if selectedRange && !selectionPanel && !editingHighlight}
  <SelectionToolbar
    word={selectionForm(selectedWord, $wordForms$?.forms)}
    on:highlight={({ detail }) => createHighlight(detail)}
    on:note={() => createHighlight('yellow', true)}
    on:action={({ detail }) => openSelectionAction(detail)}
  />
{/if}

{#if editingHighlight && annotations}
  {#key editingHighlight.id}
    <HighlightEditor
      highlight={editingHighlight}
      focusNote={editingFocusNote}
      on:change={({ detail }) =>
        editingHighlight && annotations?.update(editingHighlight.id, detail)}
      on:delete={() => {
        if (editingHighlight) {
          annotations?.remove(editingHighlight.id);
        }
        editingHighlight = undefined;
      }}
      on:close={() => (editingHighlight = undefined)}
    />
  {/key}
{/if}

{#if panelMounted && $rawBookData$ && $bookData$}
  <ReaderPanel
    open={panelOpen}
    bind:tab={panelTab}
    title={$rawBookData$.title}
    elementHtml={$rawBookData$.elementHtml}
    highlights={$highlights$ ?? []}
    syncError={$highlightSyncError$ ?? ''}
    getIndex={getSearchIndex}
    sections={$sectionList$}
    sectionData={$sectionData$ ?? []}
    {primer}
    position={exploredCharCount}
    bookCharacters={bookCharCount}
    selection={selectionPanel}
    on:close={closePanel}
    on:closeSelection={() => (selectionPanel = undefined)}
    on:navigated={closeSheetAfterJump}
    on:jump={({ detail }) => {
      jumpToCount(detail);
      closeSheetAfterJump();
    }}
    on:reveal={({ detail }) => hooks.reveal(detail, $rawBookData$?.title)}
    on:searchJump={({ detail }) => {
      jumpToSearchResult(detail);
      closeSheetAfterJump();
    }}
    on:edit={({ detail }) => {
      editingHighlight = detail;
      editingFocusNote = true;
    }}
    on:position={(ev) => {
      if (!cssHighlightsSupported) {
        followTts(ev.detail);
      }
    }}
    on:reading={(ev) =>
      painter.showReading(
        ev.detail,
        () => bookWidth,
        (count) => scrollToCount(count, true),
        followTts
      )}
  />
{/if}

{#if !(panelOpen && panelTab === 'listen')}
  <MiniPlayer {panelOpen} onopen={() => openPanel('listen')} bind:room={miniPlayerRoom} />
{/if}

{#if $jumpBackOrigin$ !== undefined}
  <JumpBackButton
    room={miniPlayerRoom && !(panelOpen && panelTab === 'listen') ? miniPlayerRoom : 0}
    onback={() => jumpBack.back()}
    ondismiss={() => jumpBack.dismiss()}
  />
{/if}

{#if welcomeBackDays && storedExploredCharacter > 0 && absenceTab && !(panelOpen && panelTab === absenceTab.key)}
  <WelcomeBackToast
    days={welcomeBackDays}
    label={absenceTab.absenceOffer?.label ?? absenceTab.label}
    onopen={() => absenceTab && openPanel(absenceTab.key)}
    ondismiss={() => (welcomeBackDays = 0)}
  />
{/if}

{#if bookCompleted}
  <BookCompletionConfetti {confettiWidthModifier} {confettiMaxRuns} {window} />
{/if}

{#if $rawBookData$ && bookmarkManager}
  <CommunityMarkers
    title={$rawBookData$.title}
    vertical={$verticalMode$}
    renderedStart={() => bookmarkManager?.getRenderedStartCount() ?? 0}
    on:open={() => openPanel('community')}
  />
{/if}

{#if $matchOffer$ && $matchOffer$.title === $rawBookData$?.title && !$communityWorks$[$matchOffer$.title] && !panelOpen && !selectedRange && !lookupOpen}
  <CommunityMatchToast offer={$matchOffer$} onchoose={() => openPanel('community')} />
{/if}

<LookupPopup bind:this={lookupPopup} bind:open={lookupOpen} scope=".book-content" />
<LookupHint />

<svelte:document onselectionchange={onSelectionChange} onclick={onDocumentClick} />

<svelte:window
  onkeydown={onKeydown}
  ononline={() => !blockDataUpdates && executeReplicate$.next()}
  onbeforeunload={handleUnload}
  onpagehide={() => isTrackerPaused$.next(true)}
  onresize={() => {
    if ($statisticsEnabled$ && !$isTrackerPaused$) {
      pauseTracker();

      merge(fromEvent(document, PAGE_CHANGE), timer(1000))
        .pipe(debounceTime(1000), take(1))
        .subscribe(() => {
          restartTrackerAfterCharacterChangeOrTime(1000);
        });
    }
  }}
/>
