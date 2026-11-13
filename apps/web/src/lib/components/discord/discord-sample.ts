/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Values for the Discord editor's preview and picker before anything was opened in this tab. */

import type { DiscordKind, DiscordValues } from '$lib/data/discord/discord-template';

const today: DiscordValues = {
  cardsMinedToday: '7',
  newWordsToday: '15',
  linesToday: '320',
  profileUrl: 'https://chimireader.github.io/u?name=reader',
  charsToday: '4,820',
  timeToday: '32 min',
  speed: '9,040',
  wordsKnown: '8,214',
  streak: '12 days'
};

export const sampleValues: Record<DiscordKind, DiscordValues> = {
  book: {
    title: '薬屋のひとりごと',
    workUrl: 'https://anilist.co/manga/101011',
    anilistId: '101011',
    titleRomaji: 'Kusuriya no Hitorigoto',
    titleEnglish: 'The Apothecary Diaries',
    communityUrl: 'https://chimireader.github.io/community?work=anilist%3A101011%2F1',
    rating: '4/5',
    tags: 'Light novel, Mystery, Historical',
    publisher: '主婦の友社',
    comprehension: '94%',
    charsSession: '6,120',
    timeSession: '41 min',
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
    workUrl: 'https://anilist.co/manga/30104',
    anilistId: '30104',
    titleRomaji: 'Yotsuba to!',
    titleEnglish: 'Yotsuba&!',
    rating: '5/5',
    tags: 'Manga, Comedy',
    publisher: 'KADOKAWA',
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
    workUrl: 'https://vndb.org/v67',
    vndbId: 'v67',
    titleRomaji: 'Higurashi no Naku Koro ni',
    titleEnglish: 'Higurashi When They Cry',
    comprehension: '91%',
    charsSession: '3,880',
    timeSession: '1 h 5 min',
    linesRead: '18,402',
    kind: 'Visual novel',
    difficulty: '2.8',
    percent: '41%',
    charsRead: '512,300',
    timeLeftBook: '80 h',
    ...today
  },
  idle: today
};
