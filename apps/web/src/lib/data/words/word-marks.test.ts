/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { BookWord } from '$lib/data/words/book-words';
import {
  formMarked,
  markEntry,
  markedWords,
  markedWordsCsv,
  marksOf,
  selectionForm
} from '$lib/data/words/word-marks';

vi.mock('$lib/data/sync/extras-sync', () => ({
  pullKanji: async () => {},
  kanjiChanged: () => {},
  pullWordMarks: async () => {},
  wordMarksChanged: () => {}
}));

const mark = { status: 'known' as const, modified: 1 };

describe('word marks', () => {
  it('marks by form unless the list reads the form two ways', () => {
    const list: BookWord[] = [
      ['猫', 'ねこ', 5, 100],
      ['私', 'わたし', 9, 10],
      ['私', 'わたくし', 2, 10]
    ];

    expect(markEntry(list, list[0])).toEqual(['猫', null]);
    expect(markEntry(list, list[2])).toEqual(['私', 'わたくし']);
  });

  it('finds the marks of a word, old reading marks included', () => {
    const marks = { '猫\tねこ': mark, '猫\t': { status: null, modified: 2 } };

    expect(marksOf(marks, ['猫', 'ねこ', 1, 1])).toEqual([['猫', 'ねこ']]);
    expect(formMarked(marks, '猫')).toBe(true);
    expect(formMarked(marks, '犬')).toBe(false);
  });

  it('matches conjugated selections to their word-list form', () => {
    const forms = new Set(['呟く', '勉強する', '美しい', '見る', '見せる', 'する']);

    expect(selectionForm('呟く', forms)).toBe('呟く');
    expect(selectionForm('呟いた', forms)).toBe('呟く');
    expect(selectionForm('勉強した', forms)).toBe('勉強する');
    expect(selectionForm('美しかった', forms)).toBe('美しい');
    expect(selectionForm('見せた', forms)).toBe('見せる');
    expect(selectionForm('した', forms)).toBe('');
    expect(selectionForm('呟きの声', forms)).toBe('');
  });
});

describe('markedWords', () => {
  it('lists active marks newest first and exports them', () => {
    const words = markedWords({
      '猫\t': { status: 'known', modified: Date.UTC(2026, 9, 20) },
      '犬\tいぬ': { status: 'ignored', modified: Date.UTC(2026, 9, 22) },
      '鳥\t': { status: null, modified: Date.UTC(2026, 9, 23) }
    });

    expect(words.map(({ form, reading, status }) => [form, reading, status])).toEqual([
      ['犬', 'いぬ', 'ignored'],
      ['猫', '', 'known']
    ]);
    expect(markedWordsCsv(words)).toBe(
      '\uFEFFword,reading,status,marked\r\n犬,いぬ,ignored,2026-10-22\r\n猫,,known,2026-10-20\r\n'
    );
  });
});
