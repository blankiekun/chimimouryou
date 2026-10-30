/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import { buildSearchIndex } from '$lib/functions/book-text/book-search';
import { setPluginEnabled } from '$lib/plugins';
import ReaderPanel from './reader-panel.svelte';

const props = (title: string, html: string, characters: number) => ({
  open: true,
  tab: 'highlights',
  title,
  elementHtml: html,
  highlights: [],
  syncError: '',
  getIndex: async () => buildSearchIndex(html),
  sections: [],
  sectionData: [],
  position: 3,
  bookCharacters: characters
});

const tabLabels = (target: HTMLElement) =>
  [...target.querySelectorAll('[role=tab]')].map((tab) => tab.textContent?.trim());

describe('ReaderPanel', () => {
  it('leaves out the tabs of a plugin that is switched off', async () => {
    const target = document.createElement('div');

    setPluginEnabled('ai', false);
    setPluginEnabled('social', false);
    new ReaderPanel({ target, props: props('Off', '', 0) });
    await tick();

    expect(tabLabels(target)).toEqual(['Highlights', 'Listen']);
  });

  it('shows Search for a book with text', async () => {
    const target = document.createElement('div');

    setPluginEnabled('ai', false);
    setPluginEnabled('social', true);
    new ReaderPanel({ target, props: props('Text', '<p>猫</p>', 1) });
    await tick();

    expect(tabLabels(target)).toEqual(['Search', 'Highlights', 'Community', 'Listen']);
  });
});
