/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// static/vn/overlay.js with hooked lines (vnbox.js): a hook fires before its text is drawn, so a
// line's one screenshot is taken at the next click or key, or as a different line comes.
describe('VN hooked line screenshots', () => {
  const win = window as any;
  let shots = 0;

  beforeAll(() => {
    document.body.innerHTML = `<canvas id="canvas"></canvas><div id="overlay">
      <div id="page-text"></div></div>`;
    vi.stubGlobal('AudioNode', class {});
    window.eval(readFileSync('static/vn/overlay.js', 'utf8'));
    win.eval(
      'var lineVoice = null; hookedLines = true; keepLines = true; voiceFile = function () { return null; }'
    );
    HTMLCanvasElement.prototype.toBlob = function (resolve: BlobCallback) {
      shots += 1;
      resolve(new Blob([String(shots)]));
    };
  });

  const line = (text: string) => win.keepLine([{ text }]);
  const click = () => window.dispatchEvent(new MouseEvent('mousedown'));

  it('takes one screenshot per line, shared by a line hooked twice', () => {
    line('あ');
    expect(shots).toBe(0);
    expect(win.keptLineList().at(-1).picture).toBe(true);
    line('あ');
    click();
    expect(shots).toBe(1);
    line('い');
    // The next line comes first: the screen still shows い's line before it.
    line('う');
    expect(shots).toBe(2);
    click();
    click();
    expect(shots).toBe(3);
  });

  it('takes none when screenshots are off', () => {
    win.eval('keepLines = false');
    line('え');
    click();
    expect(shots).toBe(3);
    expect(win.keptLineList().at(-1).picture).toBe(false);
  });
});
