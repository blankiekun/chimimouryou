/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aiConnectionKeys$,
  aiConnections$,
  aiLanguage$,
  aiPromptOverrides$,
  defaultAskAiPresets
} from '$lib/data/ai-settings';
import { askAi, buildPassagePrompt } from '$lib/data/ask-ai';
import { aiPrompts, builtInPrompt, defaultAskAiPresetsJa, presetsForLanguage } from './ai-prompts';

/** An OpenRouter connection with this key; an empty key removes every connection. */
function setOpenRouterKey(key: string) {
  aiConnections$.next(
    key ? [{ id: 'openrouter', name: 'OR', provider: 'openrouter', kind: 'text', modified: 1 }] : []
  );
  aiConnectionKeys$.next(key ? { openrouter: key } : {});
}

describe('AI language', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    aiLanguage$.next('en');
    setOpenRouterKey('');
  });

  it('switches every prompt with one setting', () => {
    expect(aiPrompts().recap).toContain('Story so far');
    aiLanguage$.next('ja');
    expect(aiPrompts().recap).toContain('これまでのあらすじ');
    expect(aiPrompts().lore).toContain('"category"');
    expect(
      buildPassagePrompt({ bookTitle: 'B', before: '', selection: 's', after: '' }, '')
    ).toContain('選んだ部分はどういう意味');
  });

  it('sends the Japanese system prompt to the model', async () => {
    aiLanguage$.next('ja');
    setOpenRouterKey('sk-or-test');
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response('data: {"choices":[{"delta":{"content":"はい"}}]}\n')
    );

    vi.stubGlobal('fetch', fetchMock);
    await askAi([{ role: 'user', content: 'q' }], () => {});

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).messages[0].content).toContain(
      '日本語で簡潔に答え'
    );
  });

  it('shows Japanese default presets unless they were customised', () => {
    expect(presetsForLanguage(defaultAskAiPresets, 'ja')).toEqual(defaultAskAiPresetsJa);
    expect(presetsForLanguage(defaultAskAiPresets, 'en')).toBe(defaultAskAiPresets);

    const custom = [{ id: 'mine', label: 'Mine', prompt: 'p' }];

    expect(presetsForLanguage(custom, 'ja')).toBe(custom);
    expect(defaultAskAiPresetsJa.map((p) => p.id)).toEqual(defaultAskAiPresets.map((p) => p.id));
  });

  it('keeps a list saved before Grammar was added, still shown in Japanese', () => {
    expect(defaultAskAiPresets.map((p) => p.id)).toContain('grammar');

    const saved = defaultAskAiPresets.filter((p) => p.id !== 'grammar');
    const ja = presetsForLanguage(saved, 'ja');

    expect(ja.map((p) => p.id)).toEqual(['explain', 'translate', 'nuance']);
    expect(ja[0].label).toBe('説明');

    const edited = [{ ...saved[0], prompt: 'mine' }, ...saved.slice(1)];

    expect(presetsForLanguage(edited, 'ja')).toBe(edited);
  });
});

describe('system prompt overrides', () => {
  afterEach(() => {
    aiLanguage$.next('en');
    aiPromptOverrides$.next({});
  });

  it('uses the copy for its language only and falls back when blank', () => {
    aiPromptOverrides$.next({ ja: { recap: '自分のあらすじ' }, en: { ask: '  ' } });

    expect(aiPrompts().recap).toBe(builtInPrompt('en', 'recap'));
    expect(aiPrompts().ask).toBe(builtInPrompt('en', 'ask'));
    aiLanguage$.next('ja');
    expect(aiPrompts().recap).toBe('自分のあらすじ');
    expect(aiPrompts().chapter).toBe(builtInPrompt('ja', 'chapter'));
  });
});
