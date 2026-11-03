<script lang="ts">
  import {
    getDefaultStatistic,
    isTrackerPaused$,
    type TrackingHistory,
    isTrackerMenuOpen$,
    TrackerSkipThresholdAction,
    TrackerAutoPause,
    updateStatistic
  } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
  import BookTimerMenu from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker-menu.svelte';
  import type { SectionWithProgress } from '$lib/components/book-reader/book-toc/book-toc';
  import type { AutoScroller } from '$lib/components/book-reader/types';
  import type {
    BooksDbReadingGoal,
    BooksDbStatistic
  } from '$lib/data/database/books-db/versions/books-db';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { PAGE_CHANGE } from '$lib/data/events';
  import { logger } from '$lib/data/logger';
  import { MergeMode } from '$lib/data/merge-mode';
  import { getReadingGoalWindow, type ReadingGoal } from '$lib/data/reading-goal';
  import {
    adjustStatisticsAfterIdleTime$,
    database,
    readingGoal$,
    startDayHoursForTracker$,
    trackerAutoPause$,
    trackerBackwardSkipThreshold$,
    trackerForwardSkipThreshold$,
    trackerIdleTime$,
    trackerPopupDetection$,
    trackerSkipThresholdAction$
  } from '$lib/data/store';
  import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
  import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';
  import {
    getDate,
    getDateKey,
    getDateTimeString,
    getPreviousDayKey,
    getSecondsToDate,
    toTimeString
  } from '$lib/functions/statistic-util';
  import { clickOutside } from '$lib/functions/use-click-outside';
  import { filterNotNullAndNotUndefined } from '$lib/functions/utils';
  import {
    fromEvent,
    interval,
    merge,
    NEVER,
    Observable,
    startWith,
    switchMap,
    tap,
    throttleTime
  } from 'rxjs';
  import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
  import { quintInOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';

  export let fontColor: string;
  export let backgroundColor: string;
  export let bookTitle: string;
  export let wasTrackerPaused: boolean;
  export let exploredCharCount: number;
  export let bookCharCount: number;
  export let sectionData: SectionWithProgress[];
  export let frozenPosition: number;
  export let autoScroller: AutoScroller | undefined;
  export let blockDataUpdates: boolean;

  export function processStatistics(
    characterDiff: number,
    timeDiff = 1,
    referenceTick = Date.now(),
    flushData = true
  ) {
    const todayDate = new Date();
    const absoluteTimeDiff = Math.abs(timeDiff);
    const isNegativeTimeDiff = timeDiff < 0;
    const referenceDate = new Date(referenceTick);
    const referenceDateKey = getDateKey($startDayHoursForTracker$, referenceDate);
    const lastStatisticModified = referenceDate.getTime();
    const secondsOnDay = getSecondsToDate($startDayHoursForTracker$, referenceDate) || 1;
    const overlappedDay = absoluteTimeDiff > secondsOnDay;
    const timeDiffForToday = overlappedDay ? secondsOnDay : absoluteTimeDiff;
    const dateTimeKey = getDateTimeString(lastStatisticModified);
    const trackerHistory: TrackingHistory[] = [
      {
        id: lastStatisticModified * Math.random(),
        dateKey: referenceDateKey,
        dateTimeKey,
        timeDiff: isNegativeTimeDiff ? -timeDiffForToday : timeDiffForToday,
        characterDiff,
        saved: false
      }
    ];

    todayKey = getDateKey($startDayHoursForTracker$, todayDate);

    if (overlappedDay || referenceDateKey !== todayKey) {
      let otherDayTimeDiff = 0;

      if (overlappedDay) {
        otherDayTimeDiff = isNegativeTimeDiff
          ? -(absoluteTimeDiff - secondsOnDay)
          : absoluteTimeDiff - secondsOnDay;
      } else {
        otherDayTimeDiff = isNegativeTimeDiff ? -timeDiffForToday : timeDiffForToday;
      }

      const otherDayKey = overlappedDay
        ? getPreviousDayKey($startDayHoursForTracker$, referenceDate)
        : referenceDateKey;
      const otherDayStatistics =
        statistics.get(otherDayKey) || getDefaultStatistic(bookTitle, otherDayKey);

      updateStatistic(otherDayStatistics, otherDayTimeDiff, characterDiff, lastStatisticModified);

      statistics.set(otherDayKey, otherDayStatistics);
      statisticsToStore.add(otherDayKey);

      if (overlappedDay) {
        trackerHistory.unshift({
          id: lastStatisticModified * Math.random(),
          dateKey: otherDayStatistics.dateKey,
          dateTimeKey,
          timeDiff: otherDayTimeDiff,
          characterDiff,
          saved: false
        });
      }
    }

    todaysStatistics =
      todaysStatistics.dateKey === todayKey
        ? todaysStatistics
        : statistics.get(todayKey) || getDefaultStatistic(bookTitle, todayKey);

    if (todayKey === referenceDateKey) {
      updateStatistic(
        todaysStatistics,
        isNegativeTimeDiff ? -timeDiffForToday : timeDiffForToday,
        characterDiff,
        lastStatisticModified
      );
    } else {
      updateStatistic(todaysStatistics, 0, 0, lastStatisticModified);
    }

    statistics.set(todayKey, todaysStatistics);
    statisticsToStore.add(todayKey);

    updateStatistic(sessionStatistics, timeDiff, characterDiff, lastStatisticModified);
    updateStatistic(allTimeStatistics, timeDiff, characterDiff, lastStatisticModified);

    for (let index = 0, { length } = trackerHistory; index < length; index += 1) {
      if (historyIndex > 59) {
        historyIndex = 0;
      }

      if (trackingHistory.length < 60) {
        trackingHistory.unshift(trackerHistory[index]);
      } else {
        trackingHistory[historyIndex] = trackerHistory[index];
        trackingHistory.sort((t1, t2) => (t2.dateTimeKey > t1.dateTimeKey ? 1 : -1));
        historyIndex += 1;
      }
    }

    updateTimeToFinishBook();

    return flushData ? flushUpdates() : Promise.resolve([false, 0]);
  }

  export async function flushUpdates(force = false) {
    if (!statisticsToStore.size || ((blockDataUpdates || holdFlush) && !force)) {
      return [false, 0];
    }

    actionInProgress = true;
    hadError = false;

    const toUpdate: string[] = JSON.parse(JSON.stringify([...statisticsToStore]));
    const itemsToStore = toUpdate
      .map((statisticToStore) => statistics.get(statisticToStore))
      .filter(filterNotNullAndNotUndefined);
    const savingToday = toUpdate.includes(todayKey) ? statistics.get(todayKey) : undefined;
    const savingNow = savingToday && { ...savingToday };

    statisticsToStore.clear();

    try {
      await database.storeStatistics(
        bookTitle,
        itemsToStore,
        ReplicationSaveBehavior.Overwrite,
        MergeMode.LOCAL
      );

      if (savingNow) savedToday = savingNow;

      trackingHistory = trackingHistory.map((item) => {
        const oldItem = item;

        oldItem.saved = toUpdate.some((dateKey) => dateKey === item.dateKey);

        return oldItem;
      });

      // During an upload: it sends this save, or the next flush asks for another.
      if (!holdFlush) dispatch('statisticsSaved');
    } catch (error: any) {
      hadError = true;
      statisticsToStore = new Set([...statisticsToStore, ...toUpdate]);
      logger.error(`Error updating statistics: ${error.message}`);
    } finally {
      actionInProgress = false;
      lastTrackerFlushTime = Date.now();

      if ($isTrackerMenuOpen$) {
        updateReadingGoalWindow();
      }
    }

    return [hadError, toUpdate.length];
  }

  /**
   * Runs `upload` with today's row built on what another device wrote since this tab last synced:
   * a tab that keeps ticking always holds the newest row, so newest-wins would drop their count.
   * shortcut: only today; the last seconds of yesterday can still replace theirs just after midnight.
   */
  export async function uploadOnSynced(
    read: () => Promise<BooksDbStatistic[] | undefined>,
    upload: () => Promise<string>
  ) {
    // A save between what's sent and what's kept as sent would be counted twice next time.
    holdFlush += 1;

    try {
      // A failed read: the upload reads the same file first, and reports what's wrong.
      takeOtherDevices(await read().catch(() => undefined));
      await flushUpdates(true);

      todayKey = getDateKey($startDayHoursForTracker$);

      const sending = (await database.getSyncedStatisticsForBook(bookTitle)).find(
        (row) => row.dateKey === todayKey
      );

      sentToday = sending;

      const error = await upload();

      if (!error && sending) syncedToday = sending;

      return error;
    } finally {
      holdFlush -= 1;
      flushUpdates();
    }
  }

  function takeOtherDevices(rows: BooksDbStatistic[] | undefined) {
    const key = getDateKey($startDayHoursForTracker$);
    const theirs = rows?.find((row) => row.dateKey === key);

    if (!theirs) return;

    // Sent last time and reported as failed, yet it landed: this tab's own row, not another device's.
    if (sentToday?.lastStatisticModified === theirs.lastStatisticModified) syncedToday = sentToday;

    const synced = syncedToday?.dateKey === key ? syncedToday : undefined;

    if (theirs.lastStatisticModified <= (synced?.lastStatisticModified ?? 0)) return;

    const current = statistics.get(key);
    const today = { ...theirs, title: bookTitle };

    if (current?.completedBook) {
      today.completedBook = 1;
      today.completedData = current.completedData;
    }

    updateStatistic(
      today,
      (current?.readingTime ?? 0) - (synced?.readingTime ?? 0),
      (current?.charactersRead ?? 0) - (synced?.charactersRead ?? 0),
      Math.max(current?.lastStatisticModified ?? 0, theirs.lastStatisticModified + 1)
    );
    updateStatistic(
      allTimeStatistics,
      today.readingTime - (current?.readingTime ?? 0),
      today.charactersRead - (current?.charactersRead ?? 0),
      today.lastStatisticModified
    );
    statistics.set(key, today);
    statisticsToStore.add(key);
    todaysStatistics = today;
    syncedToday = { ...theirs };
  }

  export function updateCompletedBook(
    completedBookStatistics: BooksDbStatistic,
    oldCompletedBookStatistics?: BooksDbStatistic
  ) {
    bookCompletionStatistics = completedBookStatistics.completedData;

    let statistic = statistics.get(completedBookStatistics.dateKey);

    if (statistic) {
      statistic = {
        ...statistic,
        ...{ completedBook: 1, completedData: bookCompletionStatistics }
      };
    } else {
      statistic = completedBookStatistics;
    }

    statistics.set(completedBookStatistics.dateKey, statistic);

    if (todaysStatistics.dateKey === statistic.dateKey) todaysStatistics = statistic;

    if (oldCompletedBookStatistics) {
      statistics.set(oldCompletedBookStatistics.dateKey, oldCompletedBookStatistics);
    }
  }

  /**
   * Runs `pull`, which brings other devices' rows into the database, then takes them. Today keeps
   * only what this tab hasn't saved: the rest is in the database's row or was replaced by a newer one.
   */
  export async function reloadStatistics(pull: () => Promise<unknown>) {
    // A save during the pull would make this tab's older count the newest row, and win the merge.
    holdFlush += 1;

    try {
      await pull();

      const rows = await database.getStatisticsForBook(bookTitle);

      todayKey = getDateKey($startDayHoursForTracker$);

      const current = statistics.get(todayKey);
      const stored = rows.find((row) => row.dateKey === todayKey);
      const saved = savedToday?.dateKey === todayKey ? savedToday : undefined;
      const pending = [...statisticsToStore]
        .filter((dateKey) => dateKey !== todayKey)
        .map((dateKey) => statistics.get(dateKey))
        .filter(filterNotNullAndNotUndefined);

      statistics = new Map();
      allTimeStatistics = getDefaultStatistic(bookTitle, todayKey);
      bookCompletionStatistics = undefined;
      loadRows(rows.filter((row) => row.dateKey !== todayKey));
      pending.forEach((row) => statistics.set(row.dateKey, row));

      let today = current;

      if (stored && (!current || stored.lastStatisticModified !== saved?.lastStatisticModified)) {
        today = stored;
        savedToday = { ...stored };
        syncedToday = { ...stored };

        const timeDiff = (current?.readingTime ?? 0) - (saved?.readingTime ?? 0);
        const characterDiff = (current?.charactersRead ?? 0) - (saved?.charactersRead ?? 0);

        if (timeDiff || characterDiff) {
          updateStatistic(
            today,
            timeDiff,
            characterDiff,
            Math.max(current?.lastStatisticModified ?? 0, stored.lastStatisticModified + 1)
          );
          statisticsToStore.add(todayKey);
        } else {
          statisticsToStore.delete(todayKey);
        }
      }

      if (today) {
        statistics.set(todayKey, today);
        loadRows([today]);
        todaysStatistics = today;
      }
    } finally {
      holdFlush -= 1;
    }

    return flushUpdates();
  }

  let yomiPopover: HTMLElement | null;
  let jpdbPopover: HTMLElement | null;
  let actionInProgress = false;
  let hadError = false;
  let pausedByAutoPause = false;
  let visibilityState: DocumentVisibilityState;
  let currentReadingGoalStart = '';
  let currentReadingGoalEnd = '';
  let remainingTimeInReadingGoalWindow = '';
  let currentReadingGoal: ReadingGoal | undefined;
  let currentTimeGoal = 0;
  let currentCharacterGoal = 0;
  let statistics = new Map<string, BooksDbStatistic>();
  let todayKey = getDateKey($startDayHoursForTracker$);
  let sessionStatistics = getDefaultStatistic(bookTitle, todayKey);
  let todaysStatistics = getDefaultStatistic(bookTitle, todayKey);
  let allTimeStatistics = getDefaultStatistic(bookTitle, todayKey);
  let bookCompletionStatistics:
    | Omit<BooksDbStatistic, 'title' | 'lastStatisticModified'>
    | undefined;
  let bookStartDate = todayKey;
  let timeToFinishBook = 'N/A';
  let lastExploredCharCount = exploredCharCount;
  let previousLastExploredCharCount = 0;
  let trackingHistory: TrackingHistory[] = [];
  let historyIndex = 0;
  let autoScrollerStatistics: BooksDbStatistic | undefined;
  let autoScrollerTimer$: Observable<''> | undefined;
  let lastExploredCharCountScroller = exploredCharCount;
  let statisticsToStore = new Set<string>();
  /** Today's row as this tab last read or saved it: the tab's unsaved difference is measured from it. */
  let savedToday: BooksDbStatistic | undefined;
  /** Today's row as last read from or sent to the sync target: this tab's reading is measured from it. */
  let syncedToday: BooksDbStatistic | undefined;
  let sentToday: BooksDbStatistic | undefined;
  let holdFlush = 0;
  let lastTrackerTick = 0;
  let lastTrackerFlushTime = 0;
  let trackerIdleTime = 0;

  const dispatch = createEventDispatcher<{
    trackerAvailable: void;
    statisticsSaved: void;
    trackerMenuClosed: void;
  }>();
  const yomiObserver = new MutationObserver(handleYomiMutation);
  const dictionaryObserver = new MutationObserver(handleMutation);

  const readingTracker$ = isTrackerPaused$.pipe(
    switchMap((isPaused) => {
      if (isPaused) {
        trackerIdleTime = 0;

        flushUpdates();

        return NEVER;
      }

      const now = Date.now();

      lastTrackerFlushTime = now;
      lastTrackerTick = now;

      return interval(1000);
    }),
    tap(processTicks),
    reduceToEmptyString()
  );

  const updateTrackerIdleTime$ = isTrackerPaused$.pipe(
    switchMap((isPaused) =>
      isPaused || $trackerIdleTime$ <= 0
        ? NEVER
        : merge(
            fromEvent(document, PAGE_CHANGE),
            fromEvent<PointerEvent>(window, 'pointermove'),
            fromEvent<Event>(document, 'selectionchange')
          ).pipe(
            startWith(true),
            throttleTime(1000),
            tap(() => (trackerIdleTime = Date.now() + $trackerIdleTime$ * 1000))
          )
    ),
    reduceToEmptyString()
  );

  $: hasReadingGoal = !!($readingGoal$.goalStartDate && todayKey >= $readingGoal$.goalStartDate);

  $: handleVisibilityChange(visibilityState);

  $: updateReadingGoalWindowForPausedState($isTrackerMenuOpen$);

  $: if (!$isTrackerPaused$) {
    updateLastExploredCharCount();
  }

  $: if (autoScroller && !autoScrollerTimer$) {
    autoScrollerTimer$ = autoScroller.wasAutoScrollerEnabled$.pipe(
      tap((isEnabled) => {
        if (isEnabled) {
          todayKey = getDateKey($startDayHoursForTracker$);
          autoScrollerStatistics = getDefaultStatistic(bookTitle, todayKey);
          lastExploredCharCountScroller = exploredCharCount;
        } else {
          autoScrollerStatistics = undefined;
        }
      }),
      switchMap((isEnabled) => (isEnabled ? interval(1000) : NEVER)),
      tap(() => {
        if (!autoScrollerStatistics) {
          return;
        }

        const diff = exploredCharCount - lastExploredCharCountScroller;

        lastExploredCharCountScroller = exploredCharCount;
        autoScrollerStatistics = {
          ...updateStatistic(autoScrollerStatistics, 1, diff, Date.now())
        };
      }),
      reduceToEmptyString()
    );
  }

  $: if ($trackerAutoPause$ !== TrackerAutoPause.OFF && !yomiPopover) {
    yomiPopover = document.querySelector(
      '.yomichan-popup,.yomichan-float,.yomitan-popup,.yomitan-float'
    );

    if (!yomiPopover) {
      yomiObserver.observe(document.body, { childList: true, subtree: false });
    }
  } else {
    yomiObserver.disconnect();
  }

  $: if ($trackerAutoPause$ !== TrackerAutoPause.OFF && !$trackerPopupDetection$) {
    if (yomiPopover) {
      dictionaryObserver.observe(yomiPopover, { attributes: true });
    }

    if (jpdbPopover) {
      dictionaryObserver.observe(jpdbPopover, { attributes: true });
    }
  } else {
    dictionaryObserver.disconnect();
  }

  onMount(init);

  onDestroy(() => {
    yomiObserver.disconnect();
    dictionaryObserver.disconnect();
  });

  function handleYomiMutation() {
    yomiPopover = document.querySelector(
      '.yomichan-popup,.yomichan-float,.yomitan-popup,.yomitan-float'
    );

    if (yomiPopover) {
      yomiObserver.disconnect();
    }
  }

  function handleMutation() {
    if (!jpdbPopover && !yomiPopover) {
      return;
    }

    const isDisplayed = isDictionaryDisplayed();

    if (isDisplayed && !$isTrackerPaused$) {
      pausedByAutoPause = true;
      isTrackerPaused$.next(true);
    } else if (!isDisplayed && $isTrackerPaused$ && !wasTrackerPaused && pausedByAutoPause) {
      pausedByAutoPause = false;
      isTrackerPaused$.next(false);
    }
  }

  function isDictionaryDisplayed() {
    return (
      (yomiPopover && yomiPopover.style.visibility !== 'hidden') ||
      (jpdbPopover && jpdbPopover.style.opacity !== '0')
    );
  }

  function handleBlur() {
    if (
      $isTrackerPaused$ ||
      $trackerAutoPause$ !== TrackerAutoPause.STRICT ||
      ($trackerPopupDetection$ && isDictionaryDisplayed())
    ) {
      return;
    }

    pausedByAutoPause = true;
    isTrackerPaused$.next(true);
  }

  function handleFocus() {
    if (
      !$isTrackerPaused$ ||
      !pausedByAutoPause ||
      wasTrackerPaused ||
      $trackerAutoPause$ !== TrackerAutoPause.STRICT ||
      (!$trackerPopupDetection$ && isDictionaryDisplayed())
    ) {
      return;
    }

    pausedByAutoPause = false;
    isTrackerPaused$.next(false);
  }

  function updateLastExploredCharCount() {
    const referenceCharCount = frozenPosition !== -1 ? frozenPosition : exploredCharCount;

    if (lastExploredCharCount !== referenceCharCount) {
      previousLastExploredCharCount = lastExploredCharCount;
      lastExploredCharCount = referenceCharCount;
    }
  }

  function revertTrackerHistory({ detail: historyItem }: CustomEvent<TrackingHistory>) {
    const entry = statistics.get(historyItem.dateKey);

    if (!entry) {
      trackingHistory = trackingHistory.filter((item) => item.id !== historyItem.id);
      return;
    }

    actionInProgress = true;

    const lastStatisticModified = Date.now();

    updateStatistic(
      entry,
      -historyItem.timeDiff,
      -historyItem.characterDiff,
      lastStatisticModified
    );
    updateStatistic(
      sessionStatistics,
      -historyItem.timeDiff,
      -historyItem.characterDiff,
      lastStatisticModified
    );
    updateStatistic(
      allTimeStatistics,
      -historyItem.timeDiff,
      -historyItem.characterDiff,
      lastStatisticModified
    );

    statistics.set(entry.dateKey, entry);
    statisticsToStore.add(entry.dateKey);

    trackingHistory = trackingHistory.map((item) =>
      item.id === historyItem.id
        ? {
            id: historyItem.id,
            dateKey: historyItem.dateKey,
            dateTimeKey: getDateTimeString(lastStatisticModified),
            timeDiff: -historyItem.timeDiff,
            characterDiff: -historyItem.characterDiff,
            saved: false
          }
        : item
    );
    trackingHistory.sort((t1, t2) => (t2.dateTimeKey > t1.dateTimeKey ? 1 : -1));
    sessionStatistics = { ...sessionStatistics };

    updateTimeToFinishBook();
    flushUpdates();
  }

  function handleVisibilityChange(state: DocumentVisibilityState) {
    if ($trackerAutoPause$ !== TrackerAutoPause.MODERATE) {
      return;
    }

    if (
      state === 'hidden' &&
      !$isTrackerPaused$ &&
      (!$trackerPopupDetection$ || !isDictionaryDisplayed())
    ) {
      pausedByAutoPause = true;
      isTrackerPaused$.next(true);
    } else if (
      state === 'visible' &&
      $isTrackerPaused$ &&
      pausedByAutoPause &&
      !wasTrackerPaused &&
      ($trackerPopupDetection$ || !isDictionaryDisplayed())
    ) {
      pausedByAutoPause = false;
      isTrackerPaused$.next(false);
    }
  }

  function updateReadingGoalWindowForPausedState(isTrackerMenuOpen: boolean) {
    if (isTrackerMenuOpen && wasTrackerPaused) {
      updateReadingGoalWindow();
    }
  }

  async function init() {
    try {
      todayKey = getDateKey($startDayHoursForTracker$);
      jpdbPopover = document.getElementById('jpdb-popup');

      const statisticsForTitle = await database.getStatisticsForBook(bookTitle);
      const setFirstBookReadResult = await database.setFirstBookRead(
        bookTitle,
        $startDayHoursForTracker$,
        statisticsForTitle[0]
      );

      bookStartDate = setFirstBookReadResult[0] as string;

      if (setFirstBookReadResult[1]) {
        dispatch('statisticsSaved');
      }

      loadRows(statisticsForTitle);

      const today = statistics.get(todayKey);

      if (today) {
        // The row itself, not a copy: it carries the book's completion, and every tick writes it back.
        todaysStatistics = today;
        savedToday = { ...today };
        syncedToday = { ...today };
      }

      dispatch('trackerAvailable');
    } catch ({ message }: any) {
      logger.error(`Error initializing timer: ${message}`);
    }
  }

  async function updateReadingGoalWindow() {
    todayKey = getDateKey($startDayHoursForTracker$);
    todaysStatistics = statistics.get(todayKey) || getDefaultStatistic(bookTitle, todayKey);

    try {
      await tick();

      let currentClosedReadingGoal: BooksDbReadingGoal | undefined;

      if (!hasReadingGoal) {
        currentClosedReadingGoal = await database.getCurrentClosedReadingGoal(todayKey);

        if (!currentClosedReadingGoal) {
          return;
        }
      }

      currentReadingGoal = currentClosedReadingGoal || $readingGoal$;
      [currentReadingGoalStart, currentReadingGoalEnd, remainingTimeInReadingGoalWindow] =
        getReadingGoalWindow(todayKey, $startDayHoursForTracker$, currentReadingGoal);

      if (
        currentClosedReadingGoal?.goalEndDate &&
        currentClosedReadingGoal.goalEndDate < currentReadingGoalEnd
      ) {
        currentReadingGoalEnd = currentClosedReadingGoal.goalEndDate;

        const adjustedEndDate = getDate(currentReadingGoalEnd, $startDayHoursForTracker$);

        remainingTimeInReadingGoalWindow = toTimeString(
          (adjustedEndDate.getTime() + 8.64e7 - Date.now()) / 1000
        );
      }

      const statisticsForTimeWindow = await database.getStatisticsForTimeWindow(
        currentReadingGoalStart,
        currentReadingGoalEnd
      );

      currentTimeGoal = 0;
      currentCharacterGoal = 0;

      for (let index = 0, { length } = statisticsForTimeWindow; index < length; index += 1) {
        const statistic = statisticsForTimeWindow[index];

        currentTimeGoal += statistic.readingTime;
        currentCharacterGoal += statistic.charactersRead;
      }
    } catch ({ message }: any) {
      logger.error(`Error updating Goal Data: ${message}`);
    }
  }

  function processTicks() {
    const now = Date.now();
    const nowTick = trackerIdleTime ? Math.min(trackerIdleTime, now) : now;
    const trackerIdleTimeReached = trackerIdleTime && nowTick >= trackerIdleTime;
    const elapsed = Math.round((nowTick - lastTrackerTick) / 1000);

    lastTrackerTick = nowTick;

    if (trackerIdleTimeReached) {
      wasTrackerPaused = true;
      isTrackerPaused$.next(true);

      if (frozenPosition === -1) {
        if ($adjustStatisticsAfterIdleTime$) {
          processStatistics(0, elapsed - $trackerIdleTime$, lastTrackerTick, true);
        } else if (elapsed) {
          processStatistics(0, elapsed, lastTrackerTick, true);
        }
      }

      return;
    }

    if (frozenPosition === -1) {
      // A render (layout change, section swap) counts from 0 until the place is back: time, no move.
      if (!exploredCharCount && lastExploredCharCount) {
        processStatistics(0, elapsed, lastTrackerTick, now - lastTrackerFlushTime > 10000);
        return;
      }

      const characterDiff = exploredCharCount - lastExploredCharCount;
      let finalCharacterDiff =
        characterDiff < 0 && Math.abs(characterDiff) > sessionStatistics.charactersRead
          ? -sessionStatistics.charactersRead
          : characterDiff;

      if (
        (finalCharacterDiff > 0 &&
          $trackerForwardSkipThreshold$ &&
          finalCharacterDiff >= $trackerForwardSkipThreshold$) ||
        (finalCharacterDiff < 0 &&
          $trackerBackwardSkipThreshold$ &&
          finalCharacterDiff <= -Math.abs($trackerBackwardSkipThreshold$))
      ) {
        if ($trackerSkipThresholdAction$ === TrackerSkipThresholdAction.PAUSE) {
          wasTrackerPaused = true;
          isTrackerPaused$.next(true);
          return;
        }
        finalCharacterDiff = 0;
      }

      previousLastExploredCharCount = lastExploredCharCount;
      lastExploredCharCount = exploredCharCount;

      processStatistics(
        finalCharacterDiff,
        elapsed,
        lastTrackerTick,
        now - lastTrackerFlushTime > 10000
      );
    }
  }

  function loadRows(rows: BooksDbStatistic[]) {
    for (let index = 0, { length } = rows; index < length; index += 1) {
      const statisticEntry = rows[index];

      statistics.set(statisticEntry.dateKey, statisticEntry);

      addToStatistic(allTimeStatistics, statisticEntry);

      if (statisticEntry.completedBook && statisticEntry.completedData) {
        bookCompletionStatistics = statisticEntry.completedData;
      }
    }
  }

  function addToStatistic(statisticObject: BooksDbStatistic, entry: BooksDbStatistic) {
    const statistic = statisticObject;

    statistic.title = entry.title;
    statistic.readingTime += entry.readingTime;
    statistic.charactersRead += entry.charactersRead;
    statistic.lastReadingSpeed = statistic.readingTime
      ? Math.ceil((3600 * statistic.charactersRead) / statistic.readingTime)
      : 0;
    statistic.minReadingSpeed = statistic.minReadingSpeed
      ? Math.min(statistic.minReadingSpeed, statistic.lastReadingSpeed)
      : statistic.lastReadingSpeed;
    statistic.altMinReadingSpeed = statistic.altMinReadingSpeed
      ? Math.min(statistic.altMinReadingSpeed, statistic.lastReadingSpeed)
      : statistic.lastReadingSpeed;
    statistic.maxReadingSpeed = Math.max(statistic.maxReadingSpeed, statistic.lastReadingSpeed);
    statistic.lastStatisticModified = Math.max(
      statistic.lastStatisticModified,
      entry.lastStatisticModified
    );
  }

  function updateTimeToFinishBook() {
    timeToFinishBook = sessionStatistics.lastReadingSpeed
      ? toTimeString(
          Math.max(
            0,
            Math.floor(
              (bookCharCount - exploredCharCount) / (sessionStatistics.lastReadingSpeed / 3600)
            )
          )
        )
      : 'N/A';
  }
</script>

{$readingTracker$ ?? ''}
{$updateTrackerIdleTime$ ?? ''}
{$autoScrollerTimer$ ?? ''}

<svelte:window on:blur={handleBlur} on:focus={handleFocus} />
<svelte:document bind:visibilityState />

{#if $isTrackerMenuOpen$}
  <div
    class="writing-horizontal-tb fixed top-0 left-0 z-[60] flex h-full w-full max-w-xl flex-col justify-between"
    style:color={fontColor}
    style:background-color={backgroundColor}
    in:fly|local={{ x: -100, duration: 100, easing: quintInOut }}
    use:clickOutside={() => {
      if (!actionInProgress) {
        dialogManager.dialogs$.next([]);
        dispatch('trackerMenuClosed');
      }
    }}
  >
    <BookTimerMenu
      {fontColor}
      {backgroundColor}
      {actionInProgress}
      {hadError}
      {currentReadingGoal}
      {currentTimeGoal}
      {currentCharacterGoal}
      {currentReadingGoalStart}
      {currentReadingGoalEnd}
      {remainingTimeInReadingGoalWindow}
      {timeToFinishBook}
      {exploredCharCount}
      {lastExploredCharCount}
      {previousLastExploredCharCount}
      {frozenPosition}
      {trackingHistory}
      {sessionStatistics}
      {todaysStatistics}
      {allTimeStatistics}
      {bookCompletionStatistics}
      {autoScrollerStatistics}
      {bookStartDate}
      {sectionData}
      canSaveStatistics={statisticsToStore.size > 0}
      bind:wasTrackerPaused
      on:trackerMenuClosed
      on:freezeCurrentLocation
      on:updateCurrentLocation={updateLastExploredCharCount}
      on:saveStatistics={() => flushUpdates()}
      on:revertStatistic={revertTrackerHistory}
    />
  </div>
{/if}
