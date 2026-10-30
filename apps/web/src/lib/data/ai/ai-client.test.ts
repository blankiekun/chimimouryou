/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiConnectionCache$ } from '$lib/data/ai/ai-connections';
import { findProvider } from '$lib/data/ai/ai-providers';
import { aiFeatureDefaults, type AiConnection } from '$lib/data/ai/ai-settings';
import { AiError, chatBody, loadModels, requestChat } from './ai-client';

const provider = (id: string) => findProvider(id)!;
const connection = (id: string, endpoint?: string): AiConnection => ({
  id,
  name: id,
  provider: id,
  kind: 'text',
  endpoint,
  modified: 1
});

function answer(content = 'ok') {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
}

function lastRequest(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [
    string,
    RequestInit
  ];

  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(String(init.body))
  };
}

describe('chatBody', () => {
  it('sends only the settings the provider accepts', () => {
    const groq = provider('groq');
    const body = chatBody(
      groq,
      'm',
      { ...aiFeatureDefaults.ask, top_k: 40, min_p: 0.1, seed: 7 },
      groq.params,
      []
    );

    expect(body).toMatchObject({
      model: 'm',
      stream: true,
      temperature: 0.7,
      max_tokens: 1024,
      seed: 7
    });
    expect(body).not.toHaveProperty('top_k');
    expect(body).not.toHaveProperty('min_p');
    expect(body).not.toHaveProperty('frequency_penalty');
    expect(body).not.toHaveProperty('context');
  });

  it('asks for reasoning in the provider’s own way, and not at all when off', () => {
    const openRouter = provider('openrouter');
    const openAi = provider('openai');

    expect(chatBody(openRouter, 'm', { reasoning: 'high' }, openRouter.params, [])).toMatchObject({
      reasoning: { effort: 'high' }
    });
    expect(chatBody(openAi, 'm', { reasoning: 'low' }, openAi.params, [])).toMatchObject({
      reasoning_effort: 'low'
    });
    expect(chatBody(openAi, 'm', { reasoning: 'off' }, openAi.params, [])).not.toHaveProperty(
      'reasoning_effort'
    );
  });

  // Catches: OpenRouter models that think by default spending max_tokens on it, and sending
  // enabled:false to a mandatory model (or one whose cached list predates the flag), which rejects it.
  it('turns OpenRouter reasoning off only for models known to allow it', () => {
    const openRouter = provider('openrouter');
    const off = (mandatory?: boolean) =>
      chatBody(openRouter, 'm', { reasoning: 'off' }, openRouter.params, [], mandatory);

    expect(off(false)).toMatchObject({ reasoning: { enabled: false } });
    expect(off(true)).not.toHaveProperty('reasoning');
    expect(off(undefined)).not.toHaveProperty('reasoning');
  });
});

describe('requestChat', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    aiConnectionCache$.next({});
  });

  const target = (id: string, key = 'secret-key', params = {}) => ({
    connection: connection(id),
    provider: provider(id),
    key,
    model: 'model-x',
    params
  });

  it('uses the model’s own parameter list from OpenRouter', async () => {
    const fetchMock = vi.fn(async () => answer());

    vi.stubGlobal('fetch', fetchMock);
    aiConnectionCache$.next({
      openrouter: { models: [{ id: 'model-x', params: ['max_tokens'] }] }
    });
    await requestChat(target('openrouter', 'k', { temperature: 0.5, max_tokens: 10 }), []);

    expect(lastRequest(fetchMock).body).toMatchObject({ max_tokens: 10 });
    expect(lastRequest(fetchMock).body).not.toHaveProperty('temperature');
    expect(lastRequest(fetchMock).headers['X-Title']).toBe('Chimimouryou');
  });

  it('sends Anthropic the header that allows browsers', async () => {
    const fetchMock = vi.fn(async () => answer());

    vi.stubGlobal('fetch', fetchMock);
    await requestChat(target('anthropic'), []);

    const { url, headers } = lastRequest(fetchMock);

    expect(url).toBe('https://api.anthropic.com/v1/chat/completions');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(headers['x-api-key']).toBe('secret-key');
    expect(headers.Authorization).toBeUndefined();
  });

  it('puts the Gemini key in a header, never in the URL', async () => {
    const fetchMock = vi.fn(async () => answer());

    vi.stubGlobal('fetch', fetchMock);
    await requestChat(target('gemini'), []);

    const { url, headers } = lastRequest(fetchMock);

    expect(url).not.toContain('secret-key');
    expect(headers['x-goog-api-key']).toBe('secret-key');
  });

  it('sends Fireworks no extra header names', async () => {
    const fetchMock = vi.fn(async () => answer());

    vi.stubGlobal('fetch', fetchMock);
    await requestChat(target('fireworks'), []);

    expect(Object.keys(lastRequest(fetchMock).headers).sort()).toEqual([
      'Authorization',
      'Content-Type'
    ]);
  });

  it('keeps the key out of every error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'bad secret-key here' } }), {
            status: 500
          })
      )
    );

    await expect(requestChat(target('openai'), [])).rejects.toThrow(
      /^(?!.*secret-key).*bad \[API key\] here/
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('data: {"error":{"message":"secret-key revoked"}}\n'))
    );
    await expect(requestChat(target('openai', 'secret-key', { stream: true }), [])).rejects.toThrow(
      /^(?!.*secret-key)/
    );
  });

  it('turns HTTP errors into the short texts', async () => {
    const failWith = (status: number) =>
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}', { status }))
      );
    const error = () => requestChat(target('openrouter'), []).catch((e: AiError) => e.title);

    failWith(401);
    expect(await error()).toBe('Key refused (401)');
    failWith(402);
    expect(await error()).toBe('Out of credits (402)');
    failWith(404);
    expect(await error()).toBe('Model no longer offered');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 429 }))
    );
    expect(
      await requestChat({ ...target('openrouter'), model: 'x:free' }, []).catch(
        (e: AiError) => e.title
      )
    ).toBe('Free limit reached (429)');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    expect(
      await requestChat({ ...target('ollama'), key: '' }, []).catch((e: AiError) => e.title)
    ).toBe("Ollama isn't answering");
  });

  // Catches: a cut-off answer passed on as half a JSON list (Lorebook) or an "empty answer"
  // (Story so far), whether finish_reason comes in a non-stream answer or the last stream chunk.
  it('says the answer hit the length limit instead of returning it cut off', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '[{"a"' }, finish_reason: 'length' }]
            })
          )
      )
    );
    expect(await requestChat(target('openrouter'), []).catch((e: AiError) => e.title)).toBe(
      'Answer cut off'
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            'data: {"choices":[{"delta":{"content":"[{"}}]}\n' +
              'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\ndata: [DONE]'
          )
      )
    );
    expect(
      await requestChat(target('openrouter', 'k', { stream: true }), []).catch(
        (e: AiError) => e.title
      )
    ).toBe('Answer cut off');
  });

  it('needs a key unless the provider runs locally', async () => {
    await expect(requestChat(target('openai', ''), [])).rejects.toThrow(
      /Needs a key on this device/
    );
  });
});

describe('loadModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    aiConnectionCache$.next({});
  });

  it('loads ElevenLabs voices and its text-to-speech models; a 404 names the endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/voices')
          ? new Response(JSON.stringify({ voices: [{ voice_id: 'v1', name: 'Aya' }] }))
          : new Response(
              JSON.stringify([
                { model_id: 'eleven_new', can_do_text_to_speech: true },
                { model_id: 'eleven_sts', can_do_text_to_speech: false }
              ])
            )
      )
    );
    const eleven = { ...connection('elevenlabs'), kind: 'voice' as const };

    expect((await loadModels(eleven, 'k')).map((model) => model.id)).toEqual(['eleven_new']);
    expect(aiConnectionCache$.getValue().elevenlabs?.voiceList).toEqual([
      { id: 'v1', name: 'Aya', lang: undefined }
    ]);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"detail":{"message":"Not here"}}', { status: 404 }))
    );
    const error = await loadModels(eleven, 'k').catch((e: AiError) => e);

    expect(error).toMatchObject({ title: 'Not found (404)', detail: 'Not here' });
  });

  it('reads price, context, free models and parameters, and caches them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  id: 'google/gemma:free',
                  context_length: 96000,
                  pricing: { prompt: '0', completion: '0' },
                  supported_parameters: ['temperature'],
                  reasoning: { mandatory: true }
                },
                { id: 'a/b', pricing: { prompt: '0.0000003', completion: '0.000001' } },
                { id: 'a/b:batch' }
              ]
            })
          )
      )
    );

    const models = await loadModels(connection('openrouter'), '');

    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({
      free: true,
      context: 96000,
      params: ['temperature'],
      mandatory: true
    });
    expect(models[1].mandatory).toBe(false);
    expect(models[1].price).toBeCloseTo(0.3);
    expect(models[1].free).toBe(false);
    expect(aiConnectionCache$.getValue().openrouter.models).toEqual(models);
  });
});
