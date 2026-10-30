/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The chapter primer in the reader's Contents: per chapter, the unknown words (unknown-words.ts)
 * met at least `primerMinCount` times in it, from the readings file's occurrences. Not part of
 * upstream.
 */

import type { Section } from '$lib/data/database/books-db/versions/v3/books-db-v3';
import type { ReadingsFile } from '$lib/data/words/generated-furigana';
import { occurrences } from '$lib/data/words/unknown-words';

export const primerMinCount = 3;

export interface PrimerWord {
  form: string;
  reading: string | null;
  count: number;
}

/** Top-level chapter reference → its primer words, most met first. */
export type ChapterPrimer = Record<string, PrimerWord[]>;

export function chapterPrimer(
  readings: ReadingsFile,
  unknown: boolean[],
  sections: Section[],
  minCount = primerMinCount
): ChapterPrimer {
  // Each section's range, credited to its top-level chapter (continuation sections too).
  const ranges = sections
    .filter((section) => section.startCharacter !== undefined && section.characters)
    .map((section) => ({
      chapter: section.parentChapter ?? section.reference,
      start: section.startCharacter as number,
      end: (section.startCharacter as number) + (section.characters as number)
    }))
    .sort((a, b) => a.start - b.start);
  const counts = new Map<string, Map<number, number>>();
  let r = 0;

  for (const [start, , word] of occurrences(readings)) {
    if (!unknown[word]) continue;
    while (r < ranges.length && ranges[r].end <= start) r += 1;
    if (r === ranges.length) break;
    if (start < ranges[r].start) continue;

    const chapter = counts.get(ranges[r].chapter) ?? new Map<number, number>();

    chapter.set(word, (chapter.get(word) ?? 0) + 1);
    counts.set(ranges[r].chapter, chapter);
  }

  const primer: ChapterPrimer = {};

  for (const [chapter, words] of counts) {
    const list = [...words]
      .filter(([, count]) => count >= minCount)
      .map(([word, count]) => {
        const [form, reading] = readings.words?.[word] ?? ['', null];

        return { form, reading, count };
      })
      // Stable sort: equal counts keep the order they first appear in.
      .sort((a, b) => b.count - a.count);

    if (list.length) primer[chapter] = list;
  }

  return primer;
}
