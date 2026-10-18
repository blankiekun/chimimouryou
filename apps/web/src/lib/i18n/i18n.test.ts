/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { en } from './en';
import { ja } from './ja';
import { translate, tr, uiLanguage$ } from './index';

const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  it('has the same keys and {params} in English and Japanese, none empty', () => {
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort());
    for (const [key, text] of Object.entries(en)) {
      const jaText = ja[key as keyof typeof en];

      expect(text.trim(), key).not.toBe('');
      expect(jaText.trim(), key).not.toBe('');
      expect(params(jaText), key).toEqual(params(text));
    }
  });

  it('only uses keys that exist', () => {
    const sources = import.meta.glob('/src/**/*.{svelte,ts}', {
      query: '?raw',
      import: 'default',
      eager: true
    }) as Record<string, string>;
    const used = Object.entries(sources)
      .filter(([path]) => !path.startsWith('/src/lib/i18n/'))
      .flatMap(([, source]) =>
        [...source.matchAll(/(?:\$t\$|\btr)\(\s*'([^']+)'/g)].map((m) => m[1])
      );

    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((key) => !(key in en))).toEqual([]);
  });

  it('fills in params and falls back to English', () => {
    expect(translate('ja', 'dashboard.streak', { count: 3 })).toBe('3日連続');
    expect(translate('en', 'nav.signedInAs', { name: 'a' })).toBe('Signed in as a');
    expect(translate('xx', 'nav.home')).toBe('Home');
    uiLanguage$.next('ja');
    expect(tr('nav.home')).toBe('ホーム');
    uiLanguage$.next('en');
  });
});
