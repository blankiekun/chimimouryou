/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import '$lib/data/storage/storage-handler-factory';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { OptionsUtil } from '$lib/vendor/yomitan/data/options-util';
import type { TermDictionaryEntry } from '$lib/vendor/yomitan/types/dictionary';
import type { ProfileOptions } from '$lib/vendor/yomitan/types/settings';
import { getPosition } from '$lib/vendor/yomitan/app/popup-position';
import { hotkeyAction } from '$lib/functions/dictionary/hotkeys';
import { matchingInput } from '$lib/functions/dictionary/scan';
import { customUrl, jpod101Url } from '$lib/data/dictionary-audio';
import { internalQuery, safeExternalUrl } from './structured-content';
import TermEntry from './term-entry.svelte';

vi.mock('$lib/data/dictionary', () => ({ getDictionaryMedia: async () => null }));

let options: ProfileOptions;

beforeAll(async () => {
  const util = new OptionsUtil();
  await util.prepare();
  options = util.getDefault().profiles[0].options;
});

const entry = {
  type: 'term',
  headwords: [
    { index: 0, term: '食べる', reading: 'たべる', sources: [], tags: [], wordClasses: ['v1'] }
  ],
  inflectionRuleChainCandidates: [{ source: 'algorithm', inflectionRules: [{ name: 'past' }] }],
  definitions: [
    {
      dictionary: 'JM',
      dictionaryAlias: 'JM',
      tags: [],
      headwordIndices: [0],
      entries: [
        'to eat',
        {
          type: 'structured-content',
          content: [
            { tag: 'a', href: 'https://example.com/x', content: 'web' },
            { tag: 'a', href: 'javascript:alert(1)', content: 'bad' },
            { tag: 'a', href: '?query=食う&wildcards=off', content: '食う' },
            { tag: 'ul', content: [{ tag: 'li', content: 'listed' }] }
          ]
        }
      ]
    }
  ],
  pronunciations: [
    {
      headwordIndex: 0,
      dictionary: 'P',
      dictionaryAlias: 'P',
      pronunciations: [
        { type: 'pitch-accent', positions: 2, nasalPositions: [], devoicePositions: [], tags: [] }
      ]
    }
  ],
  frequencies: [
    {
      headwordIndex: 0,
      dictionary: 'F',
      dictionaryAlias: 'F',
      hasReading: false,
      frequency: 500,
      displayValue: null
    }
  ]
} as unknown as TermDictionaryEntry;

describe('TermEntry', () => {
  it('shows the headword, chain, tags, pitch and a safe glossary', () => {
    const target = document.createElement('div');
    const component = new TermEntry({ target, props: { entry, options, summaries: [] } });
    const lookups: string[] = [];
    component.$on('lookup', ({ detail }) => lookups.push(detail));

    expect(target.querySelector('.headword-term ruby')?.textContent).toBe('食た');
    expect(target.querySelector('.headword-term')?.textContent?.trim()).toBe('食たべる');
    expect(target.querySelector('.inflection')?.textContent).toBe('past');
    expect(target.querySelector('.tag-frequency')?.textContent).toContain('500');
    expect(target.querySelector('.pronunciation-mora[data-pitch=high]')).not.toBeNull();
    const glosses = [...target.querySelectorAll('.gloss-item')];
    expect(glosses[0].textContent).toBe('to eat');
    expect(glosses[1].querySelector('.gloss-sc-li')?.textContent).toBe('listed');

    const [web, bad, internal] = glosses[1].querySelectorAll('a');
    expect(web.getAttribute('href')).toBe('https://example.com/x');
    expect(web.rel).toBe('noreferrer noopener');
    expect(bad.hasAttribute('href')).toBe(false);
    internal.click();
    expect(lookups).toEqual(['食う']);
  });
});

describe('lookup helpers', () => {
  it('matches Yomitan scanning inputs', () => {
    const { inputs } = options.scanning;
    expect(matchingInput(inputs, 'mouse', [])).toBeUndefined();
    expect(matchingInput(inputs, 'mouse', ['shift'])).toBe(inputs[0]);
    expect(matchingInput(inputs, 'mouse', ['shift', 'mouse0'])).toBeUndefined();
    expect(matchingInput(inputs, 'touch', [])?.options.scanOnTouchTap).toBe(true);
  });

  it('finds popup hotkeys with exactly their modifiers', () => {
    const { hotkeys } = options.inputs;
    const key = (code: string, init: KeyboardEventInit = {}) =>
      hotkeyAction(hotkeys, new KeyboardEvent('keydown', { code, ...init }))?.action;
    expect(key('Escape')).toBe('close');
    expect(key('KeyP', { altKey: true })).toBe('playAudio');
    expect(key('KeyP')).toBeUndefined();
    expect(key('KeyE', { altKey: true })).toBeUndefined(); // addNote: no Anki here
  });

  it('places the popup below horizontal text, flipping when there is no room', () => {
    const viewport = { left: 0, top: 0, right: 800, bottom: 600 };
    const sizes = {
      width: 400,
      height: 250,
      horizontalOffset: 0,
      verticalOffset: 10,
      horizontalOffset2: 10,
      verticalOffset2: 0,
      horizontalTextPositionBelow: true,
      verticalTextPosition: 'before'
    };
    const word = (top: number) => [{ left: 100, top, right: 140, bottom: top + 20 }];
    expect(getPosition(word(100), 'horizontal-tb', viewport, sizes)).toMatchObject({
      left: 100,
      top: 130,
      below: true
    });
    expect(getPosition(word(500), 'horizontal-tb', viewport, sizes)).toMatchObject({
      top: 240,
      below: false
    });
    // Vertical text: beside the line, to its right for "before" in vertical-rl.
    expect(getPosition(word(100), 'vertical-rl', viewport, sizes).left).toBe(150);
  });

  it('builds audio URLs and checks links', () => {
    expect(jpod101Url('食べる', 'たべる')).toContain('kanji=%E9%A3%9F');
    expect(jpod101Url('たべる', 'たべる')).not.toContain('kanji=');
    expect(customUrl('http://x/?t={term}&r={reading}&n={none}', '本', 'ほん')).toBe(
      'http://x/?t=本&r=ほん&n={none}'
    );
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('https://a.b/c')).toBe('https://a.b/c');
    expect(internalQuery('?query=%E6%9C%AC&wildcards=off')).toBe('本');
  });
});
