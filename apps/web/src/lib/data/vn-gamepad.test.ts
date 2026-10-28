/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { cursorSpeed, heldActions, padChanges } from './vn-gamepad';

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
});
