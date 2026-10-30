/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Keeps the text being read in place when the reader panel opens or closes and the book re-lays
 * out. Paginated: an empty spacer at the start of the section, sized in the block direction, puts
 * the first line of the old page at the start of a page again; it holds no text, so character
 * counts, bookmarks and highlight ranges are unchanged. Continuous: a scroll that keeps the line
 * at the same spot on screen.
 */

import { getParagraphNodes } from './get-paragraph-nodes';

/** A character in the rendered book; the DOM nodes survive a re-layout. */
export interface TextAnchor {
  node: Text;
  index: number;
}

/** Paginated layout: pages are columnsPerPage columns of the multicol content. */
export interface PageGeometry {
  vertical: boolean;
  /** Block size of a column (px): the content's width in vertical text, its height otherwise */
  columnSize: number;
  /** Distance between the starts of two columns in the inline direction (px) */
  columnPitch: number;
  columnsPerPage: number;
}

export interface FlowPosition {
  column: number;
  /** Distance from the column's block start (px) */
  offset: number;
}

/** Where a character's box lies in the multicol flow, relative to the content box. */
export function flowPosition(rect: DOMRect, content: DOMRect, g: PageGeometry): FlowPosition {
  return g.vertical
    ? {
        column: Math.floor((rect.top + rect.height / 2 - content.top) / g.columnPitch),
        offset: content.right - rect.right
      }
    : {
        column: Math.floor((rect.left + rect.width / 2 - content.left) / g.columnPitch),
        offset: rect.top - content.top
      };
}

/**
 * The spacer size that moves a character at `pos` to `target` px from the start of a page,
 * assuming the flow after the spacer moves with it. Kept under one page: a whole page more only
 * adds a blank one.
 */
export function spacerSize(current: number, pos: FlowPosition, target: number, g: PageGeometry) {
  const page = g.columnSize * g.columnsPerPage;
  const flow = (pos.column % g.columnsPerPage) * g.columnSize + pos.offset;
  return (((current + target - flow) % page) + page) % page;
}

export function charRect(anchor: TextAnchor) {
  const range = document.createRange();
  for (let i = anchor.index; i < anchor.node.length; i += 1) {
    range.setStart(anchor.node, i);
    range.setEnd(anchor.node, i + 1);
    const rect = range.getClientRects()[0];
    if (rect && (rect.width || rect.height)) return rect;
  }
  return undefined;
}

/**
 * The first character, in document order, that isn't `before` (laid out before the page or
 * reading line). Text flows in document order, so `before` holds for a prefix: binary search.
 */
export function firstTextAfter(root: Element, before: (rect: DOMRect) => boolean) {
  return firstTextAfterIn(
    getParagraphNodes(root).filter((n): n is Text => n instanceof Text),
    before
  );
}

/** firstTextAfter over text nodes already collected in document order. */
export function firstTextAfterIn(
  nodes: Text[],
  before: (rect: DOMRect) => boolean
): TextAnchor | undefined {
  const range = document.createRange();
  const lastRect = (node: Text) => {
    range.selectNodeContents(node);
    const rects = range.getClientRects();
    return rects[rects.length - 1];
  };
  let lo = 0;
  let hi = nodes.length;
  // A node without a box (ruby's <rp>) takes the place of the nearest laid-out one before it;
  // everything before `lo` is before.
  const laidOut = (i: number) => {
    for (let j = i; j >= lo; j -= 1) {
      const rect = lastRect(nodes[j]);
      if (rect) return rect;
    }
    return undefined;
  };
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const rect = laidOut(mid);
    if (!rect || before(rect)) lo = mid + 1;
    else hi = mid;
  }
  const node = nodes[lo];
  if (!node) return undefined;

  let first = 0;
  let last = node.length - 1;
  while (first < last) {
    const mid = (first + last) >> 1;
    const rect = charRect({ node, index: mid });
    if (!rect || before(rect)) first = mid + 1;
    else last = mid;
  }
  // Skip collapsed whitespace, which has no box.
  while (first < node.length - 1 && !node.data[first].trim()) first += 1;
  return { node, index: first };
}

export interface PageAnchor extends TextAnchor {
  /** The character's offset from its page's start when it began the page */
  offset: number;
}

/** The first character of the page shown, with its offset from the page's start. */
export function capturePageAnchor(content: Element, g: PageGeometry, page: number) {
  const box = content.getBoundingClientRect();
  const firstColumn = page * g.columnsPerPage;
  const anchor = firstTextAfter(content, (rect) => flowPosition(rect, box, g).column < firstColumn);
  const rect = anchor && charRect(anchor);
  if (!anchor || !rect) return undefined;
  const pos = flowPosition(rect, box, g);
  if (Math.floor(pos.column / g.columnsPerPage) !== page) return undefined;
  return { ...anchor, offset: pos.offset };
}

export function setSpacer(spacer: HTMLElement, size: number) {
  spacer.style.display = size > 0 ? 'block' : 'none';
  spacer.style.blockSize = `${size}px`;
}

export function spacerOf(spacer: HTMLElement) {
  return spacer.style.display === 'block' ? parseFloat(spacer.style.blockSize) || 0 : 0;
}

/**
 * Sizes the spacer so the anchor starts a page again and returns the index of the page it is on.
 * Page breaks before the anchor can move with the spacer (paragraphs that avoid breaks), so it
 * re-measures; when no size fits (the anchor inside such a paragraph) it keeps the one that put
 * the anchor nearest a page start.
 */
export function alignPageAnchor(
  spacer: HTMLElement,
  content: Element,
  anchor: PageAnchor,
  g: PageGeometry
) {
  const measure = () => {
    const rect = charRect(anchor);
    return rect && flowPosition(rect, content.getBoundingClientRect(), g);
  };
  let best = { size: spacerOf(spacer), miss: Infinity };
  for (let i = 0; i < 6; i += 1) {
    const pos = measure();
    if (!pos) return undefined;
    const current = spacerOf(spacer);
    const miss = (pos.column % g.columnsPerPage) * g.columnSize + pos.offset - anchor.offset;
    if (Math.abs(miss) < 1) return Math.floor(pos.column / g.columnsPerPage);
    if (Math.abs(miss) < Math.abs(best.miss)) best = { size: current, miss };
    setSpacer(spacer, spacerSize(current, pos, anchor.offset, g));
  }
  setSpacer(spacer, best.size);
  const pos = measure();
  return pos && Math.floor(pos.column / g.columnsPerPage);
}

/** Continuous: the screen coordinate kept for a line (vertical: its right edge, else its top). */
export function linePos(rect: DOMRect, vertical: boolean) {
  return vertical ? rect.right : rect.top;
}

/**
 * Continuous: the scroll that keeps a line as far from the visible start edge as it was when that
 * edge moved from `edgeWas` to `edge` (the panel or bar came or went), so the place read stays.
 */
export function lineScroll(now: number, was: number, edgeWas: number, edge: number) {
  return now - (was - edgeWas + edge);
}
