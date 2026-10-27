/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it, vi } from 'vitest';
import { VnReading, vnTextSource } from '$lib/data/vn-text';
import { vnboxLines } from '$lib/data/vn';

const options = { statistics: true, startDayHours: 0 };
const sjis = (text: string) => new Uint8Array(new TextEncoder().encode(text));

describe('vnTextSource', () => {
  it('turns a CONscripter page (bytes, boxes, read flags) into text and overlay lines', () => {
    const onText = vi.fn();
    const source = vnTextSource({ encoding: 'utf8', files: [] }, onText);
    const bytes = sjis('猫だ');

    expect(source.player).toBe('player.html');
    source.onText(bytes, 1, new Int32Array(), 1);
    expect(onText).toHaveBeenCalledWith('猫だ', true, true);
    expect(source.textLines(bytes, [0, 10, 20, 24, 3, 34, 20, 24])).toEqual([
      { text: '猫だ', x: 10, y: 20, size: 24, pitch: 24 }
    ]);
  });

  it('hands on a VNBox hook line as read, never skipped', () => {
    const onText = vi.fn();
    const source = vnTextSource({ encoding: 'sjis', files: [], engine: 'vnbox' }, onText);

    expect(source.player).toBe('vnbox.html');
    source.onText('「こんにちは」');
    expect(onText).toHaveBeenCalledWith('「こんにちは」', false, false);
    expect(source.textLines('あ', 640, 480)).toEqual(vnboxLines('あ', { width: 640, height: 480 }));
  });
});

describe('vnboxLines', () => {
  it('splits long lines into rows of 30 characters at the bottom of the screen', () => {
    const rows = vnboxLines(`${'あ'.repeat(35)}\nい`);

    expect(rows.map((row) => row.text)).toEqual(['あ'.repeat(30), 'あ'.repeat(5), 'い']);
    expect(rows[1].y).toBeGreaterThan(rows[0].y);
    expect(rows[0].x).toBe(40);
  });
});

describe('VnReading', () => {
  const start = new Date(2026, 9, 26, 12).getTime();
  const reading = () => new VnReading({ title: 'g', pages: [], characters: 0 }, new Map(), start);

  it('counts what each page adds, with the time since the last text', () => {
    const game = reading();

    expect(game.add('猫が', false, false, options, start + 5000)).toBe(true);
    game.add('猫が好き', false, false, options, start + 9000);

    const changes = game.takeChanges()!;

    expect(changes.read.characters).toBe(4);
    expect(changes.text).toBe('猫が好き');
    expect(changes.days).toHaveLength(1);
    expect(changes.days[0]).toMatchObject({ charactersRead: 4, readingTime: 9 });
    expect(game.takeChanges()).toBeUndefined();
  });

  it('counts skipped, reread and read-before text as nothing', () => {
    const game = reading();

    game.add('猫', false, false, options, start + 1000);
    game.add('犬', true, false, options, start + 2000);
    game.add('猫', false, false, options, start + 3000);
    game.add('鳥', false, true, options, start + 4000);

    expect(game.read.characters).toBe(1);
  });

  it('caps a break and keeps statistics out when they are off', () => {
    const game = reading();

    game.add('猫', false, false, { ...options, statistics: false }, start + 3600_000);

    expect(game.takeChanges()!.days).toEqual([]);

    game.add('犬', false, false, options, start + 2 * 3600_000);
    expect(game.takeChanges()!.days[0].readingTime).toBe(120);
  });
});
