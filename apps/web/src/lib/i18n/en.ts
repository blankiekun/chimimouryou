/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * English UI strings, the reference set: every key here needs a Japanese one in
 * ja.ts. Whole sentences with {param}s, never fragments to concatenate; English
 * plurals get their own key (`…One`). Not part of upstream.
 */
export const en = {
  'nav.sections': 'Sections',
  'nav.home': 'Home',
  'nav.store': 'Store',
  'nav.statistics': 'Statistics',
  'nav.settings': 'Settings',
  'nav.notes': 'Notes',
  'nav.notesUnavailable': 'Notes are not available in this reader yet',
  'nav.back': 'Back',
  'nav.continueReading': 'Continue reading',
  'nav.continue': 'Continue',
  'nav.signIn': 'Sign in',
  'nav.signedInAs': 'Signed in as {name}',
  'nav.account': 'Account: {name}',

  'dashboard.label': 'Reading stats',
  'dashboard.today': 'Today',
  'dashboard.streak': '{count} days in a row',
  'dashboard.streakOne': '{count} day in a row',
  'dashboard.noStreak': 'No streak yet',
  'dashboard.streakTitle': 'Longest {longest} · {days} days read',
  'dashboard.heatmap': 'Characters read per day, last 18 weeks',
  'dashboard.dayTitle': '{date}: {count} characters',
  'dashboard.pastWeek': 'Past 7 days',
  'dashboard.characters': 'Characters read',
  'dashboard.time': 'Reading time',
  'dashboard.hours': '{hours}h {minutes}m',
  'dashboard.minutes': '{minutes}m',
  'dashboard.speed': 'Speed',
  'dashboard.speedValue': '{speed}/h',
  'dashboard.finished': 'Books finished',
  'dashboard.started': '{count} started',
  'dashboard.kanji': 'Kanji met',
  'dashboard.trackerOff':
    'Turn on the reading tracker (Settings → Statistics) to count characters, time and streaks.',
  'dashboard.guide': 'Learning guide: Yomitan, Anki and choosing books',

  'home.continueReading': 'Continue reading',
  'home.resume': 'Resume',
  'home.resumeBook': 'Resume {title}',
  'home.readNext': 'Read next',
  'home.myBooks': 'My books',
  'home.remove': 'Remove from Home',
  'home.add': 'Add to Home',
  'home.addSelected': 'Add selected books to Home',
  'home.emptyTitle': 'Pick your next reads in the Store',
  'home.emptyText':
    'Search for a book or a series there and add it to Home, or select several books and press "Add to Home".',
  'home.openStore': 'Open the Store',
  'home.offline':
    "The server can't be reached: showing the books downloaded to this browser. Progress syncs once it's back",
  'home.retry': 'retry',

  'store.view': 'Store view',
  'store.books': 'Books',
  'store.series': 'Series',

  'settings.uiLanguage': 'Interface language',
  'settings.uiLanguageHint':
    "Menus and buttons. Parts of the app are still in English only. The AI's language is set in Settings → AI."
};

export type MessageKey = keyof typeof en;
