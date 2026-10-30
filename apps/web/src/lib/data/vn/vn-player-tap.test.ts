/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// static/vn/overlay.js (with player.js) holds a tap on its text overlay while the page's built-in lookups are on
// (window.textTap set): a tap that finds a word never reaches the game, any other does.
describe('VN player text taps', () => {
  let canvasEvents: string[] = [];
  let text: HTMLElement;

  beforeAll(() => {
    document.body.innerHTML = `<canvas id="canvas"></canvas><div id="overlay">
      <div id="page-text"><div>猫が好きです。</div></div><div id="sprite-text"></div>
      <div id="choices"></div></div><video id="video"></video>`;
    // Plain script, run as the frame would (its top-level vars become globals); it patches
    // AudioNode, which jsdom lacks.
    vi.stubGlobal('AudioNode', class {});
    window.eval(readFileSync('static/vn/overlay.js', 'utf8'));
    window.eval(readFileSync('static/vn/player.js', 'utf8'));
    for (const type of ['touchstart', 'touchend', 'touchmove']) {
      document.getElementById('canvas')!.addEventListener(type, () => canvasEvents.push(type));
    }
    text = document.querySelector('#page-text div')!;
  });

  const touch = (type: string) => {
    const point = { identifier: 0, target: text, clientX: 10, clientY: 20 } as unknown as Touch;
    const touches = type === 'touchend' ? [] : [point];
    text.dispatchEvent(
      new TouchEvent(type, { bubbles: true, cancelable: true, touches, changedTouches: [point] })
    );
  };
  const tap = () => {
    canvasEvents = [];
    touch('touchstart');
    touch('touchend');
    return canvasEvents;
  };
  const setTextTap = (fn: ((x: number, y: number) => boolean) | null) =>
    ((window as unknown as { textTap: typeof fn }).textTap = fn);

  it('passes taps straight to the game while lookups are off', () => {
    setTextTap(null);
    expect(tap()).toEqual(['touchstart', 'touchend']);
  });

  it('keeps a tap that found a word from the game', () => {
    const at: number[][] = [];
    setTextTap((x, y) => (at.push([x, y]), true));
    expect(tap()).toEqual([]);
    expect(at).toEqual([[10, 20]]);
  });

  it('passes a tap that found nothing, and drags, to the game', () => {
    setTextTap(() => false);
    expect(tap()).toEqual(['touchstart', 'touchend']);
    canvasEvents = [];
    touch('touchstart');
    touch('touchmove');
    expect(canvasEvents).toEqual(['touchstart', 'touchmove']);
  });
});
