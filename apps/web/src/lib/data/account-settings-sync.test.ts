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
  openRouterApiKey$,
  openRouterModel$,
  elevenLabsApiKey$
} from '$lib/data/ai-settings';
import { theme$ } from '$lib/data/store';
import { darkTheme$ } from '$lib/data/theme/theme-store';
import { startSettingsSync, syncAccountSettings } from './account-settings-sync';

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

let remote: { values: Record<string, unknown>; modified: Record<string, number> } | undefined;
let uploads: string[] = [];

function mockServer(initial?: typeof remote) {
  remote = initial;
  uploads = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        uploads.push(String(init.body));
        remote = JSON.parse(String(init.body));
        return new Response('', { status: 201 });
      }
      return remote ? new Response(JSON.stringify(remote)) : new Response('', { status: 404 });
    })
  );
}

/** Settings as left in this browser by `owner` (undefined: before owners were recorded). */
function leaveSettingsFrom(owner: string | undefined) {
  openRouterApiKey$.next('sk-or-alice');
  elevenLabsApiKey$.next('sk_eleven_alice');
  openRouterModel$.next('model/alice');
  window.localStorage.setItem(
    'accountSettingsModified',
    JSON.stringify({ openRouterApiKey: 2000, elevenLabsApiKey: 2000, openRouterModel: 2000 })
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
  beforeEach(() => {
    window.localStorage.clear();
    // jsdom has no matchMedia (used to pick the reader profile).
    window.matchMedia = vi.fn(() => ({ matches: false }) as MediaQueryList);
  });

  afterEach(() => {
    startSettingsSync(null);
    vi.unstubAllGlobals();
  });

  it("doesn't upload or keep another account's API keys after switching accounts", async () => {
    leaveSettingsFrom('alice');
    mockServer({ values: {}, modified: {} });

    await signInAs(bob);

    expect(uploads.join()).not.toContain('sk-');
    expect(openRouterApiKey$.getValue()).toBe('');
    expect(elevenLabsApiKey$.getValue()).toBe('');
    expect(window.localStorage.getItem('openRouterApiKey')).toBeNull();
  });

  it('removes API keys from the browser when the account is signed out or expired', async () => {
    leaveSettingsFrom('alice');
    mockServer();

    await signInAs(null);

    expect(openRouterApiKey$.getValue()).toBe('');
    expect(elevenLabsApiKey$.getValue()).toBe('');
    // Non-secret settings stay.
    expect(openRouterModel$.getValue()).toBe('model/alice');
  });

  it('still syncs the same account', async () => {
    leaveSettingsFrom('alice');
    mockServer({ values: {}, modified: {} });

    await signInAs(alice);

    expect(uploads.join()).toContain('sk-or-alice');
    expect(openRouterApiKey$.getValue()).toBe('sk-or-alice');
  });

  it("doesn't adopt API keys typed while signed out", async () => {
    leaveSettingsFrom(undefined);
    mockServer({ values: {}, modified: {} });

    await signInAs(alice);

    expect(uploads.join()).not.toContain('sk-');
    expect(openRouterApiKey$.getValue()).toBe('');
    expect(openRouterModel$.getValue()).toBe('model/alice');
  });

  it('keeps API keys typed while signed out until someone signs in', async () => {
    leaveSettingsFrom(undefined);
    mockServer();

    await signInAs(null);

    expect(openRouterApiKey$.getValue()).toBe('sk-or-alice');
  });

  it("applies the new account's own keys", async () => {
    leaveSettingsFrom('alice');
    mockServer({ values: { openRouterApiKey: 'sk-or-bob' }, modified: { openRouterApiKey: 1 } });

    await signInAs(bob);

    expect(openRouterApiKey$.getValue()).toBe('sk-or-bob');
  });

  it('removes connection keys on sign-out but keeps the connections', async () => {
    aiConnections$.next([
      { id: 'g', name: 'Gemini', provider: 'gemini', kind: 'text', modified: 1 }
    ]);
    aiConnectionKeys$.next({ g: 'AIza-alice' });
    window.localStorage.setItem('accountSettingsOwner', 'alice');
    mockServer();

    await signInAs(null);

    expect(aiConnectionKeys$.getValue()).toEqual({});
    expect(window.localStorage.getItem('aiConnectionKeys')).toBeNull();
    expect(aiConnections$.getValue()).toHaveLength(1);
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
    expect(names(remote?.values.aiConnections as never)).toEqual(expected);
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
    expect(remote?.values.theme).toBe('chimi-light');
    expect(remote?.modified.darkTheme).toBe(later);
  });
});
