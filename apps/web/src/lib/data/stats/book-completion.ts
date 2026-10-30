/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * "Complete book" in the reader (/b): marks today's statistic as the completion day.
 * Moved out of routes/b/+page.svelte unchanged.
 */

import { getDefaultStatistic } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import { MergeMode } from '$lib/data/merge-mode';
import { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
import { database } from '$lib/data/store';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
import { getDateKey } from '$lib/functions/statistic-util';

/**
 * Stores today as the book's completion, unless it was completed before and `overwrite` is off
 * (then nothing is stored). `stored` lists what was written; `finishedStatistic` is the earlier
 * completion day when it was cleared.
 */
export async function storeBookCompletion(
  title: string,
  startDayHours: number,
  overwrite: boolean
) {
  const finishedStatistic = await database.getStatisticForCompletedBook(title);
  const todayKey = getDateKey(startDayHours);
  const statisticsUntilToday = await database.getStatisticsUntilDate(title, todayKey);
  const todayStatistic =
    statisticsUntilToday.find((statistic) => statistic.dateKey === todayKey) ||
    getDefaultStatistic(title, todayKey);
  const statisticsToStore: BooksDbStatistic[] = [];
  const lastStatisticModified = Date.now();

  todayStatistic.lastStatisticModified = lastStatisticModified;
  todayStatistic.completedBook = 1;
  todayStatistic.completedData = {
    ...{ dateKey: todayKey },
    ...BaseStorageHandler.getStatisticsMetadata(
      BaseStorageHandler.getStatisticsFileName(
        statisticsUntilToday,
        todayStatistic.lastStatisticModified
      )
    )
  };

  let updateFinishedStatistic = false;

  if (!finishedStatistic) {
    statisticsToStore.push(todayStatistic);
  } else if (overwrite && finishedStatistic.dateKey !== todayStatistic.dateKey) {
    delete finishedStatistic.completedBook;
    delete finishedStatistic.completedData;
    finishedStatistic.lastStatisticModified = lastStatisticModified;
    statisticsToStore.push(todayStatistic, finishedStatistic);
    updateFinishedStatistic = true;
  } else if (overwrite) {
    statisticsToStore.push(todayStatistic);
  }

  if (statisticsToStore.length) {
    await database.storeStatistics(
      title,
      statisticsToStore,
      ReplicationSaveBehavior.Overwrite,
      MergeMode.LOCAL,
      lastStatisticModified
    );
  }

  return {
    stored: statisticsToStore,
    todayStatistic,
    finishedStatistic: updateFinishedStatistic ? finishedStatistic : undefined
  };
}
