/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Values for the Discord editor's preview and picker before anything was opened in this tab. */

import type { DiscordKind, DiscordValues } from '$lib/data/discord-template';

const today: DiscordValues = {
  charsToday: '4,820',
  timeToday: '32 min',
  speed: '9,040',
  wordsKnown: '8,214',
  streak: '12 days'
};

export const sampleValues: Record<DiscordKind, DiscordValues> = {
  book: {
    title: '薬屋のひとりごと',
    author: '日向夏',
    series: '薬屋のひとりごと',
    volume: 'Vol. 1',
    chapter: '第三話 白粉',
    kind: 'Book',
    difficulty: '3.1',
    chapterNumber: '3',
    chapterCount: '12',
    percent: '21%',
    charsRead: '31,420',
    timeLeftBook: '9 h 40 min',
    timeLeftChapter: '12 min',
    ...today
  },
  manga: {
    title: 'よつばと!',
    author: 'あずまきよひこ',
    series: 'よつばと!',
    volume: 'Vol. 3',
    kind: 'Manga',
    page: '48',
    pageCount: '208',
    percent: '23%',
    ...today
  },
  vn: {
    title: 'ひぐらしのなく頃に',
    kind: 'Visual novel',
    difficulty: '2.8',
    percent: '41%',
    charsRead: '512,300',
    timeLeftBook: '80 h',
    ...today
  },
  idle: today
};
