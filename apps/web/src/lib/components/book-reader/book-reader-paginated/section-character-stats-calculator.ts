/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BehaviorSubject } from 'rxjs';
import { CharacterStatsCalculator } from '$lib/components/book-reader/book-reader-continuous/character-stats-calculator';
import { binarySearchNoNegative } from '$lib/functions/binary-search';
import { dev } from '$app/env';
import { formatPos } from '$lib/functions/format-pos';
import { getCharacterCount } from '$lib/functions/get-character-count';
import { getParagraphNodes } from '../get-paragraph-nodes';
import { flowPosition, type PageGeometry } from '../page-anchor';

export class SectionCharacterStatsCalculator {
  readonly charCount: number;

  private readonly sectionAccCharCounts: number[];

  private sectionIndex = -1;

  private calculator: CharacterStatsCalculator | undefined;

  constructor(
    public readonly containerEl: HTMLElement,
    public readonly sections: ReadonlyArray<Element>,
    private virtualScrollPos$: BehaviorSubject<number>,
    private getWidth: () => number,
    private getHeight: () => number,
    private getPageGap: () => number,
    public verticalMode: boolean,
    private readonly scrollEl: HTMLElement,
    private readonly document: Document,
    // The multicol content and its geometry: counts and jumps to the character, not the text node
    private getContent: () => { el: HTMLElement; g: PageGeometry } | undefined = () => undefined
  ) {
    const getSectionCharCount = (section: Element) => {
      const paragraphs = getParagraphNodes(section);
      return paragraphs.reduce((acc, cur) => acc + getCharacterCount(cur), 0);
    };
    let exploredCharCount = 0;
    this.sectionAccCharCounts = sections.map((section) => {
      exploredCharCount += getSectionCharCount(section);
      return exploredCharCount;
    });
    this.charCount = exploredCharCount;
  }

  updateCurrentSection(sectionIndex: number) {
    this.calculator = new CharacterStatsCalculator(
      this.containerEl,
      this.verticalMode ? 'horizontal' : 'vertical',
      'ltr',
      this.scrollEl,
      this.document
    );
    this.sectionIndex = sectionIndex;

    setTimeout(() => {
      this.calculator?.updateParagraphPosIfNeeded(this.virtualScrollPos$.getValue());
    });
  }

  updateParagraphPos() {
    if (!this.calculator) return;
    this.calculator.updateParagraphPos(this.virtualScrollPos$.getValue());
  }

  calcExploredCharCount(customReadingPointRange: Range | undefined) {
    if (dev && this.getPageGap() === 0) {
      // Scroll position must be beyond text size for character count increment
      throw new Error('Formula assumes non-zero page gap');
    }

    if (customReadingPointRange && this.calculator) {
      return (
        this.getSectionStartCount() + this.calculator.getCharCountToPoint(customReadingPointRange)
      );
    }

    // A text node can span pages (long paragraphs on a phone): count to the page's first character.
    const pageStart = this.pageStartCount();
    if (pageStart !== undefined) return pageStart;

    const offset = this.verticalMode ? 0 : -this.screenSize;
    return this.getCharCountByScrollPos(this.virtualScrollPos$.getValue() + offset);
  }

  getCharCountByScrollPos(scrollPos: number) {
    if (!this.calculator) return -1;
    const startCount = this.getSectionStartCount();
    return this.calculator.getCharCountByScrollPos(scrollPos) + startCount;
  }

  getSectionIndexByCharCount(charCount: number) {
    return binarySearchNoNegative(this.sectionAccCharCounts, charCount) + 1;
  }

  getScrollPosByCharCount(charCount: number) {
    if (!this.calculator) return -1;
    const startCount = this.getSectionStartCount();
    const endCount = this.sectionAccCharCounts[this.sectionIndex];
    const mirroredCount = charCount - startCount;
    const isEndChar = charCount === endCount && endCount - startCount > 0;
    if (mirroredCount < 0 || charCount > endCount || isEndChar) return -1;
    if (mirroredCount === 0) return 0;

    const page = this.pageOfCount(mirroredCount);
    if (page !== undefined) return page * this.screenSize;

    const index = binarySearchNoNegative(this.calculator.accumulatedCharCount, mirroredCount);
    const { accumulatedCharCount, paragraphPos } = this.calculator;
    const prevCharCount = accumulatedCharCount[index];
    if (Number.isNaN(Number(paragraphPos[index]))) return -1;

    const bestFitIndex = (from: number, to: number): number => {
      if (from >= to) return to;
      if (accumulatedCharCount[from] > prevCharCount) return from;
      return bestFitIndex(from + 1, to);
    };
    const scrollPos = paragraphPos[bestFitIndex(index + 1, accumulatedCharCount.length - 1)];

    const { screenSize } = this;
    const offsetCount = this.verticalMode ? -1 : 0;
    const screenPos = screenSize * (Math.ceil(scrollPos / screenSize) + offsetCount);
    return formatPos(screenPos, this.calculator.direction);
  }

  checkBookmarkOnScreen(charCount: number) {
    const scrollPos = this.getScrollPosByCharCount(charCount);
    const virtualPos = this.virtualScrollPos$.getValue();

    if (scrollPos !== -1 && scrollPos === virtualPos && this.calculator) {
      return {
        isBookmarkScreen: true,
        ...this.calculator.getBookMarkPosForSection(this.getSectionStartCount(), charCount)
      };
    }

    return {
      isBookmarkScreen: scrollPos !== -1 && scrollPos === virtualPos,
      bookmarkPos: undefined,
      node: undefined,
      isFirstNode: true
    };
  }

  private pageStartCount() {
    const content = this.getContent();
    if (!content || !this.calculator) return undefined;
    const { el, g } = content;
    const box = el.getBoundingClientRect();
    const page = Math.round(this.virtualScrollPos$.getValue() / this.screenSize);
    const count = this.calculator.charCountBefore(
      (rect) => flowPosition(rect, box, g).column < page * g.columnsPerPage
    );
    return count === undefined ? undefined : this.getSectionStartCount() + count;
  }

  /** Page of the character after the first `count` ones of the section. */
  private pageOfCount(count: number) {
    const content = this.getContent();
    const rect = this.calculator?.charRectForCount(count);
    if (!content || !rect) return undefined;
    const { el, g } = content;
    return Math.floor(flowPosition(rect, el.getBoundingClientRect(), g).column / g.columnsPerPage);
  }

  getOffsetToRange(customReadingPointRange: Range | undefined, columns: number) {
    if (!customReadingPointRange) {
      return 0;
    }

    const rect = customReadingPointRange.getBoundingClientRect();

    if (this.verticalMode) {
      return 1 - rect.left / this.screenSizeMirrored;
    }

    const progressPerColumn = Math.floor(100 / columns);
    const toSlice = Math.floor(this.screenSize / columns);
    const progressInColumn = (progressPerColumn * rect.bottom) / this.screenSizeMirrored;

    let totalProgress = progressInColumn;
    let columnNumber = 0;

    for (let index = 0; index < this.screenSize; index += toSlice) {
      if (rect.right >= index) {
        totalProgress = columnNumber * progressPerColumn + progressInColumn;
        columnNumber += 1;
      } else {
        break;
      }
    }

    return totalProgress / 100;
  }

  getSectionStartCount() {
    return this.sectionAccCharCounts[this.sectionIndex - 1] || 0;
  }

  private get screenSize() {
    return (this.verticalMode ? this.getHeight() : this.getWidth()) + this.getPageGap();
  }

  private get screenSizeMirrored() {
    return (this.verticalMode ? this.getWidth() : this.getHeight()) + this.getPageGap();
  }
}
