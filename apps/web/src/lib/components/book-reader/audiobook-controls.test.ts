/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { flushSync, mount } from 'svelte';
import { describe, expect, it } from 'vitest';
import { PlaybackController } from '$lib/functions/audiobook/playback-controller';
import AudiobookControls from './audiobook-controls.svelte';
import AudiobookControlsPanel from './audiobook-controls-panel.svelte';

describe('audiobook controls', () => {
  it('show the speed and the line modes, and open the speed panel', () => {
    localStorage.clear();
    const controller = new PlaybackController(
      {
        time: () => 0,
        duration: () => 10,
        seek: () => {},
        play: () => {},
        pause: () => {},
        paused: () => true,
        setRate: () => {}
      },
      'Book'
    );
    const target = document.createElement('div');
    const props = { controller, hasLines: true };

    mount(AudiobookControls, { target, props });
    mount(AudiobookControlsPanel, { target, props });

    const loop = target.querySelector('[aria-pressed]') as HTMLButtonElement;

    loop.click();
    flushSync();
    expect(loop.getAttribute('aria-pressed')).toBe('true');

    (target.querySelector('.abc-pill') as HTMLButtonElement).click();
    flushSync();
    const preset = [...target.querySelectorAll<HTMLButtonElement>('.abc-chip')].find(
      (button) => button.textContent === '0.8×'
    );

    preset?.click();
    flushSync();
    expect(controller.rate).toBe(0.8);
    expect(target.querySelector('.abc-pill')?.textContent).toBe('0.8×');
  });
});
