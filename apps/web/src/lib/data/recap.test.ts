/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aiConnectionKeys$,
  aiConnections$,
  aiFeatures$,
  defaultAiFeatures
} from '$lib/data/ai-settings';
import type { Section } from '$lib/data/database/books-db/versions/v3/books-db-v3';
import { buildSearchIndex } from '$lib/functions/book-text/book-search';
import { readerDb } from '$lib/data/reader-db';
import { deleteSavedRecap, getSavedRecaps, planRecap, textBetween, writeRecap } from './recap';

const account = vi.hoisted(() => ({ user: null as { id: string; username: string } | null }));

vi.mock('$lib/data/account', () => ({ accountReady: async () => account.user }));

const sections = [
  { reference: 'c1', label: 'One', startCharacter: 0 },
  { reference: 'c2', label: 'Two', startCharacter: 3 },
  { reference: 'c3', label: 'Three', startCharacter: 6 }
] as Section[];
const index = buildSearchIndex('<p>あいう</p><p>えおか</p><p>きくけ</p>');

async function cacheSummary(title: string, key: string, model: string) {
  await (
    await readerDb()
  ).put('recaps', { title, chapters: { [key]: { summary: 's', characters: 3, model } } });
}

/** An OpenRouter connection with this key; an empty key removes every connection. */
function setOpenRouterKey(key: string) {
  aiConnections$.next(
    key ? [{ id: 'openrouter', name: 'OR', provider: 'openrouter', kind: 'text', modified: 1 }] : []
  );
  aiConnectionKeys$.next(key ? { openrouter: key } : {});
}

describe('planRecap', () => {
  it('summarises only finished chapters, skipping cached ones for the same model', async () => {
    aiConnections$.next([
      { id: 'or', name: 'OpenRouter', provider: 'openrouter', kind: 'text', modified: 1 }
    ]);
    aiFeatures$.next({
      ...defaultAiFeatures,
      ask: { connection: 'or', model: 'model/a', params: {} },
      recap: { connection: 'inherit', model: '', params: {} }
    });
    await cacheSummary('Book', 'c1', 'model/a');

    const plan = await planRecap('Book', index, sections, 7, 9);

    expect(plan.finished.map((p) => p.key)).toEqual(['c1', 'c2']);
    expect(plan.missing.map((p) => p.key)).toEqual(['c2']);
    expect(plan.missingCharacters).toBe(3);
    expect(plan.model).toBe('model/a');
  });

  it('redoes summaries made with another model', async () => {
    aiFeatures$.next({
      ...defaultAiFeatures,
      recap: { connection: 'or', model: 'model/cheap', params: {} }
    });
    await cacheSummary('Book 2', 'c1', 'model/a');

    const plan = await planRecap('Book 2', index, sections, 7, 9);

    expect(plan.missing.map((p) => p.key)).toEqual(['c1', 'c2']);
  });
});

describe('writeRecap', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setOpenRouterKey('');
  });

  it('saves each recap with the position it covers', async () => {
    setOpenRouterKey('sk-or-test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"Recap"}}]}\n'))
    );

    const plan = await planRecap('Saved', index, sections, 2, 9);

    await writeRecap(
      'Saved',
      index,
      plan,
      2,
      () => {},
      () => {},
      new AbortController().signal
    );
    await writeRecap(
      'Saved',
      index,
      plan,
      1,
      () => {},
      () => {},
      new AbortController().signal
    );

    expect((await getSavedRecaps('Saved')).map((r) => [r.position, r.text])).toEqual([
      [1, 'Recap'],
      [2, 'Recap']
    ]);
  });
});

describe('textBetween', () => {
  it('cuts the paragraph containing the start instead of skipping it', () => {
    const text = buildSearchIndex('<p>「あいうえお」</p><p>かき</p>');

    expect(textBetween(text, 2, 6)).toBe('うえお」\nか');
    expect(textBetween(text, 0, 2)).toBe('「あい');
  });
});

describe("another account's recaps", () => {
  it('are empty for the current reader, and a change starts a record of their own', async () => {
    const recap = { created: 1, position: 3, text: 'A', model: 'm', characters: 3 };

    await (
      await readerDb()
    ).put('recaps', {
      title: 'shared',
      chapters: { c1: { summary: 's', characters: 3, model: 'm' } },
      saved: [recap, { ...recap, created: 2 }],
      account: 'alice'
    } as never);
    account.user = { id: 'bob', username: 'bob' };

    expect(await getSavedRecaps('shared')).toEqual([]);
    await deleteSavedRecap('shared', 1);
    expect((await (await readerDb()).get('recaps', 'shared'))?.saved).toEqual([]);

    account.user = null;
  });
});
