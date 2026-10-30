/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { StorageKey } from '$lib/data/storage/storage-types';

await import('$lib/data/storage/storage-handler-factory');
const { FilesystemStorageHandler } = await import('./filesystem-handler');
const { SyncConflictError } = await import('./base-handler');

let clock = 1000;

/** The part of FileSystemDirectoryHandle the sync-file methods use; each write bumps lastModified. */
class FakeDirectory {
  files = new Map<string, { text: string; lastModified: number }>();

  async getDirectoryHandle(): Promise<never> {
    throw new DOMException('', 'NotFoundError');
  }

  async getFileHandle(name: string, { create = false } = {}) {
    if (!this.files.has(name)) {
      if (!create) throw new DOMException(name, 'NotFoundError');
      this.files.set(name, { text: '', lastModified: (clock += 1) });
    }

    const files = this.files;

    return {
      getFile: async () => {
        const entry = files.get(name)!;

        return { text: async () => entry.text, lastModified: entry.lastModified };
      },
      createWritable: async () => {
        let text = '';

        return {
          write: async (chunk: string) => {
            text += chunk;
          },
          close: async () => files.set(name, { text, lastModified: (clock += 1) })
        };
      }
    };
  }
}

describe('FilesystemStorageHandler sync files', () => {
  // Bug: two devices sharing the folder overwrite each other's merged sync file without noticing.
  it('rejects a write made with a stale version and accepts one made with the current version', async () => {
    const handler = new FilesystemStorageHandler(window, StorageKey.FS);
    const root = new FakeDirectory();

    (handler as any).rootDirectory = root;

    await handler.writeSyncFile('extras.json', '{"a":1}', { version: '' });

    const first = await handler.readSyncFile('extras.json');

    // Another device writes after we read.
    await handler.writeSyncFile('extras.json', '{"b":2}');

    await expect(
      handler.writeSyncFile('extras.json', '{"a":1,"c":3}', { version: first!.version })
    ).rejects.toBeInstanceOf(SyncConflictError);
    expect(root.files.get('extras.json')!.text).toBe('{"b":2}');

    const current = await handler.readSyncFile('extras.json');

    await handler.writeSyncFile('extras.json', '{"b":2,"c":3}', { version: current!.version });
    expect((await handler.readSyncFile('extras.json'))!.text).toBe('{"b":2,"c":3}');
  });
});
