/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Chat completions for the AI features through each connection's
 * OpenAI-compatible endpoint, called straight from the browser; model lists and
 * Test connection. Settings a model doesn't accept are left out. Keys never go
 * into URLs and are removed from every error. Not part of upstream.
 */

import {
  aiConnectionCache$,
  connectionKey,
  defaultModel,
  resolveFeature,
  updateConnectionCache,
  type AiConnectionCache,
  type AiConnectionTest,
  type AiModel,
  type ResolvedFeature
} from '$lib/data/ai/ai-connections';
import {
  authHeaders,
  connectionBaseUrl,
  findProvider,
  isLocalProvider,
  type AiProvider,
  type SamplerName
} from '$lib/data/ai/ai-providers';
import {
  redactSecret,
  type AiConnection,
  type AiSamplers,
  type AiTextFeature
} from '$lib/data/ai/ai-settings';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** An error with the short text the settings and the reader panels show. */
export class AiError extends Error {
  constructor(
    readonly title: string,
    readonly detail = '',
    /** Link that helps, e.g. where to create a key */
    readonly help?: { label: string; href: string }
  ) {
    super(detail ? `${title}. ${detail}` : title);
  }
}

const samplerNames: SamplerName[] = [
  'temperature',
  'top_p',
  'top_k',
  'min_p',
  'frequency_penalty',
  'presence_penalty',
  'max_tokens',
  'seed'
];

/**
 * Claude models before 4.7 take temperature (not with top_p: Sonnet 4.5 and Haiku 4.5 refuse
 * both); later ones (Haiku 5.5, Opus 5…) refuse any sampling setting.
 */
function claudeParams(model: string, params: string[]) {
  const name = model.replace(/^anthropic[./]/, '');
  const version = /^claude-(?:(?:opus|sonnet|haiku)-)?(\d+)(?:-(\d)(?!\d))?/.exec(name);
  const older = !!version && Number(version[1]) + Number(version[2] ?? 0) / 10 < 4.7;

  return params.filter((param) => param !== 'top_p' && (older || param !== 'temperature'));
}

/** Settings a model accepts: its own list from the provider (OpenRouter), else the provider's. */
export function acceptedParams(provider: AiProvider, connectionId: string, model: string) {
  const listed = cachedModel(connectionId, model)?.params;

  return (listed ??
    (provider.id === 'anthropic'
      ? claudeParams(model, provider.params)
      : provider.params)) as string[];
}

function cachedModel(connectionId: string, model: string) {
  return aiConnectionCache$.getValue()[connectionId]?.models?.find((m) => m.id === model);
}

/** The request body: model, messages, stream and the settings the model accepts. */
export function chatBody(
  provider: AiProvider,
  model: string,
  params: AiSamplers,
  accepted: string[],
  messages: ChatMessage[],
  /** OpenRouter's reasoning.mandatory for this model; undefined when not known */
  reasoningMandatory?: boolean
) {
  const body: Record<string, unknown> = { model, messages, stream: !!params.stream };

  samplerNames.forEach((name) => {
    if (params[name] !== undefined && accepted.includes(name)) {
      body[name] = params[name];
    }
  });

  if (params.reasoning && params.reasoning !== 'off' && accepted.includes('reasoning')) {
    if (provider.id === 'openrouter') {
      body.reasoning = { effort: params.reasoning };
    } else {
      body.reasoning_effort = params.reasoning;
    }
  } else if (
    provider.id === 'openrouter' &&
    accepted.includes('reasoning') &&
    reasoningMandatory === false
  ) {
    // Models that think by default spend max_tokens on it. A model list cached before the flag
    // existed leaves it undefined: send nothing, since mandatory models reject this.
    body.reasoning = { enabled: false };
  }

  return body;
}

function requestHeaders(provider: AiProvider, key: string) {
  return {
    ...authHeaders(provider, key),
    'Content-Type': 'application/json',
    // Fireworks' CORS refuses extra header names.
    ...(provider.id === 'openrouter' ? { 'X-Title': 'Chimimouryou' } : {})
  };
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function keyHelp(provider: AiProvider) {
  return provider.keyUrl
    ? { label: `Open ${hostOf(provider.keyUrl)}`, href: provider.keyUrl }
    : undefined;
}

/** No answer at all: offline, refused by CORS, or blocked as mixed content. */
function unreachableError(provider: AiProvider, baseUrl: string) {
  const host = hostOf(baseUrl);
  const local = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(baseUrl);

  if (baseUrl.startsWith('http:') && !local && globalThis.location?.protocol === 'https:') {
    return new AiError(
      'Blocked by the browser',
      `${host} is a plain http address, which pages served over https can't call. Use https, or the desktop app.`
    );
  }

  if (provider.id === 'ollama') {
    return new AiError(
      "Ollama isn't answering",
      `Nothing at ${host}. Start Ollama with OLLAMA_ORIGINS set to ${globalThis.location?.origin ?? 'this site'}, then test again.`,
      {
        label: 'How to set OLLAMA_ORIGINS',
        href: 'https://github.com/ollama/ollama/blob/main/docs/faq.mdx'
      }
    );
  }

  return new AiError(
    "Couldn't reach the server",
    isLocalProvider(provider)
      ? `Nothing at ${host}. Start the server and allow requests from this site (CORS).`
      : `No answer from ${host}. Check the endpoint; some servers refuse requests from web pages (CORS).`
  );
}

async function errorDetail(response: Response) {
  try {
    const body = await response.json();
    const error = Array.isArray(body) ? body[0]?.error : body?.error;

    // ElevenLabs answers {detail: {message}} or {detail: "…"}
    const detail = typeof body?.detail === 'string' ? body.detail : body?.detail?.message;

    return String(
      (typeof error === 'string' ? error : error?.message) || body?.message || detail || ''
    );
  } catch {
    return '';
  }
}

async function responseError(
  response: Response,
  provider: AiProvider,
  baseUrl: string,
  model: string
) {
  const status = response.status;
  const detail = await errorDetail(response);

  if (status === 401 || status === 403) {
    return new AiError(
      `Key refused (${status})`,
      'Check that you copied the whole key, or create a new one.',
      keyHelp(provider)
    );
  }

  if (status === 402) {
    return new AiError(
      'Out of credits (402)',
      `Add credits at ${hostOf(provider.keyUrl || baseUrl)}, or choose a model marked Free.`
    );
  }

  if (status === 429) {
    return model.endsWith(':free')
      ? new AiError(
          'Free limit reached (429)',
          'Free models allow 50 requests a day. Try again tomorrow, or add credits.'
        )
      : new AiError('Too many requests (429)', detail || 'Wait a moment and try again.');
  }

  if (model && (status === 404 || (status === 400 && /model/i.test(detail)))) {
    return new AiError(
      'Model no longer offered',
      `${model} is not offered by ${provider.label}. Choose another model in Settings → AI.`
    );
  }

  if (status === 404) {
    return new AiError(
      'Not found (404)',
      detail ||
        `Nothing at ${response.url || baseUrl}. Check the endpoint (${provider.baseUrl || 'https://…/v1'}).`
    );
  }

  return new AiError(`Request failed (HTTP ${status})`, detail);
}

/** Keeps the key out of an error's text. */
function redacted(error: unknown, key: string) {
  if (error instanceof AiError) {
    return new AiError(redactSecret(error.title, key), redactSecret(error.detail, key), error.help);
  }

  return error instanceof Error && key && error.message.includes(key)
    ? new Error(redactSecret(error.message, key))
    : error;
}

export type ChatTarget = Pick<
  ResolvedFeature,
  'connection' | 'provider' | 'key' | 'model' | 'params'
>;

/** Sends one chat request; with `params.stream`, onText gets the answer so far. */
export async function requestChat(
  target: ChatTarget,
  messages: ChatMessage[],
  onText: (text: string) => void = () => {},
  signal?: AbortSignal
): Promise<string> {
  const { connection, provider, key, model, params } = target;

  if (!connection || !provider) {
    throw new AiError('Needs a connection', 'Add one in Settings → AI.');
  }

  if (provider.needsKey && !key) {
    throw new AiError(
      'Needs a key on this device',
      'This connection synced without its key. Paste the key, or sign in to get it from your account.'
    );
  }

  const baseUrl = connectionBaseUrl(provider, connection.endpoint);

  try {
    return await sendChat(
      provider,
      baseUrl,
      connection.id,
      key,
      model,
      params,
      messages,
      onText,
      signal
    );
  } catch (error) {
    throw redacted(error, key);
  }
}

async function sendChat(
  provider: AiProvider,
  baseUrl: string,
  connectionId: string,
  key: string,
  model: string,
  params: AiSamplers,
  messages: ChatMessage[],
  onText: (text: string) => void,
  signal?: AbortSignal
) {
  let response: Response;

  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: requestHeaders(provider, key),
      body: JSON.stringify(
        chatBody(
          provider,
          model,
          params,
          acceptedParams(provider, connectionId, model),
          messages,
          cachedModel(connectionId, model)?.mandatory
        )
      ),
      signal
    });
  } catch (error) {
    if (signal?.aborted || (error as Error)?.name === 'AbortError') {
      throw error;
    }

    throw unreachableError(provider, baseUrl);
  }

  if (!response.ok || !response.body) {
    throw await responseError(response, provider, baseUrl, model);
  }

  const text = params.stream
    ? await readStream(response, onText)
    : await readAnswer(response, onText);

  if (!text) {
    throw new AiError('Empty answer', 'The model returned an empty answer.');
  }

  return text;
}

function streamError(error: { message?: string }) {
  return new AiError('The model stopped', error.message || 'Stream error.');
}

/** A cut-off answer would only fail later (half a JSON list) or look empty (all reasoning). */
function checkFinish(choice: { finish_reason?: string } | undefined) {
  if (choice?.finish_reason === 'length') {
    throw new AiError(
      'Answer cut off',
      'The answer hit the Max answer length limit. Raise it in Settings → AI, or set Reasoning effort to Off.'
    );
  }
}

async function readAnswer(response: Response, onText: (text: string) => void) {
  const body = await response.json();

  if (body.error) {
    throw streamError(body.error);
  }

  checkFinish(body.choices?.[0]);

  const text = String(body.choices?.[0]?.message?.content ?? '');

  onText(text);

  return text;
}

async function readStream(response: Response, onText: (text: string) => void) {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();

  let buffer = '';
  let text = '';

  const handleLine = (line: string) => {
    // Lines starting with ':' are keep-alive comments.
    if (!line.startsWith('data:')) {
      return;
    }

    const payload = line.slice(5).trim();

    if (!payload || payload === '[DONE]') {
      return;
    }

    const chunk = JSON.parse(payload);

    if (chunk.error) {
      throw streamError(chunk.error);
    }

    checkFinish(chunk.choices?.[0]);

    const delta = chunk.choices?.[0]?.delta?.content;

    if (delta) {
      text += delta;
      onText(text);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += value;

    const lines = buffer.split('\n');

    buffer = lines.pop() ?? '';
    lines.forEach(handleLine);
  }

  // The last line may end without a newline.
  handleLine(buffer);

  return text;
}

/**
 * Asks a feature's model (Ask AI, Story so far, Lorebook) with its connection
 * and settings, and returns the answer.
 */
export function chat(
  feature: AiTextFeature,
  messages: ChatMessage[],
  onText?: (text: string) => void,
  signal?: AbortSignal
) {
  return requestChat(resolveFeature(feature), messages, onText, signal);
}

function toModel(provider: AiProvider, raw: any): AiModel {
  const id = String(raw.id ?? raw.name ?? '').replace(/^models\//, '');
  const prompt = raw.pricing?.prompt;
  const price = prompt === undefined ? undefined : Number(prompt) * 1e6;

  return {
    id,
    name: typeof raw.name === 'string' && raw.name !== raw.id ? raw.name : undefined,
    context: raw.context_length ?? raw.context_window ?? raw.max_context_length ?? undefined,
    price: Number.isFinite(price) ? price : undefined,
    free:
      provider.id === 'openrouter'
        ? id.endsWith(':free') || (prompt === '0' && raw.pricing?.completion === '0')
        : !!provider.free || isLocalProvider(provider),
    params: Array.isArray(raw.supported_parameters) ? raw.supported_parameters : undefined,
    mandatory: provider.id === 'openrouter' ? raw.reasoning?.mandatory === true : undefined
  };
}

/** Loads a connection's model list from its provider and keeps it in this browser. */
export async function loadModels(connection: AiConnection, key = connectionKey(connection)) {
  const provider = findProvider(connection.provider);

  if (!provider) {
    throw new AiError('Unknown provider', connection.provider);
  }

  const baseUrl = connectionBaseUrl(provider, connection.endpoint);
  let models: AiModel[];
  let voices: number | undefined;
  let voiceList: AiConnectionCache['voiceList'];

  try {
    if (provider.kind === 'voice') {
      const list: any[] = (await fetchJson(provider, baseUrl, '/voices', key)).voices ?? [];
      // The account's text-to-speech models; the built-in list if that fails.
      const offered: any[] = await fetchJson(provider, baseUrl, '/models', key).catch(() => []);
      const ids = (Array.isArray(offered) ? offered : [])
        .filter((model) => model?.model_id && model.can_do_text_to_speech !== false)
        .map((model) => String(model.model_id));

      models = (ids.length ? ids : (provider.models ?? [])).map((id) => ({ id }));

      voices = list.length;
      voiceList = list
        .filter((voice) => voice?.voice_id)
        .map((voice) => ({
          id: String(voice.voice_id),
          name: String(voice.name ?? voice.voice_id),
          lang: voice.labels?.language ?? voice.verified_languages?.[0]?.language
        }));
    } else if (provider.models) {
      models = provider.models.map((id) => ({ id }));
    } else {
      const body = await fetchJson(provider, baseUrl, '/models', key);
      const list: any[] = Array.isArray(body) ? body : (body.data ?? body.models ?? []);

      models = list
        .map((raw) => toModel(provider, raw))
        .filter((m) => m.id && !m.id.endsWith(':batch'));
    }
  } catch (error) {
    throw redacted(error, key);
  }

  updateConnectionCache(connection.id, { models, voices, voiceList, loadedAt: Date.now() });

  return models;
}

async function fetchJson(provider: AiProvider, baseUrl: string, path: string, key: string) {
  let response: Response;

  try {
    response = await fetch(`${baseUrl}${path}`, { headers: authHeaders(provider, key) });
  } catch {
    throw unreachableError(provider, baseUrl);
  }

  if (!response.ok) {
    throw await responseError(response, provider, baseUrl, '');
  }

  return response.json();
}

/**
 * One short request to the model a feature would use (or the provider's
 * default), after reloading the models. The result is kept for the "Last test" column.
 */
export async function testConnection(connection: AiConnection, key = connectionKey(connection)) {
  const provider = findProvider(connection.provider);
  const started = performance.now();
  let test: AiConnectionTest;

  try {
    const models = await loadModels(connection, key);

    if (provider?.kind === 'voice') {
      test = {
        ok: true,
        title: 'Works',
        detail: `${aiConnectionCache$.getValue()[connection.id]?.voices ?? 0} voices loaded.`,
        at: Date.now()
      };
    } else {
      const ask = resolveFeature('ask');
      const model =
        (ask.connection?.id === connection.id && ask.model) ||
        (provider ? defaultModel(provider, 'ask', connection.id) : '') ||
        models[0]?.id ||
        '';

      await requestChat(
        { connection, provider, key, model, params: { max_tokens: 16, stream: false } },
        [{ role: 'user', content: 'Reply with OK.' }]
      ).catch((error) => {
        // A thinking model may spend all 16 tokens before answering: it still answered.
        if (!(error instanceof AiError && error.title === 'Empty answer')) {
          throw error;
        }
      });

      const seconds = ((performance.now() - started) / 1000).toFixed(1);

      test = {
        ok: true,
        title: 'Works',
        detail: `${model} answered in ${seconds} s. ${models.length} models loaded.`,
        at: Date.now()
      };
    }
  } catch (error) {
    test = {
      ok: false,
      title: error instanceof AiError ? error.title : 'Failed',
      detail: error instanceof AiError ? error.detail : redactSecret(String(error), key),
      at: Date.now()
    };
  }

  updateConnectionCache(connection.id, { test });

  return test;
}
