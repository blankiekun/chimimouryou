/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiConnectionKeys$, aiConnections$, askAiReaderNote$ } from '$lib/data/ai-settings';
import { askAi } from './ask-ai';

function stream(lines: string[]) {
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/event-stream' } });
}

/** An OpenRouter connection with this key; an empty key removes every connection. */
function setOpenRouterKey(key: string) {
  aiConnections$.next(
    key ? [{ id: 'openrouter', name: 'OR', provider: 'openrouter', kind: 'text', modified: 1 }] : []
  );
  aiConnectionKeys$.next(key ? { openrouter: key } : {});
}

describe('askAi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setOpenRouterKey('');
    askAiReaderNote$.next('');
  });

  it('streams the answer', async () => {
    setOpenRouterKey('sk-or-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        stream([
          ': keep-alive',
          'data: {"choices":[{"delta":{"content":"こん"}}]}',
          'data: {"choices":[{"delta":{"content":"にちは"}}]}',
          'data: [DONE]'
        ])
      )
    );
    const onText = vi.fn();

    const messages = await askAi([{ role: 'user', content: 'q' }], onText);

    expect(messages[1]).toEqual({ role: 'assistant', content: 'こんにちは' });
    expect(onText).toHaveBeenLastCalledWith('こんにちは');
  });

  it('adds the reader note to the default instructions only', async () => {
    setOpenRouterKey('sk-or-secret');
    askAiReaderNote$.next('I am at JLPT N3.');
    const fetch = vi.fn(async () =>
      stream(['data: {"choices":[{"delta":{"content":"a"}}]}', 'data: [DONE]'])
    );
    vi.stubGlobal('fetch', fetch);
    const system = (call: number) =>
      JSON.parse((fetch.mock.calls[call] as unknown as [string, RequestInit])[1].body as string)
        .messages[0].content;

    await askAi([{ role: 'user', content: 'q' }], () => {});
    await askAi([{ role: 'user', content: 'q' }], () => {}, undefined, { system: 'Recap.' });

    expect(system(0)).toMatch(/\n\nI am at JLPT N3\.$/);
    expect(system(1)).toBe('Recap.');
  });

  it('keeps the key out of error messages', async () => {
    setOpenRouterKey('sk-or-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'Bad key sk-or-secret' } }), {
            status: 500
          })
      )
    );

    await expect(askAi([{ role: 'user', content: 'q' }], () => {})).rejects.toThrow(
      /^(?!.*sk-or-secret).*Bad key \[API key\]/s
    );
  });

  it('keeps the key out of stream errors', async () => {
    setOpenRouterKey('sk-or-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => stream(['data: {"error":{"message":"key sk-or-secret revoked"}}']))
    );

    await expect(askAi([{ role: 'user', content: 'q' }], () => {})).rejects.toThrow(
      /^(?!.*sk-or-secret)/s
    );
  });
});
