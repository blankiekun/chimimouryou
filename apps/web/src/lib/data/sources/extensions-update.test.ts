/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Update of a Mihon extension on the real stores (fake-indexeddb); only the app's host is stubbed.
 * Ways it could fail:
 * - another row (a second repository listing the same jar, or a row switched off) holds the old pin
 *   and its jar is deleted anyway
 * - a host refusing the install changes the row, so it points at code that was never kept
 * - an install from scratch (switching on) asks for something to be deleted
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setExtension, updateExtension, type ExtensionRow, type RepoRow } from './extensions';
import { extensionStore as db } from './local-sources';

const install = vi.hoisted(() => vi.fn());

vi.mock('./mihon-runtime', () => ({
  mihonHost: () => ({ install }),
  mihonRunsApks: () => false,
  openMihon: vi.fn()
}));

const OLD = 'a'.repeat(64);
const NEW = 'b'.repeat(64);

const entry = (id: string) => ({
  extensionType: 'mihon',
  id,
  name: id,
  lib: '1.6',
  version: '1.6.2',
  jarUrl: `https://repo.example/${id}.jar`,
  apkUrl: '',
  sources: [{ id: '1', name: id, lang: 'ja', baseUrl: 'https://site.example' }]
});

async function addRepo(url: string, ids: string[]) {
  return (await db.put('repos', {
    key: url,
    url,
    format: 'mihon',
    signingKey: 'key',
    entries: ids.map(entry),
    fetched: 0
  } as unknown as RepoRow)) as number;
}

const row = (repo: number, id: string, on = true): ExtensionRow => ({
  repo,
  id,
  on,
  code: '',
  sha256: OLD,
  version: '1.6.1'
});

const stored = (repo: number, id: string) =>
  db.one('extensions', [repo, id]) as Promise<ExtensionRow | undefined>;

beforeEach(async () => {
  for (const r of (await db.all('extensions')) as ExtensionRow[]) {
    await db.remove('extensions', [r.repo, r.id]);
  }
  for (const r of (await db.all('repos')) as RepoRow[]) await db.remove('repos', r.id);
  install.mockReset();
  install.mockResolvedValue({ sha256: NEW });
  // The index can't be read again here: the repository's stored entries stay.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
});

describe('updating a Mihon extension', () => {
  it('asks to replace the old pin when no other row holds it', async () => {
    const repo = await addRepo('https://repo.example/index.pb', ['one', 'two']);
    await db.put('extensions', row(repo, 'one'));
    await updateExtension(repo, 'one');
    expect(install).toHaveBeenCalledWith('https://repo.example/one.jar', 'key', OLD);
    expect((await stored(repo, 'one'))?.sha256).toBe(NEW);
  });

  it('keeps a pin another row holds, even one switched off in another repository', async () => {
    const repo = await addRepo('https://repo.example/index.pb', ['one']);
    const mirror = await addRepo('https://mirror.example/index.pb', ['one']);
    await db.put('extensions', row(repo, 'one'));
    await db.put('extensions', row(mirror, 'one', false));
    await updateExtension(repo, 'one');
    expect(install).toHaveBeenCalledWith('https://repo.example/one.jar', 'key', undefined);
    expect((await stored(mirror, 'one'))?.sha256).toBe(OLD);
  });

  it('a refused install leaves the row on its old pin', async () => {
    const repo = await addRepo('https://repo.example/index.pb', ['one']);
    await db.put('extensions', row(repo, 'one'));
    install.mockRejectedValue(new Error('HTTP 500'));
    await expect(updateExtension(repo, 'one')).rejects.toThrow('HTTP 500');
    expect((await stored(repo, 'one'))?.sha256).toBe(OLD);
  });

  it('switching on for the first time replaces nothing', async () => {
    const repo = await addRepo('https://repo.example/index.pb', ['one']);
    await setExtension(repo, 'one', true);
    expect(install).toHaveBeenCalledWith('https://repo.example/one.jar', 'key', undefined);
  });
});
