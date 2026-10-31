/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The Lore check bank: excerpts of eight books (`lore-bank/cases.json`, built by
 * `scripts/lore-bank.py`) go through the real lorebook update (prompt, chunks, merge) and the
 * result is scored against each case's checks (duplicates, stale names, spoilers when going back,
 * an injected order).
 *
 * By default the recorded model answers (`lore-bank/answers-*.json`) are replayed, with no
 * request: a merge change that scores lower on a recording than when it was recorded fails.
 * With LORE_LIVE=<label> the bank is sent to the model (Anthropic, LORE_MODEL, default
 * claude-haiku-5-5; the key from LORE_KEY_FILE, default ~/.config/anthropic-key) and recorded
 * as answers-<label>.json:
 *
 *   LORE_LIVE=after pnpm exec vitest run src/lib/data/ai/lorebook-bank.test.ts
 *
 * After changing the checks, LORE_RESCORE=1 (replay) stores the new scores in the recordings.
 */

import 'fake-indexeddb/auto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { aiConnectionKeys$, aiConnections$, aiFeatures$ } from '$lib/data/ai/ai-settings';
import { saveConnection } from '$lib/data/ai/ai-connections';
import { aiPrompts } from '$lib/data/ai/ai-prompts';
import { textBetween } from '$lib/data/ai/recap';
import { buildSearchIndex } from '$lib/functions/book-text/book-search';
import { countCharacters } from '$lib/functions/book-text/text-positions';
import * as lore from './lorebook';
import type { LoreEntry } from './lorebook';

vi.mock('$lib/data/account/account', () => ({ accountReady: async () => null }));

interface Check {
  type: 'one' | 'both' | 'named' | 'apart' | 'spoiler' | 'clean' | 'reading';
  any?: string[];
  like?: string[];
  all?: string[];
  other?: string[];
  name?: string;
  not?: string;
  reading?: string;
  info?: boolean;
}

interface Case {
  id: string;
  title: string;
  case: string;
  paragraphs: string[];
  back?: number;
  checks: Check[];
}

interface Recording {
  model: string;
  chunk: number;
  recorded: string;
  /** Answers per case in request order, and the score when recorded */
  cases: Record<string, { answers: string[]; score: number; usage: number[][] }>;
}

const dir = join(__dirname, 'lore-bank');
const cases: Case[] = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf-8'));
const live = process.env.LORE_LIVE;
const model = process.env.LORE_MODEL ?? 'claude-haiku-5-5';
/** Characters per request: small, so each case takes several updates that have to merge */
const chunk = 1500;
/** $ per million tokens (in, out) by model; Haiku 5.5 below 100k-token prompts */
const prices: Record<string, [number, number]> = { 'claude-haiku-5-5': [0.1, 0.5] };

const honorific = /(さん|ちゃん|くん|君|様|さま|殿|先生|氏)$/;
const bare = (term: string) => term.replace(honorific, '') || term;

/**
 * The character entry is about one of the words: its name or a key is one (honorifics aside), or
 * its name ends with one (里見美禰子), or its name or a key contains one of `like` (髭のある男).
 */
function refers(entry: LoreEntry, words: string[], like: string[] = []) {
  const terms = [entry.name, ...entry.keys];

  return (
    entry.category === 'character' &&
    (words.some((word) => entry.name.endsWith(word) || terms.some((t) => bare(t) === word)) ||
      like.some((word) => terms.some((t) => t.includes(word))))
  );
}

/** What the panel shows for the entry at `position` (nothing but its name when the version then isn't known). */
function shown(title: string, entry: LoreEntry, position: number) {
  const version = lore.loreEntryAt(title, entry, position);

  return version ? [version.name, version.content, ...(version.keys ?? [])].join(' ') : '';
}

function judge(title: string, check: Check, entries: LoreEntry[], back: number) {
  const matching = entries.filter((entry) => refers(entry, check.any ?? [], check.like));
  const text = (entry: LoreEntry) => [entry.name, ...entry.keys].join(' ');

  switch (check.type) {
    case 'one':
      return matching.length === 1;
    case 'both':
      return matching.length === 1 && check.all!.every((word) => text(matching[0]).includes(word));
    case 'named':
      return matching.length > 0 && matching.every((entry) => entry.name.includes(check.name!));
    case 'apart':
      return matching.length > 0 && !matching.some((entry) => refers(entry, check.other!));
    case 'spoiler':
      return matching
        .filter((entry) => entry.fromBook || entry.firstSeen < back)
        .every((entry) => !new RegExp(check.not!, 'i').test(shown(title, entry, back)));
    case 'clean':
      return !entries.some((entry) =>
        new RegExp(check.not!).test([text(entry), entry.content].join(' '))
      );
    case 'reading':
      return matching.length === 1 && matching[0].reading.includes(check.reading!);
  }
}

/** Passed scored checks / scored checks, and a line per check. */
function score(title: string, bankCase: Case, entries: LoreEntry[], back: number) {
  const results = bankCase.checks.map((check) => ({
    check,
    pass: judge(title, check, entries, back)
  }));
  const scored = results.filter(({ check }) => !check.info);

  return {
    score: scored.filter(({ pass }) => pass).length / scored.length,
    lines: results.map(
      ({ check, pass }) =>
        `  ${pass ? 'pass' : 'FAIL'}${check.info ? ' (info)' : ''} ${check.type} ${(check.any ?? []).join('/')}`
    )
  };
}

function bookOf(bankCase: Case) {
  // The bank writes the book's ruby as ｜base《reading》.
  const html = bankCase.paragraphs
    .map((text) =>
      text.replace(/</g, '&lt;').replace(/｜([^《]*)《([^》]*)》/g, '<ruby>$1<rt>$2</rt></ruby>')
    )
    .map((text) => `<p>${text}</p>`)
    .join('');
  const index = buildSearchIndex(html);
  const last = index.paragraphs[index.paragraphs.length - 1];
  const total = last.startCount + countCharacters(last.text);
  const back = bankCase.back === undefined ? total : index.paragraphs[bankCase.back].startCount;

  return { index, total, back };
}

function answerResponse(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
}

/** Reads the case to its end, every request answered by `respond`; returns the entries. */
async function runCase(
  bankCase: Case,
  label: string,
  respond: (url: string, init: RequestInit) => Promise<Response>
) {
  const { index, total } = bookOf(bankCase);
  const title = `${bankCase.title} (${label})`;

  vi.stubGlobal('fetch', respond);
  await lore.updateLorebook(title, index, total);
  vi.unstubAllGlobals();

  return { title, entries: (await lore.getLorebook(title)).entries };
}

function useConnection(key: string) {
  aiConnections$.next([]);
  aiConnectionKeys$.next({});
  saveConnection({ id: 'anthropic', name: 'Anthropic', provider: 'anthropic', kind: 'text' }, key);
  aiFeatures$.next({
    ...aiFeatures$.getValue(),
    lore: { connection: 'anthropic', model, params: { context: chunk } }
  });
}

if (live) {
  describe(`lore bank, live (${model})`, () => {
    const recording: Recording = {
      model,
      chunk,
      recorded: new Date().toISOString().slice(0, 10),
      cases: {}
    };

    beforeAll(() => {
      const [inPrice, outPrice] = prices[model] ?? [4, 20];
      // Japanese is about a token per character; earlier entries are sent again with each part.
      const requests = cases.reduce((sum, c) => sum + Math.ceil(bookOf(c).total / chunk), 0);
      const input = requests * (aiPrompts().lore.length + chunk * 1.5 + 3000);
      const output = requests * 2000;
      const cost = (input * inPrice + output * outPrice) / 1e6;

      const sent = (ruby: boolean) =>
        cases.reduce((sum, c) => {
          const { index, total } = bookOf(c);

          for (let start = 0; start < total; start += chunk) {
            sum += textBetween(index, start, Math.min(start + chunk, total), ruby).length;
          }

          return sum;
        }, 0);

      console.log(
        `${requests} requests, ~${input} tokens in, ~${output} out: about $${cost.toFixed(2)}; passages ${sent(false)} characters, ${sent(true)} with ruby`
      );
      if (cost > 3) {
        throw new Error('Over $3: not sent');
      }

      const keyFile = process.env.LORE_KEY_FILE ?? join(homedir(), '.config/anthropic-key');

      useConnection(readFileSync(keyFile, 'utf-8').trim());
    });

    afterAll(() => {
      writeFileSync(join(dir, `answers-${live}.json`), JSON.stringify(recording, null, 1) + '\n');
      const total = Object.values(recording.cases).reduce((sum, c) => sum + c.score, 0);

      console.log(`${live}: ${total.toFixed(2)} of ${cases.length}`);
    });

    cases.forEach((bankCase) =>
      it(
        bankCase.id,
        async () => {
          const realFetch = globalThis.fetch;
          const answers: string[] = [];
          const usage: number[][] = [];
          const { title, entries } = await runCase(bankCase, live, async (url, init) => {
            const response = await realFetch(url, init);
            const json = await response.json();

            if (!response.ok) {
              throw new Error(`${response.status} ${JSON.stringify(json.error ?? json)}`);
            }
            answers.push(json.choices[0].message.content);
            usage.push([json.usage?.prompt_tokens ?? 0, json.usage?.completion_tokens ?? 0]);

            return answerResponse(answers[answers.length - 1]);
          });
          const result = score(title, bankCase, entries, bookOf(bankCase).back);

          recording.cases[bankCase.id] = { answers, score: result.score, usage };
          console.log(
            [
              `${bankCase.id}: ${result.score.toFixed(2)}`,
              ...result.lines,
              ...entries.map((e) => `  · ${e.name} [${e.keys.join('、')}] ${e.category}`)
            ].join('\n')
          );
        },
        600_000
      )
    );
  });
} else {
  const recordings = readdirSync(dir)
    .filter((name) => /^answers-.+\.json$/.test(name))
    .map((name) => ({
      label: name.slice(8, -5),
      recording: JSON.parse(readFileSync(join(dir, name), 'utf-8')) as Recording
    }));

  describe('lore bank, recorded answers', () => {
    beforeAll(() => useConnection('replay'));

    recordings.forEach(({ label, recording }) =>
      cases
        .filter((bankCase) => recording.cases[bankCase.id])
        .forEach((bankCase) =>
          // Catches a merge change that handles these answers worse (duplicates, stale names,
          // spoilers shown when going back) than the code they were recorded with.
          it(`${label}: ${bankCase.id}`, async () => {
            const answers = [...recording.cases[bankCase.id].answers];
            const { title, entries } = await runCase(bankCase, `replay ${label}`, async () => {
              const next = answers.shift();

              if (next === undefined) {
                throw new Error('More requests than recorded answers');
              }

              return answerResponse(next);
            });
            const result = score(title, bankCase, entries, bookOf(bankCase).back);

            console.log(
              `${label} ${bankCase.id}: ${result.score.toFixed(2)}\n${result.lines.join('\n')}`
            );
            expect(answers).toHaveLength(0);
            if (process.env.LORE_RESCORE) {
              // After the checks change: the recording's score becomes this code's score.
              recording.cases[bankCase.id].score = result.score;
              writeFileSync(
                join(dir, `answers-${label}.json`),
                JSON.stringify(recording, null, 1) + '\n'
              );
            }
            expect(result.score).toBeGreaterThanOrEqual(recording.cases[bankCase.id].score);
          })
        )
    );
  });
}
