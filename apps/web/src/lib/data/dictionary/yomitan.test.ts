/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { isYomitanPopup, watchYomitan, yomitanSeen$ } from '$lib/data/dictionary/yomitan';

describe('isYomitanPopup', () => {
  it('knows the popup frame, not other elements', () => {
    const frame = document.createElement('iframe');
    frame.className = 'yomitan-popup';
    expect(isYomitanPopup(frame)).toBe(true);
    expect(isYomitanPopup(document.createElement('div'))).toBe(false);
    expect(isYomitanPopup(document.createTextNode('x'))).toBe(false);
  });
});

describe('watchYomitan', () => {
  it('remembers a popup added to the body', async () => {
    yomitanSeen$.next(false);
    watchYomitan(window);
    const frame = document.createElement('iframe');
    frame.className = 'yomitan-popup';
    document.body.appendChild(frame);
    await new Promise((resolve) => setTimeout(resolve));
    expect(yomitanSeen$.getValue()).toBe(true);
    frame.remove();
  });
});
