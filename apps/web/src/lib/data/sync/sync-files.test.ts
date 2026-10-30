/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/data/account', () => ({
  accountReady: async () => null,
  accountSyncUrl: '/account/sync/',
  currentAccount: () => null
}));

import {
  AnnotationsController,
  mergeHighlights,
  parseAnnotations,
  type Highlight
} from '$lib/data/annotations';
import { fakeApi } from '$lib/data/test-utils/fake-api';
import { readerDb } from '$lib/data/reader-db';
import { SyncConflictError } from '$lib/data/storage/handler/base-handler';
import { GDriveStorageHandler } from '$lib/data/storage/handler/gdrive-handler';
import { storageOAuthTokens } from '$lib/data/storage/storage-oauth-manager';
import { StorageKey, StorageSourceDefault } from '$lib/data/storage/storage-types';
import { storageSource$ } from '$lib/data/storage/storage-view';
import { autoReplication$, syncTarget$ } from '$lib/data/store';
import { syncState$ } from '$lib/data/sync-status';
import { AutoReplicationType } from '$lib/functions/replication/replication-options';
import { readerSyncSource, syncFileStore, syncJsonFile } from './sync-files';

interface DriveFile {
  id: string;
  name: string;
  parents: string[];
  folder: boolean;
  version: string;
  content: string;
}

/** jsdom's Blob has no text(). */
function blobText(blob: Blob) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });
}

/** Google Drive's files API in memory, as far as the handlers use it. */
function fakeDrive() {
  const files: DriveFile[] = [];
  let nextId = 0;
  const add = (props: Omit<DriveFile, 'id' | 'version'>) => {
    const file = { ...props, id: `id${(nextId += 1)}`, version: '1' };
    files.push(file);
    return file;
  };
  const root = add({ name: 'ttu-reader-data', parents: ['root'], folder: true, content: '' });

  add({ name: 'On Drive', parents: [root.id], folder: true, content: '' });

  async function request(url: string, options: { method?: string; body?: any } = {}) {
    const { pathname, searchParams } = new URL(url);
    const method = options.method || 'GET';
    const id = pathname.split('/files/')[1];

    if (method === 'GET' && searchParams.get('alt') === 'media') {
      return files.find((file) => file.id === id)!.content;
    }

    if (method === 'GET') {
      const q = searchParams.get('q')!;
      const parent = /'([^']+)' in parents/.exec(q)![1];
      const name = /name ?= ?["']([^"']+)["']/.exec(q)?.[1];
      const folder = q.includes("mimeType = 'application/vnd.google-apps.folder'");

      return {
        files: files.filter(
          (file) =>
            file.parents.includes(parent) &&
            (!name || file.name === name) &&
            (!folder || file.folder)
        )
      };
    }

    if (method === 'POST' && !pathname.includes('/upload/')) {
      return add({ ...JSON.parse(options.body), folder: true, content: '' });
    }

    const form = options.body as FormData;
    const resource = JSON.parse(await blobText(form.get('resource') as Blob));
    const content = await blobText(form.get('file') as Blob);

    if (method === 'PATCH') {
      const file = files.find((entry) => entry.id === id)!;

      Object.assign(file, { content, version: `${Number(file.version) + 1}` });
      return file;
    }

    return add({ ...resource, folder: false, content });
  }

  vi.spyOn(GDriveStorageHandler.prototype as any, 'request').mockImplementation(request as any);

  return { files, root };
}

const highlight = (id: string): Omit<Highlight, 'id' | 'created' | 'modified'> => ({
  start: 0,
  end: 1,
  text: id,
  note: '',
  color: 'yellow',
  chapter: ''
});

const drive = StorageSourceDefault.GDRIVE_DEFAULT;

/** The tests' own document: `{ words: string[] }`, anything else refused. */
const wordsList = (raw: unknown) =>
  Array.isArray((raw as { words?: unknown } | null)?.words)
    ? (raw as { words: string[] })
    : undefined;

describe('extra files on Google Drive', () => {
  beforeEach(() => {
    storageOAuthTokens.set(drive, {
      accessToken: 'token',
      expiration: Date.now() + 3_600_000,
      scope: ''
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    storageOAuthTokens.delete(drive);
    await (await readerDb()).clear('annotations');
  });

  it('shows a highlight made in one browser in another', async () => {
    const { files } = fakeDrive();
    const a = new AnnotationsController('On Drive', drive);

    await a.load();
    a.add(highlight('葵'));
    await a.flush();

    expect(files.find((file) => file.name === 'annotations.json')?.content).toContain('葵');

    // The other browser has nothing cached.
    await (await readerDb()).clear('annotations');
    const b = new AnnotationsController('On Drive', drive);

    await b.load();

    expect(b.highlights$.getValue().map((h) => h.text)).toEqual(['葵']);
    expect(files.filter((file) => file.name === 'annotations.json')).toHaveLength(1);
  });

  it('merges again when another device wrote in between', async () => {
    const { files } = fakeDrive();
    const store = (await syncFileStore(drive))!;
    let other = true;

    await store.writeSyncFile('words.json', JSON.stringify({ words: ['a'] }), { version: '' });
    await syncJsonFile<{ words: string[] }>(
      store,
      'words.json',
      undefined,
      wordsList,
      async (remote) => {
        if (other) {
          other = false;
          await store.writeSyncFile('words.json', JSON.stringify({ words: ['a', 'b'] }));
        }
        return { words: [...new Set([...(remote?.words ?? []), 'c'])] };
      }
    );

    const words = files.filter((file) => file.name === 'words.json');

    expect(words).toHaveLength(1);
    expect(JSON.parse(words[0].content).words).toEqual(['a', 'b', 'c']);
  });

  // Bug: a truncated or corrupt upload made JSON.parse throw before merge, so that file never
  // synced again on any device. Then: replaced with no copy kept and nothing shown, so a folder
  // edited by hand or another sync tool lost its content without a trace.
  it('keeps a copy of a malformed remote file and lists the error before replacing it', async () => {
    const { files } = fakeDrive();
    const store = (await syncFileStore(drive))!;

    await store.writeSyncFile('words.json', '{"words": ["a"', { version: '' });
    await syncJsonFile<{ words: string[] }>(
      store,
      'words.json',
      undefined,
      wordsList,
      async (remote) => ({ words: [...(remote?.words ?? []), 'local'] })
    );

    const words = files.filter((file) => file.name === 'words.json');
    const copies = files.filter((file) => /^words\.json\.bad-\d+$/.test(file.name));

    expect(words).toHaveLength(1);
    expect(JSON.parse(words[0].content)).toEqual({ words: ['local'] });
    expect(copies.map((file) => file.content)).toEqual(['{"words": ["a"']);
    expect(syncState$.getValue().errors[0].detail).toContain(copies[0].name);
  });

  // Bug: the copy's upload fails (quota, offline mid-sync) and the original is replaced anyway,
  // so its content is gone after all.
  it('leaves a malformed file alone when its copy cannot be written', async () => {
    const { files } = fakeDrive();
    const drive$ = (await syncFileStore(drive))!;
    const store = {
      readSyncFile: drive$.readSyncFile.bind(drive$),
      writeSyncFile: (name: string, text: string, options?: object) =>
        name.includes('.bad-')
          ? Promise.reject(new Error('quota'))
          : drive$.writeSyncFile(name, text, options)
    };

    await store.writeSyncFile('words.json', '{"words": ["a"', { version: '' });
    await expect(
      syncJsonFile<{ words: string[] }>(store, 'words.json', undefined, wordsList, async () => ({
        words: ['local']
      }))
    ).rejects.toThrow('quota');

    expect(
      files.filter((file) => file.name.startsWith('words.json')).map((f) => f.content)
    ).toEqual(['{"words": ["a"']);
  });

  // Bug: a file in a newer client's format (it parses, its shape is unknown here) is merged as
  // "missing" and overwritten with the local copy: version-skew data loss on every device.
  it('never writes over a file whose shape the parser refuses, and names it', async () => {
    const { files } = fakeDrive();
    const store = (await syncFileStore(drive))!;
    const merge = vi.fn(async () => ({ words: ['local'] }));

    await store.writeSyncFile('words.json', '{"words": {"newer": true}}', { version: '' });
    await expect(
      syncJsonFile<{ words: string[] }>(store, 'words.json', undefined, wordsList, merge)
    ).rejects.toThrow('words.json');

    expect(merge).not.toHaveBeenCalled();
    expect(
      files.filter((file) => file.name.startsWith('words.json')).map((f) => f.content)
    ).toEqual(['{"words": {"newer": true}}']);
  });

  // Bug: a file that isn't there yet counts as invalid, so the first upload never happens; or an
  // empty file (a write cut off at zero bytes) gets a copy and an error for nothing.
  it('uploads over a missing or empty file without a copy', async () => {
    const { files } = fakeDrive();
    const store = (await syncFileStore(drive))!;
    const merge = async (remote?: { words: string[] }) =>
      remote ? undefined : { words: ['local'] };

    await syncJsonFile(store, 'words.json', undefined, wordsList, merge);
    await store.writeSyncFile('kanji.json', '', { version: '' });
    await syncJsonFile(store, 'kanji.json', undefined, wordsList, merge);

    expect(files.filter((file) => !file.folder).map((file) => [file.name, file.content])).toEqual([
      ['words.json', '{"words":["local"]}'],
      ['kanji.json', '{"words":["local"]}']
    ]);
  });

  // Bug: a retry loop that never gives up, or one that swallows the second conflict, so the
  // caller marks its local changes as synced when nothing was written.
  it('gives up with the conflict after one retry, merging the newest file each time', async () => {
    let writes = 0;
    const store = {
      readSyncFile: async () => ({ text: JSON.stringify({ n: writes }), version: `${writes}` }),
      writeSyncFile: async () => {
        writes += 1;
        throw new SyncConflictError();
      }
    };
    const seen: number[] = [];

    await expect(
      syncJsonFile<{ n: number }>(
        store,
        'words.json',
        undefined,
        (raw) => raw as { n: number },
        async (remote) => {
          seen.push(remote!.n);
          return { n: -1 };
        }
      )
    ).rejects.toBeInstanceOf(SyncConflictError);
    expect(seen).toEqual([0, 1]);
  });

  it("doesn't create folders for books that aren't on Drive", async () => {
    const { files } = fakeDrive();
    const store = (await syncFileStore(drive))!;

    await store.writeSyncFile('annotations.json', '{}', { title: 'Browser only', version: '' });

    expect(files.map((file) => file.name)).toEqual(['ttu-reader-data', 'On Drive']);
    expect(await store.readSyncFile('annotations.json', 'Browser only')).toBeUndefined();
  });

  it('waits for a Drive sign-in', async () => {
    storageOAuthTokens.delete(drive);

    expect(await syncFileStore(drive)).toBeUndefined();
  });
});

describe('reader files for a browser library', () => {
  it('sync with the auto-replication target, never the server signed out', () => {
    storageSource$.next(StorageKey.BROWSER);
    syncTarget$.next(drive);
    expect(readerSyncSource()).toBe('');

    autoReplication$.next(AutoReplicationType.All);
    expect(readerSyncSource()).toBe(drive);

    syncTarget$.next(StorageSourceDefault.CALIBRE_DEFAULT);
    expect(readerSyncSource()).toBe('');
    autoReplication$.next(AutoReplicationType.Off);
    syncTarget$.next('');
  });
});

describe('extra files on the server', () => {
  // One API for the block: server-api.ts keeps the catalog and the mirror per page load.
  const api = fakeApi();
  const title = 'On the server';
  const saved = (id: string, modified: number, text = id): Highlight => ({
    ...highlight(id),
    text,
    id,
    created: 1,
    modified
  });
  const puts = (start: number) =>
    api.requests.slice(start).filter((request) => !request.startsWith('GET'));

  api.addBook({ id: 7, calibreId: 107, title });

  beforeEach(() => vi.stubGlobal('fetch', api.fetch));
  afterEach(() => vi.unstubAllGlobals());

  // Bug: annotations.json written back whole would PUT every highlight on each sync (and a
  // tombstone left out of the read would bring a deleted highlight back on another device).
  it('reads highlights with their tombstones and PUTs only the changed one', async () => {
    const store = (await syncFileStore(StorageSourceDefault.CALIBRE_DEFAULT))!;

    api.setRow('highlights', { book: 7, hid: 'a', modified: 5, data: saved('a', 5) });
    api.setRow('highlights', {
      book: 7,
      hid: 'b',
      modified: 6,
      deleted: true,
      data: { ...saved('b', 6, ''), deleted: true }
    });

    const remote = (await store.readSyncFile('annotations.json', title))!;
    const { highlights } = JSON.parse(remote.text) as { highlights: Highlight[] };

    expect(highlights.map((h) => [h.id, !!h.deleted])).toEqual([
      ['a', false],
      ['b', true]
    ]);
    expect(remote.version).toBe('6');

    const start = api.requests.length;

    await store.writeSyncFile(
      'annotations.json',
      JSON.stringify({ title, highlights: [saved('a', 9, 'edited'), highlights[1]] }),
      { title, version: remote.version }
    );

    expect(puts(start)).toEqual(['PUT /api/v1/books/7/highlights/a']);
    expect(api.rowsOf('highlights').find((row) => row.hid === 'a')?.data.text).toBe('edited');
  });

  // Bug: a 409 swallowed (or retried forever) would overwrite or drop the other device's newer
  // edit of the same highlight instead of merging it once.
  it('merges the newer highlight another device saved in between, once', async () => {
    const store = (await syncFileStore(StorageSourceDefault.CALIBRE_DEFAULT))!;
    const remotes: string[][] = [];
    let other = true;

    await syncJsonFile<{ highlights?: Highlight[] }>(
      store,
      'annotations.json',
      title,
      parseAnnotations,
      async (remote) => {
        remotes.push((remote?.highlights || []).map((h) => `${h.id}:${h.text}`));
        if (other) {
          other = false;
          api.setRow('highlights', {
            book: 7,
            hid: 'c',
            modified: 20,
            data: saved('c', 20, 'theirs')
          });
        }
        return { highlights: mergeHighlights([saved('c', 10, 'mine')], remote?.highlights || []) };
      }
    );

    expect(remotes).toHaveLength(2);
    expect(remotes[1]).toContain('c:theirs');
    expect(api.rowsOf('highlights').find((row) => row.hid === 'c')?.data.text).toBe('theirs');
  });

  // Bug: a doc written with this device's Date.now() is refused (409) forever when the row came
  // from a device whose clock is ahead; it must be newer than the version it merged with.
  it('writes a doc newer than the version it merged with, even with the clock behind', async () => {
    const store = (await syncFileStore(StorageSourceDefault.CALIBRE_DEFAULT))!;
    const ahead = Date.now() + 3_600_000;

    api.setRow('bookDocs', { book: 7, kind: 'lorebook', modified: ahead, data: { entries: [] } });

    const remote = (await store.readSyncFile('lorebook.json', title))!;

    await store.writeSyncFile('lorebook.json', JSON.stringify({ entries: ['merged'] }), {
      title,
      version: remote.version
    });

    expect(remote.version).toBe(String(ahead));
    expect(api.rowsOf('bookDocs').find((row) => row.kind === 'lorebook')).toMatchObject({
      modified: ahead + 1,
      data: { entries: ['merged'] }
    });
  });

  // Bug: a title missing from the catalog (a book a friend sent) would be written to
  // `books/undefined/...` instead of staying in this browser.
  it('writes nothing for a book the server does not have', async () => {
    const store = (await syncFileStore(StorageSourceDefault.CALIBRE_DEFAULT))!;
    const start = api.requests.length;
    const options = { title: 'Sent by a friend', version: '' };

    await store.writeSyncFile(
      'annotations.json',
      JSON.stringify({ highlights: [saved('d', 1)] }),
      options
    );
    await store.writeSyncFile('recaps.json', JSON.stringify({ saved: [] }), options);

    expect(puts(start)).toEqual([]);
    expect(await store.readSyncFile('annotations.json', 'Sent by a friend')).toBeUndefined();
  });
});
