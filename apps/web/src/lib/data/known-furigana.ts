/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The "Known" furigana style: hides ruby over kanji the reader has met often,
 * but only ruby that is a plain hiragana reading of its base. Not part of upstream.
 */

import { getKanjiSeen } from '$lib/data/kanji-seen';

/** Times every kanji of a base must have been met (all books) for its ruby to hide. */
export const knownKanjiMinCount = 10;

export const knownRubyClass = 'ttu-known-ruby';

const kanjiPattern = /\p{Unified_Ideograph}/u;
const hiraganaOnly = /^[ぁ-ゖ]+$/;
const voiced: Record<string, string> = {
  か: 'が',
  き: 'ぎ',
  く: 'ぐ',
  け: 'げ',
  こ: 'ご',
  さ: 'ざ',
  し: 'じ',
  す: 'ず',
  せ: 'ぜ',
  そ: 'ぞ',
  た: 'だ',
  ち: 'ぢ',
  つ: 'づ',
  て: 'で',
  と: 'ど',
  は: 'ばぱ',
  ひ: 'びぴ',
  ふ: 'ぶぷ',
  へ: 'べぺ',
  ほ: 'ぼぽ'
};

function toHiragana(text: string) {
  return text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** A kanji's reading as it can sound in a word: rendaku (ひと → びと) and っ (がく → がっ). */
function variants(reading: string) {
  const starts = [reading[0], ...(voiced[reading[0]] ?? '')];
  const result: string[] = [];

  for (const start of starts) {
    const word = start + reading.slice(1);
    result.push(word);
    if (word.length > 1 && 'つちくき'.includes(word[word.length - 1])) {
      result.push(`${word.slice(0, -1)}っ`);
    }
  }

  return result;
}

/**
 * Whether `reading` is spelled by the readings of the base's kanji (on and kun of
 * 常用/人名用 kanji, from KANJIDIC2) and its kana. Gikun like そら over 宇宙 and
 * jukujikun like きょう over 今日 aren't, and neither are kanji outside the table.
 */
export function isPlainReading(base: string, reading: string, readings: Record<string, string>) {
  const match = (i: number, j: number): boolean => {
    if (i === base.length) {
      return j === reading.length;
    }

    const char = base[i];
    if (!kanjiPattern.test(char) && char !== '々') {
      return reading[j] === toHiragana(char) && match(i + 1, j + 1);
    }

    const own = readings[char === '々' && i > 0 ? base[i - 1] : char];
    return (own?.split(' ') ?? [])
      .flatMap(variants)
      .some((form) => reading.startsWith(form, j) && match(i + 1, j + form.length));
  };

  return match(0, 0);
}

/**
 * Hide ruby only when its reading is plain hiragana that spells the base's usual
 * reading and every kanji of the base was met at least `minCount` times. Ruby that is
 * katakana, contains kanji or is any other reading is the author's choice and stays.
 */
export function hideKnownRuby(
  base: string,
  reading: string,
  kanjiTotals: Record<string, number>,
  readings: Record<string, string>,
  minCount = knownKanjiMinCount
) {
  const kanji = [...base].filter((char) => kanjiPattern.test(char));

  return (
    kanji.length > 0 &&
    hiraganaOnly.test(reading) &&
    kanji.every((char) => (kanjiTotals[char] ?? 0) >= minCount) &&
    isPlainReading(base, reading, readings)
  );
}

/** Kanji met across all books in this browser. */
export function totalKanjiCounts(books: { counts: Record<string, number> }[]) {
  const totals: Record<string, number> = {};
  for (const book of books) {
    for (const [kanji, count] of Object.entries(book.counts)) {
      totals[kanji] = (totals[kanji] ?? 0) + count;
    }
  }
  return totals;
}

/** Loads the kanji met and the readings table once, e.g. when a book opens. */
export async function loadKnownRubyCheck() {
  const [books, table] = await Promise.all([getKanjiSeen(), import('./kanji-readings.json')]);
  const totals = totalKanjiCounts(books);
  const readings: Record<string, string> = table.default;

  return (base: string, reading: string) => hideKnownRuby(base, reading, totals, readings);
}

/** Marks the ruby elements to hide in a rendered section and returns them. */
export function markKnownRuby(
  contentEl: HTMLElement,
  hide: (base: string, reading: string) => boolean
) {
  return Array.from(contentEl.getElementsByTagName('ruby')).filter((ruby) => {
    let base = '';
    let reading = '';
    for (const node of ruby.childNodes) {
      const tag = node.nodeName.toLowerCase();
      if (tag === 'rt') {
        reading += node.textContent ?? '';
      } else if (tag !== 'rp') {
        base += node.textContent ?? '';
      }
    }

    const marked = hide(base.trim(), reading.trim());
    ruby.classList.toggle(knownRubyClass, marked);
    return marked;
  });
}
