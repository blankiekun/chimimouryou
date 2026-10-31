/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { Capacitor } from '@capacitor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkEngineRelease, checkForUpdate, commitOfVersion, newerApk } from './app-update';

function github(routes: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = url.replace('https://api.github.com/repos/o/r/', '');

      return path in routes
        ? new Response(JSON.stringify(routes[path]))
        : new Response('{}', { status: 404 });
    })
  );
}

describe('app update check', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the commit from version.txt', () => {
    expect(commitOfVersion('b3cadf4d\n')).toEqual({ commit: 'b3cadf4d', dirty: false });
    expect(commitOfVersion('v2.0.0-12-gb3cadf4d-dirty')).toEqual({
      commit: 'b3cadf4d',
      dirty: true
    });
    expect(commitOfVersion('docker').commit).toBe('');
  });

  it('lists newer commits on main, newest first', async () => {
    github({
      'compare/aaaaaaa...main': {
        status: 'ahead',
        commits: [
          { sha: 'b1', commit: { message: 'feat: one\n\nbody' } },
          { sha: 'b2', commit: { message: 'fix: two' } }
        ]
      }
    });

    expect(await checkForUpdate('o/r', 'aaaaaaa')).toEqual({
      target: 'main',
      current: 'aaaaaaa',
      dirty: false,
      latest: 'b2',
      state: 'behind',
      commits: [
        { sha: 'b2', message: 'fix: two' },
        { sha: 'b1', message: 'feat: one' }
      ]
    });
  });

  it('compares with the latest release on the stable channel', async () => {
    github({
      'releases/latest': { tag_name: 'v3.2.0' },
      'compare/aaaaaaa...v3.2.0': {
        status: 'ahead',
        commits: [{ sha: 'r1', commit: { message: 'docs: v3.2.0' } }]
      }
    });

    const check = await checkForUpdate('o/r', 'v3.1.0-0-gaaaaaaa', 'stable');

    expect([check.target, check.state, check.latest]).toEqual(['v3.2.0', 'behind', 'r1']);
  });

  it('is unknown when the deployed commit is not on GitHub', async () => {
    github({ 'commits/main': { sha: 'c9' } });

    const check = await checkForUpdate('o/r', 'deadbee-dirty');

    expect([check.state, check.latest, check.dirty]).toEqual(['unknown', 'c9', true]);
  });

  it('compares the installed engine with the latest CONscripter release', async () => {
    const release = {
      tag_name: 'v0.10.0',
      html_url: 'https://example.test/v0.10.0',
      assets: [{ name: 'conscripter_v0.10.0_web.7z' }]
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(release)))
    );

    expect(await checkEngineRelease('v0.9.0\n')).toEqual({
      installed: 'v0.9.0',
      latest: 'v0.10.0',
      url: release.html_url,
      newer: true,
      webBuild: true
    });
    expect((await checkEngineRelease('v0.10.0')).newer).toBe(false);
  });
});

// Bugs these catch: an older or equal release offered (a prerelease build pushed back to the last
// stable one), the play build or a debug build (no version) asking GitHub, a release without its APK
// yet offered with no link, more than one request a day, offline breaking the start or silencing
// the check for a day, and "Later" never asking again on the next start.
describe('android apk update', () => {
  const apkUrl = 'https://github.com/o/r/releases/download/v3.13.0/chimimouryou-3.13.0.apk';
  const release = (tag: string, assets = [{ name: 'x.apk', browser_download_url: apkUrl }]) =>
    vi.fn(async () => new Response(JSON.stringify({ tag_name: tag, assets })));
  const day = 86_400_000;
  let flavor: string | undefined;

  beforeEach(() => {
    localStorage.clear();
    flavor = 'MihonHost';
    vi.spyOn(Capacitor, 'isPluginAvailable').mockImplementation((name) => name === flavor);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('offers a newer release with its apk', async () => {
    vi.stubGlobal('fetch', release('v3.13.0'));

    expect(await newerApk('3.12.0', 0)).toEqual({ version: '3.13.0', url: apkUrl });
  });

  it('offers nothing for the same or an older release', async () => {
    vi.stubGlobal('fetch', release('v3.12.0'));
    expect(await newerApk('3.12.0', 0)).toBeUndefined();
    // A prerelease build is newer than /releases/latest.
    expect(await newerApk('3.13.0-rc1', 0)).toBeUndefined();
  });

  it('offers nothing while the release has no apk yet', async () => {
    vi.stubGlobal('fetch', release('v3.13.0', []));

    expect(await newerApk('3.12.0', 0)).toBeUndefined();
  });

  it('never asks GitHub from the play build or a build without a version', async () => {
    const fetch = release('v3.13.0');
    vi.stubGlobal('fetch', fetch);

    expect(await newerApk('', 0)).toBeUndefined();
    flavor = undefined;
    expect(await newerApk('3.12.0', 0)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks GitHub once a day and offers again on each start', async () => {
    const fetch = release('v3.13.0');
    vi.stubGlobal('fetch', fetch);

    await newerApk('3.12.0', 0);
    expect(await newerApk('3.12.0', day - 1)).toEqual({ version: '3.13.0', url: apkUrl });
    expect(fetch).toHaveBeenCalledTimes(1);
    await newerApk('3.12.0', day);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('is quiet offline and tries again on the next start', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await newerApk('3.12.0', 0)).toBeUndefined();

    vi.stubGlobal('fetch', release('v3.13.0'));
    expect(await newerApk('3.12.0', 1)).toEqual({ version: '3.13.0', url: apkUrl });
  });
});
