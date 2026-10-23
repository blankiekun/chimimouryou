/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  aiConnectionKeys$,
  aiConnections$,
  aiFeatures$,
  defaultAiFeatures,
  elevenLabsApiKey$,
  elevenLabsModel$,
  openRouterApiKey$,
  openRouterModel$,
  openRouterRecapModel$,
  type AiConnection
} from '$lib/data/ai-settings';
import {
  deleteConnection,
  featureParams,
  mergeConnections,
  migrateAiSettings,
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
  openRouterApiKey$.next('');
  elevenLabsApiKey$.next('');
  window.localStorage.clear();
});

describe('migrateAiSettings', () => {
  it('moves the OpenRouter and ElevenLabs settings into connections once', () => {
    openRouterApiKey$.next('sk-or-1');
    openRouterModel$.next('vendor/ask');
    openRouterRecapModel$.next('vendor/recap');
    elevenLabsApiKey$.next('sk_el');
    elevenLabsModel$.next('eleven_v4_turbo');

    migrateAiSettings();

    expect(aiConnections$.getValue().map((c) => [c.id, c.provider, c.kind])).toEqual([
      ['openrouter', 'openrouter', 'text'],
      ['elevenlabs', 'elevenlabs', 'voice']
    ]);
    expect(aiConnectionKeys$.getValue()).toEqual({ openrouter: 'sk-or-1', elevenlabs: 'sk_el' });
    expect(aiFeatures$.getValue().ask).toMatchObject({
      connection: 'openrouter',
      model: 'vendor/ask'
    });
    expect(aiFeatures$.getValue().recap).toMatchObject({ model: 'vendor/recap' });
    expect(aiFeatures$.getValue().lore.connection).toBe('inherit');
    expect(aiFeatures$.getValue().voice).toMatchObject({
      connection: 'elevenlabs',
      model: 'eleven_v4_turbo'
    });
    expect(window.localStorage.getItem('aiSettingsVersion')).toBe('1');

    // Once: later changes to the old settings don't move again.
    aiConnections$.next([]);
    migrateAiSettings();
    expect(aiConnections$.getValue()).toEqual([]);
  });

  it('lets recap inherit from Ask AI when its model was emptied', () => {
    openRouterModel$.next('vendor/ask');
    openRouterRecapModel$.next('');

    migrateAiSettings();

    expect(aiFeatures$.getValue().recap.connection).toBe('inherit');
    expect(resolveFeature('recap').model).toBe('vendor/ask');
    // The model was set but no key: the connection waits for one on this device.
    expect(aiConnectionKeys$.getValue()).toEqual({});
  });

  it('waits when there is nothing to move yet', () => {
    migrateAiSettings();

    expect(aiConnections$.getValue()).toEqual([]);
    expect(window.localStorage.getItem('aiSettingsVersion')).toBeNull();
  });
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

  it('turn off a setting with null and mirror the old settings', () => {
    saveConnection({ id: 'openrouter', name: 'OR', provider: 'openrouter', kind: 'text' }, 'sk-or');
    setFeature('ask', {
      connection: 'openrouter',
      model: 'vendor/m',
      params: { top_p: null } as never
    });

    expect(featureParams('ask')).not.toHaveProperty('top_p');
    expect(openRouterApiKey$.getValue()).toBe('sk-or');
    expect(openRouterModel$.getValue()).toBe('vendor/m');

    deleteConnection('openrouter');
    expect(openRouterApiKey$.getValue()).toBe('');
    expect(aiConnections$.getValue()[0].deleted).toBe(true);
    expect(aiFeatures$.getValue().ask.connection).toBe('');
  });
});
