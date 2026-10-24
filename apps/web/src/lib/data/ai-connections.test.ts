/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aiConnectionKeys$,
  aiConnections$,
  aiFeatures$,
  defaultAiFeatures,
  type AiConnection
} from '$lib/data/ai-settings';
import {
  deleteConnection,
  featureParams,
  mergeConnections,
  resolveFeature,
  saveConnection,
  setFeature
} from './ai-connections';

const conn = (id: string, modified: number, extra: Partial<AiConnection> = {}): AiConnection => ({
  id,
  name: id,
  provider: 'openrouter',
  kind: 'text',
  modified,
  ...extra
});

afterEach(() => {
  aiConnections$.next([]);
  aiConnectionKeys$.next({});
  aiFeatures$.next(defaultAiFeatures);
  window.localStorage.clear();
});

describe('mergeConnections', () => {
  it('keeps the newer edit of each connection, and deletions', () => {
    const merged = mergeConnections(
      [conn('a', 5, { name: 'local' }), conn('b', 1), conn('c', 3)],
      [conn('a', 2, { name: 'remote' }), conn('b', 4, { deleted: true }), conn('d', 1)]
    );

    expect(merged.map((c) => [c.id, c.name, !!c.deleted])).toEqual([
      ['a', 'local', false],
      ['b', 'b', true],
      ['c', 'c', false],
      ['d', 'd', false]
    ]);
  });
});

describe('features', () => {
  it('use the first connection and the provider’s model until one is chosen', () => {
    saveConnection({ id: 'g', name: 'Gemini', provider: 'gemini', kind: 'text' }, 'AIza-key');

    expect(resolveFeature('ask')).toMatchObject({ key: 'AIza-key', model: 'gemini-flash-latest' });
    expect(resolveFeature('lore')).toMatchObject({
      inherited: true,
      model: 'gemini-flash-lite-latest'
    });
    expect(featureParams('lore')).toMatchObject({ temperature: 0.2, stream: false });
  });

  it('turn off a setting with null', () => {
    saveConnection({ id: 'openrouter', name: 'OR', provider: 'openrouter', kind: 'text' }, 'sk-or');
    setFeature('ask', {
      connection: 'openrouter',
      model: 'vendor/m',
      params: { top_p: null } as never
    });

    expect(featureParams('ask')).not.toHaveProperty('top_p');
    expect(resolveFeature('ask')).toMatchObject({ key: 'sk-or', model: 'vendor/m' });

    deleteConnection('openrouter');
    expect(aiConnectionKeys$.getValue()).toEqual({});
    expect(aiConnections$.getValue()[0].deleted).toBe(true);
    expect(aiFeatures$.getValue().ask.connection).toBe('');
  });
});

describe('settings from before connections', () => {
  it('are removed from this browser on load', async () => {
    window.localStorage.setItem('openRouterApiKey', 'sk-or-old');
    window.localStorage.setItem('elevenLabsApiKey', 'sk_old');
    vi.resetModules();
    await import('$lib/data/ai-settings');

    expect(window.localStorage.getItem('openRouterApiKey')).toBeNull();
    expect(window.localStorage.getItem('elevenLabsApiKey')).toBeNull();
  });
});
