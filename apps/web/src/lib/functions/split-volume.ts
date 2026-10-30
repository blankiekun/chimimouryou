/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/*
 * Line-for-line port of `split_volume`, `kanji_number` and `is_series_name` in
 * server/build-catalog.py, so browser libraries group series like the catalog. split-volume.json
 * pins both: change the Python first, regenerate the rows from it, then this.
 *
 * Python's regex flavour is spelled out: `\s` and strip() are str.isspace(), `.` stops only at
 * \n, `\d` is any Unicode decimal digit (float() reads them all), len() counts code points.
 */

const S = '\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const D = '\\p{Nd}';

const editionLabel = new RegExp(
  `[${S}]*[【\\[(（〔][^】\\])）〕]*(?:版|文庫|ノベル|ブックス|BOOKS|Books|特典|限定|特装|コミック)[^】\\])）〕]*[】\\])）〕]$`,
  'u'
);
const authorPrefix = new RegExp(`^\\[[^\\]]+\\][${S}]*`, 'u');
const kanjiDigits: Record<string, number> = {
  〇: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};
const volumeWords: Record<string, number> = {
  上: 1,
  中: 2,
  下: 3,
  前編: 1,
  後編: 2,
  上巻: 1,
  中巻: 2,
  下巻: 3
};
const volumeSuffixes = [
  new RegExp(`^(?<base>[^\\n]+?)[${S}]*(?:vol(?:ume)?\\.?|#|＃)[${S}]*(?<num>${D}+)[${S}]*$`, 'iu'),
  new RegExp(
    `^(?<base>[^\\n]+?)[${S}]*[(\\[【]?[${S}]*(?<word>上巻|中巻|下巻|前編|後編|上|中|下)[${S}]*[)\\]】]?$`,
    'u'
  ),
  new RegExp(
    `^(?<base>[^\\n]+?)[${S}]*[(\\[【〈《]?[${S}]*(?:第[${S}]*)?` +
      `(?<num>${D}+(?:\\.${D}+)?|[〇一二三四五六七八九十百]+)[${S}]*(?:巻|部|章|話|集|冊)?[${S}]*[)\\]】〉》]?$`,
    'u'
  )
];

function strip(text: string, chars: string) {
  return text.replace(new RegExp(`^[${chars}]+|[${chars}]+$`, 'gu'), '');
}

/** A decimal digit's value: Unicode puts each script's 0-9 in a row, so count the digits before it. */
function digitValue(char: string) {
  let code = char.codePointAt(0)!;
  let value = 0;

  while (/\p{Nd}/u.test(String.fromCodePoint(--code))) value += 1;

  return value % 10;
}

/** A kanji numeral such as 二十三 or 百五. */
export function kanjiNumber(text: string) {
  let total = 0;
  let current = 0;

  for (const char of text) {
    if (char === '百') {
      total += (current || 1) * 100;
      current = 0;
    } else if (char === '十') {
      total += (current || 1) * 10;
      current = 0;
    } else {
      current = current * 10 + kanjiDigits[char];
    }
  }

  return total + current;
}

/** `kanji_number`: digits in any script (one decimal point) or a kanji numeral, as the regex gives it. */
function volumeNumber(text: string) {
  return /^\p{Nd}+$/u.test(text.replace('.', ''))
    ? Number([...text].map((char) => (char === '.' ? char : digitValue(char))).join(''))
    : kanjiNumber(text);
}

/** 'ダンタリアンの書架１' → ['ダンタリアンの書架', 1]; the cleaned title and null without a volume. */
export function splitVolume(title: string): [string, number | null] {
  const text = strip(
    strip(title.normalize('NFKC').replace(authorPrefix, ''), S).replace(editionLabel, ''),
    S
  );

  for (const pattern of volumeSuffixes) {
    const groups = text.match(pattern)?.groups;
    const base = groups && strip(groups.base, ' 　\\-‐－:：・,、');

    if (base) {
      return [base, groups.word ? volumeWords[groups.word] : volumeNumber(groups.num)];
    }
  }

  return [text, null];
}

/** Product codes like 'b522apdm' and very short leftovers are no series. */
export function isSeriesName(name: string) {
  // ıİſK: what Python's re.I also matches with a-z.
  return [...name].length >= 2 && !/^[0-9a-z_ıİſK-]+$/iu.test(name);
}
