/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { beforeEach, describe, expect, it } from 'vitest';
import { DictionaryDatabase } from '$lib/vendor/yomitan/dictionary/dictionary-database';
import { importCollection } from './collection-import';

const title = 'Test Dict';
const terms = Array.from({ length: 150 }, (_, i) => ({
  expression: i % 3 ? `語${i}` : '辞書',
  reading: i % 2 ? `ご${i}` : i % 3 ? `語${i}` : 'じしょ',
  definitionTags: 'n',
  rules: '',
  score: i,
  glossary: [{ type: 'structured-content', content: [`gloss ${i}`, { tag: 'br' }] }],
  sequence: i,
  termTags: '',
  dictionary: title
}));
const termMeta = [
  {
    expression: '辞書',
    mode: 'freq',
    data: { reading: 'じしょ', frequency: 5 },
    dictionary: title
  },
  { expression: '語1', mode: 'pitch', data: { reading: 'ご1', pitches: [] }, dictionary: title }
];
const summary = { title, revision: '1', sequenced: true, version: 3 };

/** A Dexie export as Yomitan writes it: outbound tables as {$: [key, value]} pairs. */
function collection(version = 6, dictionaries = [summary]) {
  const pair = (value: unknown, key: number) => ({
    $: [key + 1, value],
    $types: { $: { '': 'arrayNonindexKeys' } }
  });
  const text = JSON.stringify({
    formatName: 'dexie',
    formatVersion: 1,
    data: {
      databaseName: 'dict',
      databaseVersion: version,
      tables: [],
      data: [
        { tableName: 'dictionaries', inbound: false, rows: dictionaries.map(pair) },
        {
          tableName: 'media',
          inbound: true,
          rows: [
            {
              id: 3,
              dictionary: title,
              path: 'img/a.png',
              mediaType: 'image/png',
              width: 1,
              height: 1,
              content: btoa('png'),
              $types: { content: 'arraybuffer' }
            }
          ]
        },
        { tableName: 'termMeta', inbound: false, rows: termMeta.map(pair) },
        {
          tableName: 'terms',
          inbound: true,
          rows: terms.map((term, i) => ({
            ...term,
            id: i + 1,
            $types: { glossary: 'arrayNonindexKeys' }
          }))
        },
        {
          tableName: 'terms',
          inbound: true,
          rows: [{ ...terms[0], dictionary: 'Not listed' }]
        }
      ]
    }
  });
  return new NodeBlob([text]) as unknown as Blob;
}

const noProgress = () => undefined;
const notCancelled = () => false;
const words = ['辞書', 'じしょ', '語4', 'ご5', '語', 'ない'];
const withoutIds = (entries: any[]) => entries.map(({ id: _id, ...entry }) => entry);

async function database(name = 'dict') {
  const db = new DictionaryDatabase();
  (db as any)._dbName = name;
  await db.prepare();
  return db;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('collection import', () => {
  it('imports every table and finds what a direct import finds', async () => {
    const db = await database();
    const result = await importCollection(db, collection(), noProgress, notCancelled);
    expect(result.imported.map(({ title }) => title)).toEqual([title]);
    expect(result.orphanRows).toBe(1);

    const reference = await database('reference');
    await reference.bulkAdd('terms', terms, 0, terms.length);
    await reference.bulkAdd('termMeta', termMeta, 0, termMeta.length);

    const set = new Set([title]);
    const [c, y] = [db as any, reference as any];
    for (const matchType of ['exact', 'prefix']) {
      expect(withoutIds(await c.findTermsBulk(words, set, matchType))).toEqual(
        withoutIds(await y.findTermsBulk(words, set, matchType))
      );
    }
    expect(await c.findTermMetaBulk(words, set)).toEqual(await y.findTermMetaBulk(words, set));
    const [media] = await c.getMedia([{ path: 'img/a.png', dictionary: title }]);
    expect(new TextDecoder().decode(media.content)).toBe('png');
  });

  it('skips installed dictionaries', async () => {
    const db = await database();
    await importCollection(db, collection(), noProgress, notCancelled);
    const again = await importCollection(db, collection(), noProgress, notCancelled);
    expect(again).toMatchObject({ imported: [], skipped: [title] });
    expect(await (db as any).findTermsBulk(['辞書'], new Set([title]), 'exact')).toHaveLength(50);
  });

  it('removes what it started on cancel', async () => {
    const db = await database();
    let chunks = 0;
    await expect(
      importCollection(db, collection(), noProgress, () => ++chunks > 1)
    ).rejects.toThrow('Import cancelled');
    expect(await db.getDictionaryInfo()).toEqual([]);
  });

  it('refuses a collection from a newer Yomitan', async () => {
    const db = await database();
    await expect(importCollection(db, collection(7), noProgress, notCancelled)).rejects.toThrow(
      /newer Yomitan/
    );
  });
});
