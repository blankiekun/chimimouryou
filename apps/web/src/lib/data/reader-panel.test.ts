/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { FuriganaStyle } from '$lib/data/furigana-style';
import {
  contentsRows,
  currentChapterLabel,
  furiganaChoice,
  furiganaSettings,
  jumpOffset,
  readerPanelTabs,
  readerWidth
} from './reader-panel';

const section = (reference: string, progress: number, extra = {}) => ({
  reference,
  label: reference,
  charactersWeight: 10,
  progress,
  ...extra
});

describe('readerPanelTabs', () => {
  it('orders the core tabs, then plugin tabs', () => {
    expect(
      readerPanelTabs([{ key: 'recap', label: 'reader.recap' }], {
        hasChapters: true,
        hasText: true
      }).map((tab) => tab.key)
    ).toEqual(['contents', 'search', 'highlights', 'listen', 'recap']);
  });

  it('leaves out Contents and Search when the book has no chapters or text', () => {
    expect(
      readerPanelTabs([], { hasChapters: false, hasText: false }).map((tab) => tab.key)
    ).toEqual(['highlights', 'listen']);
  });
});

describe('jumpOffset', () => {
  const open = { paginated: false, panelOpen: true };

  it('keeps continuous jumps clear of the open panel and bar', () => {
    expect(jumpOffset({ ...open, vertical: true }, 1440, 16)).toBe(26.75 * 16);
    expect(jumpOffset({ ...open, vertical: true }, 390, 16)).toBe(0);
    expect(jumpOffset({ ...open, vertical: false }, 1440, 16)).toBe(3.5 * 16);
  });

  it('is zero when paginated or closed', () => {
    expect(jumpOffset({ ...open, vertical: true, paginated: true }, 1440, 16)).toBe(0);
    expect(jumpOffset({ ...open, vertical: false, panelOpen: false }, 1440, 16)).toBe(0);
  });
});

describe('readerWidth', () => {
  it('makes room for the panel on larger screens only', () => {
    expect(readerWidth(1440, true, 16)).toBe(1440 - 26.75 * 16);
    expect(readerWidth(1440, false, 16)).toBe(1440);
    expect(readerWidth(390, true, 16)).toBe(390);
  });
});

describe('contentsRows', () => {
  it('folds continuation sections into their chapter and marks the first unfinished one', () => {
    const rows = contentsRows([
      section('a', 100),
      section('b', 100),
      section('b2', 0, { parentChapter: 'b', label: undefined }),
      section('c', 0)
    ]);

    expect(rows.map((row) => [row.reference, row.progress, row.current])).toEqual([
      ['a', 100, false],
      ['b', 50, true],
      ['c', 0, false]
    ]);
  });

  it('marks the last chapter when the book is finished', () => {
    expect(currentChapterLabel([section('a', 100), section('b', 100)])).toBe('b');
    expect(currentChapterLabel([])).toBe('');
  });
});

describe('furigana choice', () => {
  it('maps the settings to Show, Known or Hide and back', () => {
    expect(furiganaChoice(false, FuriganaStyle.Hover)).toBe('show');
    expect(furiganaChoice(true, FuriganaStyle.Known)).toBe('known');
    expect(furiganaChoice(true, FuriganaStyle.Hide)).toBe('hide');
    expect(furiganaChoice(true, FuriganaStyle.Partial)).toBeUndefined();

    for (const choice of ['show', 'known', 'hide'] as const) {
      const { hideFurigana, style } = furiganaSettings(choice);

      expect(furiganaChoice(hideFurigana, style ?? FuriganaStyle.Partial)).toBe(choice);
    }
  });
});
