/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BookmarkManager } from '../types';
import type { BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';
import type { CharacterStatsCalculator } from './character-stats-calculator';

export class BookmarkManagerContinuous implements BookmarkManager {
  constructor(
    private calculator: CharacterStatsCalculator,
    private window: Window,
    private firstDimensionMargin: number
  ) {}

  scrollToBookmark(bookmarkData: BooksDbBookmarkData, customReadingPointScrollOffset = 0) {
    if (!bookmarkData.exploredCharCount) return;

    if (this.scrollToCharCount(bookmarkData.exploredCharCount, customReadingPointScrollOffset)) {
      return;
    }

    const { scrollToData } = resolveTargetScroll(
      this.getParagraphPosition(bookmarkData.exploredCharCount),
      this.firstDimensionMargin
    );
    const scrollProperty = this.calculator.verticalMode ? 'left' : 'top';

    if (scrollToData.left !== undefined && scrollProperty === 'left') {
      scrollToData.left += customReadingPointScrollOffset;
    } else if (scrollToData.top !== undefined && scrollProperty === 'top') {
      scrollToData.top -= customReadingPointScrollOffset;
    }

    this.window.scrollTo(scrollToData);
  }

  formatBookmarkData(bookId: number, customReadingPointScrollOffset = 0): BooksDbBookmarkData {
    const exploredCharCount = this.charCountAt(customReadingPointScrollOffset);
    const bookCharCount = this.calculator.charCount;

    const { verticalMode } = this.calculator;
    const scrollAxis = verticalMode ? 'scrollX' : 'scrollY';

    return {
      dataId: bookId,
      exploredCharCount,
      progress: exploredCharCount / bookCharCount,
      [scrollAxis]: this.window[scrollAxis],
      lastBookmarkModified: new Date().getTime()
    };
  }

  /** Characters before the first one at the reading point (not whole paragraphs). */
  charCountAt(customReadingPointScrollOffset = 0) {
    return (
      this.calculator.charCountAtLine(this.readingLine(customReadingPointScrollOffset)) ??
      this.calculator.calcExploredCharCount(customReadingPointScrollOffset)
    );
  }

  /** Puts the line of the character after `charCount` at the reading point, whatever the layout. */
  scrollToCharCount(charCount: number, customReadingPointScrollOffset = 0) {
    const target = this.getCharScroll(charCount, customReadingPointScrollOffset);
    if (target) this.window.scrollTo(resolveTargetScroll(target, 0).scrollToData);
    return !!target;
  }

  getRenderedStartCount() {
    return 0;
  }

  isCharCountOnScreen(charCount: number) {
    return this.calculator.isCharCountOnScreen(charCount);
  }

  formatBookmarkDataByRange(bookId: number): BooksDbBookmarkData {
    return this.formatBookmarkData(bookId);
  }

  getBookmarkBarPosition(bookmarkData: BooksDbBookmarkData): BookmarkPosData | undefined {
    const targetScroll = this.getBookmarkPosition(bookmarkData);
    if (!targetScroll) return undefined;

    return resolveTargetScroll(targetScroll, this.firstDimensionMargin).bookmarkPosData;
  }

  private getBookmarkPosition(bookmark: BooksDbBookmarkData): TargetScroll | undefined {
    if (!bookmark.exploredCharCount) return undefined;

    return (
      this.getCharScroll(bookmark.exploredCharCount) ||
      this.getParagraphPosition(bookmark.exploredCharCount)
    );
  }

  private getParagraphPosition(charCount: number): TargetScroll {
    const scrollPos = this.calculator.getScrollPosByCharCount(charCount);
    if (this.calculator.verticalMode) {
      return {
        scrollX: scrollPos
      };
    }
    return {
      scrollY: scrollPos
    };
  }

  /** Screen x (vertical text) or y of the reading point, where jumps land and chapters are read. */
  private readingLine(offset = 0) {
    const fromEdge = this.firstDimensionMargin + offset;
    return this.calculator.verticalMode ? this.window.innerWidth - fromEdge : fromEdge;
  }

  /** The scroll that puts the line of the character after `charCount` at the reading point. */
  private getCharScroll(charCount: number, offset = 0): TargetScroll | undefined {
    const rect = this.calculator.charRectForCount(charCount);
    if (!rect) return undefined;
    const line = this.readingLine(offset);
    return this.calculator.verticalMode
      ? { scrollX: this.window.scrollX + rect.right - line }
      : { scrollY: this.window.scrollY + rect.top - line };
  }
}

function resolveTargetScroll(
  targetScroll: TargetScroll,
  dimensionAdjustment: number
): {
  bookmarkPosData: BookmarkPosData;
  scrollToData: ScrollToOptions;
} {
  if ('scrollX' in targetScroll) {
    return {
      scrollToData: {
        left: targetScroll.scrollX
      },
      bookmarkPosData: {
        right: `${-targetScroll.scrollX + dimensionAdjustment}px`
      }
    };
  }
  return {
    scrollToData: {
      top: targetScroll.scrollY
    },
    bookmarkPosData: {
      top: `${targetScroll.scrollY + dimensionAdjustment}px`
    }
  };
}

type TargetScroll = { scrollX: number } | { scrollY: number };

export interface BookmarkPosData {
  top?: string;
  right?: string;
}
