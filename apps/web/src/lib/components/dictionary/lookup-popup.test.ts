/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { tick } from 'svelte';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ enabled: [] as boolean[], lookup: vi.fn() }));

// jsdom has no caret-from-point: the text under any point is 狐の親子.
vi.mock('$lib/functions/dictionary/scan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/functions/dictionary/scan')>()),
  scanAt: () => ({ node: document.body, offset: 0, text: '狐の親子' }),
  scannedRange: vi.fn()
}));

const touchInput = {
  include: '',
  exclude: '',
  types: { mouse: false, touch: true, pen: true },
  options: { scanOnTouchTap: true, minimumTouchTime: 0, searchTerms: true, searchKanji: true }
};

vi.mock('$lib/data/dictionary/dictionary', async () => {
  const { writableSubject } = await import('$lib/functions/svelte/store');
  const profile = () => ({
    dictionaries: state.enabled.map((enabled, index) => ({ name: `d${index}`, enabled })),
    scanning: {
      inputs: [touchInput],
      delay: 0,
      autoHideResults: false,
      layoutAwareScan: false,
      matchTypePrefix: false,
      selectText: false
    },
    general: { popupDisplayMode: 'default', customPopupCss: '', fontSize: 14, lineHeight: 1.5 },
    audio: { enabled: false }
  });

  return {
    builtInLookups$: new BehaviorSubject(true),
    dictionaries$: writableSubject([]),
    noDictionaryNoteSeen$: writableSubject(false),
    yomitanOptions$: writableSubject({}),
    loadYomitanOptions: async () => ({}),
    refreshDictionaries: async () => [],
    profileOptions: profile,
    lookup: state.lookup
  };
});

vi.mock('$lib/data/dictionary/jmdict', () => ({
  bundledJmdictSize: async () => undefined,
  hasJmdict: () => false,
  installJmdict: vi.fn(),
  jmdictReleases: 'https://example.invalid/releases'
}));

const { default: LookupPopup } = await import('./lookup-popup.svelte');
const { noDictionaryNoteSeen$ } = await import('$lib/data/dictionary/dictionary');

async function mount() {
  const target = document.createElement('div');
  const text = document.createElement('p');

  text.className = 'book-content';
  target.append(text);
  document.body.append(target);
  document.elementFromPoint = () => text;

  const popup = new LookupPopup({ target, props: { scope: '.book-content' } });

  // loadYomitanOptions → refreshDictionaries → listed
  for (let i = 0; i < 5; i += 1) await tick();

  return { target, popup: popup as unknown as { tapAt(x: number, y: number): boolean } };
}

/** A finger down and up at the point, as the window sees it before the host's tap handler. */
function touch(x: number, y: number) {
  for (const type of ['pointerdown', 'pointerup']) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      pointerType: 'touch',
      isPrimary: true,
      pointerId: 1,
      clientX: x,
      clientY: y,
      buttons: 0
    });
    document.body.dispatchEvent(event);
  }
}

describe('LookupPopup tapAt', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    noDictionaryNoteSeen$.next(false);
    state.lookup.mockReset().mockResolvedValue({ dictionaryEntries: [], originalTextLength: 0 });
  });

  it('lets a tap through, once with a note, while no dictionary is installed', async () => {
    state.enabled = [];
    const { target, popup } = await mount();

    touch(10, 10);
    expect(popup.tapAt(10, 10)).toBe(false);
    await tick();
    expect(target.textContent).toContain('No dictionary yet');
    expect(noDictionaryNoteSeen$.getValue()).toBe(true);
    expect(state.lookup).not.toHaveBeenCalled();
  });

  it('lets taps through when every dictionary is turned off', async () => {
    state.enabled = [false];
    const { popup } = await mount();

    touch(10, 10);
    expect(popup.tapAt(10, 10)).toBe(false);
  });

  it('takes the tap and looks the text up with a dictionary', async () => {
    state.enabled = [true];
    const { target, popup } = await mount();

    touch(10, 10);
    expect(popup.tapAt(10, 10)).toBe(true);
    expect(state.lookup).toHaveBeenCalledWith('狐の親子', {
      searchTerms: true,
      searchKanji: true,
      matchType: 'exact'
    });
    await tick();
    expect(target.textContent).not.toContain('No dictionary yet');
  });
});
