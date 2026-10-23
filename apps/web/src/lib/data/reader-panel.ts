/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The reader's chrome (Study Book): which index tabs the side panel shows, the Contents rows,
 * and the Aa sheet's furigana choice. Not part of upstream.
 */

import type { SectionWithProgress } from '$lib/components/book-reader/book-toc/book-toc';
import { FuriganaStyle } from '$lib/data/furigana-style';
import { getWeightedAverage } from '$lib/functions/utils';
import type { MessageKey } from '$lib/i18n';

/** 'contents' | 'search' | 'highlights' | 'listen' | a plugin tab's key */
export type PanelTab = string;

export interface PanelTabEntry {
  key: PanelTab;
  label: MessageKey;
}

/** Index tabs in their order on the panel's edge; plugin tabs (Story so far, Lorebook) last. */
export function readerPanelTabs(
  pluginTabs: PanelTabEntry[],
  { hasChapters, hasText }: { hasChapters: boolean; hasText: boolean }
): PanelTabEntry[] {
  return [
    ...(hasChapters ? [{ key: 'contents', label: 'reader.contents' as const }] : []),
    ...(hasText ? [{ key: 'search', label: 'reader.searchTab' as const }] : []),
    { key: 'highlights', label: 'reader.highlights' },
    { key: 'listen', label: 'reader.listen' },
    ...pluginTabs.map(({ key, label }) => ({ key, label }))
  ];
}

/** Width of the open panel with its tabs on larger screens (reader-panel.svelte) */
export const panelWidthRem = 26.75;

/** The book's width beside the panel: on larger screens it shrinks, on phones the sheet covers it. */
export function readerWidth(width: number, panelOpen: boolean, remPx: number) {
  return panelOpen && width >= 768 ? width - panelWidthRem * remPx : width;
}

/** Height of the reader bar (book-reader-header.svelte) */
export const readerBarRem = 3.5;

/**
 * Room kept free above the book for the bar, with the book's own top padding (2rem) a little more
 * than the bar's height, so no line starts under it and showing it moves nothing.
 */
export function readerTopInset(remPx: number) {
  return (readerBarRem - 1.5) * remPx;
}

/**
 * Continuous mode: how far from the screen's start edge the visible book begins, where jumps land
 * and the reading position is measured. Scrolled text passes under the reader's chrome: under the
 * open panel at the right for vertical text, under the bar at the top for horizontal text (always,
 * so showing the bar or the panel moves nothing). Paginated pages fit beside them.
 */
export function jumpOffset(
  { vertical, paginated, panelOpen }: { vertical: boolean; paginated: boolean; panelOpen: boolean },
  width: number,
  remPx: number
) {
  if (paginated) {
    return 0;
  }

  if (!vertical) {
    return readerBarRem * remPx;
  }

  return panelOpen ? width - readerWidth(width, true, remPx) : 0;
}

export interface ContentsRow {
  reference: string;
  label: string;
  /** 0-100, the chapter with its continuation sections */
  progress: number;
  current: boolean;
}

/** Top-level chapters with their progress; the first one not finished is current. */
export function contentsRows(sections: SectionWithProgress[]): ContentsRow[] {
  const chapters = sections.filter((section) => !section.parentChapter);
  const rows = chapters.map((chapter) => {
    const parts = sections.filter(
      (section) =>
        section.reference === chapter.reference || section.parentChapter === chapter.reference
    );

    return {
      reference: chapter.reference,
      label: chapter.label ?? '',
      progress:
        getWeightedAverage(
          parts.map((part) => part.progress),
          parts.map((part) => part.charactersWeight)
        ) || 0,
      current: false
    };
  });
  const current = rows.findIndex((row) => row.progress < 100);
  const index = current === -1 ? rows.length - 1 : current;

  return rows.map((row, i) => (i === index ? { ...row, current: true } : row));
}

export function currentChapterLabel(sections: SectionWithProgress[]) {
  return contentsRows(sections).find((row) => row.current)?.label ?? '';
}

/** The Aa sheet's three furigana choices; the other styles stay in Settings → Reader. */
export type FuriganaChoice = 'show' | 'known' | 'hide';

export function furiganaChoice(
  hideFurigana: boolean,
  style: FuriganaStyle
): FuriganaChoice | undefined {
  if (!hideFurigana) {
    return 'show';
  }
  if (style === FuriganaStyle.Known) {
    return 'known';
  }

  return style === FuriganaStyle.Hide ? 'hide' : undefined;
}

export function furiganaSettings(choice: FuriganaChoice): {
  hideFurigana: boolean;
  style?: FuriganaStyle;
} {
  if (choice === 'show') {
    return { hideFurigana: false };
  }

  return {
    hideFurigana: true,
    style: choice === 'known' ? FuriganaStyle.Known : FuriganaStyle.Hide
  };
}
