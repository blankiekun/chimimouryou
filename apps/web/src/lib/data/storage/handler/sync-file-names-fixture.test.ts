/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
// Shared with the server's migration (server/api/syncnames.py, test_syncnames.py): both must read the
// sync file names the same way.
import fixtureJson from '../../../../../../../server/tests/fixtures/sync-file-names.json?raw';

await import('$lib/data/storage/storage-handler-factory');
const { BaseStorageHandler } = await import('./base-handler');

const fixture = JSON.parse(fixtureJson) as {
  titles: { title: string; sanitized: string }[];
  parse: { kind: 'book' | 'progress' | 'statistics' | 'goals'; name: string; expected: object }[];
  findFile: { names: string[]; prefix: string; expected: string | null }[];
};

const parsers = {
  book: (name: string) => BaseStorageHandler['getBookMetadata'](name),
  progress: (name: string) => BaseStorageHandler['getProgressMetadata'](name),
  statistics: (name: string) => BaseStorageHandler.getStatisticsMetadata(name),
  goals: (name: string) => BaseStorageHandler['getReadingGoalsMetadata'](name)
};

// JSON has no NaN: the fixture writes it as null.
const withoutNaN = (value: object) =>
  Object.fromEntries(Object.entries(value).map(([key, v]) => [key, Number.isNaN(v) ? null : v]));

describe('the shared sync file name fixture', () => {
  it('sanitizes and desanitizes titles', () => {
    for (const { title, sanitized } of fixture.titles) {
      expect(BaseStorageHandler['sanitizeForFilename'](title)).toBe(sanitized);
      expect(BaseStorageHandler['desanitizeFilename'](sanitized)).toBe(title);
    }
  });

  it('parses file names', () => {
    for (const { kind, name, expected } of fixture.parse) {
      expect(withoutNaN(parsers[kind](name)), name).toEqual(expected);
    }
  });

  it('finds the file to read', () => {
    for (const { names, prefix, expected } of fixture.findFile) {
      const found = BaseStorageHandler.findFile(
        names.map((name) => ({ name })),
        prefix
      );
      expect(found?.name ?? null).toBe(expected);
    }
  });
});
