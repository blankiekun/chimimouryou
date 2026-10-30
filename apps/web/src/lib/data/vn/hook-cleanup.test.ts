/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import {
  cleanHookLine,
  collapseRepeatedChars,
  collapseRepeatedLine,
  collapseRepeatedPhrases,
  collapseTrailingRepeat,
  collapseTypewriter,
  dropRubyFirst,
  hookCleaner,
  keepCp932,
  keepQuotes,
  ruleError,
  stripControl,
  stripMarkup,
  suggestCleanup
} from './hook-cleanup';

describe('hook cleanup filters', () => {
  it('collapses doubled characters, guessing the count and keeping single ones', () => {
    expect(collapseRepeatedChars('ここここはは何何処処？？')).toBe('ここは何処？');
    expect(collapseRepeatedChars('おお前前ははもうう死死んんででいいるる')).toBe(
      'お前はもう死んでいる'
    );
    // Ordinary text is left alone.
    expect(collapseRepeatedChars('そうか……ああ、わかった')).toBe('そうか……ああ、わかった');
    // A set count: a run shorter than it stays.
    expect(collapseRepeatedChars('あああいいいう', 3)).toBe('あいう');
  });

  it('collapses a repeated line and repeated sentences', () => {
    expect(collapseRepeatedLine('吾輩は猫である。吾輩は猫である。')).toBe('吾輩は猫である。');
    expect(collapseRepeatedLine('吾輩は猫である。')).toBe('吾輩は猫である。');
    expect(collapseRepeatedPhrases('おはよう。おはよう。元気？元気？')).toBe('おはよう。元気？');
    expect(collapseRepeatedPhrases('「待って」「待って」そう言った。')).toBe(
      '「待って」そう言った。'
    );
  });

  it('keeps the last of a typewriter redraw', () => {
    expect(collapseTypewriter('ああいあいう')).toBe('あいう');
    expect(collapseTypewriter('今今日今日は今日は晴れ')).toBe('今日は晴れ');
    expect(collapseTypewriter('AABABCABCD')).toBe('ABCD');
    // Two parts could be ordinary text (ここ).
    expect(collapseTypewriter('ここ')).toBe('ここ');
    expect(collapseTypewriter('あいあいう')).toBe('あいあいう');
  });

  it('collapses an ending repeated three or more times', () => {
    expect(collapseTrailingRepeat('どうしてどうしてどうして')).toBe('どうして');
    expect(collapseTrailingRepeat('え？　待ってよ待ってよ待ってよ')).toBe('え？　待ってよ');
    expect(collapseTrailingRepeat('待ってよ待ってよ')).toBe('待ってよ待ってよ');
  });

  it('strips markup, control characters and non-Shift JIS characters', () => {
    expect(stripMarkup('<color=red>{太一/たいち}</color>は{p}走った')).toBe('太一は走った');
    expect(stripControl('今日は\u0001\u001b晴れ\n明日も')).toBe('今日は晴れ\n明日も');
    expect(keepCp932('ＡＢＣ…「髙橋」①ｶﾅé😀')).toBe('ＡＢＣ…「髙橋」①ｶﾅ');
  });

  it('drops a reading padded before its base text (ruby first)', () => {
    expect(dropRubyFirst('くろす　　黒須太一は走った')).toBe('黒須太一は走った');
    expect(dropRubyFirst('彼は　みやすみ  宮澄見里と')).toBe('彼は　宮澄見里と');
  });

  it('keeps only the quotes', () => {
    expect(keepQuotes('太一「行くぞ」')).toBe('「行くぞ」');
    expect(keepQuotes('風が吹いた。')).toBe('風が吹いた。');
  });

  it('validates and applies regex rules, skipping invalid ones', () => {
    expect(ruleError('(')).not.toBe('');
    expect(ruleError('^【.+?】')).toBe('');
    expect(
      cleanHookLine('【太一】「おう」', {
        replace: true,
        rules: [
          { pattern: '^【.+?】', replacement: '' },
          { pattern: '(', replacement: 'x' }
        ]
      })
    ).toBe('「おう」');
  });

  it('runs no filter by default and keeps … and full-width forms (no NFKC)', () => {
    expect(cleanHookLine('ＡＢ……ｶﾅ①', {})).toBe('ＡＢ……ｶﾅ①');
  });

  it('keeps only the new text after a finished line, per thread, unless turned off', () => {
    const clean = hookCleaner({});
    const off = hookCleaner({ newOnly: false });

    off('あ。');
    expect(off('あ。い')).toBe('あ。い');

    expect(clean('少しばかり無邪気すぎる。', 'a')).toBe('少しばかり無邪気すぎる。');
    expect(clean('少しばかり無邪気すぎる。忍「ところで」', 'a')).toBe('忍「ところで」');
    expect(clean('少しばかり無邪気すぎる。', 'b')).toBe('少しばかり無邪気すぎる。');
    expect(clean('新しいページ。', 'a')).toBe('新しいページ。');
    // A typewriter sending each character: the previous line isn't finished, kept whole.
    expect(clean('あ', 'c')).toBe('あ');
    expect(clean('あい', 'c')).toBe('あい');
  });

  it('keeps cutting a finished line while the next one is redrawn in pieces', () => {
    const clean = hookCleaner({});

    expect(clean('「だって、もう子供じゃないもん」\n')).toBe('「だって、もう子供じゃないもん」\n');
    expect(clean('「だって、もう子供じゃないもん」あずさ')).toBe('あずさ');
    expect(clean('「だって、もう子供じゃないもん」あずさ　満面の笑顔で言うのだ。')).toBe(
      'あずさ　満面の笑顔で言うのだ。'
    );
    expect(clean('次のページ')).toBe('次のページ');
    expect(clean('次のページです')).toBe('次のページです');
  });

  it('drops a line that is the one before it behind the end of an older one', () => {
    const clean = hookCleaner({});
    // Each click: the new line, then the previous line's end with the new line again.
    const sent = [
      '満面の笑顔で言うのだ。',
      '忍「…………」',
      '満面の笑顔で言うのだ。忍「…………」',
      'あずさ「……だ、黙るの？」',
      '「…………」忍あずさ「……だ、黙るの？」',
      '忍「あ、いや」',
      '「……だ、黙るの？」あずさ忍「あ、いや」'
    ];

    expect(sent.map((line) => clean(line)).filter(Boolean)).toEqual([
      '満面の笑顔で言うのだ。',
      '忍「…………」',
      'あずさ「……だ、黙るの？」',
      '忍「あ、いや」'
    ]);
  });

  it('drops lines seen lately, per thread, and empty lines', () => {
    const clean = hookCleaner({ recentLines: true, recentSize: 2, markup: true });

    expect(clean('一行目', 'a')).toBe('一行目');
    expect(clean('一行目', 'b')).toBe('一行目');
    expect(clean('一行目', 'a')).toBe('');
    expect(clean('二行目', 'a')).toBe('二行目');
    expect(clean('三行目', 'a')).toBe('三行目');
    expect(clean('一行目', 'a')).toBe('一行目');
    expect(clean('<br>', 'a')).toBe('');
  });
});

describe('suggestCleanup', () => {
  it('never suggests new text only: it is on by default', () => {
    expect(
      suggestCleanup([
        '少しばかり。',
        '少しばかり。忍「ところで」',
        '少しばかり。忍「ところで」行こうか。'
      ])
    ).toBeUndefined();
  });

  it('suggests the repeated-characters filter for a hook doubling every character', () => {
    expect(
      suggestCleanup([
        '今今日日はは晴晴れれ',
        '「「おおははよようう」」',
        'ままたた明明日日',
        '行行くくよよ。。'
      ])
    ).toEqual({ repeatedChars: true });
  });

  it('suggests markup and ruby first together', () => {
    expect(
      suggestCleanup(['<r>くろす　黒須は笑った', '<r>みやすみ　宮澄と話す', '<r>きりはら　霧原だ'])
    ).toEqual({ markup: true, rubyFirst: true });
  });

  it('suggests nothing for clean lines or too few', () => {
    expect(
      suggestCleanup(['吾輩は猫である。', '名前はまだ無い。', 'どこで生れたかとんと見当がつかぬ。'])
    ).toBe(undefined);
    expect(suggestCleanup(['今今日日'])).toBe(undefined);
  });
});
