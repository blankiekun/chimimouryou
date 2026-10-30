/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { DexieJsonReader, type DexieHeader } from './dexie-json';

/** A small export in dexie-export-import's own layout (as Yomitan writes it). */
export function dexieExport(pretty = false) {
  const data = {
    formatName: 'dexie',
    formatVersion: 1,
    data: {
      databaseName: 'dict',
      databaseVersion: 6,
      tables: [{ name: 'dictionaries', schema: '++,title,version', rowCount: 1 }],
      data: [
        {
          tableName: 'dictionaries',
          inbound: false,
          rows: [
            {
              $: [1, { title: 'Test "Dict"', revision: '1', sequenced: true, version: 3 }],
              $types: { $: { '': 'arrayNonindexKeys' } }
            }
          ]
        },
        {
          tableName: 'media',
          inbound: true,
          rows: [
            {
              id: 1,
              dictionary: 'Test "Dict"',
              path: 'a.png',
              mediaType: 'image/png',
              width: 1,
              height: 1,
              content: btoa('\x89PNG'),
              $types: { content: 'arraybuffer' }
            }
          ]
        },
        {
          tableName: 'terms',
          inbound: true,
          rows: [
            {
              id: 7,
              expression: '辞書',
              reading: 'じしょ',
              definitionTags: 'n',
              rules: '',
              score: -1.5e3,
              glossary: [{ type: 'structured-content', content: ['a\\"b', { tag: 'br' }] }],
              sequence: 4,
              termTags: '',
              dictionary: 'Test "Dict"',
              $types: { glossary: 'arrayNonindexKeys', 'glossary.0.content': 'arrayNonindexKeys' }
            },
            { id: 8, expression: 'x', reading: 'x', glossary: [], score: 0, dictionary: 'Other' }
          ]
        },
        {
          tableName: 'termMeta',
          inbound: false,
          rows: [
            {
              $: [
                3,
                { expression: '辞書', mode: 'freq', data: 5, dictionary: 'Test "Dict"', x: null }
              ],
              $types: { $: { '': 'arrayNonindexKeys', '1.x': 'undef' } }
            }
          ]
        }
      ]
    }
  };
  return JSON.stringify(data, undefined, pretty ? 2 : undefined);
}

function read(text: string, pieces: number) {
  let header: DexieHeader | undefined;
  const rows: [string, unknown][] = [];
  const reader = new DexieJsonReader({
    header: (h) => (header = h),
    row: (table, row) => rows.push([table, row])
  });
  const size = Math.ceil(text.length / pieces);
  for (let i = 0; i < text.length; i += size) reader.push(text.slice(i, i + size));
  reader.end();
  return { header, rows };
}

describe('DexieJsonReader', () => {
  it('reads every row the same however the text is split', () => {
    const whole = read(dexieExport(), 1);
    expect(whole.header).toMatchObject({ formatName: 'dexie', databaseVersion: 6 });
    expect(whole.rows.map(([table]) => table)).toEqual([
      'dictionaries',
      'media',
      'terms',
      'terms',
      'termMeta'
    ]);
    for (const pieces of [7, 100, dexieExport().length]) {
      expect(JSON.stringify(read(dexieExport(), pieces))).toBe(JSON.stringify(whole));
    }
    expect(JSON.stringify(read(dexieExport(true), 13).rows)).toBe(JSON.stringify(whole.rows));
  });

  it('revives Typeson values', () => {
    const { rows } = read(dexieExport(), 3);
    expect(rows[0][1]).toEqual([1, expect.objectContaining({ title: 'Test "Dict"' })]);
    const media = rows[1][1] as { content: ArrayBuffer };
    expect([...new Uint8Array(media.content)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(rows[2][1]).toMatchObject({
      score: -1500,
      glossary: [{ content: ['a\\"b', { tag: 'br' }] }]
    });
    expect(rows[4][1]).toEqual([
      3,
      { expression: '辞書', mode: 'freq', data: 5, dictionary: 'Test "Dict"' }
    ]);
  });

  it('refuses text that is not a whole export', () => {
    const text = dexieExport();
    expect(() => read(text.slice(0, text.length - 5), 2)).toThrow(/ends before/);
    // Other JSON parses to nothing: no header, no rows (the importer's checkHeader never runs).
    expect(read('[1,2]', 1)).toEqual({ header: undefined, rows: [] });
    expect(() => read('{"a" 1}', 1)).toThrow(/Not a Dexie export/);
  });
});
