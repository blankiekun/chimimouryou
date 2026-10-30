/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

// known-furigana loads kanji met, which sync through extras-sync and its storage handler.
vi.mock('$lib/data/storage/handler/server-handler', () => ({ ServerStorageHandler: {} }));

import readings from 'yurigana/kanji-readings.json';
import {
  hideKnownRuby,
  knownRubyClass,
  markKnownRuby,
  totalKanjiCounts
} from '$lib/data/known-furigana';

const met = Object.fromEntries([...'本気異能宇宙人間茶学校今日一'].map((kanji) => [kanji, 10]));
const hide = (base: string, reading: string, totals = met) =>
  hideKnownRuby(base, reading, totals, readings);

describe('hideKnownRuby', () => {
  it('hides a plain reading of kanji met often enough', () => {
    expect(hide('人間', 'にんげん')).toBe(true);
    expect(hide('学校', 'がっこう')).toBe(true);
    expect(hide('人々', 'ひとびと')).toBe(true);
  });

  it('keeps katakana ruby', () => {
    expect(hide('本気', 'マジ')).toBe(false);
    expect(hide('異能', 'スキル')).toBe(false);
  });

  it('keeps hiragana ruby that is not a reading of the base', () => {
    expect(hide('宇宙', 'そら')).toBe(false);
    expect(hide('本気', 'まじ')).toBe(false);
    expect(hide('宇宙', 'うちゅう')).toBe(true);
  });

  it('keeps jukujikun, which the per-kanji readings cannot spell', () => {
    expect(hide('今日', 'きょう')).toBe(false);
  });

  it('keeps ruby with kanji and bases without kanji', () => {
    expect(hide('本気', '本気')).toBe(false);
    expect(hide('スキル', 'すきる')).toBe(false);
  });

  it('matches the kana of a partly kanji base', () => {
    expect(hide('お茶', 'おちゃ')).toBe(true);
    expect(hide('お茶', 'ちゃ')).toBe(false);
  });

  it('needs every kanji met at least ten times in total', () => {
    expect(hide('人間', 'にんげん', { ...met, 間: 9 })).toBe(false);
    const totals = totalKanjiCounts([{ counts: { 人: 5, 間: 10 } }, { counts: { 人: 5 } }]);
    expect(hide('人間', 'にんげん', totals)).toBe(true);
  });
});

describe('markKnownRuby', () => {
  it('marks the ruby to hide, reading rt and skipping rp', () => {
    const el = document.createElement('div');
    el.innerHTML =
      '<ruby>人間<rp>(</rp><rt>にんげん</rt><rp>)</rp></ruby><ruby><rb>本気</rb><rt>マジ</rt></ruby>';

    const marked = markKnownRuby(el, (base, reading) => hide(base, reading));

    expect(marked).toHaveLength(1);
    expect(el.querySelectorAll(`.${knownRubyClass}`)[0].textContent).toBe('人間(にんげん)');
  });
});
