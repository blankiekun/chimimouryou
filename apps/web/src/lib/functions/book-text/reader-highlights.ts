/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The reader's (/b) colouring of the rendered text: highlights, the search match, the line read
 * aloud and unknown words, plus the passage and hit tests around a selection or a tap.
 * Moved out of routes/b/+page.svelte unchanged.
 */

import type { BookmarkManager } from '$lib/components/book-reader/types';
import { highlightColors, type Highlight, type HighlightColor } from '$lib/data/annotations';
import type { Section } from '$lib/data/database/books-db/versions/v3/books-db-v3';
import { spansWithin, type CountSpan } from '$lib/data/unknown-words';
import { chapterLabelAt } from '$lib/functions/book-text/book-search';
import {
  clearCssHighlights,
  cssHighlightsSupported,
  setCssHighlight
} from '$lib/functions/book-text/css-highlights';
import {
  countsForRange,
  getTextSegments,
  rangeForCounts
} from '$lib/functions/book-text/text-positions';

export interface CountMatch {
  start: number;
  end: number;
}

export interface HighlightRange {
  highlight: Highlight;
  range: Range;
}

export function getTextWithoutFurigana(range: Range) {
  const fragment = range.cloneContents();

  fragment.querySelectorAll('rt, rp').forEach((element) => element.remove());

  return (fragment.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * Colours highlights, the search match, the line read aloud and unknown words in `content`, whose
 * text starts at character count `base`. Returns the highlights' ranges and the reading line's.
 */
export function paintHighlights(
  content: Element,
  base: number,
  highlights: Highlight[],
  searchMatch: CountMatch | undefined,
  readingMatch: CountMatch | undefined,
  unknownSpans: CountSpan[]
) {
  const segments = getTextSegments(content);
  const lastSegment = segments[segments.length - 1];
  const end = base + (lastSegment ? lastSegment.startCount + lastSegment.count : 0);
  const byColor = new Map<HighlightColor, Range[]>(highlightColors.map((color) => [color, []]));
  const withNotes: Range[] = [];
  const highlightRanges: HighlightRange[] = [];

  highlights.forEach((highlight) => {
    if (highlight.end <= base || highlight.start >= end) {
      return;
    }

    const range = rangeForCounts(
      document,
      segments,
      Math.max(highlight.start, base),
      Math.min(highlight.end, end),
      base
    );

    if (!range) {
      return;
    }

    byColor.get(highlight.color)?.push(range);

    if (highlight.note) {
      withNotes.push(range);
    }

    highlightRanges.push({ highlight, range });
  });

  byColor.forEach((ranges, color) => setCssHighlight(`ttu-hl-${color}`, ranges));
  setCssHighlight('ttu-hl-note', withNotes);

  const searchRange =
    searchMatch && searchMatch.end > base && searchMatch.start < end
      ? rangeForCounts(document, segments, searchMatch.start, searchMatch.end, base)
      : undefined;

  setCssHighlight('ttu-search', searchRange ? [searchRange] : []);

  const readingRange =
    readingMatch && readingMatch.end > base && readingMatch.start < end
      ? rangeForCounts(document, segments, readingMatch.start, readingMatch.end, base)
      : undefined;

  setCssHighlight('ttu-reading', readingRange ? [readingRange] : []);
  setCssHighlight(
    'ttu-unknown',
    spansWithin(unknownSpans, base, end).flatMap(
      ([start, stop]) => rangeForCounts(document, segments, start, stop, base) ?? []
    )
  );

  return { highlightRanges, readingRange };
}

function caretAt(x: number, y: number) {
  const doc = document as any;

  if (doc.caretPositionFromPoint) {
    const position = doc.caretPositionFromPoint(x, y);

    return position && { node: position.offsetNode as Node, offset: position.offset as number };
  }

  const range: Range | null = doc.caretRangeFromPoint?.(x, y);

  return range && { node: range.startContainer, offset: range.startOffset };
}

/** The highlight under the point (x, y), if any. */
export function highlightAt(highlightRanges: HighlightRange[], x: number, y: number) {
  const caret = highlightRanges.length ? caretAt(x, y) : undefined;

  return (
    (caret &&
      highlightRanges.find(({ range }) => {
        try {
          return range.isPointInRange(caret.node, caret.offset);
        } catch (_) {
          return false;
        }
      })?.highlight) ||
    undefined
  );
}

/** Whether a range's box shows within the book's width and the window's height. */
export function isOnScreen(rect: DOMRect | undefined, bookWidth: number, innerHeight: number) {
  return (
    !!rect &&
    rect.width + rect.height > 0 &&
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < bookWidth &&
    rect.bottom <= innerHeight
  );
}

/** The text around a selection in `content` (furigana left out), for a plugin's selection action. */
export function selectionPassage(
  content: Element,
  selectedRange: Range,
  bookTitle: string,
  contextLength: number,
  renderedStart: number | undefined
) {
  const before = document.createRange();
  const after = document.createRange();

  before.setStart(content, 0);
  before.setEnd(selectedRange.startContainer, selectedRange.startOffset);
  after.setStart(selectedRange.endContainer, selectedRange.endOffset);
  after.setEnd(content, content.childNodes.length);

  return {
    bookTitle,
    before: getTextWithoutFurigana(before).slice(-contextLength),
    selection: getTextWithoutFurigana(selectedRange),
    after: getTextWithoutFurigana(after).slice(0, 600),
    start:
      renderedStart === undefined
        ? undefined
        : countsForRange(getTextSegments(content), selectedRange, renderedStart).start
  };
}

/** The selection inside the book's text (a copy), or undefined. */
export function selectedBookRange() {
  const selection = document.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
  const content = document.querySelector('.book-content');

  return range && !range.collapsed && content?.contains(range.commonAncestorContainer)
    ? range.cloneRange()
    : undefined;
}

/** A new highlight over `range` in `content` (text starting at `base`), or undefined if it is empty. */
export function newHighlight(
  content: Element,
  range: Range,
  base: number,
  color: HighlightColor,
  sections: Section[]
) {
  const { start, end } = countsForRange(getTextSegments(content), range, base);
  const text = getTextWithoutFurigana(range);

  if (end <= start || !text) {
    return undefined;
  }

  return { start, end, text, note: '', color, chapter: chapterLabelAt(sections, start) };
}

/**
 * Keeps the reader's highlights, search match, line read aloud and unknown words painted: repaints
 * 200 ms after a change and whenever the rendered text changes (paginated mode swaps sections).
 */
export class HighlightPainter {
  searchMatch: CountMatch | undefined;

  /** Line being read aloud (audiobook or AI voice) */
  readingMatch: CountMatch | undefined;

  private highlightRanges: HighlightRange[] = [];

  private highlightsDirty = true;

  private unknownSpans: CountSpan[] = [];

  private highlightTimer: ReturnType<typeof setTimeout> | undefined;

  private observedContent: Element | null = null;

  // Paginated mode swaps the section's DOM, which invalidates the ranges.
  private contentObserver =
    typeof MutationObserver === 'undefined'
      ? undefined
      : new MutationObserver(() => this.scheduleHighlights(true));

  constructor(
    private getBookmarkManager: () => BookmarkManager | undefined,
    private getHighlights: () => Highlight[] | undefined
  ) {}

  scheduleHighlights(force = false) {
    if (force) {
      this.highlightsDirty = true;
    }

    if (!this.highlightsDirty || !cssHighlightsSupported) {
      return;
    }

    clearTimeout(this.highlightTimer);
    this.highlightTimer = setTimeout(() => {
      const content = document.querySelector('.book-content');

      if (content && content !== this.observedContent) {
        this.contentObserver?.disconnect();
        this.contentObserver?.observe(content, { childList: true, subtree: true });
        this.observedContent = content;
      }

      this.applyHighlights();
    }, 200);
  }

  /** Colours highlights and the current search match in the rendered text. */
  applyHighlights() {
    const content = document.querySelector('.book-content');
    const bookmarkManager = this.getBookmarkManager();

    if (!content || !bookmarkManager) {
      return;
    }

    const painted = paintHighlights(
      content,
      bookmarkManager.getRenderedStartCount(),
      this.getHighlights() || [],
      this.searchMatch,
      this.readingMatch,
      this.unknownSpans
    );

    this.highlightRanges = painted.highlightRanges;
    this.highlightsDirty = false;

    return painted.readingRange;
  }

  /** New unknown-word spans; repaints when there are or were some. */
  setUnknownSpans(spans: CountSpan[]) {
    if (spans.length || this.unknownSpans.length) {
      this.unknownSpans = spans;
      this.scheduleHighlights(true);
    }
  }

  /**
   * Highlights the line being read and turns the page or scrolls when it isn't visible.
   * Without CSS highlights `follow` keeps the page with the voice.
   */
  showReading(
    match: { start: number; end: number; follow?: boolean } | undefined,
    bookWidth: () => number,
    scrollToCount: (count: number) => void,
    follow: (count: number) => void
  ) {
    this.readingMatch = match;
    this.highlightsDirty = true;

    if (!cssHighlightsSupported) {
      // Without highlights, at least keep the page with the voice.
      if (match) {
        follow(match.start);
      }
      return;
    }

    const range = this.applyHighlights();

    if (!match) {
      return;
    }

    if (
      match.follow !== false &&
      !isOnScreen(range?.getBoundingClientRect(), bookWidth(), window.innerHeight)
    ) {
      scrollToCount(match.start);
      this.scheduleHighlights(true);
    }
  }

  /** The highlight under the point (x, y), if any. */
  highlightAt(x: number, y: number) {
    return highlightAt(this.highlightRanges, x, y);
  }

  destroy() {
    clearTimeout(this.highlightTimer);
    this.contentObserver?.disconnect();
    clearCssHighlights('ttu-');
  }
}
