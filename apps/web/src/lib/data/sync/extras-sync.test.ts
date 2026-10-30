/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const account = vi.hoisted(() => ({ user: null as { id: string; username: string } | null }));

vi.mock('$lib/data/account/account', () => ({
  accountReady: async () => account.user,
  accountSyncUrl: '/account/sync/',
  currentAccount: () => account.user
}));

import { fakeApi } from '$lib/data/test-utils/fake-api';
import { readerDb } from '$lib/data/reader-db';
import { getLorebook, saveLoreEntries, type LoreEntry } from '$lib/data/ai/lorebook';
import { deleteSavedRecap, getSavedRecaps } from '$lib/data/ai/recap';
import {
  enableExtrasSync,
  extrasSyncError$,
  mergeKanji,
  mergeWordMarks,
  syncExtras,
  syncImmersion,
  syncKanji,
  syncWordMarks
} from './extras-sync';

const entry = (name: string): LoreEntry => ({
  id: name,
  name,
  reading: '',
  category: 'character',
  keys: [name],
  content: `${name}.`,
  firstSeen: 0,
  updated: 0
});

// One API for the file: server-api.ts keeps the catalog and the mirror per page load.
const api = fakeApi({ account: () => account.user?.id ?? '' });

['Lore', 'Race', 'Recaps', 'Private', 'Broken'].forEach((title, index) =>
  api.addBook({ id: index + 1, calibreId: 101 + index, title })
);

/** Docs another device stored; returns this test's fetch calls. */
function server(seed: { kind: string; title?: string; who?: string; data: unknown }[] = []) {
  const calls: string[] = [];

  seed.forEach(({ kind, title, who = '', data }) =>
    api.setRow(
      title === undefined ? 'accountDocs' : 'bookDocs',
      { kind, ...(title === undefined ? {} : { book: api.bookId(title) }), modified: 1, data },
      who
    )
  );
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return api.fetch(url, init);
    })
  );

  return { calls };
}

describe('extras sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    account.user = null;
  });

  it('only syncs books it was turned on for', async () => {
    const { calls } = server();

    await syncExtras('lorebook', 'Not synced');

    expect(calls).toEqual([]);
  });

  it('uploads a newer local lorebook and adopts a newer remote one', async () => {
    server();

    enableExtrasSync('Lore', 'ttu-calibre-default');
    await saveLoreEntries('Lore', [entry('葵')]);
    await syncExtras('lorebook', 'Lore');

    expect((api.doc('lorebook', 'Lore') as { entries: LoreEntry[] }).entries).toHaveLength(1);
    expect(api.doc('lorebook', 'Lore')).not.toHaveProperty('account');

    api.setRow('bookDocs', {
      book: api.bookId('Lore'),
      kind: 'lorebook',
      modified: Date.now() + 60_000,
      data: {
        title: 'Lore',
        entries: [entry('葵'), entry('東京')],
        processedUpTo: 900,
        modified: Date.now() + 60_000
      }
    });
    await syncExtras('lorebook', 'Lore');

    const lorebook = await getLorebook('Lore');

    expect(lorebook.entries.map((e) => e.name)).toEqual(['葵', '東京']);
    expect(lorebook.processedUpTo).toBe(900);
  });

  it('keeps a local save made while the remote copy was being fetched', async () => {
    server();

    enableExtrasSync('Race', 'ttu-calibre-default');
    await saveLoreEntries('Race', [entry('葵')]);
    await syncExtras('lorebook', 'Race');

    const fetchMock = vi.mocked(fetch);
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementationOnce(async (url, init) => {
      await saveLoreEntries('Race', [entry('葵'), entry('東京')]);
      return respond(url, init);
    });
    await syncExtras('lorebook', 'Race');

    expect((await getLorebook('Race')).entries.map((e) => e.name)).toEqual(['葵', '東京']);
    expect((api.doc('lorebook', 'Race') as { entries: LoreEntry[] }).entries).toHaveLength(2);
  });

  it('combines saved recaps from both sides and keeps deletions', async () => {
    const recap = (created: number) => ({
      position: created,
      text: `r${created}`,
      created,
      model: 'm'
    });
    server([
      {
        kind: 'recaps',
        title: 'Recaps',
        data: {
          title: 'Recaps',
          chapters: { c2: { summary: 'two', characters: 1, model: 'm' } },
          saved: [recap(2), recap(3)]
        }
      }
    ]);

    enableExtrasSync('Recaps', 'ttu-calibre-default');
    await (
      await readerDb()
    ).put('recaps', {
      title: 'Recaps',
      chapters: { c1: { summary: 'one', characters: 1, model: 'm' } },
      saved: [recap(1)]
    });
    await syncExtras('recaps', 'Recaps');

    expect((await getSavedRecaps('Recaps')).map((r) => r.created)).toEqual([1, 2, 3]);

    await deleteSavedRecap('Recaps', 3);
    await syncExtras('recaps', 'Recaps');

    const uploaded = api.doc('recaps', 'Recaps') as {
      chapters: object;
      saved: { created: number }[];
      deletedSaved: number[];
    };

    expect(uploaded.saved.map((r) => r.created)).toEqual([1, 2]);
    expect(uploaded.deletedSaved).toEqual([3]);
    expect(Object.keys(uploaded.chapters).sort()).toEqual(['c1', 'c2']);
  });

  // Bug: a server error or a cut-off remote file clears the local lorebook or recaps. And (owner
  // 2026-10-29, item F) a remote value of the wrong shape is never written over: it may be a newer
  // version's format.
  it('keeps the local copies when the remote file fails to load or is malformed', async () => {
    const recaps = {
      title: 'Broken',
      chapters: { c1: { summary: 'one', characters: 1, model: 'm' } },
      saved: [{ position: 1, text: 'r1', created: 1, model: 'm' }]
    };
    const puts: Record<string, any> = {};
    let failWith500 = true;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') puts[url] = JSON.parse(init.body as string).data;

        return failWith500 && url.startsWith('/api/v1/sync')
          ? new Response('', { status: 503 })
          : api.fetch(url, init);
      })
    );
    // What another device left: cut off, so not an object.
    ['lorebook', 'recaps'].forEach((kind) =>
      api.setRow('bookDocs', {
        book: api.bookId('Broken'),
        kind,
        modified: 1,
        data: '{"title":"Broken","entr'
      })
    );
    enableExtrasSync('Broken', 'ttu-calibre-default');
    await saveLoreEntries('Broken', [entry('葵')]);
    await (await readerDb()).put('recaps', recaps);

    await syncExtras('lorebook', 'Broken');
    await syncExtras('recaps', 'Broken');

    expect(puts).toEqual({});
    expect((await getLorebook('Broken')).entries.map((e) => e.name)).toEqual(['葵']);
    expect((await getSavedRecaps('Broken')).map((r) => r.created)).toEqual([1]);

    failWith500 = false;
    await syncExtras('lorebook', 'Broken');
    await syncExtras('recaps', 'Broken');

    expect((await getLorebook('Broken')).entries.map((e) => e.name)).toEqual(['葵']);
    expect((await getSavedRecaps('Broken')).map((r) => r.created)).toEqual([1]);
    expect(puts).toEqual({});
    expect(extrasSyncError$.getValue().lorebook).toContain('lorebook.json');
    expect(extrasSyncError$.getValue().recaps).toContain('recaps.json');
  });

  it("doesn't upload another account's cached lorebook", async () => {
    server();

    enableExtrasSync('Private', 'ttu-calibre-default');
    await (
      await readerDb()
    ).put('lorebooks', {
      title: 'Private',
      entries: [entry('秘密')],
      processedUpTo: 10,
      modified: 1,
      account: 'alice'
    });
    account.user = { id: 'bob', username: 'bob' };
    await syncExtras('lorebook', 'Private');

    expect(
      JSON.stringify(['', 'bob', 'alice'].map((who) => api.rowsOf('bookDocs', who)))
    ).not.toContain('秘密');
    expect((await getLorebook('Private')).entries).toEqual([]);
  });
});

describe('word marks sync', () => {
  const mark = (status: 'known' | 'ignored' | null, modified: number) => ({ status, modified });

  afterEach(async () => {
    vi.unstubAllGlobals();
    account.user = null;
    window.localStorage.clear();
    await (await readerDb()).clear('known');
  });

  it('keeps the newest mark per word, removals included', () => {
    expect(
      mergeWordMarks(
        { '猫\t': mark('known', 5), '犬\tいぬ': mark('ignored', 1), '鳥\t': mark(null, 3) },
        { '猫\t': mark(null, 4), '犬\tいぬ': mark(null, 2), '魚\t': mark('known', 1) }
      )
    ).toEqual({
      '猫\t': mark('known', 5),
      '犬\tいぬ': mark(null, 2),
      '鳥\t': mark(null, 3),
      '魚\t': mark('known', 1)
    });
  });

  // Bug: on a tie in `modified` each device keeps its own mark, so they never agree.
  it('settles a tie in modified the same way on both devices', () => {
    const a = { '猫\t': mark('known', 5) };
    const b = { '猫\t': mark(null, 5) };

    expect(mergeWordMarks(a, b)).toEqual(mergeWordMarks(b, a));
  });

  it('merges words.json in the account folder for the signed-in reader', async () => {
    server([
      {
        kind: 'words',
        who: 'bob',
        data: { words: { '猫\t': mark(null, 9), bad: { status: 'x' } } }
      }
    ]);
    const db = await readerDb();

    await db.put('known', { '猫\t': mark('known', 5), '犬\t': mark('ignored', 6) }, 'marks');
    account.user = { id: 'bob', username: 'bob' };
    window.localStorage.setItem('readerDataOwner', 'bob');
    await syncWordMarks();

    const merged = { '猫\t': mark(null, 9), '犬\t': mark('ignored', 6) };

    expect(await db.get('known', 'marks')).toEqual(merged);
    expect(api.doc('words', undefined, 'bob')).toEqual({ words: merged });
  });

  it("doesn't sync signed out", async () => {
    const { calls } = server();

    await syncWordMarks();
    expect(calls).toEqual([]);
  });
});

describe('kanji sync', () => {
  const book = (title: string, upTo: number, modified?: number, kanji = '人') => ({
    title,
    upTo,
    counts: { [kanji]: upTo },
    ...(modified === undefined ? {} : { modified })
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    account.user = null;
    window.localStorage.clear();
    await (await readerDb()).clear('kanji');
  });

  it('keeps the newest record per title without adding counts', () => {
    expect(
      mergeKanji(
        [book('A', 10, 2), book('B', 50), book('C', 5, 1)],
        [book('A', 99, 1), book('B', 60), book('D', 7, 3)]
      )
    ).toEqual([book('A', 10, 2), book('B', 60), book('C', 5, 1), book('D', 7, 3)]);
  });

  // Bug: records with the same (or no) modified time keep whichever side is local, so devices never agree.
  it('settles ties in modified the same way on both devices', () => {
    const local = [book('A', 10, 3), book('B', 40)];
    const remote = [book('A', 20, 3), book('B', 30)];
    const byTitle = (books: ReturnType<typeof mergeKanji>) =>
      [...books].sort((x, y) => x.title.localeCompare(y.title));

    expect(byTitle(mergeKanji(local, remote))).toEqual(byTitle(mergeKanji(remote, local)));
    expect(byTitle(mergeKanji(local, remote))).toEqual([book('A', 20, 3), book('B', 40)]);
  });

  it('downloads newer records and uploads the merged file for the signed-in reader', async () => {
    server([
      { kind: 'kanji', who: 'bob', data: { books: [book('A', 99, 1, '山'), book('B', 20, 5)] } }
    ]);
    const db = await readerDb();

    await db.put('kanji', book('A', 10, 2));
    account.user = { id: 'bob', username: 'bob' };
    window.localStorage.setItem('readerDataOwner', 'bob');
    await syncKanji();

    expect(await db.getAll('kanji')).toEqual([book('A', 10, 2), book('B', 20, 5)]);
    expect(api.doc('kanji', undefined, 'bob')).toEqual({
      books: [book('A', 10, 2), book('B', 20, 5)]
    });
  });

  it("doesn't sync signed out or before another reader's kanji are released", async () => {
    const { calls } = server();

    await (await readerDb()).put('kanji', book('A', 10, 2));
    await syncKanji();
    account.user = { id: 'bob', username: 'bob' };
    window.localStorage.setItem('readerDataOwner', 'alice');
    await syncKanji();

    expect(calls).toEqual([]);
  });
});

describe('immersion sync', () => {
  const logged = (id: string, modified: number, seconds = 60) => ({
    id,
    type: 'vn',
    title: 'ゲーム',
    day: '2026-10-21',
    seconds,
    characters: 10,
    source: 'hook',
    modified
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    account.user = null;
    window.localStorage.clear();
    await (await readerDb()).delete('known', 'immersion');
  });

  it('merges immersion.json in the account folder, dropping malformed entries', async () => {
    server([
      {
        kind: 'immersion',
        who: 'bob',
        data: {
          entries: {
            a: logged('a', 1, 999),
            b: logged('b', 4),
            bad: { id: 'bad' },
            c: logged('x', 1)
          }
        }
      }
    ]);
    const db = await readerDb();

    await db.put('known', { a: logged('a', 2) } as any, 'immersion');
    account.user = { id: 'bob', username: 'bob' };
    window.localStorage.setItem('readerDataOwner', 'bob');
    await syncImmersion();

    const merged = { a: logged('a', 2), b: logged('b', 4) };

    expect(await db.get('known', 'immersion')).toEqual(merged);
    expect(api.doc('immersion', undefined, 'bob')).toEqual({ entries: merged });
  });

  it("doesn't sync signed out without a library source", async () => {
    const { calls } = server();

    await syncImmersion();
    expect(calls).toEqual([]);
  });
});
