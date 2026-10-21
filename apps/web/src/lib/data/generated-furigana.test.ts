/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { addGeneratedRuby, type ReadingsFile } from './generated-furigana';

const html = '<div><p>三本の木を<ruby>見<rt>み</rt></ruby>た。行った。</p></div>';

describe('addGeneratedRuby', () => {
  it('wraps glossed kanji runs, a counter span over its tokens', () => {
    // Counts: 三0 本1 の2 木3 を4 見5 た6 行7 っ8 た9 (。 isn't counted): 10.
    const readings: ReadingsFile = {
      characters: 10,
      glosses: [
        [[0, 2, '三本', 'さんぼん']],
        [[0, 1, '三', 'さん']],
        [[0, 1, '木', 'き']],
        [[0, 1, '行', 'い']]
      ],
      occ: [0, 0, 0, 0, 1, 1, 1, 2, -1, 2, 3, 2, 4, 4, 3]
    };

    expect(addGeneratedRuby(html, readings)).toBe(
      '<div><p><ruby class="ttu-gen-ruby">三本<rt>さんぼん</rt></ruby>の' +
        '<ruby class="ttu-gen-ruby">木<rt>き</rt></ruby>を<ruby>見<rt>み</rt></ruby>た。' +
        '<ruby class="ttu-gen-ruby">行<rt>い</rt></ruby>った。</p></div>'
    );
  });

  it('leaves the book alone when the counts differ', () => {
    expect(addGeneratedRuby(html, { characters: 11, glosses: [], occ: [] })).toBe(html);
  });

  it('skips a gloss whose base text differs', () => {
    const readings: ReadingsFile = {
      characters: 10,
      glosses: [[[0, 1, '林', 'はやし']]],
      occ: [3, 0, 0]
    };

    expect(addGeneratedRuby(html, readings)).toBe(html);
  });
});
