/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The fast difficulty core, the same as scripts/calibre/jiten/core.py (read its notes): Sudachi's
 * tokens → JMdict compounds joined → word units → frequency ranks → V98 and a log-rank histogram. Both check
 * scripts/calibre/tests/fixtures/difficulty-core.json; change them together. Not part of upstream.
 */

/** The book's core numbers, as the difficulty service stores them (estimate `core`) */
export interface CoreNumbers {
  /** CORE_VERSION */
  v: number;
  /** Running words and different words, without names and noise */
  tokens: number;
  types: number;
  /** Occurrences of names (proper nouns), left out of the rest */
  names: number;
  /** Top-N words of the frequency list for 98% of the running words; null: beyond the list */
  v98: number | null;
  /** Occurrences and different words per log-rank bucket (`bucket`); the last: unranked */
  hist: number[];
  histTypes: number[];
  /** Share of the kanji under the author's ruby, 0-1 (version 2; core.py's facets) */
  rubyKanji?: number;
  /** Mean characters per sentence (version 2) */
  sentLen?: number;
}

export interface WordUnit {
  lemma: string;
  form: string;
  reading: string;
  name: boolean;
}

export const CORE_VERSION = 2;
export const REPEAT_CAP = 10;
const BUCKETS_PER_DECADE = 4;
export const RANKED_BUCKETS = 6 * BUCKETS_PER_DECADE;
/** Lower edges of the ranked buckets (core.py's EDGES) */
export const EDGES = Array.from(
  { length: RANKED_BUCKETS },
  (_, b) => 10 ** (b / BUCKETS_PER_DECADE)
);
const VOCABULARY = new Set([
  '名詞',
  '代名詞',
  '形状詞',
  '連体詞',
  '形容詞',
  '動詞',
  '副詞',
  '接続詞',
  '感動詞'
]);

/** Half up, as core.py's round2 */
const round2 = (value: number) => Math.floor(value * 100 + 0.5) / 100;

const toHiragana = (text: string) =>
  text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** A Sudachi token as yurigana's SudachiTokenizer.tokens gives it: `begin`/`end` are offsets in the text */
export interface CoreToken {
  surface: string;
  form: string;
  lemma: string;
  reading: string;
  pos: string[];
  begin: number;
  end: number;
}

/** The frequency list as the core reads it (build.sh's core-frequency.tsv.gz, `parseCoreTable`) */
export interface CoreTable {
  ranks: Map<string, number>;
  /** `term \t reading` → rank */
  readingRanks: Map<string, number>;
  /** JMdict compounds the list ranks → their reading (compound_merge.compound_table) */
  compounds: Map<string, string>;
}

/** yurigana's HAS_CONTENT */
const hasContent = /[0-9A-Za-z぀-ヿ㐀-䶿一-鿿豈-﫿０-ｚ々]/;

/**
 * A chunk's tokens from Sudachi's rows (the analysis worker's tokenize_rows: `surface \x1f form \x1f
 * normalized \x1f reading \x1f pos,pos…`, joined by \x1e), symbols and blanks left out as yurigana
 * does. `start`: the chunk's offset in the text.
 */
export function tokensOf(rows: string, start = 0): CoreToken[] {
  const tokens: CoreToken[] = [];
  let at = start;

  if (!rows) return tokens;
  for (const row of rows.split('\x1e')) {
    const [surface, form, lemma, reading, pos] = row.split('\x1f');
    const poses = pos.split(',');

    if (poses[0] !== '補助記号' && poses[0] !== '空白' && hasContent.test(surface)) {
      tokens.push({
        surface,
        form,
        lemma,
        reading,
        pos: poses,
        begin: at,
        end: at + surface.length
      });
    }
    at += surface.length;
  }

  return tokens;
}

const MAX_TOKENS = 4;
const NOUN = ['名詞', '普通名詞', '一般', '*', '*', '*'];
const joins = ({ pos }: CoreToken) => pos[0] !== '助詞' && pos[0] !== '助動詞' && pos[1] !== '数詞';

/** FrequencyTable.word: the rank of the term with this reading, else the term's */
function wordRank(table: CoreTable, term: string, reading: string) {
  return (reading && table.readingRanks.get(`${term}\t${reading}`)) || table.ranks.get(term);
}

/**
 * compound_merge.merge_compounds without the Reader's readings (the segmentation seam shared with
 * the word lists, #259): each JMdict compound the tokens spell, commoner than its rarest part, as
 * one token.
 */
export function mergeCompounds(tokens: CoreToken[], table: CoreTable): CoreToken[] {
  const merged: CoreToken[] = [];
  const rank = (token: CoreToken) =>
    wordRank(table, token.lemma, toHiragana(token.reading)) ?? Infinity;

  for (let i = 0; i < tokens.length; ) {
    const token = tokens[i];
    let joined = false;

    if (joins(token)) {
      let end = i + 1;

      while (
        end < tokens.length &&
        end - i < MAX_TOKENS &&
        tokens[end].begin === tokens[end - 1].end &&
        joins(tokens[end])
      ) {
        end++;
      }
      for (let j = end; j > i + 1; j--) {
        const last = tokens[j - 1];
        const stem = tokens
          .slice(i, j - 1)
          .map((t) => t.surface)
          .join('');
        const form = stem + last.form;
        const reading = table.compounds.get(form);

        if (
          reading === undefined ||
          (wordRank(table, form, reading) ?? Infinity) >= Math.max(...tokens.slice(i, j).map(rank))
        ) {
          continue;
        }

        const surface = stem + last.surface;

        merged.push({
          surface,
          form,
          lemma: form,
          reading: surface === form ? reading : '',
          pos: last.pos[0] === '接頭辞' || last.pos[0] === '接尾辞' ? NOUN : last.pos,
          begin: token.begin,
          end: token.begin + surface.length
        });
        i = j;
        joined = true;
        break;
      }
    }
    if (!joined) {
      merged.push(token);
      i++;
    }
  }

  return merged;
}

/** core.py's word_units: vocabulary units from the (merged) tokens. */
export function* wordUnits(tokens: Iterable<CoreToken>): Generator<WordUnit> {
  for (const { form, lemma, reading, pos } of tokens) {
    if (VOCABULARY.has(pos[0])) {
      yield {
        lemma,
        form,
        reading: toHiragana(reading),
        name: pos[0] === '名詞' && pos[1] === '固有名詞'
      };
    }
  }
}

/** core.py's book_core: the book's core numbers from its tokens, with the facets of its text and ruby. */
export function bookCore(tokens: CoreToken[], table: CoreTable, text = '', rubyKanji = 0) {
  return {
    ...summarise(wordUnits(mergeCompounds(tokens, table)), (lemma) => table.ranks.get(lemma)),
    ...coreFacets(text, rubyKanji)
  };
}

const kanjiGlobal = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{3134f}]/gu;
const sentencePattern = /[^。！？!?\n]+[。！？!?」』]*/g;
const blankPattern = /[ \t\r\u00a0\u3000]/g;
/** Code points, as Python's len (astral kanji are two UTF-16 units) */
const codePoints = (text: string) => text.length - (text.match(/[\udc00-\udfff]/g)?.length ?? 0);

/**
 * core.py's facets: rubyKanji, kanji under the author's ruby (`rubyKanji`, rubyKanjiCount) per
 * kanji of the text, at most 1; sentLen, mean characters per sentence (two non-blank at least).
 */
export function coreFacets(text: string, rubyKanji: number) {
  const kanji = text.match(kanjiGlobal)?.length ?? 0;
  let total = 0;
  let count = 0;

  for (const [sentence] of text.matchAll(sentencePattern)) {
    if (sentence.replace(blankPattern, '').length >= 2) {
      total += codePoints(sentence);
      count++;
    }
  }

  return {
    rubyKanji: kanji ? round2(Math.min(rubyKanji / kanji, 1)) : 0,
    sentLen: count ? round2(total / count) : 0
  };
}

/** Kanji in the HTML's ruby bases (yurigana's _count_ruby over book_text's ruby) */
export function rubyKanjiCount(html: string) {
  let count = 0;

  for (const [, base] of html.matchAll(/<ruby\b[^>]*>([\s\S]*?)<\/ruby>/gi)) {
    count += coreText(base).match(kanjiGlobal)?.length ?? 0;
  }

  return count;
}

/**
 * build.sh's core list: `term \t rank` lines, a blank line, `term \t reading \t rank` lines, a
 * blank line, `compound \t reading` lines.
 */
export function parseCoreTable(text: string): CoreTable {
  const table: CoreTable = { ranks: new Map(), readingRanks: new Map(), compounds: new Map() };
  let section = 0;

  for (let at = 0; at < text.length; ) {
    let end = text.indexOf('\n', at);

    if (end < 0) end = text.length;
    if (end === at) {
      section++;
    } else {
      const tab = text.lastIndexOf('\t', end);
      const key = text.slice(at, tab);
      const value = text.slice(tab + 1, end);

      if (section === 0) table.ranks.set(key, +value);
      else if (section === 1) table.readingRanks.set(key, +value);
      else table.compounds.set(key, value);
    }
    at = end + 1;
  }

  return table;
}

export function bucket(rank: number | null | undefined) {
  if (rank == null) return RANKED_BUCKETS;

  let b = 0;

  while (b + 1 < RANKED_BUCKETS && EDGES[b + 1] <= rank) b++;

  return b;
}

const numberPattern = /^[0-9０-９〇一二三四五六七八九十百千万]+$/;
const singleKanaPattern = /^[ぁ-ゟ゠-ヿー]$/;
const kanjiPattern = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{3134f}]/u;
const particles = new Set(
  (
    'は が を に で と も の へ や か な ね よ わ ぞ ぜ さ て ば し から まで より だけ ほど ' +
    'くらい ぐらい など なら って けど けれど のに ので しか こそ でも ても さえ'
  ).split(' ')
);

/** word_list.is_noise_word */
function isNoise(form: string, rank: number | null | undefined) {
  return (
    particles.has(form) ||
    numberPattern.test(form) ||
    singleKanaPattern.test(form) ||
    (rank == null && !kanjiPattern.test(form))
  );
}

/** core.py's summarise: the book's core numbers from its word units. */
export function summarise(
  units: Iterable<WordUnit>,
  rankOf: (lemma: string) => number | null | undefined
): CoreNumbers {
  const words = new Map<string, [count: number, rank: number | null]>();
  let names = 0;

  for (const { lemma, form, name } of units) {
    if (name) {
      names++;
      continue;
    }

    let word = words.get(lemma);

    if (!word) {
      const rank = rankOf(lemma) ?? null;

      if (isNoise(form, rank)) continue;
      words.set(lemma, (word = [0, rank]));
    }
    word[0]++;
  }

  const all = [...words.values()];
  const tokens = all.reduce((sum, [n]) => sum + n, 0);
  const hist = new Array<number>(RANKED_BUCKETS + 1).fill(0);
  const histTypes = new Array<number>(RANKED_BUCKETS + 1).fill(0);

  for (const [n, rank] of all) {
    hist[bucket(rank)] += n;
    histTypes[bucket(rank)] += 1;
  }

  let covered = all.reduce((sum, [n]) => sum + Math.max(n - REPEAT_CAP, 0), 0);
  let v98: number | null = tokens && covered * 50 >= tokens * 49 ? 1 : null;

  if (v98 === null) {
    for (const [n, rank] of all.filter(([, rank]) => rank !== null).sort((a, b) => a[1]! - b[1]!)) {
      covered += Math.min(n, REPEAT_CAP);
      if (covered * 50 >= tokens * 49) {
        v98 = rank;
        break;
      }
    }
  }

  return { v: CORE_VERSION, tokens, types: words.size, names, v98, hist, histTypes };
}

/** The frozen 1-10 scale (core-scale.json) */
export interface CoreScale {
  version: number;
  tiers: string[];
  /** [score, V98], both rising */
  anchors: [number, number][];
}

/** core.py's score: V98 on the 1-10 scale, log-linear between the anchors, clamped. */
export function coreScore(v98: number | null, scale: CoreScale) {
  const { anchors } = scale;
  const top = anchors[anchors.length - 1][0];

  if (v98 === null) return top;

  const x = Math.log(v98);

  if (x <= Math.log(anchors[0][1])) return anchors[0][0];
  for (let i = 1; i < anchors.length; i++) {
    const [s0, v0] = anchors[i - 1];
    const [s1, v1] = anchors[i];

    if (x <= Math.log(v1)) {
      return round2(s0 + ((s1 - s0) * (x - Math.log(v0))) / (Math.log(v1) - Math.log(v0)));
    }
  }

  return top;
}

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};

/**
 * The book's text from its HTML, close to readings_file.extract: ruby text (rt, rp) left out, a
 * newline at block ends. shortcut: [hidden] subtrees are kept; they are rare in books and only add
 * a few words to the estimate.
 */
export function coreText(html: string) {
  return html
    .replace(/<(rt|rp)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\b[^>]*>|<\/(p|div|h[1-6]|li|blockquote|tr|dd|dt|section|article)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity, name: string) => {
      if (name[0] !== '#') return entities[name.toLowerCase()] ?? entity;

      const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : +name.slice(1);

      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    });
}

/** Characters as the estimate counts them (features.TOKEN_CLEAN keeps these) */
export const countCharacters = (text: string) =>
  text.match(/[a-zA-Z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fafＡ-Ｚａ-ｚ０-９々．]/g)?.length ?? 0;

/**
 * The text's chunks for Sudachi and their offsets: paragraphs, cut at a sentence end past 5,000
 * characters (yurigana's SudachiTokenizer.tokens).
 */
export function* chunks(text: string): Generator<[chunk: string, start: number]> {
  let offset = 0;

  for (let paragraph of text.split('\n')) {
    let start = offset;

    offset += paragraph.length + 1;
    while (paragraph) {
      let chunk = paragraph.slice(0, 5000);

      if (paragraph.length > 5000) {
        const cut = Math.max(...[...'。！？'].map((c) => chunk.lastIndexOf(c)));

        if (cut > 0) chunk = paragraph.slice(0, cut + 1);
      }
      paragraph = paragraph.slice(chunk.length);
      yield [chunk, start];
      start += chunk.length;
    }
  }
}
