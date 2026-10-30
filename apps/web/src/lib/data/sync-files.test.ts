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

import { AnnotationsController, type Highlight } from '$lib/data/annotations';
import { readerDb } from '$lib/data/reader-db';
import { GDriveStorageHandler } from '$lib/data/storage/handler/gdrive-handler';
import { storageOAuthTokens } from '$lib/data/storage/storage-oauth-manager';
import { StorageKey, StorageSourceDefault } from '$lib/data/storage/storage-types';
import { storageSource$ } from '$lib/data/storage/storage-view';
import { autoReplication$, syncTarget$ } from '$lib/data/store';
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
    await syncJsonFile<{ words: string[] }>(store, 'words.json', undefined, async (remote) => {
      if (other) {
        other = false;
        await store.writeSyncFile('words.json', JSON.stringify({ words: ['a', 'b'] }));
      }
      return { words: [...new Set([...(remote?.words ?? []), 'c'])] };
    });

    const words = files.filter((file) => file.name === 'words.json');

    expect(words).toHaveLength(1);
    expect(JSON.parse(words[0].content).words).toEqual(['a', 'b', 'c']);
  });

  // Bug: a truncated or corrupt upload made JSON.parse throw before merge, so that file never
  // synced again on any device.
  it('replaces a malformed remote file with the local copy', async () => {
    const { files } = fakeDrive();
    const store = (await syncFileStore(drive))!;

    await store.writeSyncFile('words.json', '{"words": ["a"', { version: '' });
    await syncJsonFile<{ words: string[] }>(store, 'words.json', undefined, async (remote) => ({
      words: [...(remote?.words ?? []), 'local']
    }));

    const words = files.filter((file) => file.name === 'words.json');

    expect(words).toHaveLength(1);
    expect(JSON.parse(words[0].content)).toEqual({ words: ['local'] });
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
