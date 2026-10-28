/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { isSocketUrl, lineCount, parseHookMessage } from './texthooker';

describe('texthooker', () => {
  it('reads plain text and the JSON the tools send', () => {
    expect(parseHookMessage('  「おはよう」\n')).toBe('「おはよう」');
    expect(parseHookMessage('{"sentence":"猫だ","time":1}')).toBe('猫だ');
    expect(parseHookMessage('{"text":"犬だ"}')).toBe('犬だ');
    expect(parseHookMessage('"引用"')).toBe('引用');
    expect(parseHookMessage('{ 括弧で始まる行')).toBe('{ 括弧で始まる行');
    expect(parseHookMessage('{"other":1}')).toBe('');
    expect(parseHookMessage(new ArrayBuffer(2))).toBe('');
  });

  it('counts characters and the time since the last line, capped like an idle pause', () => {
    const last = { id: '1', text: '前の行', at: 0 };

    expect(lineCount('今日は、晴れ。', undefined, 5000, 300)).toEqual({
      characters: 5,
      seconds: 0,
      repeat: false
    });
    expect(lineCount('今日は', last, 12_400, 300)).toMatchObject({ characters: 3, seconds: 12 });
    expect(lineCount('今日は', last, 3_600_000, 300).seconds).toBe(300);
    expect(lineCount('今日は', last, 3_600_000, 0).seconds).toBe(120);
    // Closed and reopened: a line kept from before the page opened adds no time.
    expect(lineCount('今日は', last, 3_600_000, 300, 3_000_000).seconds).toBe(0);
    expect(lineCount('今日は', { ...last, at: 3_590_000 }, 3_600_000, 300, 3_000_000).seconds).toBe(
      10
    );
    expect(lineCount('前の行', last, 9000, 300)).toEqual({
      characters: 0,
      seconds: 0,
      repeat: true
    });
  });

  it('only takes WebSocket addresses', () => {
    expect(isSocketUrl('ws://localhost:6677')).toBe(true);
    expect(isSocketUrl('wss://example.com/hook')).toBe(true);
    expect(isSocketUrl('http://localhost:6677')).toBe(false);
    expect(isSocketUrl('localhost:6677')).toBe(false);
  });
});
