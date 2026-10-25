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

import { highlightColors, type Highlight, type HighlightColor } from '$lib/data/annotations';
import { spansWithin, type CountSpan } from '$lib/data/unknown-words';
import { setCssHighlight } from '$lib/functions/book-text/css-highlights';
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
