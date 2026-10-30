/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// static/vn/vnbox.js's hook threads (VNBox's hooks contract): only the selected thread, by
// default the hook script's, reaches the page; live hooks through a fake boxedwineFrida.
describe('VNBox hook threads', () => {
  const onText = vi.fn();
  // The page's cleanup: doubled characters halved, 'skip' dropped.
  const clean = vi.fn((line: string) => (line === 'skip' ? '' : line.replace(/(.)\1/g, '$1')));
  let hooks: any;
  const text = (line: string, thread?: object) => (window as any).boxedwineText(line, thread);

  beforeAll(() => {
    document.body.innerHTML = `<div class="emscripten_border"><div id="dropzone">
      <canvas id="canvas"></canvas></div></div><div id="overlay">
      <div id="page-text"></div><div id="sprite-text"></div><div id="choices"></div></div>`;
    vi.stubGlobal('AudioNode', class {});
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
      }
    );
    window.eval(readFileSync('static/vn/overlay.js', 'utf8'));
    window.eval(readFileSync('static/vn/vnbox.js', 'utf8'));
    // VNBox's scripts never load here: the hooks are set before startGame waits for them.
    (window as any).startGame({ textLines: () => [], onText, clean });
    hooks = (window as any).vnboxHooks;
  });

  it("drives the page with old VNBox's lines, which have no thread", () => {
    text('一行目');
    expect(onText).toHaveBeenLastCalledWith('一行目');
    expect(hooks.live()).toBe(false);
  });

  it('keeps other threads to the sheet until one is picked', () => {
    onText.mockClear();
    text('今', { id: 'glyph', kind: 'search', label: 'GetGlyphOutlineW' });
    expect(onText).not.toHaveBeenCalled();
    expect(hooks.threads().find((thread: any) => thread.id === 'glyph')).toMatchObject({
      last: '今',
      count: 1,
      label: 'GetGlyphOutlineW'
    });

    hooks.select('glyph');
    text('日', { id: 'glyph', kind: 'search' });
    text('二行目');
    expect(onText.mock.calls).toEqual([['日']]);
  });

  it('picks a loaded H-code, keeps a picked search thread and goes back', () => {
    const frida = {
      load: vi.fn(() => 'h1'),
      loadHcode: vi.fn(() => 'h2'),
      unload: vi.fn(),
      keep: vi.fn(() => 'h3'),
      search: { running: true, start: vi.fn(), stop: vi.fn() },
      scriptFor: vi.fn()
    };
    (window as any).boxedwineFrida = frida;
    expect(hooks.live()).toBe(true);

    hooks.searchStop();
    expect(frida.keep).toHaveBeenCalledWith('glyph');
    expect(frida.search.stop).toHaveBeenCalled();

    hooks.loadHcode('HS-14*8@4A1C32:Game.exe');
    text('ハ', { id: 'hcode:1', kind: 'hcode' });
    expect(hooks.selected()).toBe('hcode:1');

    hooks.reset();
    expect(frida.unload.mock.calls).toEqual([['h3'], ['h2']]);
    expect(hooks.selected()).toBe(null);
    onText.mockClear();
    text('三行目');
    expect(onText).toHaveBeenLastCalledWith('三行目');
  });

  it("cleans the driving thread's lines and drops the ones cleaned away", () => {
    onText.mockClear();
    text('今今日日');
    text('skip');
    expect(onText.mock.calls).toEqual([['今日']]);
    expect(clean).toHaveBeenLastCalledWith('skip', 'script');
    // The sheet keeps the hooked text, which it cleans itself.
    expect(hooks.threads().find((thread: any) => thread.id === 'script').last).toBe('skip');
  });

  it('keeps the 200 threads heard last, and the selected one', () => {
    text('選', { id: 'picked', kind: 'search' });
    hooks.select('picked');
    for (let i = 0; i < 300; i++) text('字', { id: `call:${i}`, kind: 'search' });
    const ids = hooks.threads().map((thread: any) => thread.id);
    expect(ids).toHaveLength(200);
    expect(ids).toContain('picked');
    expect(ids).toContain('call:299');
    expect(ids).not.toContain('call:100');
    hooks.select(null);
  });
});
