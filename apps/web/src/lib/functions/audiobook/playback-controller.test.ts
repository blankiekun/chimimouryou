/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audiobookControls$ } from '$lib/data/audiobook-controls';
import { getAudiobookRate } from '$lib/data/audiobook';
import { builtInPopupOpen$ } from '$lib/data/yomitan';
import { PlaybackController } from './playback-controller';

const cues = [
  { startSeconds: 1, endSeconds: 3, text: 'a' },
  { startSeconds: 4, endSeconds: 6, text: 'b' }
];

function setup() {
  const media = {
    now: 0,
    isPaused: true,
    time: () => media.now,
    duration: () => 10,
    seek: vi.fn((seconds: number) => (media.now = seconds)),
    play: vi.fn(() => (media.isPaused = false)),
    pause: vi.fn(() => (media.isPaused = true)),
    paused: () => media.isPaused,
    setRate: vi.fn()
  };
  const controller = new PlaybackController(media, 'Book');

  controller.setCues(cues);
  /** Plays on to `seconds` in one tick. */
  const playTo = (seconds: number) => {
    media.isPaused = false;
    controller.tick();
    media.now = seconds;
    controller.tick();
  };

  return { media, controller, playTo };
}

describe('PlaybackController', () => {
  beforeEach(() => {
    localStorage.clear();
    audiobookControls$.next({});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the speed per book', () => {
    const { media, controller } = setup();

    controller.setRate(0.8);
    expect(media.setRate).toHaveBeenCalledWith(0.8);
    expect(getAudiobookRate('Book')).toBe(0.8);
    expect(setup().controller.rate).toBe(0.8);
  });

  it('moves between lines and seeks by the step', () => {
    const { media, controller } = setup();

    media.now = 5;
    controller.line(-1);
    expect(media.now).toBe(1);
    controller.line(1);
    expect(media.now).toBe(4);
    controller.seekBy(-5);
    expect(media.now).toBe(0);
    audiobookControls$.next({ seekSeconds: 3 });
    controller.run('forward');
    expect(media.now).toBe(3);
  });

  it('repeats lines while looping, as often as set', () => {
    const { media, controller, playTo } = setup();

    audiobookControls$.next({ loopCount: 2 });
    controller.toggleLoop();
    media.now = 2.9;
    playTo(3.1);
    expect(media.now).toBe(1);
    media.now = 2.9;
    playTo(3.1);
    // Played twice: on to the next line
    expect(media.now).toBe(3.1);
  });

  it('pauses after each line and goes on after the gap', () => {
    const { media, controller, playTo } = setup();

    audiobookControls$.next({ autoPause: true, autoPauseGap: 2 });
    media.now = 2.9;
    playTo(3.05);
    expect(media.pause).toHaveBeenCalled();
    expect(media.isPaused).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(media.play).toHaveBeenCalled();
    expect(controller.state$.getValue().loop).toBe(false);
  });

  it('pauses during a lookup and goes on after it', () => {
    const { media, controller } = setup();
    const stop = controller.start(window);

    media.isPaused = false;
    builtInPopupOpen$.next(true);
    expect(media.isPaused).toBe(true);
    builtInPopupOpen$.next(false);
    vi.advanceTimersByTime(500);
    expect(media.isPaused).toBe(false);

    // Not when switched off, nor when the audio was already paused
    audiobookControls$.next({ pauseOnLookup: false });
    builtInPopupOpen$.next(true);
    expect(media.isPaused).toBe(false);
    builtInPopupOpen$.next(false);
    stop();
  });

  it('answers its keys only outside text fields and without modifiers', () => {
    const { media, controller } = setup();
    const stop = controller.start(window);

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK' }));
    expect(media.play).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', ctrlKey: true }));
    expect(media.pause).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'BracketLeft' }));
    expect(controller.rate).toBe(0.95);
    media.now = 5;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', shiftKey: true }));
    expect(media.now).toBe(0);

    const input = document.createElement('input');

    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyO', bubbles: true }));
    expect(controller.state$.getValue().loop).toBe(false);
    input.remove();
    stop();
  });

  it('pauses when the sleep timer ends', () => {
    const { media, controller } = setup();

    media.isPaused = false;
    controller.setSleep(5);
    expect(controller.state$.getValue().sleepAt).toBeGreaterThan(0);
    vi.advanceTimersByTime(5 * 60_000);
    expect(media.isPaused).toBe(true);
    expect(controller.state$.getValue().sleepAt).toBe(0);
  });
});
