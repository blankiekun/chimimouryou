/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import {
  bookCore,
  chunks,
  coreScore,
  coreText,
  parseCoreTable,
  tokensOf,
  type CoreScale
} from './core';
import scale from '$lib/data/difficulty-scale.json';
// Shared with the difficulty service (scripts/calibre/jiten/core.py, test_core.py): both must give these.
import fixtureJson from '../../../../../../scripts/calibre/tests/fixtures/difficulty-core.json?raw';
import serverScale from '../../../../../../scripts/calibre/jiten/core-scale.json?raw';

const fixture = JSON.parse(fixtureJson) as {
  cases: {
    name: string;
    morphemes: (string | number)[][];
    ranks: Record<string, number>;
    readingRanks: Record<string, number>;
    compounds: Record<string, string>;
    expected: unknown;
  }[];
  scores: [number | null, number][];
};

describe('the shared difficulty core fixture', () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))(
    '%s',
    (_, { morphemes, ranks, readingRanks, compounds, expected }) => {
      // A 6th field repeats the row (runs are stored once).
      const rows = morphemes
        .flatMap((row) => Array<string>(Number(row[5] ?? 1)).fill(row.slice(0, 5).join('\x1f')))
        .join('\x1e');
      const table = {
        ranks: new Map(Object.entries(ranks)),
        readingRanks: new Map(Object.entries(readingRanks)),
        compounds: new Map(Object.entries(compounds))
      };

      expect(bookCore(tokensOf(rows), table)).toEqual(expected);
    }
  );

  it('reads the core list build.sh writes', () => {
    const table = parseCoreTable('の\t1\n顔\t300\n\n顔\tがお\t75124\n\n心配顔\tしんぱいがお\n');

    expect([...table.ranks]).toEqual([
      ['の', 1],
      ['顔', 300]
    ]);
    expect([...table.readingRanks]).toEqual([['顔\tがお', 75124]]);
    expect([...table.compounds]).toEqual([['心配顔', 'しんぱいがお']]);
  });

  it('scores V98 as the service does', () => {
    for (const [v98, expected] of fixture.scores) {
      expect(coreScore(v98, scale as unknown as CoreScale)).toBe(expected);
    }
  });

  it('uses the service’s scale', () => {
    expect(scale).toEqual(JSON.parse(serverScale));
  });
});

describe('coreText', () => {
  it('leaves ruby text out and ends blocks with a newline', () => {
    expect(
      coreText(
        '<p><ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>&amp;&#x3042;</p><p>次<br/>行</p>'
      )
    ).toBe('漢字&あ\n次\n行\n');
  });

  it('cuts long paragraphs at a sentence end', () => {
    const text = `${'あ'.repeat(4000)}。${'い'.repeat(2000)}`;

    expect([...chunks(`前\n${text}`)].map(([chunk, at]) => [chunk.length, at])).toEqual([
      [1, 0],
      [4001, 2],
      [2000, 4003]
    ]);
  });
});
