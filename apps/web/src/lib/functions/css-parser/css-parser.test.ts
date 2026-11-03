/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import parseCss from './css-parser';

/**
 * Selector lists come from book stylesheets. Ways the split could fail: a comma inside (), also
 * nested, read as a separator; a comma or paren inside a quoted string miscounted; an escaped
 * quote ending a string early; a crafted list of commas freezing the tab.
 */
const selectors = (css: string) => (parseCss(css).stylesheet.rules[0] as any).selectors;

describe('selector lists', () => {
  it('splits on top-level commas only', () => {
    expect(selectors('a , b:not(c, d),e {color:red}')).toEqual(['a', 'b:not(c, d)', 'e']);
    expect(selectors(':is(a, :not(b, c), d), e {color:red}')).toEqual([
      ':is(a, :not(b, c), d)',
      'e'
    ]);
  });

  it('ignores commas and parens in strings', () => {
    expect(selectors('[a="x,y"], b {color:red}')).toEqual(['[a="x,y"]', 'b']);
    expect(selectors('[a="("], b {color:red}')).toEqual(['[a="("]', 'b']);
    expect(selectors(`[a='\\'(,'], b {color:red}`)).toEqual([`[a='\\'(,']`, 'b']);
  });

  it('keeps up with a huge list', () => {
    const start = performance.now();

    expect(selectors(`${'a,'.repeat(100_000)}b {color:red}`)).toHaveLength(100_001);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
