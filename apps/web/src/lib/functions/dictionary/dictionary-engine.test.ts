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
import { deleteDictionary, importDictionary, listDictionaries, lookup } from './dictionary-engine';

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

  it('skips disabled dictionaries and deletes them', async () => {
    const off = { ...options, dictionaries: [{ ...options.dictionaries[0], enabled: false }] };
    expect((await lookup('辞書', off)).dictionaryEntries).toEqual([]);

    await deleteDictionary('Test JMdict');
    expect(await listDictionaries()).toEqual([]);
    expect((await lookup('辞書', options)).dictionaryEntries).toEqual([]);
  });
});
