/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement } from '../src/hub';

/** D1's binding over Node's built-in SQLite (D1 is SQLite too), with schema.sql applied */
export function memoryD1() {
  const db = new DatabaseSync(':memory:');

  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));

  const statement = (sql: string, values: unknown[] = []): D1PreparedStatement => ({
    bind: (...next) => statement(sql, next),
    first: async <T>() => (db.prepare(sql).get(...(values as never[])) ?? null) as T | null,
    all: async <T>() => ({ results: db.prepare(sql).all(...(values as never[])) as T[] }),
    run: async () => ({
      meta: { changes: Number(db.prepare(sql).run(...(values as never[])).changes) }
    })
  });
  const d1: D1Database = {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = [];

        for (const one of statements) results.push(await one.run());
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  };

  return { d1, db };
}

/** A WebP header (the hub reads no further): VP8L, or VP8X with metadata flags */
export function webp(width: number, height: number, size = 200, flags = -1) {
  const bytes = new Uint8Array(size);
  const ascii = (at: number, text: string) =>
    [...text].forEach((char, i) => (bytes[at + i] = char.charCodeAt(0)));
  const u32 = (at: number, value: number) =>
    [0, 1, 2, 3].forEach((i) => (bytes[at + i] = (value >>> (8 * i)) & 255));

  ascii(0, 'RIFF');
  u32(4, size - 8);
  ascii(8, 'WEBP');
  if (flags < 0) {
    ascii(12, 'VP8L');
    bytes[20] = 0x2f;
    u32(21, (width - 1) | ((height - 1) << 14));
  } else {
    ascii(12, 'VP8X');
    bytes[20] = flags;
    u32(24, width - 1);
    u32(27, height - 1);
  }
  return bytes;
}
