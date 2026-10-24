/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lineHash, lineIndex, visibleThreads, type CommunityNote } from '$lib/data/community';
import {
  bookLines,
  lineAt,
  lineLinkTarget,
  passedLine,
  splitContext,
  unseenNotes
} from '$lib/data/community-book';
import { enabledPlugins$ } from '$lib/plugins/plugin-settings';

const paragraphs = [
  { text: '一章', startCount: 0 },
  {
    text: '私はその人を常に先生と呼んでいた。だからここでもただ先生と書くだけで本名は打ち明けない。',
    startCount: 2
  },
  { text: '「本当ですか」と彼は言った。', startCount: 46 }
];

describe('community in the book', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    enabledPlugins$.next(['social']);
  });

  it('splits the book into lines with their character counts', () => {
    const lines = bookLines(paragraphs);

    expect(lines.map((line) => line.text)).toEqual([
      '一章',
      '私はその人を常に先生と呼んでいた。',
      'だからここでもただ先生と書くだけで本名は打ち明けない。',
      '「本当ですか」と彼は言った。'
    ]);
    // Punctuation doesn't count as characters: 「 and 」 are skipped in reader positions.
    expect(lines[1]).toMatchObject({ start: 2, end: 18 });
    expect(lines[2].start).toBe(18);
    expect(lines[3].start).toBe(46);
  });

  it('finds the line at a position and the lines passed', () => {
    const lines = bookLines(paragraphs);

    expect(lineAt(lines, 0)).toBe(0);
    expect(lineAt(lines, 20)).toBe(2);
    expect(passedLine(lines, 18)).toBe(1);
    expect(passedLine(lines, 19)).toBe(2);
  });

  it('shows threads only on lines the reader passed', async () => {
    const lines = bookLines(paragraphs);
    const index = await lineIndex(lines.map((line) => line.text));
    const later = (await lineHash(lines[3].text))!;
    const threads = [{ prefix: later.slice(0, 8), posts: 2, spoiler: false }];

    expect(visibleThreads(threads, index, passedLine(lines, 20))).toEqual([]);
    expect(visibleThreads(threads, index, passedLine(lines, 47))).toMatchObject([
      { hash: later, index: 3, posts: 2 }
    ]);
  });

  it('marks the line in its page', () => {
    expect(splitContext('前の文。この行。後の文。', 'この行。')).toEqual({
      before: '前の文。',
      line: 'この行。',
      after: '後の文。'
    });
    expect(splitContext('どこにもない', 'この行。').line).toBe('この行。');
  });

  it('groups unseen replies by the post they answer', () => {
    const note = (id: string, parent: string, at: number, name: string) =>
      ({
        id,
        parent,
        at,
        work: 'w',
        line: 'l',
        title: 't',
        vol: '1',
        cover: null,
        author: { name }
      }) as unknown as CommunityNote;
    const groups = unseenNotes(
      [
        note('a', 'p1', 30, 'Mio'),
        note('b', 'p1', 20, 'Ren'),
        note('c', 'p2', 10, 'Aki'),
        note('d', 'p1', 25, 'Mio')
      ],
      { p2: 10 }
    );

    expect(groups).toEqual([
      expect.objectContaining({ parent: 'p1', count: 3, at: 30, names: ['Mio', 'Ren'] })
    ]);
  });

  it('sends line links nowhere with social off or a malformed line', async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal('fetch', fetchMock);
    expect(await lineLinkTarget(new URLSearchParams({ line: 'x', work: 'w' }))).toBeNull();
    enabledPlugins$.next([]);
    expect(
      await lineLinkTarget(new URLSearchParams({ line: 'a'.repeat(32), work: 'anilist:1' }))
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens the thread when the book is not in this browser', async () => {
    enabledPlugins$.next(['social']);
    expect(
      await lineLinkTarget(new URLSearchParams({ line: 'a'.repeat(32), work: 'anilist:1/2' }))
    ).toBe(`/community?work=anilist%3A1%2F2&line=${'a'.repeat(32)}`);
  });
});
