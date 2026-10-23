/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The AI providers a connection can use (Settings → AI → Connections). Every text
 * provider is called through its OpenAI-compatible chat completions endpoint,
 * straight from the browser. Sources for CORS and free tiers are in the AI
 * settings research notes. Not part of upstream.
 */

/** Request settings a model may accept, named like OpenRouter's `supported_parameters`. */
export type SamplerName =
  | 'temperature'
  | 'top_p'
  | 'top_k'
  | 'min_p'
  | 'frequency_penalty'
  | 'presence_penalty'
  | 'max_tokens'
  | 'reasoning'
  | 'seed';

/**
 * bearer: `Authorization: Bearer`; anthropic: `x-api-key` plus the header that lets a
 * browser call it; google: `x-goog-api-key` (never `?key=` in the URL).
 */
export type AiAuth = 'bearer' | 'anthropic' | 'google' | 'elevenlabs';

export type AiProviderGroup = 'aggregator' | 'free' | 'direct' | 'local' | 'other';

export interface AiProvider {
  id: string;
  label: string;
  /** One line under the name in the provider picker */
  hint?: string;
  group: AiProviderGroup;
  kind: 'text' | 'voice';
  /** OpenAI-compatible base URL, without a trailing slash */
  baseUrl: string;
  auth: AiAuth;
  needsKey: boolean;
  /** free: a free tier; trains: a free tier whose text may be used for training */
  free?: 'free' | 'trains';
  /** Settings its models accept, unless the model list says otherwise per model */
  params: SamplerName[];
  /** Fixed model list for providers without a models endpoint */
  models?: string[];
  /** Model per feature when none is chosen; empty: the first listed model */
  defaultModels?: { ask?: string; recap?: string; voice?: string };
  /** Shown first under "Suggested" in the model picker */
  suggested?: string[];
  /** Where to create a key */
  keyUrl?: string;
  /** Can't send headers beyond authorization and content-type (Fireworks' CORS) */
  plainHeaders?: boolean;
}

const common: SamplerName[] = [
  'temperature',
  'top_p',
  'frequency_penalty',
  'presence_penalty',
  'max_tokens',
  'seed'
];
const everything: SamplerName[] = [...common, 'top_k', 'min_p', 'reasoning'];
const local: SamplerName[] = [...common, 'top_k', 'min_p'];

export const aiProviders: AiProvider[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    hint: '300+ models from every vendor',
    group: 'aggregator',
    kind: 'text',
    baseUrl: 'https://openrouter.ai/api/v1',
    auth: 'bearer',
    needsKey: true,
    // Each model's own list comes with the model list (supported_parameters).
    params: everything,
    defaultModels: { ask: '~google/gemini-flash-latest', recap: '~deepseek/deepseek-flash-latest' },
    suggested: ['~google/gemini-flash-latest', '~deepseek/deepseek-flash-latest'],
    keyUrl: 'https://openrouter.ai/settings/keys'
  },
  {
    id: 'gemini',
    label: 'Google AI Studio (Gemini API)',
    hint: 'Gemini models; also reads aloud',
    group: 'free',
    kind: 'text',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    auth: 'google',
    needsKey: true,
    free: 'trains',
    params: ['temperature', 'top_p', 'max_tokens', 'reasoning'],
    defaultModels: { ask: 'gemini-flash-latest', recap: 'gemini-flash-lite-latest' },
    suggested: ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-pro-latest'],
    keyUrl: 'https://aistudio.google.com/apikey'
  },
  {
    id: 'groq',
    label: 'Groq',
    hint: 'Fast open models',
    group: 'free',
    kind: 'text',
    baseUrl: 'https://api.groq.com/openai/v1',
    auth: 'bearer',
    needsKey: true,
    free: 'free',
    params: ['temperature', 'top_p', 'max_tokens', 'seed'],
    keyUrl: 'https://console.groq.com/keys'
  },
  {
    id: 'mistral',
    label: 'Mistral',
    hint: 'Phone check at sign-up',
    group: 'free',
    kind: 'text',
    baseUrl: 'https://api.mistral.ai/v1',
    auth: 'bearer',
    needsKey: true,
    free: 'trains',
    params: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'max_tokens'],
    defaultModels: { ask: 'mistral-medium-latest', recap: 'mistral-small-latest' },
    keyUrl: 'https://console.mistral.ai/api-keys'
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    group: 'free',
    kind: 'text',
    baseUrl: 'https://api.cerebras.ai/v1',
    auth: 'bearer',
    needsKey: true,
    free: 'free',
    params: ['temperature', 'top_p', 'max_tokens', 'seed'],
    keyUrl: 'https://cloud.cerebras.ai'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    group: 'direct',
    kind: 'text',
    baseUrl: 'https://api.openai.com/v1',
    auth: 'bearer',
    needsKey: true,
    params: [...common, 'reasoning'],
    defaultModels: { ask: 'gpt-5-mini', recap: 'gpt-5-nano' },
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    group: 'direct',
    kind: 'text',
    baseUrl: 'https://api.anthropic.com/v1',
    auth: 'anthropic',
    needsKey: true,
    params: ['temperature', 'top_p', 'max_tokens'],
    defaultModels: { ask: 'claude-sonnet-4-5', recap: 'claude-haiku-4-5' },
    keyUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    group: 'direct',
    kind: 'text',
    baseUrl: 'https://api.deepseek.com',
    auth: 'bearer',
    needsKey: true,
    params: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'max_tokens'],
    defaultModels: { ask: 'deepseek-chat', recap: 'deepseek-chat' },
    keyUrl: 'https://platform.deepseek.com/api_keys'
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    group: 'direct',
    kind: 'text',
    baseUrl: 'https://api.x.ai/v1',
    auth: 'bearer',
    needsKey: true,
    params: common,
    keyUrl: 'https://console.x.ai'
  },
  {
    id: 'cohere',
    label: 'Cohere',
    hint: 'Trial keys are free',
    group: 'direct',
    kind: 'text',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    auth: 'bearer',
    needsKey: true,
    params: common,
    keyUrl: 'https://dashboard.cohere.com/api-keys'
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    group: 'direct',
    kind: 'text',
    baseUrl: 'https://api.perplexity.ai',
    auth: 'bearer',
    needsKey: true,
    params: [
      'temperature',
      'top_p',
      'top_k',
      'frequency_penalty',
      'presence_penalty',
      'max_tokens'
    ],
    // It has no models endpoint.
    models: ['sonar', 'sonar-pro', 'sonar-reasoning', 'sonar-reasoning-pro'],
    defaultModels: { ask: 'sonar', recap: 'sonar' },
    keyUrl: 'https://www.perplexity.ai/settings/api'
  },
  {
    id: 'together',
    label: 'Together',
    group: 'direct',
    kind: 'text',
    baseUrl: 'https://api.together.xyz/v1',
    auth: 'bearer',
    needsKey: true,
    params: local,
    keyUrl: 'https://api.together.ai/settings/api-keys'
  },
  {
    id: 'fireworks',
    label: 'Fireworks',
    group: 'direct',
    kind: 'text',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    auth: 'bearer',
    needsKey: true,
    params: local,
    keyUrl: 'https://fireworks.ai/account/api-keys',
    plainHeaders: true
  },
  {
    id: 'ollama',
    label: 'Ollama',
    hint: 'Set OLLAMA_ORIGINS first',
    group: 'local',
    kind: 'text',
    baseUrl: 'http://localhost:11434/v1',
    auth: 'bearer',
    needsKey: false,
    params: local
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp server',
    group: 'local',
    kind: 'text',
    baseUrl: 'http://localhost:8080/v1',
    auth: 'bearer',
    needsKey: false,
    params: local
  },
  {
    id: 'koboldcpp',
    label: 'KoboldCpp',
    group: 'local',
    kind: 'text',
    baseUrl: 'http://localhost:5001/v1',
    auth: 'bearer',
    needsKey: false,
    params: local
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    hint: 'Turn on CORS in its server settings',
    group: 'local',
    kind: 'text',
    baseUrl: 'http://localhost:1234/v1',
    auth: 'bearer',
    needsKey: false,
    params: local
  },
  {
    id: 'custom',
    label: 'OpenAI-compatible endpoint',
    hint: 'Any server with /v1/chat/completions',
    group: 'other',
    kind: 'text',
    baseUrl: '',
    auth: 'bearer',
    needsKey: false,
    params: local
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    hint: 'Reads aloud with character timing',
    group: 'other',
    kind: 'voice',
    baseUrl: 'https://api.elevenlabs.io/v1',
    auth: 'elevenlabs',
    needsKey: true,
    free: 'free',
    params: [],
    models: ['eleven_v4', 'eleven_v4_turbo', 'eleven_multilingual_v2'],
    defaultModels: { voice: 'eleven_v4' },
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys'
  }
];

export function findProvider(id: string | undefined) {
  return aiProviders.find((provider) => provider.id === id);
}

/** Base URL of a connection: its own endpoint, else the provider's. */
export function connectionBaseUrl(provider: AiProvider, endpoint?: string) {
  return (endpoint?.trim() || provider.baseUrl).replace(/\/+$/, '');
}

/** Request headers with the key, in the provider's style. */
export function authHeaders(provider: AiProvider, key: string): Record<string, string> {
  if (!key) {
    return {};
  }

  switch (provider.auth) {
    case 'anthropic':
      // Anthropic only answers browsers that send this header.
      return {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      };
    case 'google':
      return { 'x-goog-api-key': key };
    case 'elevenlabs':
      return { 'xi-api-key': key };
    default:
      return { Authorization: `Bearer ${key}` };
  }
}

/** True for a server on this computer, which needs no key and may refuse other origins. */
export function isLocalProvider(provider: AiProvider) {
  return provider.group === 'local';
}
