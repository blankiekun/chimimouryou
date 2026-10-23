/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BookmarkManagerContinuous } from './bookmark-manager-continuous';
import { CharacterStatsCalculator } from './character-stats-calculator';

// A fake layout: every character (counted or not) is a 20px box, `perLine` to a line, each
// paragraph starting a new line PAD from the screen's start edge: lines go down in horizontal
// text, columns go left from the right edge (W) in vertical text, where scrollX is negative.
const PAD = 50;
const BOX = 20;
const W = 400;
let perLine = 10;
let vertical = false;
const scroll = { x: 0, y: 0 };

let container: HTMLElement;
const lineOf = new Map<Text, number>();

function layout() {
  lineOf.clear();
  let line = 0;
  container.querySelectorAll('p').forEach((p) => {
    const text = p.firstChild as Text;
    lineOf.set(text, line);
    line += Math.ceil(text.length / perLine);
  });
}

function box(node: Text, index: number) {
  const line = (lineOf.get(node) ?? 0) + Math.floor(index / perLine);
  const along = (index % perLine) * BOX;
  const across = PAD + line * BOX;
  const top = vertical ? along : across - scroll.y;
  const left = vertical ? W - across - BOX - scroll.x : along;
  return { left, top, width: BOX, height: BOX, right: left + BOX, bottom: top + BOX } as DOMRect;
}

function rangeBoxes(range: Range) {
  let node: Text;
  let start = 0;
  let end: number;
  if (range.startContainer instanceof Text) {
    node = range.startContainer;
    start = range.startOffset;
    end = range.endContainer === node ? range.endOffset : node.length;
  } else {
    node = range.startContainer.childNodes[range.startOffset] as Text;
    end = node.length;
  }
  const boxes = [];
  for (let i = start; i < end; i += 1) boxes.push(box(node, i));
  return boxes;
}

const fakeWindow = {
  innerWidth: W,
  get scrollX() {
    return scroll.x;
  },
  get scrollY() {
    return scroll.y;
  },
  scrollTo(opts: ScrollToOptions) {
    if (opts.top !== undefined) scroll.y = opts.top;
    if (opts.left !== undefined) scroll.x = opts.left;
  }
} as unknown as Window;

const scrollEl = {
  get scrollTop() {
    return scroll.y;
  },
  get scrollLeft() {
    return scroll.x;
  },
  getBoundingClientRect: () => ({ top: -scroll.y, right: W - scroll.x }) as DOMRect
} as unknown as HTMLElement;

const proto = Range.prototype as unknown as Record<string, unknown>;
const saved = { rects: proto.getClientRects, rect: proto.getBoundingClientRect };

beforeEach(() => {
  proto.getClientRects = function (this: Range) {
    return rangeBoxes(this);
  };
  proto.getBoundingClientRect = function (this: Range) {
    const boxes = rangeBoxes(this);
    const first = boxes[0];
    const last = boxes[boxes.length - 1];
    return { ...last, top: first.top, height: last.bottom - first.top } as DOMRect;
  };
  container = document.createElement('div');
  // 25 + 38 + 26 counted characters; 「 and 」 aren't.
  container.innerHTML = [
    'あいうえおかきくけこさしすせそたちつてとなにぬねの',
    '「はひふへほまみむめもやゆよらりるれろわをんアイウエオカキクケコサシスセソタチ」',
    'ツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロ'
  ]
    .map((t) => `<p>${t}</p>`)
    .join('');
  document.body.appendChild(container);
  perLine = 10;
  vertical = false;
  scroll.x = 0;
  scroll.y = 0;
  layout();
});

afterEach(() => {
  container.remove();
  proto.getClientRects = saved.rects;
  proto.getBoundingClientRect = saved.rect;
});

function manager() {
  const calc = vertical
    ? new CharacterStatsCalculator(container, 'vertical', 'rtl', scrollEl, document)
    : new CharacterStatsCalculator(container, 'horizontal', 'ltr', scrollEl, document);
  calc.updateParagraphPos();
  // Reading point PAD from the start edge, where a paragraph starts at no scroll.
  return new BookmarkManagerContinuous(calc, fakeWindow, PAD);
}

describe('BookmarkManagerContinuous', () => {
  it('saves the first character at the reading point, not its paragraph', () => {
    // Line 5 (the second paragraph's third line) at the top: 25, 「 and 19 characters before it.
    scroll.y = 5 * BOX;
    expect(manager().formatBookmarkData(1).exploredCharCount).toBe(25 + 19);
    // with a reading point 2 lines down
    expect(manager().formatBookmarkData(1, 2 * BOX).exploredCharCount).toBe(25 + 38);
  });

  it('brings that character back to the reading point in another layout', () => {
    scroll.y = 5 * BOX;
    const data = manager().formatBookmarkData(1);

    perLine = 7;
    layout();
    scroll.y = 0;
    const m = manager();
    m.scrollToBookmark(data);
    const text = container.querySelectorAll('p')[1].firstChild as Text;
    expect(text.data[20]).toBe('を');
    expect(box(text, 20).top).toBe(PAD);
    expect(m.formatBookmarkData(1).exploredCharCount).toBeLessThanOrEqual(
      data.exploredCharCount ?? 0
    );

    // and with a reading point offset
    m.scrollToBookmark(data, 3 * BOX);
    expect(box(text, 20).top).toBe(PAD + 3 * BOX);
  });

  it('does the same in vertical text', () => {
    vertical = true;
    layout();
    scroll.x = -5 * BOX;
    const data = manager().formatBookmarkData(1);
    expect(data.exploredCharCount).toBe(25 + 19);

    perLine = 7;
    layout();
    scroll.x = 0;
    manager().scrollToBookmark(data, 2 * BOX);
    const text = container.querySelectorAll('p')[1].firstChild as Text;
    expect(box(text, 20).right).toBe(W - PAD - 2 * BOX);
  });
});
