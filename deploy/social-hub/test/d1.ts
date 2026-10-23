/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement } from '../src/index';

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
