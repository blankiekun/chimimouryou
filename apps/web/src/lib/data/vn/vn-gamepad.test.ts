/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  cursorSpeed,
  heldActions,
  padChanges,
  padStep,
  watchGamepads,
  type PadSheets
} from './vn-gamepad';

function pad(pressed: number[], axes = [0, 0, 0, 0]) {
  return {
    buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index) })),
    axes
  } as unknown as Gamepad;
}

describe('vn gamepad', () => {
  it('maps the standard buttons to actions', () => {
    expect([...heldActions(pad([0, 1, 2, 3, 4, 5, 8, 9, 12, 13, 14, 15, 16]))].sort()).toEqual(
      [
        'advance',
        'menu',
        'skip',
        'backlog',
        'wheelUp',
        'wheelDown',
        'fullscreen',
        'more',
        'up',
        'down',
        'left',
        'right'
      ].sort()
    );
  });

  it('reads the left stick past half way as the d-pad', () => {
    expect([...heldActions(pad([], [-0.8, 0.6]))]).toEqual(['left', 'down']);
    expect(heldActions(pad([], [0.3, -0.3])).size).toBe(0);
  });

  it('reports presses and releases between polls', () => {
    const before = heldActions(pad([0, 2]));
    const now = heldActions(pad([2, 3]));

    expect(padChanges(before, now)).toEqual({ pressed: ['backlog'], released: ['advance'] });
  });

  it('moves the cursor with the stick past its dead zone, else the d-pad', () => {
    expect(cursorSpeed(pad([], [0.1, -0.1]))).toEqual([0, 0]);
    expect(cursorSpeed(pad([], [1, -1]))).toEqual([1, -1]);
    expect(cursorSpeed(pad([], [0.6, 0]))[0]).toBeCloseTo(0.25);
    expect(cursorSpeed(pad([14, 13]))).toEqual([-1, 1]);
  });

  // padStep's failure modes: B reaching the game while a sheet is open (or Saves not
  // restarting it); Y opening the Backlog of a blocked game; X toggling skip before the game
  // started; a release not reaching the game (a button stuck down in it).
  const none: PadSheets = {
    more: false,
    backlog: false,
    tuning: false,
    hooks: false,
    saves: false
  };
  const game = { started: true, blocked: false };

  it('closes a sheet with B before B reaches the game', () => {
    expect(padStep({ ...none, hooks: true, more: true }, ['menu'], [], game)).toEqual({
      sheets: none,
      effects: []
    });
    expect(padStep({ ...none, saves: true }, ['menu'], [], game)).toEqual({
      sheets: none,
      effects: ['closeSaves']
    });
    expect(padStep(none, ['menu'], [], game).effects).toEqual([{ button: 'menu', down: true }]);
  });

  it('toggles the Backlog and More sheets, never the Backlog of a blocked game', () => {
    expect(padStep({ ...none, more: true }, ['backlog'], [], game).sheets).toEqual({
      ...none,
      backlog: true
    });
    expect(padStep(none, ['backlog'], [], { ...game, blocked: true }).sheets).toEqual(none);
    expect(padStep({ ...none, backlog: true }, ['more'], [], game).sheets).toEqual({
      ...none,
      more: true
    });
  });

  it('skips only once the game started, and always passes releases on', () => {
    expect(padStep(none, ['skip'], [], { ...game, started: false }).effects).toEqual([]);
    expect(padStep({ ...none, more: true }, ['skip'], ['menu'], game).effects).toEqual([
      { button: 'menu', down: false },
      'skip'
    ]);
  });

  it('polls an idle pad on a timer, and each frame again once it is used', () => {
    vi.useFakeTimers();
    let frames = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      setTimeout(() => {
        frames += 1;
        callback(performance.now());
      }, 16)
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    const connected = { ...pad([]), connected: true } as Gamepad;
    let current = connected;
    const change = vi.fn();
    const stop = watchGamepads(() => [current], { change, cursor: () => {} });

    vi.advanceTimersByTime(2000);
    const idleFrames = frames;
    vi.advanceTimersByTime(1000);
    // Idle: no frame polls, the timer's 50 ms polls instead.
    expect(frames).toBe(idleFrames);

    current = { ...pad([0]), connected: true } as Gamepad;
    vi.advanceTimersByTime(100);
    expect(change).toHaveBeenCalledWith(['advance'], []);
    vi.advanceTimersByTime(500);
    expect(frames).toBeGreaterThan(idleFrames + 10);

    stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
