/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { backlogLines } from '$lib/data/vn/vn-backlog';

const line = (text: string, picture = true, sound = false) => ({ text, picture, sound });

describe('backlogLines', () => {
  it('lists what each click wait added, newest first', () => {
    expect(backlogLines([line('猫だ。'), line('猫だ。犬だ。'), line('新しい。')])).toEqual([
      { text: '新しい。', picture: true, sound: false, index: 2 },
      { text: '犬だ。', picture: true, sound: false, index: 1 },
      { text: '猫だ。', picture: true, sound: false, index: 0 }
    ]);
  });

  it('lists a repeated line once, where it was first read, with the newest copy', () => {
    const lines = backlogLines([
      line('一。', false),
      line('二。', false),
      line('一。', true, true),
      line('一。', true, true)
    ]);

    expect(lines).toEqual([
      { text: '二。', picture: false, sound: false, index: 1 },
      { text: '一。', picture: true, sound: true, index: 3 }
    ]);
  });

  it('skips click waits that added nothing', () => {
    expect(backlogLines([line('あ'), line('あ '), line('')]).map((l) => l.index)).toEqual([0]);
  });
});
