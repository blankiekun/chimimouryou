/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { OptionsUtil } from '$lib/vendor/yomitan/data/options-util';
import { canRunYomitan } from '$lib/functions/can-run-yomitan';
import { builtInLookupsOn, ensureDictionarySettings, type DictionarySummary } from './dictionary';

const ua = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
  firefoxAndroid: 'Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  iPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  chromeIPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
};

describe('canRunYomitan', () => {
  it('is true for desktop Chromium, Firefox and the desktop app', () => {
    expect(canRunYomitan(ua.chromeWindows, 0, false)).toBe(true);
    expect(canRunYomitan(ua.edge, 0, false)).toBe(true);
    expect(canRunYomitan(ua.chromeMac, 0, false)).toBe(true);
    expect(canRunYomitan(ua.firefoxLinux, 0, false)).toBe(true);
    expect(canRunYomitan(ua.firefoxAndroid, 5, false)).toBe(true);
    expect(canRunYomitan('anything', 0, true)).toBe(true);
  });

  it('is false on iOS (iPadOS as a Mac too), desktop Safari and other Android browsers', () => {
    expect(canRunYomitan(ua.iPhone, 5, false)).toBe(false);
    expect(canRunYomitan(ua.chromeIPhone, 5, false)).toBe(false);
    expect(canRunYomitan(ua.mac, 5, false)).toBe(false);
    expect(canRunYomitan(ua.chromeMac, 5, false)).toBe(false);
    expect(canRunYomitan(ua.mac, 0, false)).toBe(false);
    expect(canRunYomitan(ua.chromeAndroid, 5, false)).toBe(false);
    expect(canRunYomitan(ua.samsung, 5, false)).toBe(false);
  });
});

describe('builtInLookupsOn', () => {
  it('starts on only where Yomitan cannot run and was never seen', () => {
    expect(builtInLookupsOn(null, false, false)).toBe(true);
    expect(builtInLookupsOn(null, true, false)).toBe(false);
    expect(builtInLookupsOn(null, false, true)).toBe(false);
  });

  it('keeps the reader own choice', () => {
    expect(builtInLookupsOn(true, true, true)).toBe(true);
    expect(builtInLookupsOn(false, false, false)).toBe(false);
  });
});

describe('ensureDictionarySettings', () => {
  it('lists exactly the installed dictionaries, keeping the order and settings', async () => {
    const util = new OptionsUtil();
    await util.prepare();
    const options = util.getDefault();
    const profile = options.profiles[0].options;
    const entry = (name: string, enabled: boolean) => ({
      name,
      alias: name,
      enabled,
      allowSecondarySearches: false,
      definitionsCollapsible: 'not-collapsible' as const,
      partsOfSpeechFilter: true,
      useDeinflections: true,
      styles: ''
    });
    profile.dictionaries = [entry('B', false), entry('Gone', true), entry('A', true)];
    const installed = ['A', 'B', 'C'].map((title) => ({
      title,
      styles: ''
    })) as DictionarySummary[];

    ensureDictionarySettings(options, installed, false);

    expect(profile.dictionaries.map(({ name, enabled }) => [name, enabled])).toEqual([
      ['B', false],
      ['A', true],
      ['C', false]
    ]);
  });
});
