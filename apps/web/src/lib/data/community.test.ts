/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clipContext,
  communityWorks$,
  confirmWork,
  contextLength,
  lineHash,
  lineIndex,
  occurrenceOf,
  loadFeed,
  postOnLine,
  resolveWork,
  sentences,
  titleWork,
  visibleThreads,
  volumeOf,
  workFromUrl
} from '$lib/data/community';
import { socialSession$, type SocialMe } from '$lib/data/social-account';
import { enabledPlugins$ } from '$lib/plugins/plugin-settings';

// The hub's own fixture: both sides must hash a line the same way.
const fixtures: { line: string; occurrence?: number; hash: string }[] = JSON.parse(
  readFileSync(resolve(process.cwd(), '../../deploy/social-hub/test/line-hashes.json'), 'utf8')
);

const me = { id: '0123456789abcdef', username: 'aki', share: {} } as SocialMe;

describe('community', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ work: null, posts: [], next: null, ok: true }))
    );
    enabledPlugins$.next(['social']);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    socialSession$.next(null);
    communityWorks$.next({});
  });

  it('hashes lines like the hub, so two editions of a line meet', async () => {
    for (const { line, occurrence, hash } of fixtures) {
      expect(await lineHash(line, occurrence)).toBe(hash);
    }
    expect(await lineHash('「はい。」')).toBeNull();
  });

  it('splits text into sentences with their closing brackets', () => {
    expect(sentences('「行くぞ！」と彼は言った。そうか……\n次の行')).toEqual([
      '「行くぞ！」',
      'と彼は言った。',
      'そうか……',
      '次の行'
    ]);
  });

  it('shows threads on every line of the book, a repeated line with a thread per copy', async () => {
    const lines = [
      '最初の文章です。',
      '繰り返す文章です。',
      '途中の文章です。',
      '「繰り返す文章です！」'
    ];
    const index = await lineIndex(lines);
    const threads = await Promise.all(
      (
        [
          ['最初の文章です。', 1],
          ['繰り返す文章です。', 1],
          ['繰り返す文章です。', 2],
          ['この本にない文章。', 1]
        ] as const
      ).map(async ([line, occurrence]) => ({
        prefix: (await lineHash(line, occurrence))!.slice(0, 8),
        posts: 1,
        spoiler: false
      }))
    );

    expect(occurrenceOf(lines, 1)).toBe(1);
    expect(occurrenceOf(lines, 3)).toBe(2);
    expect(visibleThreads(threads, index).map((one) => one.index)).toEqual([0, 1, 3]);
  });

  it('clips the page around the line', () => {
    const line = '真ん中の文。';
    const page = `${'前'.repeat(800)}${line}${'後'.repeat(800)}`;
    const context = clipContext(page, line);

    expect([...context].length).toBe(contextLength);
    expect(context).toContain(line);
    expect(clipContext('短いページ。', '短いページ。')).toBe('短いページ。');
  });

  it('makes work keys from AniList and VNDB pages, else from the title', () => {
    expect(volumeOf('本好きの下剋上 3')).toBe('3');
    expect(volumeOf('吾輩は猫である')).toBe('');
    expect(workFromUrl('https://anilist.co/manga/85737/Honzuki/', '本好きの下剋上 3')).toBe(
      'anilist:85737/3'
    );
    expect(workFromUrl('https://vndb.org/v17', 'Ever17')).toBe('vndb:v17');
    expect(workFromUrl('https://jiten.moe/decks/media/1/detail', '本 3')).toBeNull();
    expect(workFromUrl('https://anilist.co.evil/manga/1', '本')).toBeNull();
    expect(titleWork('[1巻] 本好きの下剋上 3')).toBe('title:本好きの下剋上3');
  });

  it('resolves a work from the cache, the Find details page, then the hub (signed in only)', async () => {
    const title = '本好きの下剋上 3';

    expect(await resolveWork(title)).toEqual({ work: null, suggestion: null });
    expect(fetchMock).not.toHaveBeenCalled();

    socialSession$.next({ token: 't', me });
    fetchMock.mockImplementationOnce(
      async () => new Response(JSON.stringify({ work: 'anilist:85737/3' }))
    );
    expect(await resolveWork(title)).toEqual({ work: null, suggestion: 'anilist:85737/3' });

    expect(await resolveWork(title, 'https://anilist.co/manga/85737')).toEqual({
      work: 'anilist:85737/3',
      suggestion: null
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      book: '本好きの下剋上3',
      vol: '3',
      work: 'anilist:85737/3'
    });
    expect(await resolveWork(title)).toEqual({ work: 'anilist:85737/3', suggestion: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the title key in this browser only', async () => {
    socialSession$.next({ token: 't', me });
    expect(await confirmWork('ローカルの本', null)).toBe('title:ローカルの本');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads signed out without a token, refuses writes, and sends nothing with social off', async () => {
    await loadFeed();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
    expect(fetchMock.mock.calls[0][1].credentials).toBe('omit');

    const post = {
      title: '本',
      vol: '',
      quote: '文章です。',
      context: '文章です。',
      body: 'x',
      spoiler: false,
      feed: true,
      occurrence: 1
    };

    await expect(postOnLine('title:本', post)).rejects.toMatchObject({ status: 401 });
    enabledPlugins$.next([]);
    await expect(loadFeed()).rejects.toMatchObject({ code: 'off' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
