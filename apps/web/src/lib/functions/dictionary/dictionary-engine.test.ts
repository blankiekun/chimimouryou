/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { TextReader, Uint8ArrayWriter, ZipWriter, configure } from '@zip.js/zip.js';
import { OptionsUtil } from '$lib/vendor/yomitan/data/options-util';
import type { ProfileOptions } from '$lib/vendor/yomitan/types/settings';
import type { TermDictionaryEntry } from '$lib/vendor/yomitan/types/dictionary';
import {
  deleteDictionary,
  importDictionary,
  listDictionaries,
  lookup as find,
  type LookupSearch
} from './dictionary-engine';

/** Term lookups (the default search): entries typed as terms. */
async function lookup(text: string, profile: ProfileOptions, search?: LookupSearch) {
  const result = await find(text, profile, search);
  return { ...result, dictionaryEntries: result.dictionaryEntries as TermDictionaryEntry[] };
}

// jsdom has no Worker.
configure({ useWebWorkers: false });

/** A tiny Yomitan dictionary (format 3): a verb, a compound and a frequency/pitch bank. */
async function dictionaryZip() {
  const files: Record<string, unknown> = {
    'index.json': { title: 'Test JMdict', revision: '1', format: 3, sequenced: true },
    'term_bank_1.json': [
      ['食べる', 'たべる', 'v1', 'v1', 10, ['to eat'], 1, ''],
      ['食べ物', 'たべもの', 'n', '', 10, ['food'], 2, ''],
      ['食', 'しょく', 'n', '', 1, ['meal'], 3, ''],
      ['辞書', 'じしょ', 'n', '', 10, ['dictionary'], 4, ''],
      ['口', 'コウ', 'n', '', 10, ['opening'], 5, ''],
      ['口', 'くち', 'n', '', 0, ['mouth'], 6, ''],
      ['近所', '', 'n', '', 10, ['neighbourhood'], 7, ''],
      ['近所', 'きんじょ', 'n', '', 0, ['neighbourhood'], 8, ''],
      ['詞葉', 'ことは', 'name', '', 10, ['a given name'], 9, ''],
      ['こと', 'こと', 'n', '', 0, ['thing'], 10, '']
    ],
    'term_meta_bank_1.json': [
      ['食べる', 'freq', { reading: 'たべる', frequency: 500 }],
      ['食べる', 'pitch', { reading: 'たべる', pitches: [{ position: 2 }] }]
    ],
    'kanji_bank_1.json': [
      ['食', 'ショク ジキ', 'く.う た.べる', 'jouyou', ['eat', 'food'], { strokes: '9' }],
      ['鬱', 'ウツ', '', '', ['gloom'], { strokes: '29' }]
    ],
    'tag_bank_1.json': [['v1', 'partOfSpeech', 0, 'Ichidan verb', 0]]
  };
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [name, content] of Object.entries(files)) {
    await writer.add(name, new TextReader(JSON.stringify(content)));
  }
  return ((await writer.close()) as Uint8Array).slice().buffer;
}

let options: ProfileOptions;

beforeAll(async () => {
  const util = new OptionsUtil();
  await util.prepare();
  options = util.getDefault().profiles[0].options;
  options.dictionaries = [
    {
      name: 'Test JMdict',
      alias: 'Test JMdict',
      enabled: true,
      allowSecondarySearches: false,
      definitionsCollapsible: 'not-collapsible',
      partsOfSpeechFilter: true,
      useDeinflections: true,
      styles: ''
    }
  ];
});

describe('dictionary engine', () => {
  it('imports a Yomitan dictionary zip', async () => {
    const progress: number[] = [];
    const { result, errors } = await importDictionary(await dictionaryZip(), (done) =>
      progress.push(done)
    );

    expect(errors).toEqual([]);
    expect(result?.title).toBe('Test JMdict');
    expect(result?.counts?.terms.total).toBe(10);
    expect(result?.counts?.kanji.total).toBe(2);
    expect(progress.length).toBeGreaterThan(0);
    expect((await listDictionaries()).map(({ title }) => title)).toEqual(['Test JMdict']);
  });

  it('finds the dictionary form of a conjugated verb, with the reasons', async () => {
    const { dictionaryEntries, originalTextLength } = await lookup('食べなかった。', options);
    const [entry] = dictionaryEntries;

    expect(originalTextLength).toBe(6);
    expect(entry.headwords[0]).toMatchObject({ term: '食べる', reading: 'たべる' });
    expect(entry.inflectionRuleChainCandidates[0].inflectionRules.map(({ name }) => name)).toEqual([
      'negative',
      '-た'
    ]);
    expect(entry.frequencies[0]).toMatchObject({ frequency: 500 });
    expect(entry.pronunciations[0].pronunciations[0]).toMatchObject({ positions: 2 });
  });

  it('puts the longest match from the start first', async () => {
    const { dictionaryEntries, originalTextLength } = await lookup('食べ物がある', options);

    expect(originalTextLength).toBe(3);
    expect(dictionaryEntries[0].headwords[0].term).toBe('食べ物');
    expect(dictionaryEntries.map((entry) => entry.headwords[0].term)).toContain('食');
  });

  it("puts on'yomi, reading-less entries and names read from kana after the word", async () => {
    const first = async (text: string) => {
      const { dictionaryEntries, originalTextLength } = await lookup(text, options);
      const { term, reading } = dictionaryEntries[0].headwords[0];
      return [term, reading, originalTextLength];
    };

    expect(await first('口を')).toEqual(['口', 'くち', 1]);
    expect(await first('近所の')).toEqual(['近所', 'きんじょ', 2]);
    expect(await first('ことは')).toEqual(['こと', 'こと', 2]);
  });

  // Yomitan's TextScanner: terms first, the first character's kanji only when no term matched.
  it('falls back to the kanji of the first character when no term matches', async () => {
    const result = await find('鬱だ', options, { searchTerms: true, searchKanji: true });
    expect(result.type).toBe('kanji');
    expect(result.originalTextLength).toBe(1);
    const [entry] = result.dictionaryEntries;
    expect(entry).toMatchObject({ type: 'kanji', character: '鬱', onyomi: ['ウツ'] });
    // a term match wins over its first kanji
    expect((await find('食べる', options, { searchKanji: true })).type).toBe('terms');
  });

  it('honours an input that searches only kanji, or only terms', async () => {
    const kanji = await find('食べる', options, { searchTerms: false, searchKanji: true });
    expect(kanji.type).toBe('kanji');
    expect(
      kanji.dictionaryEntries.map((entry) => entry.type === 'kanji' && entry.character)
    ).toEqual(['食']);
    const terms = await find('鬱だ', options, { searchTerms: true, searchKanji: false });
    expect(terms.dictionaryEntries).toEqual([]);
    const none = await find('食べる', options, { searchTerms: false, searchKanji: false });
    expect(none.dictionaryEntries).toEqual([]);
  });

  // matchTypePrefix: a real prefix match, so a partial word still finds the full one.
  it('finds words that start with the text under a prefix match', async () => {
    expect((await lookup('辞', options, { searchKanji: false })).dictionaryEntries).toEqual([]);
    const prefix = await lookup('辞', options, { searchKanji: false, matchType: 'prefix' });
    expect(
      prefix.dictionaryEntries.map((entry) => entry.type === 'term' && entry.headwords[0].term)
    ).toContain('辞書');
  });

  it('skips disabled dictionaries and deletes them', async () => {
    const off = { ...options, dictionaries: [{ ...options.dictionaries[0], enabled: false }] };
    expect((await lookup('辞書', off)).dictionaryEntries).toEqual([]);

    await deleteDictionary('Test JMdict');
    expect(await listDictionaries()).toEqual([]);
    expect((await lookup('辞書', options)).dictionaryEntries).toEqual([]);
  });
});
