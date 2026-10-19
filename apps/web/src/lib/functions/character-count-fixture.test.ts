/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { getParagraphNodes } from '$lib/components/book-reader/get-paragraph-nodes';
import { getCharacterCount, isCountedCharacter } from './get-character-count';
import { isNodeGaiji } from './is-node-gaiji';
// Shared with the difficulty service's readings files (scripts/calibre/jiten/readings_file.py,
// test_readings_file.py): both must count a book's HTML the same way.
import fixtureJson from '../../../../../scripts/calibre/tests/fixtures/character-count.json?raw';

const fixture = JSON.parse(fixtureJson) as { html: string; characters: number; counted: string };

describe('the shared character counting fixture', () => {
  it('counts the characters the readings files count, in the same order', () => {
    const root = document.createElement('div');
    root.innerHTML = fixture.html;
    const nodes = getParagraphNodes(root);

    expect(nodes.reduce((sum, node) => sum + getCharacterCount(node), 0)).toBe(fixture.characters);
    expect(
      nodes
        .map((node) =>
          isNodeGaiji(node)
            ? '〓'
            : Array.from(node.textContent || '')
                .filter(isCountedCharacter)
                .join('')
        )
        .join('')
    ).toBe(fixture.counted);
  });
});
