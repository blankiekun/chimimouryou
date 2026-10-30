/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { OptionsUtil } from '$lib/vendor/yomitan/data/options-util';
import { getStandardFieldMarkers } from '$lib/vendor/yomitan/data/anki-template-util';
import type { TermDictionaryEntry } from '$lib/vendor/yomitan/types/dictionary';
import type { ProfileOptions } from '$lib/vendor/yomitan/types/settings';
import { scannedSentence } from '$lib/functions/dictionary/scan';
import {
  addAnkiNote,
  ankiMobileUrl,
  buildAnkiNote,
  defaultFieldValue,
  dictionaryAnkiFromYomitan,
  dictionaryAnkiSettings,
  duplicateQuery
} from './anki-dictionary';

let util: OptionsUtil;
let profile: ProfileOptions;

beforeAll(async () => {
  util = new OptionsUtil();
  await util.prepare();
  profile = util.getDefault().profiles[0].options;
});

const entry = {
  type: 'term',
  isPrimary: true,
  textProcessorRuleChainCandidates: [],
  inflectionRuleChainCandidates: [{ source: 'algorithm', inflectionRules: [{ name: 'past' }] }],
  score: 0,
  frequencyOrder: 0,
  dictionaryIndex: 0,
  dictionaryAlias: 'JM',
  sourceTermExactMatchCount: 1,
  matchPrimaryReading: false,
  maxOriginalTextLength: 3,
  headwords: [
    {
      index: 0,
      term: '食べる',
      reading: 'たべる',
      sources: [
        {
          originalText: '食べた',
          transformedText: '食べた',
          deinflectedText: '食べる',
          matchType: 'exact',
          matchSource: 'term',
          isPrimary: true
        }
      ],
      tags: [],
      wordClasses: ['v1']
    }
  ],
  definitions: [
    {
      index: 0,
      headwordIndices: [0],
      dictionary: 'JM',
      dictionaryIndex: 0,
      dictionaryAlias: 'JM',
      id: 1,
      score: 0,
      frequencyOrder: 0,
      sequences: [1],
      isPrimary: true,
      tags: [],
      entries: ['to eat']
    }
  ],
  pronunciations: [
    {
      index: 0,
      headwordIndex: 0,
      dictionary: 'P',
      dictionaryIndex: 1,
      dictionaryAlias: 'P',
      pronunciations: [
        { type: 'pitch-accent', positions: 2, nasalPositions: [], devoicePositions: [], tags: [] }
      ]
    }
  ],
  frequencies: [
    {
      index: 0,
      headwordIndex: 0,
      dictionary: 'F',
      dictionaryIndex: 2,
      dictionaryAlias: 'F',
      hasReading: true,
      frequency: 500,
      displayValue: null,
      displayValueParsed: false
    }
  ]
} as unknown as TermDictionaryEntry;

const context = {
  url: 'https://example.com/b?id=1',
  documentTitle: 'Book',
  query: '食べた',
  fullQuery: '食べたい',
  sentence: { text: 'パンを食べた。', offset: 3 }
};

const fields = (values: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      { value, overwriteMode: 'coalesce' as const }
    ])
  );

describe('built-in dictionary notes', () => {
  it('renders Yomitan markers with its default templates', async () => {
    const settings = dictionaryAnkiSettings({
      deck: 'Mining',
      model: 'Japanese',
      fields: fields({
        Word: '{expression}',
        Reading: '{reading}',
        Furigana: '{furigana-plain}',
        Meaning: '{glossary-plain-no-dictionary}',
        Sentence: '{cloze-prefix}<b>{cloze-body}</b>{cloze-suffix}',
        Freq: '{frequency-harmonic-rank}',
        Pitch: '{pitch-accent-positions}',
        Title: '{document-title}',
        Mixed: 'x {reading} y'
      }),
      duplicateScope: 'deck'
    });
    const note = await buildAnkiNote({ entry, context, settings, profile, summaries: [] });
    expect(note.deckName).toBe('Mining');
    expect(note.modelName).toBe('Japanese');
    expect(note.tags).toEqual(['chimimouryou']);
    expect(note.fields).toMatchObject({
      Word: '食べる',
      Reading: 'たべる',
      Furigana: '食[た]べる',
      Sentence: 'パンを<b>食べた</b>。',
      Freq: '500',
      Title: 'Book',
      Mixed: 'x たべる y'
    });
    expect(note.fields.Meaning).toContain('to eat');
    expect(note.fields.Pitch).toContain('<span>2</span>');
    expect(duplicateQuery(note)).toBe('"deck:Mining" "word:食べる"');

    const first = await buildAnkiNote({
      entry,
      context,
      settings,
      profile,
      summaries: [],
      firstFieldOnly: true
    });
    expect(Object.keys(first.fields)).toEqual(['Word']);
  });

  it('uses custom field templates from Yomitan', async () => {
    const settings = dictionaryAnkiSettings({
      deck: 'D',
      model: 'M',
      fields: fields({ Front: '{custom}' }),
      fieldTemplates:
        '{{#*inline "custom"}}[{{definition.expression}}]{{/inline}}{{~> (lookup . "marker") ~}}'
    });
    const note = await buildAnkiNote({ entry, context, settings, profile, summaries: [] });
    expect(note.fields.Front).toBe('[食べる]');
  });

  it('adds with AnkiConnect, word audio for {audio} fields', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: 42, error: null })));
    vi.stubGlobal('fetch', fetchMock);
    const settings = dictionaryAnkiSettings({
      deck: 'D',
      model: 'M',
      fields: fields({ Front: '{expression}', Audio: '{audio}' })
    });
    const note = await buildAnkiNote({ entry, context, settings, profile, summaries: [] });
    expect(await addAnkiNote(note, entry, settings)).toBe(42);
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
    );
    expect(body.action).toBe('addNote');
    expect(body.params.note.audio[0]).toMatchObject({
      fields: ['Audio'],
      skipHash: expect.any(String)
    });
    expect(body.params.note.audio[0].url).toContain('kana=%E3%81%9F%E3%81%B9%E3%82%8B');
    vi.unstubAllGlobals();
  });

  it('builds the AnkiMobile link', () => {
    const url = ankiMobileUrl(
      {
        fields: { Front: '食べる', Back: 'to eat & drink' },
        tags: ['a', 'b'],
        deckName: 'Mining::JP',
        modelName: 'Basic',
        options: {} as never
      },
      'https://example.com/b?id=1'
    );
    expect(url.startsWith('anki://x-callback-url/addnote?')).toBe(true);
    const params = new URLSearchParams(url.split('?').slice(1).join('?'));
    expect(params.get('type')).toBe('Basic');
    expect(params.get('deck')).toBe('Mining::JP');
    expect(params.get('fldBack')).toBe('to eat & drink');
    expect(params.get('tags')).toBe('a b');
    expect(params.get('x-success')).toBe('https://example.com/b?id=1');
    expect(url).not.toContain('+');
  });

  it('reads the card format from a Yomitan settings export', async () => {
    const options = util.getDefault();
    const anki = options.profiles[0].options.anki;
    expect(dictionaryAnkiFromYomitan(options)).toBeUndefined();
    anki.cardFormats[0] = {
      ...anki.cardFormats[0],
      type: 'term',
      deck: 'Mining',
      model: 'Lapis',
      fields: fields({ Expression: '{expression}', Sentence: '{sentence}' })
    };
    anki.tags = ['yomitan'];
    anki.duplicateScope = 'deck-root';
    const upgraded = await util.update(JSON.parse(JSON.stringify(options)));
    expect(dictionaryAnkiFromYomitan(upgraded)).toMatchObject({
      deck: 'Mining',
      model: 'Lapis',
      fields: { Expression: { value: '{expression}' }, Sentence: { value: '{sentence}' } },
      tags: ['yomitan'],
      duplicateScope: 'deck-root',
      fieldTemplates: null
    });
  });

  it('guesses field markers like Yomitan', () => {
    const markers = getStandardFieldMarkers('term');
    expect(defaultFieldValue('Anything', 0, markers)).toBe('{expression}');
    expect(defaultFieldValue('Word Reading', 1, markers)).toBe('{reading}');
    expect(defaultFieldValue('Meaning', 2, markers)).toBe('{glossary}');
    expect(defaultFieldValue('Sentence', 3, markers)).toBe('{sentence}');
    expect(defaultFieldValue('Notes', 4, markers)).toBe('');
  });

  it('finds the sentence around the match in the page', () => {
    const p = document.createElement('p');
    p.innerHTML = '前の文。パンを<ruby>食<rt>た</rt></ruby>べた。次の文。';
    document.body.append(p);
    const node = p.querySelector('ruby')!.firstChild!;
    const sentence = scannedSentence(
      { node, offset: 0, text: '食べた' },
      3,
      false,
      profile.sentenceParsing
    );
    expect(sentence).toEqual({ text: 'パンを食べた。', offset: 3 });
    p.remove();
  });
});
