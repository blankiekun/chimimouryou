/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { flowPosition, lineScroll, spacerSize, type PageGeometry } from './page-anchor';

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;

describe('flowPosition', () => {
  it('finds the column and the offset from its block start', () => {
    const horizontal: PageGeometry = {
      vertical: false,
      columnSize: 800,
      columnPitch: 520,
      columnsPerPage: 2
    };
    expect(flowPosition(rect(1560, 230, 20, 20), rect(0, 30, 1000, 800), horizontal)).toEqual({
      column: 3,
      offset: 200
    });
    const vertical: PageGeometry = {
      vertical: true,
      columnSize: 1000,
      columnPitch: 940,
      columnsPerPage: 1
    };
    expect(flowPosition(rect(700, 1900, 20, 20), rect(0, 0, 1000, 900), vertical)).toEqual({
      column: 2,
      offset: 280
    });
  });
});

describe('spacerSize', () => {
  const one: PageGeometry = {
    vertical: true,
    columnSize: 1000,
    columnPitch: 940,
    columnsPerPage: 1
  };
  const two: PageGeometry = {
    vertical: false,
    columnSize: 800,
    columnPitch: 520,
    columnsPerPage: 2
  };

  it('pushes the anchor to the next page start', () => {
    expect(spacerSize(0, { column: 4, offset: 300 }, 10, one)).toBe(710);
    // second column of a two-column spread: a column and the rest of this one
    expect(spacerSize(0, { column: 3, offset: 200 }, 0, two)).toBe(600);
    expect(spacerSize(0, { column: 2, offset: 200 }, 0, two)).toBe(1400);
  });

  it('keeps a spacer that already fits and stays under a page', () => {
    expect(spacerSize(250, { column: 1, offset: 10 }, 10, one)).toBe(250);
    // the anchor sits before its target: a smaller spacer moves it back
    expect(spacerSize(500, { column: 1, offset: 5 }, 25, one)).toBe(520);
    expect(spacerSize(900, { column: 0, offset: 950 }, 0, one)).toBe(950);
  });
});

describe('lineScroll', () => {
  it('keeps the line as far from the visible start edge as it was', () => {
    // vertical: the panel opens (edge 1440 -> 1012), then closes
    expect(lineScroll(1500, 1430, 1440, 1012)).toBe(498);
    expect(lineScroll(1000, 1002, 1012, 1440)).toBe(-430);
    // horizontal: the bar's room comes (edge 0 -> 56) and goes
    expect(lineScroll(300, 20, 0, 56)).toBe(224);
    expect(lineScroll(60, 76, 56, 0)).toBe(40);
  });
});
