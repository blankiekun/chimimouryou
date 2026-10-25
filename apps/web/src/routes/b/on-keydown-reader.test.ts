/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { isIgnoredReaderKey, isSearchShortcut } from './on-keydown-reader';

function keydown(init: KeyboardEventInit, target: Element = document.body) {
  const event = new KeyboardEvent('keydown', { bubbles: true, ...init });

  Object.defineProperty(event, 'target', { value: target });
  return event;
}

describe('reader key guards', () => {
  it('takes Ctrl/Cmd+F as Search', () => {
    expect(isSearchShortcut(keydown({ key: 'f', ctrlKey: true }))).toBe(true);
    expect(isSearchShortcut(keydown({ key: 'F', metaKey: true }))).toBe(true);
    expect(isSearchShortcut(keydown({ key: 'f' }))).toBe(false);
  });

  it('leaves typing in fields, modifiers and repeats alone', () => {
    const box = document.createElement('label');
    const input = document.createElement('input');

    box.append(input);
    expect(isIgnoredReaderKey(keydown({ key: 'ArrowLeft' }))).toBe(false);
    expect(isIgnoredReaderKey(keydown({ key: 'ArrowLeft' }, input))).toBe(true);
    expect(isIgnoredReaderKey(keydown({ key: 'ArrowLeft', shiftKey: true }))).toBe(true);
    expect(isIgnoredReaderKey(keydown({ key: 'ArrowLeft', repeat: true }))).toBe(true);
  });
});
