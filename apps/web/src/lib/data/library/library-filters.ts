/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import { levelGroup, levelGroupKey } from '$lib/data/difficulty/difficulty';
import type { MessageKey } from '$lib/i18n';

export interface LibraryFilter {
  key: string;
  label: MessageKey;
  test: (card: BookCardProps, now: number) => boolean;
}

export interface LibraryFilterSection {
  key: string;
  label: MessageKey;
  filters: LibraryFilter[];
}

const dayMs = 24 * 60 * 60 * 1000;
const completedThreshold = 0.995;

export function isFinished(card: BookCardProps) {
  return card.progress >= completedThreshold;
}

/** Started but not finished. */
export function isReading(card: BookCardProps) {
  return card.progress > 0 && card.progress < completedThreshold;
}

export const allBooksFilter: LibraryFilter = {
  key: 'all',
  label: 'library.allBooks',
  test: () => true
};

export const libraryFilterSections: LibraryFilterSection[] = [
  {
    key: 'type',
    label: 'library.type',
    filters: [
      { key: 'books', label: 'library.books', test: (card) => !card.manga && !card.vn },
      { key: 'manga', label: 'library.manga', test: (card) => !!card.manga },
      { key: 'vn', label: 'library.vn', test: (card) => !!card.vn }
    ]
  },
  {
    key: 'status',
    label: 'library.status',
    filters: [
      { key: 'unread', label: 'library.unread', test: (card) => !card.progress },
      {
        key: 'reading',
        label: 'library.reading',
        test: isReading
      },
      {
        key: 'completed',
        label: 'library.completed',
        test: isFinished
      }
    ]
  },
  {
    key: 'activity',
    label: 'library.lastRead',
    filters: [
      {
        key: 'week',
        label: 'library.pastWeek',
        test: (card, now) => !!card.lastBookOpen && now - card.lastBookOpen <= 7 * dayMs
      },
      {
        key: 'month',
        label: 'library.pastMonth',
        test: (card, now) => !!card.lastBookOpen && now - card.lastBookOpen <= 30 * dayMs
      },
      {
        key: 'older',
        label: 'library.older',
        test: (card, now) => !!card.lastBookOpen && now - card.lastBookOpen > 30 * dayMs
      },
      { key: 'never', label: 'library.neverOpened', test: (card) => !card.lastBookOpen }
    ]
  },
  {
    key: 'difficulty',
    label: 'book.difficulty',
    filters: [
      // 1-10 levels in groups of two (the 0-5 bands' keys were difficulty-N: those filters reset)
      ...[0, 1, 2, 3, 4].map((group) => ({
        key: `level-${group + 1}`,
        label: levelGroupKey(group),
        test: (card: BookCardProps) =>
          card.difficulty !== undefined && levelGroup(card.difficulty) === group
      })),
      {
        key: 'difficulty-none',
        label: 'library.notEstimated',
        test: (card) => card.difficulty === undefined
      }
    ]
  },
  {
    key: 'length',
    label: 'library.length',
    filters: [
      {
        key: 'short',
        label: 'library.lengthShort',
        test: (card) => card.characters > 0 && card.characters < 100_000
      },
      {
        key: 'medium',
        label: 'library.lengthMedium',
        test: (card) => card.characters >= 100_000 && card.characters < 150_000
      },
      {
        key: 'medium-long',
        label: 'library.lengthMediumLong',
        test: (card) => card.characters >= 150_000 && card.characters < 200_000
      },
      {
        key: 'longer',
        label: 'library.lengthLonger',
        test: (card) => card.characters >= 200_000 && card.characters <= 300_000
      },
      {
        key: 'long',
        label: 'library.lengthLong',
        test: (card) => card.characters > 300_000
      }
    ]
  }
];

const filtersByKey = new Map(
  [allBooksFilter, ...libraryFilterSections.flatMap((section) => section.filters)].map((filter) => [
    filter.key,
    filter
  ])
);

const seriesPrefix = 'series:';

/** Filter key showing one series (Store → Series). */
export function seriesFilterKey(series: string) {
  return `${seriesPrefix}${series}`;
}

export function getLibraryFilter(key: string): LibraryFilter {
  if (key.startsWith(seriesPrefix)) {
    const series = key.slice(seriesPrefix.length);

    return { key, label: 'library.sortSeries', test: (card) => card.series === series };
  }

  return filtersByKey.get(key) ?? allBooksFilter;
}

/** What the filter is called: its label, or the series' name. */
export function libraryFilterLabel(key: string, t: (key: MessageKey) => string) {
  return key.startsWith(seriesPrefix)
    ? key.slice(seriesPrefix.length)
    : t(getLibraryFilter(key).label);
}

export function filterBookCards(
  bookCards: BookCardProps[],
  filterKey: string,
  searchTerm: string,
  now = Date.now()
) {
  const filter = getLibraryFilter(filterKey);
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase();

  return bookCards.filter(
    (card) =>
      filter.test(card, now) &&
      (!normalizedSearch ||
        card.title.toLocaleLowerCase().includes(normalizedSearch) ||
        !!card.authors?.toLocaleLowerCase().includes(normalizedSearch) ||
        !!card.series?.toLocaleLowerCase().includes(normalizedSearch) ||
        !!card.tags?.some((tag) => tag.toLocaleLowerCase().includes(normalizedSearch)))
  );
}

export function countBookCards(
  bookCards: BookCardProps[],
  sections: LibraryFilterSection[] = libraryFilterSections,
  now = Date.now()
) {
  const counts = new Map<string, number>();

  [allBooksFilter, ...sections.flatMap((section) => section.filters)].forEach((filter) => {
    counts.set(filter.key, bookCards.filter((card) => filter.test(card, now)).length);
  });

  return counts;
}
