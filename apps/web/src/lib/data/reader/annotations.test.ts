/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const account = vi.hoisted(() => ({ user: null as { id: string; username: string } | null }));

vi.mock('$lib/data/account', () => ({
  accountReady: async () => account.user,
  accountSyncUrl: '/account/sync/',
  currentAccount: () => account.user
}));

import { fakeApi } from '$lib/data/test-utils/fake-api';
import { readerDb } from '$lib/data/reader-db';
import {
  AnnotationsController,
  highlightsToMarkdown,
  mergeHighlights,
  type Highlight
} from './annotations';

function highlight(id: string, modified: number, props: Partial<Highlight> = {}): Highlight {
  return {
    id,
    start: 0,
    end: 1,
    text: id,
    note: '',
    color: 'yellow',
    chapter: '',
    created: 0,
    modified,
    ...props
  };
}

describe('mergeHighlights', () => {
  it('keeps the newest edit of each highlight and sorts by position', () => {
    const merged = mergeHighlights(
      [highlight('a', 1, { note: 'old', start: 5 }), highlight('b', 1)],
      [highlight('a', 2, { note: 'new', start: 5 }), highlight('c', 1, { start: 2 })]
    );

    expect(merged.map((h) => h.id)).toEqual(['b', 'c', 'a']);
    expect(merged[2].note).toBe('new');
  });

  it('lets a newer tombstone win', () => {
    const [merged] = mergeHighlights([highlight('a', 1)], [highlight('a', 2, { deleted: true })]);

    expect(merged.deleted).toBe(true);
  });

  // Bug: a deletion and an edit with the same modified time: the local side wins, so one device
  // keeps the highlight for good, or the deleted highlight comes back.
  it('lets a tombstone win a tie, whichever side it is on', () => {
    const edit = highlight('a', 5, { note: 'edited' });
    const tombstone = highlight('a', 5, { deleted: true });

    expect(mergeHighlights([edit], [tombstone])[0].deleted).toBe(true);
    expect(mergeHighlights([tombstone], [edit])[0].deleted).toBe(true);
  });
});

describe('highlightsToMarkdown', () => {
  it('groups by chapter and quotes text', () => {
    expect(
      highlightsToMarkdown('Book', [
        highlight('x', 0, { text: '一行\n二行', chapter: 'C1', note: 'メモ' })
      ])
    ).toBe('# Book\n\n## C1\n\n> 一行\n> 二行\n\nメモ\n');
  });
});

// One API for the file: server-api.ts keeps the catalog and the mirror per page load.
const api = fakeApi({ account: () => account.user?.id ?? '' });

['Book A', 'Book B', 'Book C'].forEach((title, index) =>
  api.addBook({ id: index + 1, calibreId: 101 + index, title })
);

describe('AnnotationsController account scoping', () => {
  const uploads: { url: string; body: string }[] = [];

  function mockServer(remote: Highlight[]) {
    uploads.length = 0;
    remote.forEach((item) =>
      api.setRow('highlights', {
        book: api.bookId('Book A'),
        hid: item.id,
        modified: item.modified,
        data: item
      })
    );
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') uploads.push({ url, body: String(init.body) });
        return api.fetch(url, init);
      })
    );
  }

  async function storeLocally(title: string, highlights: Highlight[], owner?: string) {
    await (await readerDb()).put('annotations', { title, highlights, account: owner });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    account.user = null;
  });

  it("doesn't upload another account's cached highlights after switching accounts", async () => {
    await storeLocally('Book A', [highlight('private', 1, { note: 'secret' })], 'alice');
    account.user = { id: 'bob', username: 'bob' };
    mockServer([]);

    const controller = new AnnotationsController('Book A', 'ttu-calibre-default');

    await controller.load();

    expect(controller.highlights$.getValue()).toEqual([]);
    expect(uploads.map((u) => u.body).join()).not.toContain('secret');
  });

  it("doesn't upload an account's highlights to the shared folder after signing out", async () => {
    await storeLocally('Book B', [highlight('private', 1, { note: 'secret' })], 'alice');
    mockServer([]);

    const controller = new AnnotationsController('Book B', 'ttu-calibre-default');

    await controller.load();

    expect(uploads.map((u) => u.body).join()).not.toContain('secret');
  });

  it('keeps and syncs highlights cached by the same account', async () => {
    await storeLocally('Book C', [highlight('mine', 1)], 'alice');
    account.user = { id: 'alice', username: 'alice' };
    mockServer([]);

    const controller = new AnnotationsController('Book C', 'ttu-calibre-default');

    await controller.load();

    expect(controller.highlights$.getValue().map((h) => h.id)).toEqual(['mine']);
    expect(uploads).toHaveLength(1);
  });

  it('keeps highlights of books that only live in this browser', async () => {
    await storeLocally('Local book', [highlight('local', 1)], 'alice');
    mockServer([]);

    const controller = new AnnotationsController('Local book', '');

    await controller.load();

    expect(controller.highlights$.getValue().map((h) => h.id)).toEqual(['local']);
  });
});
