/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * A Windows game's text cleanup: filters for what hooks get wrong (doubled characters, redraws,
 * markup, ruby), run in a fixed order on each hooked line before the overlay, statistics, Anki
 * and the backlog see it (vnbox.js `clean`). Saved per game next to the hook (VnInfo.hookCleanup).
 * No Unicode normalization: NFKC turns … and full-width forms into ASCII. Not upstream.
 */

export interface HookRule {
  pattern: string;
  replacement: string;
}

/** Every filter is off unless set, except newOnly: on unless false. */
export interface HookCleanup {
  /** Control characters (line breaks stay) */
  control?: boolean;
  /** <tags>, {base/reading} ruby (the base stays) and other {…} */
  markup?: boolean;
  /** Characters Shift JIS (cp932) has no code for: garbage from a wrong hook */
  cp932?: boolean;
  /** A reading padded with spaces before its base text (CROSS†CHANNEL): the reading goes */
  rubyFirst?: boolean;
  /** AAAABBBB → AB, each run of a character divided by repeatCount */
  repeatedChars?: boolean;
  /** 0 or unset: guessed per line, the most common run length */
  repeatCount?: number;
  /** あああいあいう → あいう: a line redrawn one more character at a time */
  typewriter?: boolean;
  /** ABCABC → ABC */
  repeatedLine?: boolean;
  /** S1S1S2S2 → S1S2: each sentence twice */
  repeatedPhrases?: boolean;
  /** XYZ at the end three or more times → once */
  trailingRepeat?: boolean;
  /** Only the 「…」 part, when there is one (drops a name before it) */
  quotesOnly?: boolean;
  /** The rules' regular expressions replaced, in order */
  replace?: boolean;
  rules?: HookRule[];
  /**
   * A line starting with the thread's last one keeps only the new text (a page the game adds
   * to). On unless false, so saved cleanups from before it get it too.
   */
  newOnly?: boolean;
  /** Drop a line seen in the last recentSize lines (a game's backlog screen firing the hook) */
  recentLines?: boolean;
  recentSize?: number;
}

export type HookFilter = Exclude<keyof HookCleanup, 'repeatCount' | 'rules' | 'recentSize'>;

/** The filters in the order they run, with their names for the Hooks sheet. */
export const hookFilters: { key: HookFilter; title: string; hint: string }[] = [
  { key: 'control', title: 'Control characters', hint: 'Removes invisible control characters.' },
  {
    key: 'markup',
    title: 'Tags and {ruby}',
    hint: 'Removes <tags>; {base/reading} keeps the base.'
  },
  { key: 'cp932', title: 'Non-Shift JIS', hint: 'Removes characters Shift JIS has no code for.' },
  {
    key: 'rubyFirst',
    title: 'Ruby first',
    hint: 'Removes a reading padded with spaces before its kanji.'
  },
  { key: 'repeatedChars', title: 'Repeated characters', hint: 'ああいいうう → あいう.' },
  { key: 'typewriter', title: 'Typewriter redraws', hint: 'ああいあいう → あいう.' },
  { key: 'repeatedLine', title: 'Repeated line', hint: 'あいうあいう → あいう.' },
  {
    key: 'repeatedPhrases',
    title: 'Repeated sentences',
    hint: 'Each sentence once: S1S1S2S2 → S1S2.'
  },
  {
    key: 'trailingRepeat',
    title: 'Repeated ending',
    hint: 'An ending repeated three or more times, once.'
  },
  {
    key: 'quotesOnly',
    title: 'Only 「…」',
    hint: 'Keeps the quoted speech, drops a name before it.'
  },
  { key: 'replace', title: 'Replace', hint: 'Your regular expressions, in order.' },
  {
    key: 'newOnly',
    title: 'New text only',
    hint: 'Drops the previous line when the next one repeats it first.'
  },
  {
    key: 'recentLines',
    title: 'Recent lines',
    hint: 'Drops a line already seen lately (backlog screens).'
  }
];

export const defaultRecentSize = 10;

/** Whether a filter runs: newOnly is on by default, the rest off. */
export function filterOn(cleanup: HookCleanup, key: HookFilter) {
  return key === 'newOnly' ? cleanup.newOnly !== false : !!cleanup[key];
}

export function stripControl(text: string) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '');
}

export function stripMarkup(text: string) {
  return text
    .replace(/<[^<>]*>/g, '')
    .replace(/\{([^{}/:|]*)[/:|][^{}]*\}/g, '$1')
    .replace(/\{[^{}]*\}/g, '');
}

let cp932Chars: Set<string> | undefined;

function cp932Set() {
  if (cp932Chars) return cp932Chars;

  const decoder = new TextDecoder('shift_jis');
  const chars = new Set<string>();
  const add = (bytes: number[]) => {
    const char = decoder.decode(new Uint8Array(bytes));

    if ([...char].length === 1 && char !== '�') chars.add(char);
  };

  for (let byte = 0; byte < 0xe0; byte += 1) if (byte < 0x80 || byte > 0xa0) add([byte]);
  for (let lead = 0x81; lead <= 0xfc; lead += 1) {
    if (lead > 0x9f && lead < 0xe0) continue;
    for (let trail = 0x40; trail <= 0xfc; trail += 1) if (trail !== 0x7f) add([lead, trail]);
  }
  cp932Chars = chars;

  return chars;
}

export function keepCp932(text: string) {
  const chars = cp932Set();

  return [...text].filter((char) => chars.has(char)).join('');
}

const kana = 'ぁ-ゟ゠-ヿ';

export function dropRubyFirst(text: string) {
  return text.replace(
    new RegExp(`[${kana}]+[ \\u3000]+(?=[\\u3400-\\u9fff\\uf900-\\ufaff々〆ヶ])`, 'gu'),
    ''
  );
}

/** Runs of one character, as [char, length]. */
function runs(text: string) {
  const found: [string, number][] = [];

  for (const char of text) {
    const last = found[found.length - 1];

    if (last?.[0] === char) last[1] += 1;
    else found.push([char, 1]);
  }

  return found;
}

/** count 0: the most common run length (a longer one on a tie); 1 leaves the line alone. */
export function collapseRepeatedChars(text: string, count = 0) {
  const lineRuns = runs(text);
  let times = count;

  if (times < 2) {
    const tally = new Map<number, number>();

    lineRuns.forEach(([, length]) => tally.set(length, (tally.get(length) ?? 0) + 1));
    times = [...tally].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 1;
  }
  if (times < 2) return text;

  // A run shorter than the count is a single character the hook sent once: kept.
  return lineRuns.map(([char, length]) => char.repeat(Math.ceil(length / times))).join('');
}

export function collapseRepeatedLine(text: string) {
  const period = (text + text).indexOf(text, 1);

  return period > 0 && period < text.length ? text.slice(0, period) : text;
}

export function collapseRepeatedPhrases(text: string) {
  const sentences = text.match(/[^。！？!?」』\n]*(?:[。！？!?」』\n]+|$)/gu) ?? [];

  return sentences.filter((sentence, index) => sentence !== sentences[index - 1]).join('');
}

/**
 * The longest text the line was typed out to, when it is three or more ever longer prefixes of
 * it one after another (あ + あい + あいう): a game redrawing its line one character at a time.
 */
export function collapseTypewriter(text: string) {
  // The shortest full text first: a longer one would hold redraws itself.
  for (let start = text.length - 1; start > 0; start -= 1) {
    if (text[start] !== text[0]) continue;

    const full = text.slice(start);
    let size = full.length;
    let end = start;
    let parts = 1;

    // Back from the full text, each earlier part a shorter prefix of it.
    while (end > 0) {
      let length = Math.min(size - 1, end);

      while (length > 0 && !text.startsWith(full.slice(0, length), end - length)) length -= 1;
      if (!length) break;
      size = length;
      end -= length;
      parts += 1;
    }
    if (end === 0 && parts >= 3) return full;
  }

  return text;
}

export function collapseTrailingRepeat(text: string) {
  const chars = [...text];

  for (let size = 2; size * 3 <= chars.length; size += 1) {
    const unit = chars.slice(-size).join('');
    let end = chars.length;

    while (end >= size && chars.slice(end - size, end).join('') === unit) end -= size;
    if ((chars.length - end) / size >= 3) return chars.slice(0, end).join('') + unit;
  }

  return text;
}

export function keepQuotes(text: string) {
  const open = text.indexOf('「');
  const close = text.lastIndexOf('」');

  return open >= 0 && close > open ? text.slice(open, close + 1) : text;
}

/** The rule's error message, or '' for a valid pattern. */
export function ruleError(pattern: string) {
  try {
    new RegExp(pattern, 'gu');
    return '';
  } catch (error: any) {
    return error.message as string;
  }
}

export function applyRules(text: string, rules: HookRule[] = []) {
  return rules.reduce(
    (line, rule) =>
      rule.pattern && !ruleError(rule.pattern)
        ? line.replace(new RegExp(rule.pattern, 'gu'), rule.replacement)
        : line,
    text
  );
}

// A line ends at one of these; a redraw cut mid-sentence (あ, あい) is not a finished line.
const lineEnd = /[。！？!?」』）)…―〜～♪]$/u;

/** The stateless filters, in order (everything but newOnly and recentLines). */
export function cleanHookLine(line: string, cleanup: HookCleanup) {
  let text = line;

  if (cleanup.control) text = stripControl(text);
  if (cleanup.markup) text = stripMarkup(text);
  if (cleanup.cp932) text = keepCp932(text);
  if (cleanup.rubyFirst) text = dropRubyFirst(text);
  if (cleanup.repeatedChars) text = collapseRepeatedChars(text, cleanup.repeatCount);
  if (cleanup.typewriter) text = collapseTypewriter(text);
  if (cleanup.repeatedLine) text = collapseRepeatedLine(text);
  if (cleanup.repeatedPhrases) text = collapseRepeatedPhrases(text);
  if (cleanup.trailingRepeat) text = collapseTrailingRepeat(text);
  if (cleanup.quotesOnly) text = keepQuotes(text);
  if (cleanup.replace) text = applyRules(text, cleanup.rules);

  return text.trim() ? text : '';
}

/**
 * The whole chain as vnbox.js's `clean(line, threadId)`: '' for a line to drop. Each thread
 * keeps its own recent lines.
 */
export function hookCleaner(cleanup: HookCleanup) {
  const recent = new Map<string, string[]>();
  // The thread's last finished line (ends at lineEnd): the page text a new line starts with.
  const finished = new Map<string, string>();
  const size = cleanup.recentSize || defaultRecentSize;

  return (line: string, threadId = '') => {
    let text = cleanHookLine(line, cleanup);

    if (text && filterOn(cleanup, 'newOnly')) {
      const previous = finished.get(threadId) ?? '';
      const full = text.trimEnd();
      const continues = !!previous && full.startsWith(previous);

      // Kept while a game redraws the new line in pieces (あ。い, あ。いう), so each piece is cut too.
      if (lineEnd.test(full)) finished.set(threadId, full);
      else if (!continues) finished.delete(threadId);
      // Only a finished line counts, so a typewriter sending one fire per character isn't cut
      // to single characters.
      if (continues && full.length > previous.length) text = full.slice(previous.length).trim();
    }
    if (!text || !cleanup.recentLines) return text;

    const seen = recent.get(threadId) ?? [];

    if (seen.includes(text)) return '';
    recent.set(threadId, [...seen, text].slice(-size));

    return text;
  };
}

/** A thread's lines through the whole chain, the dropped ones left out. */
export function cleanLines(lines: string[], cleanup: HookCleanup) {
  const clean = hookCleaner(cleanup);

  return lines.map((line) => clean(line)).filter(Boolean);
}

// Filters the suggestion tries, in chain order: the ones fixing what a hook breaks, not the
// matters of taste (only 「…」, replace). newOnly is on by default, so it is never suggested.
const suggestable: HookFilter[] = [
  'control',
  'markup',
  'cp932',
  'rubyFirst',
  'repeatedChars',
  'typewriter',
  'repeatedLine',
  'repeatedPhrases',
  'trailingRepeat',
  'recentLines'
];

/**
 * The smallest cleanup that makes a thread's recent lines clean: each filter in order is added
 * when it changes or drops at least a quarter of the lines left by the ones before (イマ's
 * doubled characters change every line). undefined: nothing to fix, or fewer than 3 lines.
 */
export function suggestCleanup(lines: string[]): HookCleanup | undefined {
  const texts = lines.filter((line) => line.trim());

  if (texts.length < 3) return undefined;

  let cleanup: HookCleanup = {};

  for (const key of suggestable) {
    const before = cleanLines(texts, cleanup);
    const changed =
      key === 'recentLines'
        ? before.length - cleanLines(before, { recentLines: true, newOnly: false }).length
        : before.filter((line) => cleanHookLine(line, { [key]: true }) !== line).length;

    if (changed * 4 >= before.length && changed > 0) cleanup = { ...cleanup, [key]: true };
  }

  return Object.keys(cleanup).length ? cleanup : undefined;
}
