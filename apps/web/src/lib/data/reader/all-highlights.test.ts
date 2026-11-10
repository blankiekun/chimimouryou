/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { readerDb } from '$lib/data/reader-db';
import type { Highlight } from './annotations';
import { allHighlights, allHighlightsMarkdown } from './all-highlights';

function highlight(id: string, start: number, props: Partial<Highlight> = {}): Highlight {
  return {
    id,
    start,
    end: start + 1,
    text: `text ${id}`,
    note: '',
    color: 'yellow',
    chapter: '',
    created: 1,
    modified: 1,
    ...props
  };
}

async function put(record: any) {
  await (await readerDb()).put('annotations', record);
}

afterEach(async () => {
  await (await readerDb()).clear('annotations');
});

describe('allHighlights', () => {
  it('groups each book with its highlights in start order', async () => {
    await put({ title: 'A', highlights: [highlight('a2', 20), highlight('a1', 10)] });
    await put({ title: 'B', highlights: [highlight('b1', 5)] });

    const books = await allHighlights('');
    const a = books.find((book) => book.title === 'A');

    expect(books).toHaveLength(2);
    expect(a?.highlights.map((h) => h.id)).toEqual(['a1', 'a2']);
    expect(books.find((book) => book.title === 'B')?.highlights.map((h) => h.id)).toEqual(['b1']);
  });

  it('leaves out deleted highlights and books left with none', async () => {
    await put({
      title: 'A',
      highlights: [highlight('a1', 1), highlight('a2', 2, { deleted: true })]
    });
    await put({ title: 'B', highlights: [highlight('b1', 1, { deleted: true })] });

    const books = await allHighlights('');

    expect(books.map((book) => book.title)).toEqual(['A']);
    expect(books[0].highlights.map((h) => h.id)).toEqual(['a1']);
  });

  it('leaves out held copies', async () => {
    await put({ title: 'A\0acc', account: 'acc', highlights: [highlight('a1', 1)] });

    expect(await allHighlights('acc')).toEqual([]);
  });

  it("leaves out another account's records", async () => {
    await put({ title: 'Other', account: 'b', highlights: [highlight('o', 1)] });
    await put({ title: 'Mine', account: 'a', highlights: [highlight('m', 1)] });
    await put({ title: 'Local', highlights: [highlight('l', 1)] });

    const titles = (await allHighlights('a')).map((book) => book.title).sort();

    expect(titles).toEqual(['Local', 'Mine']);
  });

  it('orders books by their newest highlight, newest first', async () => {
    await put({ title: 'Old', highlights: [highlight('o', 1, { modified: 100 })] });
    await put({
      title: 'New',
      highlights: [highlight('n1', 1, { modified: 50 }), highlight('n2', 2, { modified: 300 })]
    });
    await put({ title: 'Mid', highlights: [highlight('m', 1, { modified: 200 })] });

    expect((await allHighlights('')).map((book) => book.title)).toEqual(['New', 'Mid', 'Old']);
  });

  it('skips malformed records', async () => {
    await put({ title: 'Bad', highlights: 'nope' });
    await put({ title: 'Good', highlights: [highlight('g', 1)] });

    expect((await allHighlights('')).map((book) => book.title)).toEqual(['Good']);
  });
});

describe('allHighlightsMarkdown', () => {
  it('has every title and quote in group order', () => {
    const markdown = allHighlightsMarkdown([
      { title: 'First', highlights: [highlight('1', 1, { text: 'quote one' })] },
      { title: 'Second', highlights: [highlight('2', 1, { text: 'quote two' })] }
    ]);
    const order = ['# First', '> quote one', '# Second', '> quote two'].map((part) =>
      markdown.indexOf(part)
    );

    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
