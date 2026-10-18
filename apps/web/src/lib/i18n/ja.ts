/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { MessageKey } from './en';

/** Japanese UI strings: the same keys and {param}s as en.ts. Not part of upstream. */
export const ja: Record<MessageKey, string> = {
  'nav.sections': 'セクション',
  'nav.home': 'ホーム',
  'nav.store': 'ストア',
  'nav.statistics': '統計',
  'nav.settings': '設定',
  'nav.notes': 'メモ',
  'nav.notesUnavailable': 'メモはまだご利用いただけません',
  'nav.back': '戻る',
  'nav.continueReading': '続きを読む',
  'nav.continue': '続き',
  'nav.signIn': 'ログイン',
  'nav.signedInAs': '{name} でログイン中',
  'nav.account': 'アカウント: {name}',

  'dashboard.label': '読書記録',
  'dashboard.today': '今日',
  'dashboard.streak': '{count}日連続',
  'dashboard.streakOne': '{count}日連続',
  'dashboard.noStreak': '連続記録はまだありません',
  'dashboard.streakTitle': '最長 {longest}日 · 読書日数 {days}日',
  'dashboard.heatmap': '1日ごとの読んだ文字数（過去18週間）',
  'dashboard.dayTitle': '{date}: {count}文字',
  'dashboard.pastWeek': '過去7日間',
  'dashboard.characters': '読んだ文字数',
  'dashboard.time': '読書時間',
  'dashboard.hours': '{hours}時間{minutes}分',
  'dashboard.minutes': '{minutes}分',
  'dashboard.speed': '読書速度',
  'dashboard.speedValue': '{speed}字/時',
  'dashboard.finished': '読み終えた本',
  'dashboard.started': '読み始めた本 {count}冊',
  'dashboard.kanji': '出会った漢字',
  'dashboard.trackerOff':
    '文字数・読書時間・連続記録を数えるには、読書トラッカーをオンにしてください（設定 → 統計）。',
  'dashboard.guide': '学習ガイド：Yomitan・Anki・本の選び方',

  'home.continueReading': '続きを読む',
  'home.resume': '再開',
  'home.resumeBook': '{title}を再開',
  'home.myBooks': 'マイブック',
  'home.remove': 'ホームから削除',
  'home.add': 'ホームに追加',
  'home.addSelected': '選択した本をホームに追加',
  'home.emptyTitle': 'ストアで次に読む本を選びましょう',
  'home.emptyText':
    'ストアで本やシリーズを検索してホームに追加するか、複数の本を選択して「ホームに追加」を押してください。',
  'home.openStore': 'ストアを開く',
  'home.offline':
    'サーバーに接続できません。このブラウザにダウンロード済みの本を表示しています。進捗は接続が戻ると同期されます',
  'home.retry': '再試行',

  'store.view': 'ストアの表示',
  'store.books': '本',
  'store.series': 'シリーズ',

  'settings.uiLanguage': '表示言語',
  'settings.uiLanguageHint':
    'メニューやボタンの言語です。一部はまだ英語のみです。AIの言語は「設定 → AI」で設定します。'
};
