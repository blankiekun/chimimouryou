/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { StorageKey } from '$lib/data/storage/storage-types';
import { vnElementHtml } from '$lib/data/vn';
import { vnsKeptOnDevice, vnUploadQuestion } from '$lib/data/vn-upload';

vi.mock('$lib/functions/file-loaders/cbz/load-cbz', () => ({
  default: async (file: File) => ({
    title: file.name.replace('.zip', ''),
    styleSheet: '',
    elementHtml: file.name.startsWith('game')
      ? vnElementHtml({ encoding: 'sjis', files: [] } as any)
      : '<!--ttu-manga-->[]',
    blobs: {},
    coverImage: '',
    hasThumb: true,
    characters: 1,
    lastBookModified: 0,
    lastBookOpen: 0
  })
}));

await import('$lib/data/storage/storage-handler-factory');
const { importData } = await import('$lib/functions/replication/replicator');

const game = { name: 'game.zip', size: 1.8 * 1024 ** 3 };

describe('vnsKeptOnDevice', () => {
  it('keeps the games on the device when the reader says so', async () => {
    const ask = vi.fn(async () => false);

    expect(await vnsKeptOnDevice(StorageKey.GDRIVE, [game], ask)).toEqual(new Set(['game.zip']));
    expect(ask).toHaveBeenCalledWith([game], StorageKey.GDRIVE);
  });

  it('uploads them when the reader chooses Upload', async () => {
    expect(await vnsKeptOnDevice(StorageKey.ONEDRIVE, [game], async () => true)).toEqual(new Set());
  });

  it('never asks for Calibre, folders or without games', async () => {
    const ask = vi.fn(async () => false);

    for (const target of [StorageKey.CALIBRE, StorageKey.FS, StorageKey.BROWSER]) {
      expect(await vnsKeptOnDevice(target, [game], ask)).toEqual(new Set());
    }

    expect(await vnsKeptOnDevice(StorageKey.GDRIVE, [], ask)).toEqual(new Set());
    expect(ask).not.toHaveBeenCalled();
  });

  it('names the game and its size', () => {
    expect(vnUploadQuestion([game], StorageKey.GDRIVE)).toEqual({
      dialogHeader: 'Upload this game to Google Drive?',
      dialogMessage:
        'game.zip is 1.8 GB. Uploading takes a while and uses that much of your Google Drive space; you can keep it on this device only.'
    });
  });
});

describe('importData with games kept on the device', () => {
  function target() {
    return {
      storageType: StorageKey.GDRIVE,
      isCacheDisabled: () => false,
      startContext: vi.fn(),
      saveCover: vi.fn(),
      saveBook: vi.fn(async (_book: unknown) => 0),
      keepOnDevice: vi.fn(async (_book: unknown) => 7)
    };
  }

  const files = () => [new File(['x'], 'game.zip'), new File(['x'], 'manga.zip')];

  it('saves a kept game in the browser and uploads the rest', async () => {
    const handler = target();

    await importData(
      document,
      handler as any,
      files(),
      new AbortController().signal,
      undefined,
      new Set(['game.zip', 'manga.zip'])
    );

    expect(handler.keepOnDevice).toHaveBeenCalledTimes(1);
    expect(handler.keepOnDevice.mock.calls[0][0]).toMatchObject({ title: 'game' });
    // A manga is never kept back, even if named.
    expect(handler.saveBook).toHaveBeenCalledTimes(1);
    expect(handler.saveBook.mock.calls[0][0]).toMatchObject({ title: 'manga' });
  });

  it('uploads games the reader chose to upload', async () => {
    const handler = target();

    await importData(
      document,
      handler as any,
      files(),
      new AbortController().signal,
      undefined,
      new Set()
    );

    expect(handler.keepOnDevice).not.toHaveBeenCalled();
    expect(handler.saveBook).toHaveBeenCalledTimes(2);
  });
});
