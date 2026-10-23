/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { StorageKey } from '$lib/data/storage/storage-types';
import { isVn, vnElementHtml, vnInfo } from '$lib/data/vn';
import { vnFolders, vnsKeptOnDevice, vnUploadQuestion } from '$lib/data/vn-upload';

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
      [],
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
      [],
      new Set()
    );

    expect(handler.keepOnDevice).not.toHaveBeenCalled();
    expect(handler.saveBook).toHaveBeenCalledTimes(2);
  });
});

describe('game folders among picked files', () => {
  /** A file as a folder pick gives it: its path from the picked folder */
  const picked = (path: string, text = 'x') => {
    const file = new File([text], path.split('/').pop()!);

    Object.defineProperty(file, 'webkitRelativePath', { value: path });
    // jsdom's Blob has no arrayBuffer().
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode(text).buffer
    });
    return file;
  };
  const pick = () => [
    picked('Books/novel.epub'),
    picked('Books/Game/0.txt', '*define\ngame\n*start\n「こんにちは」\\\nend'),
    picked('Books/Game/arc.nsa', 'archive'),
    picked('Books/Game/bgm/title.ogg'),
    picked('Books/Game/save/1.txt'),
    picked('Books/Game/.DS_Store'),
    picked('Books/notes.txt')
  ];

  it('makes one game of each folder holding a script, the rest stay files', () => {
    const { games, rest } = vnFolders(pick());

    expect(rest.map((file) => file.webkitRelativePath)).toEqual([
      'Books/novel.epub',
      'Books/notes.txt'
    ]);
    expect(games).toHaveLength(1);
    expect(games[0].name).toBe('Game');
    expect(Object.keys(games[0].files)).toEqual([
      '0.txt',
      'arc.nsa',
      'bgm/title.ogg',
      'save/1.txt'
    ]);
    expect(games[0].size).toBe(Object.values(games[0].files).reduce((n, f) => n + f.size, 0));
  });

  it('leaves loose scripts and plain files alone', () => {
    expect(vnFolders([new File(['x'], '0.txt'), new File(['x'], 'a.epub')]).games).toEqual([]);
  });

  it('imports a game folder as one visual novel, kept on the device when asked', async () => {
    const handler = {
      storageType: StorageKey.GDRIVE,
      isCacheDisabled: () => false,
      startContext: vi.fn(),
      saveCover: vi.fn(),
      saveBook: vi.fn(async (_book: unknown) => 0),
      keepOnDevice: vi.fn(async (_book: unknown) => 7)
    };
    const { games } = vnFolders(pick());
    const titles: string[] = [];

    await importData(
      document,
      handler as any,
      games,
      new AbortController().signal,
      undefined,
      titles,
      new Set(['Game'])
    );

    expect(handler.saveBook).not.toHaveBeenCalled();
    expect(handler.keepOnDevice).toHaveBeenCalledTimes(1);

    const book = handler.keepOnDevice.mock.calls[0][0] as any;

    expect(titles).toEqual(['Game']);
    expect(book.title).toBe('Game');
    expect(isVn(book)).toBe(true);
    expect(vnInfo(book).files).toEqual(['0.txt', 'arc.nsa', 'bgm/title.ogg', 'save/1.txt']);
    expect(book.blobs['arc.nsa']).toBe(games[0].files['arc.nsa']);
    expect(book.characters).toBeGreaterThan(0);
  });
});
