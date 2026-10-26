/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('standalone edition', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_EDITION', 'standalone');
    vi.stubGlobal('fetch', fetchMock);
    // A Calibre source saved by a server build on the same origin.
    window.localStorage.setItem('lastStorageSource', 'calibre');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    window.localStorage.clear();
  });

  it('offers no Calibre source and starts on Browser', async () => {
    const view = await import('$lib/data/storage/storage-view');

    expect(view.calibreSourceAvailable).toBe(false);
    expect(view.browserSourceAvailable).toBe(true);
    expect(view.storageSource$.getValue()).toBe('browser');
  });

  it('never asks the server for the catalog, estimates or the session', async () => {
    const calibre = await import('$lib/data/calibre');
    const account = await import('$lib/data/account');
    const { loadSeriesOverrides } = await import('$lib/data/series-overrides');
    const { loadBookMetadata } = await import('$lib/data/book-metadata');

    expect(await calibre.loadCalibreCatalog()).toEqual([]);
    expect(await calibre.loadCalibreDifficulty()).toEqual({});
    expect(await loadSeriesOverrides()).toEqual({});
    expect(await loadBookMetadata()).toEqual({});
    expect(await account.accountReady()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing to the social hub before signing up, or while social is off', async () => {
    const social = await import('$lib/data/social');
    const { activePlugins } = await import('$lib/plugins');

    await social.loadFriends();
    activePlugins().forEach((plugin) => plugin.onBookLeft?.('本', 10, 100));
    expect(fetchMock).not.toHaveBeenCalled();

    window.localStorage.setItem(
      'socialSession',
      JSON.stringify({ token: 't', me: { id: 'a', share: {} } })
    );
    vi.resetModules();
    const plugins = await import('$lib/plugins');

    plugins.setPluginEnabled('social', false);
    plugins.activePlugins().forEach((plugin) => plugin.onBookLeft?.('本', 10, 100));
    expect(fetchMock).not.toHaveBeenCalled();
    // Signed in with social on, leaving a book reports it.
    plugins.setPluginEnabled('social', true);
    plugins.activePlugins().forEach((plugin) => plugin.onBookLeft?.('本', 10, 100));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The first import of the plugins pulls in most of the app: slow on CI runners.
  }, 15_000);

  it('reads Community anonymously only when asked, never with social off, and writes nothing signed out', async () => {
    fetchMock.mockImplementation(async () => new Response('{"posts":[],"next":null}'));

    const community = await import('$lib/data/community');
    const plugins = await import('$lib/plugins');

    // Loading the module (as the app does) asks nothing.
    await community.resolveWork('本 3', '');
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(community.replyTo('0123456789abcdef', 'x')).rejects.toMatchObject({
      status: 401
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // Opening the Community tab signed out: a public read, without a token.
    await community.loadFeed();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
    plugins.setPluginEnabled('social', false);
    await expect(community.loadFeed()).rejects.toMatchObject({ code: 'off' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks the hub nothing for Community replies or line links signed out, or with social off', async () => {
    const book = await import('$lib/data/community-book');
    const plugins = await import('$lib/plugins');

    // Home's replies need a hub account; a line link with social off goes nowhere.
    await book.refreshNotes();
    plugins.setPluginEnabled('social', false);
    expect(
      await book.lineLinkTarget(new URLSearchParams({ line: 'a'.repeat(32), work: 'anilist:1' }))
    ).toBeNull();
    window.localStorage.setItem(
      'socialSession',
      JSON.stringify({ token: 't', me: { id: 'a', share: {} } })
    );
    vi.resetModules();
    await (await import('$lib/data/community-book')).refreshNotes();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens a matched book signed out with one anonymous threads GET, and nothing with social off', async () => {
    window.localStorage.setItem('communityWorks', JSON.stringify({ 本: 'anilist:1' }));
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ threads: [], next: null }))
    );

    const plugins = await import('$lib/plugins');
    const { markBookOnOpen } = await import('$lib/data/community-book');
    const getIndex = async () => ({ paragraphs: [{ text: '本文の一行目です。', startCount: 0 }] });

    plugins.setPluginEnabled('social', false);
    await markBookOnOpen('本', getIndex as never);
    expect(fetchMock).not.toHaveBeenCalled();

    plugins.setPluginEnabled('social', true);
    await markBookOnOpen('本', getIndex as never);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];

    expect(String(url)).toContain('/v1/community/threads?');
    expect(JSON.stringify(init?.headers ?? {})).not.toContain('Bearer');
  });

  it('takes the public word test without a request, and saves the result for the app', async () => {
    const { default: PlacementTest } = await import(
      '$lib/components/placement/placement-test.svelte'
    );
    const placement = await import('$lib/data/placement');
    const target = document.createElement('div');
    const test = new PlacementTest({ target, props: { shared: true } });
    const click = async (text: string) => {
      [...target.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!.click();
      await Promise.resolve();
    };

    await click('Start');
    for (let i = 0; i < placement.placementLength; i += 1) {
      const word = target.querySelector('.placement-word')!.textContent!.trim();
      const real = placement.placementList.find((item) => item.w === word)!.r;

      await click(real && real <= 8000 ? 'I know it' : 'Don’t know');
    }

    expect(target.querySelector('.placement-big')?.textContent).toMatch(/About [\d,]+ words/);
    expect(placement.placementCutoff()).toBeGreaterThan(5000);
    expect(placement.placementFromWordTest$.getValue()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    test.$destroy();
  });

  it('takes the hard word test without a request, and keeps its result apart', async () => {
    const { default: PlacementTest } = await import(
      '$lib/components/placement/placement-test.svelte'
    );
    const placement = await import('$lib/data/placement');
    const items = await placement.loadHardItems();
    const target = document.createElement('div');
    // Connected, so its form submits.
    document.body.append(target);
    const test = new PlacementTest({ target, props: { shared: true, hard: true } });
    const click = async (text: string) => {
      [...target.querySelectorAll('button')]
        .find((b) => b.textContent?.trim().endsWith(text))!
        .click();
      await new Promise((resolve) => setTimeout(resolve));
    };

    await click('Start');
    // Start loads the items with a dynamic import, which can take more than one task.
    await vi.waitFor(() => expect(target.querySelector('.placement-word')).not.toBeNull());
    for (let i = 0; i < placement.placementLength; i += 1) {
      const word = target.querySelector('.placement-word')!.textContent!.trim();
      const item = items.find((entry) => entry.w === word)!;

      if (item.r! > 8000) {
        await click('I don’t know');
      } else {
        const input = target.querySelector<HTMLInputElement>('.hard-input')!;

        input.value = item.k[0];
        input.dispatchEvent(new Event('input'));
        await new Promise((resolve) => setTimeout(resolve));
        await click('Next');
        await click(item.m[0]);
      }
    }

    expect(target.querySelector('.placement-big')?.textContent).toMatch(/About [\d,]+ words/);
    expect(target.querySelector('.placement-credits')?.textContent).toContain('Wiktionary');
    expect(
      placement.latestPlacement(placement.placementResults$.getValue(), 'typed')?.cutoff
    ).toBeGreaterThan(5000);
    expect(fetchMock).not.toHaveBeenCalled();
    test.$destroy();
    target.remove();
  });

  it('hands out the browser handler for Calibre', async () => {
    const { getStorageHandler } = await import('$lib/data/storage/storage-handler-factory');
    const { StorageKey } = await import('$lib/data/storage/storage-types');

    expect(getStorageHandler(window, StorageKey.CALIBRE)).toBe(
      getStorageHandler(window, StorageKey.BROWSER)
    );
  });

  describe('connected to a server', () => {
    beforeEach(() => {
      window.localStorage.setItem('serverBase', 'https://books.example');
      window.localStorage.setItem('serverToken', 'secret-token');
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ books: [] })));
    });

    it('offers the Calibre source and reads the catalog with the token, without cookies', async () => {
      const view = await import('$lib/data/storage/storage-view');
      const calibre = await import('$lib/data/calibre');

      expect(view.calibreSourceAvailable).toBe(true);
      await calibre.loadCalibreCatalog();

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://books.example/calibre/catalog.json');
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret-token');
      expect(init.credentials).toBe('omit');
      expect(url).not.toContain('secret-token');
    });

    it('lists game folders with the token, without cookies', async () => {
      fetchMock.mockResolvedValue(new Response('[]'));
      const { vnFolderSize } = await import('$lib/functions/file-loaders/vn/load-vn');

      expect(await vnFolderSize('/calibre/vn/G/')).toBe(0);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://books.example/calibre/vn/G/');
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret-token');
      expect(init.credentials).toBe('omit');
    });

    it('leaves other URLs alone', async () => {
      const { serverUrl } = await import('$lib/data/server-connect');

      expect(serverUrl('/calibre/sync/a')).toBe('https://books.example/calibre/sync/a');
      expect(serverUrl('/jiten/search')).toBe('/jiten/search');
      expect(serverUrl('https://api.example/calibre/x')).toBe('https://api.example/calibre/x');
    });

    it('is ignored by the self-hosted build', async () => {
      vi.stubEnv('VITE_EDITION', '');
      const { serverConnected, serverUrl } = await import('$lib/data/server-connect');

      expect(serverConnected).toBe(false);
      expect(serverUrl('/calibre/catalog.json')).toBe('/calibre/catalog.json');
    });
  });

  it('accepts only https server addresses', async () => {
    const { serverOrigin } = await import('$lib/data/server-connect');

    expect(serverOrigin('books.example/')).toBe('https://books.example');
    expect(serverOrigin(' https://books.example:8443/x ')).toBe('https://books.example:8443');
    expect(() => serverOrigin('http://192.0.2.1')).toThrow(/HTTPS/);
  });

  it('sends no Discord status to the hub unless the relay switch, social and an account are on', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    window.localStorage.setItem(
      'socialSession',
      JSON.stringify({ token: 't', me: { id: 'a', share: {} } })
    );

    const plugins = await import('$lib/plugins');
    const hooks = await import('$lib/data/reader-hooks');
    const discord = await import('$lib/data/discord');
    const { discordOptions$ } = await import('$lib/data/discord-settings');
    const hubCalls = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/v1/presence'));
    const read = async (position: number) => {
      hooks.readingActivity({ kind: 'book', title: '本', position, characters: 100 });
      await new Promise((resolve) => setTimeout(resolve, 20));
    };

    // Signed in with the plugin on, but the switch is off by default.
    plugins.setPluginEnabled('discord', true);
    await read(10);
    expect(hubCalls()).toHaveLength(0);

    // The switch on but social off.
    plugins.setPluginEnabled('social', false);
    discordOptions$.next({ relay: true });
    await read(20);
    expect(hubCalls()).toHaveLength(0);

    plugins.setPluginEnabled('social', true);
    await read(30);
    expect(hubCalls()).toHaveLength(1);
    plugins.setPluginEnabled('discord', false);
    discord.resetSender();
  });

  it('searches AniList/VNDB for a Discord cover only with the plugin and Show on and titles shown', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 404 }));

    const plugins = await import('$lib/plugins');
    const hooks = await import('$lib/data/reader-hooks');
    const discord = await import('$lib/data/discord');
    const { discordActivities$, discordOptions$ } = await import('$lib/data/discord-settings');
    const searches = () =>
      fetchMock.mock.calls.filter(([url]) => /anilist|vndb/.test(String(url))).length;
    const read = async (title: string) => {
      hooks.readingActivity({ kind: 'book', title, position: 10, characters: 100 });
      await new Promise((resolve) => setTimeout(resolve, 20));
    };

    discordActivities$.next({ book: { details: '', state: '', largeImage: 'cover' } });
    await read('本');
    plugins.setPluginEnabled('discord', true);
    discordOptions$.next({ show: false });
    await read('本 2');
    discordOptions$.next({ show: true, hideTitles: true });
    await read('本 3');
    expect(searches()).toBe(0);

    discordOptions$.next({ hideTitles: false });
    await read('本 4');
    expect(searches()).toBe(1);
    plugins.setPluginEnabled('discord', false);
    discord.resetSender();
  });

  it('gives the hub a Discord cover only signed in, with social on and titles shown', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 404 }));

    const plugins = await import('$lib/plugins');
    const hooks = await import('$lib/data/reader-hooks');
    const discord = await import('$lib/data/discord');
    const { socialSession$ } = await import('$lib/data/social-account');
    const { discordActivities$, discordOptions$ } = await import('$lib/data/discord-settings');
    const coverCalls = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/v1/cover')).length;
    const read = async (title: string) => {
      hooks.readingActivity({ kind: 'book', title, position: 10, characters: 100 });
      await new Promise((resolve) => setTimeout(resolve, 20));
    };

    discordActivities$.next({ book: { details: '', state: '', largeImage: 'cover' } });
    plugins.setPluginEnabled('discord', true);
    await read('本');
    socialSession$.next({ token: 't', me: { id: 'a', share: {} } as never });
    plugins.setPluginEnabled('social', false);
    await read('本 2');
    discordOptions$.next({ hideTitles: true });
    plugins.setPluginEnabled('social', true);
    await read('本 3');
    expect(coverCalls()).toBe(0);

    discordOptions$.next({ hideTitles: false });
    await read('本 4');
    expect(coverCalls()).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some(([url]) => /\/calibre\/|\/account\//.test(String(url)))).toBe(
      false
    );
    plugins.setPluginEnabled('discord', false);
    socialSession$.next(null);
    discord.resetSender();
  });

  it('offers no library cover upload and sends nothing, even signed in as a dev', async () => {
    const covers = await import('$lib/data/library-covers');
    const { socialSession$ } = await import('$lib/data/social-account');

    socialSession$.next({ token: 't', me: { id: 'a', role: 'dev', share: {} } as never });
    expect(covers.libraryCoversAvailable).toBe(false);
    await covers.uploadLibraryCovers();
    expect(fetchMock).not.toHaveBeenCalled();
    socialSession$.next(null);
  });

  it('asks the Anki add-on nothing while the Discord plugin is off', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));

    const plugins = await import('$lib/plugins');
    const hooks = await import('$lib/data/reader-hooks');
    const discord = await import('$lib/data/discord');
    const addonCalls = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).startsWith(discord.addonUrl));

    // Off by default: reading, the library and the status line send nothing.
    hooks.readingActivity({ kind: 'book', title: '本', position: 10, characters: 100 });
    hooks.readingActivity({ kind: 'idle' });
    await discord.checkConnection();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();

    plugins.setPluginEnabled('discord', true);
    await discord.checkConnection();
    expect(addonCalls()).toHaveLength(1);

    // Switched off again: one clear for what it sent, then nothing.
    hooks.readingActivity({ kind: 'book', title: '本', position: 10, characters: 100 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    plugins.setPluginEnabled('discord', false);
    const sent = addonCalls().length;

    hooks.readingActivity({ kind: 'book', title: '本', position: 20, characters: 100 });
    await discord.checkConnection();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(addonCalls()).toHaveLength(sent);
    expect(addonCalls().at(-1)?.[1]?.method).toBe('DELETE');
    discord.resetSender();
  });
});
