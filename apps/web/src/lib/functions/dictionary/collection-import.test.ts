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
import { DictionaryStore, PackWriter } from './collection-store';

const title = 'Test Dict';
const reverse = (text: string) => [...text].reverse().join('');
const terms = Array.from({ length: 150 }, (_, i) => ({
  expression: i % 3 ? `語${i}` : '辞書',
  reading: i % 2 ? `ご${i}` : i % 3 ? `語${i}` : 'じしょ',
  expressionReverse: reverse(i % 3 ? `語${i}` : '辞書'),
  readingReverse: reverse(i % 2 ? `ご${i}` : i % 3 ? `語${i}` : 'じしょ'),
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
const words = ['辞書', 'じしょ', '語4', 'ご5', '語', 'ない', '5'];
const withoutIds = (entries: any[]) => entries.map(({ id: _id, ...entry }) => entry);

async function database(name = 'dict') {
  const db = new DictionaryStore();
  (db as any)._dbName = name;
  await db.prepare();
  return db;
}

async function reference() {
  const db = new DictionaryDatabase();
  (db as any)._dbName = 'reference';
  await db.prepare();
  await db.bulkAdd('terms', terms, 0, terms.length);
  await db.bulkAdd('termMeta', termMeta, 0, termMeta.length);
  return db as any;
}

/** The origin private file system as far as collection-store.ts uses it. */
class FakeDirectory {
  entries = new Map<string, FakeDirectory | FakeFile>();
  async getDirectoryHandle(name: string, { create = false } = {}) {
    if (!this.entries.has(name) && create) this.entries.set(name, new FakeDirectory());
    const entry = this.entries.get(name);
    if (!(entry instanceof FakeDirectory)) throw new DOMException(name, 'NotFoundError');
    return entry;
  }
  async getFileHandle(name: string, { create = false } = {}) {
    if (!this.entries.has(name) && create) this.entries.set(name, new FakeFile());
    const entry = this.entries.get(name);
    if (!(entry instanceof FakeFile)) throw new DOMException(name, 'NotFoundError');
    return entry;
  }
  async removeEntry(name: string) {
    if (!this.entries.delete(name)) throw new DOMException(name, 'NotFoundError');
  }
  async *keys() {
    yield* [...this.entries.keys()];
  }
}

class FakeFile {
  bytes = new Uint8Array(0);
  async getFile() {
    return new NodeBlob([this.bytes.slice()]);
  }
  async createSyncAccessHandle() {
    return {
      write: (data: ArrayBufferView, { at }: { at: number }) => {
        const chunk = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        if (at + chunk.length > this.bytes.length) {
          const grown = new Uint8Array(at + chunk.length);
          grown.set(this.bytes);
          this.bytes = grown;
        }
        this.bytes.set(chunk, at);
        return chunk.length;
      },
      read: (data: Uint8Array, { at }: { at: number }) => {
        const chunk = this.bytes.subarray(at, at + data.length);
        data.set(chunk);
        return chunk.length;
      },
      flush: () => undefined,
      close: () => undefined
    };
  }
}

let opfs: FakeDirectory;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  opfs = new FakeDirectory();
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { getDirectory: async () => opfs }
  });
});

describe('collection import', () => {
  // 256-byte blocks split rows across blocks; 0 writes a version-1 pack (#181: uncompressed).
  it.each([65536, 256, 0])(
    'imports every table and finds what a direct import finds (blocks of %i)',
    async (block) => {
      PackWriter.blockSize = block;
      const db = await database();
      const result = await importCollection(db, collection(), noProgress, notCancelled);
      expect(result.imported.map(({ title }) => title)).toEqual([title]);
      expect(result.orphanRows).toBe(1);

      const set = new Set([title]);
      const [c, y] = [db as any, await reference()];
      for (const matchType of ['exact', 'prefix', 'suffix']) {
        expect(withoutIds(await c.findTermsBulk(words, set, matchType))).toEqual(
          withoutIds(await y.findTermsBulk(words, set, matchType))
        );
      }
      expect(await c.findTermMetaBulk(words, set)).toEqual(await y.findTermMetaBulk(words, set));
      const exact = words.map((term) => ({ term, reading: 'じしょ' }));
      expect(withoutIds(await c.findTermsExactBulk(exact, set))).toEqual(
        withoutIds(await y.findTermsExactBulk(exact, set))
      );
      const sequences = [0, 4, 7, 999].map((query) => ({ query, dictionary: title }));
      expect(withoutIds(await c.findTermsBySequenceBulk(sequences))).toEqual(
        withoutIds(await y.findTermsBySequenceBulk(sequences))
      );
      expect(await c.findTermsBulk(words, new Set(['Other']), 'exact')).toEqual([]);
      const [media] = await c.getMedia([{ path: 'img/a.png', dictionary: title }]);
      expect(new TextDecoder().decode(media.content)).toBe('png');
      PackWriter.blockSize = 65536;
    }
  );

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
    expect((opfs.entries.get('dictionary-collections') as FakeDirectory).entries.size).toBe(0);
  });

  it('deletes a pack with its last dictionary, also after a restart', async () => {
    const db = await database();
    await importCollection(db, collection(), noProgress, notCancelled);
    const packs = opfs.entries.get('dictionary-collections') as FakeDirectory;
    expect(packs.entries.size).toBe(1);
    const again = await database();
    expect(await again.findTermsBulk(['辞書'], new Set([title]), 'exact')).toHaveLength(50);
    await again.deleteDictionary(title, 1000, () => undefined);
    expect(await again.getDictionaryInfo()).toEqual([]);
    expect(await again.findTermsBulk(['辞書'], new Set([title]), 'exact')).toEqual([]);
    expect(packs.entries.size).toBe(0);
  });

  it('keeps zip-imported dictionaries in IndexedDB beside a pack', async () => {
    const db = await database();
    await importCollection(db, collection(), noProgress, notCancelled);
    const other = { ...terms[0], dictionary: 'Zip', score: 99 };
    await db.bulkAdd('terms', [other], 0, 1);
    const found = await db.findTermsBulk(['辞書'], new Set([title, 'Zip']), 'exact');
    expect(found).toHaveLength(51);
    expect(found.filter(({ dictionary }: any) => dictionary === 'Zip')).toHaveLength(1);
  });

  it('refuses a collection from a newer Yomitan', async () => {
    const db = await database();
    await expect(importCollection(db, collection(7), noProgress, notCancelled)).rejects.toThrow(
      /newer Yomitan/
    );
  });
});
