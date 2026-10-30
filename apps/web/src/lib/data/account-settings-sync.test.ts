/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  aiConnectionKeys$,
  aiConnections$,
  askAiPresets$,
  askAiReaderNote$
} from '$lib/data/ai-settings';
import { mangaSeriesModes$ } from '$lib/data/manga';
import { fontSize$, theme$, viewMode$ } from '$lib/data/store';
import { ViewMode } from '$lib/data/view-mode';
import { customAppThemes$, darkTheme$ } from '$lib/data/theme/theme-store';
import { audiobookshelfToken$ } from '$lib/data/audiobookshelf';
import { socialSession$ } from '$lib/data/social-account';
import { homeBookTitles$, homeRemovedTitles$ } from '$lib/data/library-home';
import { dropSyncMirrors } from '$lib/data/server-api';
import { fakeApi } from '$lib/data/test-utils/fake-api';
import {
  mergeEntries,
  settingsSyncState$,
  startSettingsSync,
  syncAccountSettings
} from './account-settings-sync';

/** The library's Drive/OneDrive/folder while signed out (undefined: none) */
const folder = vi.hoisted(() => ({ files: undefined as Record<string, string> | undefined }));

vi.mock('$lib/data/sync-files', async (importOriginal) => {
  const original = await importOriginal<typeof import('$lib/data/sync-files')>();

  return {
    ...original,
    readerSyncStore: (signedIn: boolean) =>
      signedIn || !folder.files
        ? original.readerSyncStore(signedIn)
        : Promise.resolve({
            readSyncFile: async (name: string) =>
              folder.files?.[name] ? { text: folder.files[name], version: '' } : undefined,
            writeSyncFile: async (name: string, text: string) => {
              folder.files![name] = text;
            }
          })
  };
});

const hubSession = (id: string) => ({
  token: `hub-token-${id}`,
  me: { id, username: id, name: id, avatar: 0, code: 'K7QM2XPA', share: {}, created: 1 }
});

// jsdom has no matchMedia; the theme store reads the system colour scheme on import.
vi.hoisted(() => {
  window.matchMedia ??= ((query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {}
    }) as never) as never;
});

const alice = { id: 'alice', username: 'alice' };
const bob = { id: 'bob', username: 'bob' };

type SettingsDoc = { values: Record<string, any>; modified: Record<string, number> } & Record<
  string,
  any
>;

// One API for the file: server-api.ts keeps the mirror per page load. The session check finds no
// account here, so the settings live in the shared '' account's docs.
const api = fakeApi();
let uploads: string[] = [];

const remote = () => api.doc('settings') as SettingsDoc | undefined;
let later = 0;

/** The settings doc as another device left it (always newer than what this browser uploaded). */
function setRemote(data: unknown) {
  later += 100_000;
  api.setRow('accountDocs', { kind: 'settings', modified: Date.now() + later, data });
}

function mockServer(initial?: Omit<SettingsDoc, 'version'>) {
  uploads = [];
  if (initial) api.setRow('accountDocs', { kind: 'settings', modified: 1, data: initial });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') uploads.push(String(init.body));
      return api.fetch(url, init);
    })
  );
}

const openRouter = {
  id: 'or',
  name: 'OpenRouter',
  provider: 'openrouter',
  kind: 'text',
  modified: 1
} as const;
const elevenLabs = {
  id: 'el',
  name: 'ElevenLabs',
  provider: 'elevenlabs',
  kind: 'voice',
  modified: 1
} as const;

/** Settings as left in this browser by `owner` (undefined: before owners were recorded). */
function leaveSettingsFrom(owner: string | undefined) {
  aiConnections$.next([openRouter, elevenLabs]);
  aiConnectionKeys$.next({ or: 'sk-or-alice', el: 'sk_eleven_alice' });
  audiobookshelfToken$.next('abs-alice');
  askAiReaderNote$.next('note/alice');
  window.localStorage.setItem(
    'accountSettingsModified',
    JSON.stringify({ aiConnections: 2000, audiobookshelfToken: 2000, askAiReaderNote: 2000 })
  );
  if (owner) {
    window.localStorage.setItem('accountSettingsOwner', owner);
  }
}

async function signInAs(user: typeof alice | null) {
  startSettingsSync(user);
  await syncAccountSettings();
}

describe('account settings sync', () => {
  beforeEach(async () => {
    // A new server database and no mirror of the old one (a mirror only starts over on a lower rev).
    api.reset();
    await dropSyncMirrors('none');
    window.localStorage.clear();
    folder.files = undefined;
    // jsdom has no matchMedia (used to pick the reader profile).
    window.matchMedia = vi.fn(() => ({ matches: false }) as MediaQueryList);
  });

  afterEach(() => {
    startSettingsSync(null);
    vi.unstubAllGlobals();
  });

  it("doesn't upload or keep another account's tokens after switching accounts", async () => {
    leaveSettingsFrom('alice');
    mockServer({ values: {}, modified: {} });

    await signInAs(bob);

    expect(uploads.join()).not.toContain('abs-alice');
    expect(audiobookshelfToken$.getValue()).toBe('');
    expect(window.localStorage.getItem('audiobookshelfToken')).toBeNull();
  });

  it('removes tokens from the browser when the account is signed out or expired', async () => {
    leaveSettingsFrom('alice');
    mockServer();

    await signInAs(null);

    expect(audiobookshelfToken$.getValue()).toBe('');
    expect(window.localStorage.getItem('audiobookshelfToken')).toBeNull();
    // Non-secret settings stay, and AI keys belong to the browser, not the account.
    expect(aiConnectionKeys$.getValue().or).toBe('sk-or-alice');
    expect(aiConnections$.getValue()).toHaveLength(2);
    expect(askAiReaderNote$.getValue()).toBe('note/alice');
  });

  // Catches an AI key reaching the server, or another account's sign-in taking this browser's keys.
  it('never uploads AI keys, keeps them across accounts and drops the account copy', async () => {
    leaveSettingsFrom('alice');
    mockServer({
      values: { aiConnections: [openRouter], aiConnectionKeys: { or: 'sk-or-bob' } },
      modified: { aiConnections: 1, aiConnectionKeys: 1 }
    });

    await signInAs(bob);

    expect(aiConnectionKeys$.getValue()).toEqual({ or: 'sk-or-alice', el: 'sk_eleven_alice' });
    expect(uploads.join()).not.toContain('sk-');
    expect(remote()?.values).not.toHaveProperty('aiConnectionKeys');
  });

  it('merges connections per id with the account', async () => {
    aiConnections$.next([
      { id: 'a', name: 'mine, newer', provider: 'groq', kind: 'text', modified: 5 },
      { id: 'b', name: 'b', provider: 'groq', kind: 'text', modified: 1 }
    ]);
    window.localStorage.setItem('accountSettingsModified', JSON.stringify({ aiConnections: 1 }));
    mockServer({
      values: {
        aiConnections: [
          { id: 'a', name: 'theirs, older', provider: 'groq', kind: 'text', modified: 2 },
          { id: 'b', name: 'b', provider: 'groq', kind: 'text', modified: 3, deleted: true },
          { id: 'c', name: 'c', provider: 'groq', kind: 'text', modified: 1 }
        ]
      },
      modified: { aiConnections: 9 }
    });

    await signInAs(alice);

    const names = (list: { id: string; name: string; deleted?: boolean }[]) =>
      list.map((c) => `${c.id}:${c.name}${c.deleted ? ':deleted' : ''}`);
    const expected = ['a:mine, newer', 'b:b:deleted', 'c:c'];

    expect(names(aiConnections$.getValue())).toEqual(expected);
    expect(names(remote()?.values.aiConnections as never)).toEqual(expected);
  });

  it("keeps both devices' new Home books", async () => {
    const connection = (id: string, modified: number) => ({
      id,
      name: id,
      provider: 'groq',
      kind: 'text' as const,
      modified
    });

    // The account's Home lost 'gone' on another device.
    aiConnections$.next([connection('y', 5)]);
    homeBookTitles$.next(['mine', 'gone']);
    homeRemovedTitles$.next({ mine: -5 });
    window.localStorage.setItem('accountSettingsOwner', 'alice');
    window.localStorage.setItem(
      'accountSettingsModified',
      JSON.stringify({ aiConnections: 5, homeBookTitles: 5 })
    );
    mockServer({
      values: {
        aiConnections: [connection('x', 3), { ...connection('z', 4), deleted: true }],
        homeBookTitles: ['theirs'],
        homeRemovedTitles: { gone: 4 }
      },
      modified: { aiConnections: 4, homeBookTitles: 4, homeRemovedTitles: 4 }
    });

    await signInAs(alice);

    expect(homeBookTitles$.getValue()).toEqual(['mine', 'theirs']);
    expect(remote()?.values.homeBookTitles).toEqual(['mine', 'theirs']);
  });

  it('moves the account from the old default themes to chimi-light, but keeps a later choice', async () => {
    const later = Date.UTC(2026, 10, 1);
    mockServer({
      values: { theme: 'washi-theme', darkTheme: 'washi-dark-theme' },
      modified: { theme: Date.UTC(2026, 9, 12), darkTheme: later }
    });

    await signInAs(alice);

    expect(theme$.getValue()).toBe('chimi-light');
    expect(darkTheme$.getValue()).toBe('washi-dark-theme');
    expect(remote()?.values.theme).toBe('chimi-light');
    expect(remote()?.modified.darkTheme).toBe(later);
  });

  it('syncs the hub sign-in to the account, so its other browsers are signed in', async () => {
    window.localStorage.setItem('accountSettingsOwner', 'alice');
    socialSession$.next(hubSession('aki'));
    mockServer({ values: {}, modified: {} });

    await signInAs(alice);
    expect(uploads.join()).toContain('hub-token-aki');

    // Another browser of the same account
    window.localStorage.clear();
    socialSession$.next(null);
    await signInAs(alice);
    expect(socialSession$.getValue()?.token).toBe('hub-token-aki');
  });

  it("forgets the account's hub sign-in on sign-out and on another account", async () => {
    window.localStorage.setItem('accountSettingsOwner', 'alice');
    socialSession$.next(hubSession('aki'));
    mockServer();

    await signInAs(null);
    expect(socialSession$.getValue()).toBeNull();
    expect(window.localStorage.getItem('socialSession')).toBeNull();

    window.localStorage.setItem('accountSettingsOwner', 'alice');
    socialSession$.next(hubSession('aki'));
    mockServer({ values: {}, modified: {} });

    await signInAs(bob);
    expect(socialSession$.getValue()).toBeNull();
    expect(uploads.join()).not.toContain('hub-token');
  });

  it('keeps a hub sign-in made while signed out in this browser, never in the folder', async () => {
    folder.files = {};
    askAiReaderNote$.next('note/ren');
    socialSession$.next(hubSession('ren'));
    mockServer();

    await signInAs(null);
    expect(socialSession$.getValue()?.token).toBe('hub-token-ren');
    expect(folder.files['settings.json']).toBeDefined();
    expect(folder.files['settings.json']).not.toContain('hub-token');
    expect(folder.files['settings.json']).not.toContain('socialSession');
  });

  it('merges presets, custom themes and series modes per entry, deletions included', async () => {
    const preset = (id: string) => ({ id, label: id, prompt: id });
    const theme = { name: 'x' } as never;

    window.localStorage.setItem('accountSettingsOwner', 'alice');
    askAiPresets$.next([preset('a')]);
    customAppThemes$.next({ old: theme });
    mockServer({
      values: {
        askAiPresets: [preset('a'), preset('theirs')],
        customAppThemes: { old: theme, keep: theme },
        mangaSeriesModes: { s1: 'rtl' }
      },
      modified: { askAiPresets: 4, customAppThemes: 4, mangaSeriesModes: 4 }
    });
    await signInAs(alice);
    expect(askAiPresets$.getValue().map(({ id }) => id)).toEqual(['a', 'theirs']);

    // This browser adds a preset, deletes a theme and sets a series; another device does too.
    askAiPresets$.next([...askAiPresets$.getValue(), preset('mine')]);
    customAppThemes$.next({ keep: theme });
    mangaSeriesModes$.next({ ...mangaSeriesModes$.getValue(), s2: 'ltr' });
    const doc = remote()!;
    const values = {
      ...doc.values,
      askAiPresets: [...doc.values.askAiPresets, preset('other')],
      mangaSeriesModes: { s1: 'vertical' }
    };
    const entryModified = {
      ...doc.entryModified,
      askAiPresets: { other: Date.now() + 1000 },
      mangaSeriesModes: { s1: Date.now() + 1000 }
    };
    setRemote({ ...doc, values, entryModified });
    await syncAccountSettings();

    expect(askAiPresets$.getValue().map(({ id }) => id)).toEqual(['a', 'theirs', 'mine', 'other']);
    expect(customAppThemes$.getValue()).toEqual({ keep: theme });
    expect(mangaSeriesModes$.getValue()).toEqual({ s1: 'vertical', s2: 'ltr' });
    expect(remote()?.values.customAppThemes).toEqual({ keep: theme });
    expect(remote()!.entryModified.customAppThemes.old).toBeLessThan(0);

    // Another device deletes this browser's preset later: the deletion wins here too.
    const stored = remote()!;
    setRemote({
      ...stored,
      values: {
        ...stored.values,
        askAiPresets: stored.values.askAiPresets.filter(({ id }: { id: string }) => id !== 'mine')
      },
      entryModified: {
        ...stored.entryModified,
        askAiPresets: { ...stored.entryModified.askAiPresets, mine: -(Date.now() + 2000) }
      }
    });
    await syncAccountSettings();
    expect(askAiPresets$.getValue().map(({ id }) => id)).toEqual(['a', 'theirs', 'other']);
  });

  // Bug: a failed upload after the merge marks the edit as synced, so it is never uploaded.
  it('uploads an edit on the next sync after a failed or unreachable PUT', async () => {
    window.localStorage.setItem('accountSettingsOwner', 'alice');
    mockServer({ values: { askAiReaderNote: 'old' }, modified: { askAiReaderNote: 1 } });
    await signInAs(alice);

    const respond = vi.mocked(fetch).getMockImplementation()!;
    askAiReaderNote$.next('edited');
    vi.mocked(fetch).mockImplementation(async (url, init) =>
      init?.method === 'PUT' ? new Response('', { status: 503 }) : respond(url as string, init)
    );
    await syncAccountSettings();
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (init?.method === 'PUT') throw new TypeError('Failed to fetch');
      return respond(url as string, init);
    });
    await syncAccountSettings();

    expect(remote()?.values.askAiReaderNote).toBe('old');
    expect(askAiReaderNote$.getValue()).toBe('edited');

    vi.mocked(fetch).mockImplementation(respond);
    await syncAccountSettings();

    expect(remote()?.values.askAiReaderNote).toBe('edited');
  });

  // Bug: a sync started while another one's upload is in flight reads the old file, and the
  // slower upload then overwrites the edit the second one carried.
  it('keeps an edit made while an upload is in flight when a second sync starts', async () => {
    window.localStorage.setItem('accountSettingsOwner', 'alice');
    mockServer({ values: { askAiReaderNote: 'old' }, modified: { askAiReaderNote: 1 } });
    await signInAs(alice);

    const respond = vi.mocked(fetch).getMockImplementation()!;
    let second: Promise<void> | undefined;

    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (init?.method === 'PUT' && !second) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        askAiReaderNote$.next('second');
        second = syncAccountSettings();
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return respond(url as string, init);
    });
    askAiReaderNote$.next('first');
    await syncAccountSettings();
    await second;

    expect(remote()?.values.askAiReaderNote).toBe('second');
    expect(askAiReaderNote$.getValue()).toBe('second');
  });

  it('gives a same-time tie to the deletion', () => {
    expect(mergeEntries({ a: 1 }, {}, { a: 5 }, { a: -5 }).merged).toEqual({});
    expect(mergeEntries({}, { a: 1 }, { a: -5 }, { a: 5 }).merged).toEqual({});
  });

  it("drops the old AI settings' keys from the account's copy", async () => {
    window.localStorage.setItem('accountSettingsOwner', 'alice');
    mockServer({
      values: { openRouterApiKey: 'sk-old', elevenLabsModel: 'eleven_v3' },
      modified: { openRouterApiKey: 4, elevenLabsModel: 4 }
    });
    await signInAs(alice);
    expect(remote()?.values).not.toHaveProperty('openRouterApiKey');
    expect(remote()?.values).not.toHaveProperty('elevenLabsModel');
    expect(remote()?.modified).not.toHaveProperty('openRouterApiKey');
  });

  /*
   * How a malformed synced value could still do harm:
   * - a newer null/unknown value is applied (font-size: nullpx, an unknown view mode);
   * - it is "healed" by uploading the local value over it, which would also overwrite a value a
   *   newer client understands and this one doesn't;
   * - a non-array entry setting (Ask AI presets) throws in the merge, so settings sync fails forever,
   *   or is read as empty and deletes the local entries whose newer times sit in the file;
   * - a connection the merge can't use (no id) breaks the merge, or one of an unknown provider is
   *   dropped and then deleted from the file for every device.
   */
  it('ignores malformed newer values, keeps local ones and leaves the file alone', async () => {
    const preset = (id: string) => ({ id, label: id, prompt: id });
    const later = Date.now() + 100_000;

    window.localStorage.setItem('accountSettingsOwner', 'alice');
    askAiPresets$.next([preset('mine')]);
    fontSize$.next(24);
    viewMode$.next(ViewMode.Continuous);
    mockServer({ values: {}, modified: {} });
    await signInAs(alice);

    setRemote({
      ...remote(),
      values: {
        ...remote()!.values,
        askAiPresets: { x: 1 },
        'reader.desktop.fontSize': null,
        'reader.desktop.viewMode': 'sideways'
      },
      modified: {
        ...remote()!.modified,
        askAiPresets: later,
        'reader.desktop.fontSize': later,
        'reader.desktop.viewMode': later
      },
      entryModified: { askAiPresets: { mine: later } }
    });
    await syncAccountSettings();

    expect(settingsSyncState$.getValue().state).toBe('synced');
    expect(askAiPresets$.getValue().map(({ id }) => id)).toEqual(['mine']);
    expect(fontSize$.getValue()).toBe(24);
    expect(viewMode$.getValue()).toBe(ViewMode.Continuous);
    expect(remote()?.values['reader.desktop.viewMode']).toBe('sideways');
    expect(remote()?.values['reader.desktop.fontSize']).toBeNull();
  });

  it('merges the usable connections of a malformed list and keeps unknown providers', async () => {
    const connection = { id: 'x', name: 'x', provider: 'groq', kind: 'text', modified: 1 } as const;
    const unknown = {
      id: 'new',
      name: 'new',
      provider: 'from-a-newer-client',
      kind: 'text',
      modified: 2
    };

    window.localStorage.setItem('accountSettingsOwner', 'alice');
    aiConnections$.next([connection]);
    window.localStorage.setItem('accountSettingsModified', JSON.stringify({ aiConnections: 1 }));
    mockServer({
      values: { aiConnections: [unknown, { name: 'no id' }, 'junk'] },
      modified: { aiConnections: 5 }
    });

    await signInAs(alice);

    expect(settingsSyncState$.getValue().state).toBe('synced');
    expect(aiConnections$.getValue().map(({ id }) => id)).toEqual(['new', 'x']);
    expect((remote()?.values.aiConnections as { id: string }[]).map(({ id }) => id)).toEqual([
      'new',
      'x'
    ]);
  });

  it('keeps settings sync running when the whole connection list is malformed', async () => {
    window.localStorage.setItem('accountSettingsOwner', 'alice');
    mockServer({
      values: { aiConnections: { y: 1 }, askAiReaderNote: 'theirs' },
      modified: { aiConnections: 5, askAiReaderNote: 5 }
    });

    await signInAs(alice);

    expect(settingsSyncState$.getValue().state).toBe('synced');
    expect(askAiReaderNote$.getValue()).toBe('theirs');
    expect(remote()?.values.aiConnections).toEqual({ y: 1 });
  });
});
