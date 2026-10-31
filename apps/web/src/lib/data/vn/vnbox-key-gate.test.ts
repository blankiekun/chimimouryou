/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

// static/vn/vnbox.js's key gate. Catches: Yomitan's Shift, held over the game's text to scan,
// reaching the game, which hides its text box (最果てのイマ); and the opposite breakage, Shift+key,
// Shift+click or the pad's keys no longer reaching the game, or modifiers counted as clicks.
it('keeps a lone scan modifier over the text from the game, and sends it late with a key or click', () => {
  document.body.innerHTML = `<div class="emscripten_border"><div id="dropzone">
    <canvas id="canvas"></canvas></div></div><div id="overlay">
    <div id="page-text"><span>今日</span></div><div id="sprite-text"></div><div id="choices"></div></div>`;
  vi.stubGlobal('AudioNode', class {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
    }
  );
  window.eval(readFileSync('static/vn/overlay.js', 'utf8'));
  window.eval(readFileSync('static/vn/vnbox.js', 'utf8'));
  (window as any).startGame({ textLines: () => [], onText: () => undefined });

  // VNBox's listeners, added once it runs (after startGame).
  const game: string[] = [];
  for (const type of ['keydown', 'keyup', 'mousedown']) {
    window.addEventListener(
      type,
      (event: any) => game.push(`${type} ${event.key ?? ''}`.trim()),
      true
    );
  }
  const canvas = document.getElementById('canvas')!;
  const text = document.querySelector('#page-text span')!;
  // Events from the user's keyboard and mouse: dispatchEvent makes them untrusted, so they go
  // through jsdom's internal dispatch with isTrusted set.
  const impl = (object: object) =>
    (object as any)[
      Object.getOwnPropertySymbols(object).find((symbol) => symbol.description === 'impl')!
    ];
  const user = (target: Element, event: Event) => {
    impl(event).isTrusted = true;
    impl(target)._dispatch(impl(event));
  };
  const key = (type: string, key: string, code = key === 'Shift' ? 'ShiftLeft' : `Key${key}`) =>
    user(canvas, new KeyboardEvent(type, { key, code, bubbles: true }));
  const clicksNow = () => {
    (window as any).boxedwineText('行');
    return (window as any).vnboxHooks.threads()[0].recent.at(-1).click;
  };

  user(text, new MouseEvent('pointermove', { bubbles: true }));
  const clicks = clicksNow();
  key('keydown', 'Shift');
  key('keydown', 'Shift');
  key('keyup', 'Shift');
  expect(game).toEqual([]);
  expect(clicksNow()).toBe(clicks);

  key('keydown', 'Shift');
  key('keydown', 'A');
  key('keyup', 'A');
  key('keyup', 'Shift');
  expect(game.splice(0)).toEqual(['keydown Shift', 'keydown A', 'keyup A', 'keyup Shift']);

  key('keydown', 'Shift');
  user(canvas, new MouseEvent('mousedown', { bubbles: true }));
  key('keyup', 'Shift');
  expect(game.splice(0)).toEqual(['keydown Shift', 'mousedown', 'keyup Shift']);

  // Untrusted keys (the pad's, through gameKey) and Shift off the text go straight through.
  (window as any).gameKey(true, 'ShiftLeft', 'Shift', 16);
  user(canvas, new MouseEvent('pointermove', { bubbles: true }));
  key('keydown', 'Shift');
  expect(game.splice(0)).toEqual(['keydown Shift', 'keydown Shift']);
});
