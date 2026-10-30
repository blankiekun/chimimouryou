/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Settings for text-to-speech and "Ask AI", stored per browser. Not part of upstream.
 */

import { localStorage } from '$lib/data/window/local-storage';
import { writableNumberLocalStorageSubject } from '$lib/data/internal/writable-number-local-storage-subject';
import { writableObjectLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';
import { writableStringLocalStorageSubject } from '$lib/data/internal/writable-string-local-storage-subject';
import { arrayOf, finite, isRecord, oneOf, record, string } from '$lib/data/setting-parsers';

export const defaultElevenLabsModel = 'eleven_v4';

/** Removes an API key from text that may be shown or logged (e.g. an echoed error). */
export function redactSecret(text: string, secret: string) {
  return secret ? text.split(secret).join('[API key]') : text;
}

export const ttsVoiceId$ = writableStringLocalStorageSubject()('ttsVoiceId', '', string);
/** This device's Web Speech voice (by name) used without an ElevenLabs key; empty picks a Japanese one. Not synced: voices differ per device. */
export const deviceVoiceName$ = writableStringLocalStorageSubject()('deviceVoiceName', '');
/** Playback speed of the AI voice (the highlight follows the audio clock). */
export const ttsPlaybackRate$ = writableNumberLocalStorageSubject()('ttsPlaybackRate', 1, finite);
/** The AI voice's speeds (Settings → AI → Voice, the mini player) */
export const ttsRates = [0.75, 0.9, 1, 1.1, 1.25, 1.5];

// Settings from before AI connections (#129), last mirrored in v3.8.0: an old API key must not linger.
[
  'openRouterApiKey',
  'openRouterModel',
  'openRouterRecapModel',
  'elevenLabsApiKey',
  'elevenLabsModel'
].forEach((key) => localStorage.removeItem(key));

/**
 * A provider, where requests go and a name (Settings → AI → Connections). Synced and
 * merged per id (newest `modified` wins, deletions kept); never holds the key.
 */
export interface AiConnection {
  id: string;
  name: string;
  /** Id in ai-providers.ts */
  provider: string;
  /** Base URL instead of the provider's */
  endpoint?: string;
  kind: 'text' | 'voice';
  modified: number;
  deleted?: boolean;
}

export type AiFeature = 'ask' | 'recap' | 'lore' | 'voice';
export type AiTextFeature = Exclude<AiFeature, 'voice'>;

export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high';

/** Advanced settings of a feature; a missing value is not sent. */
export interface AiSamplers {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  max_tokens?: number;
  /** Characters of book text sent (Ask AI: before the selection; Lorebook: per request) */
  context?: number;
  reasoning?: ReasoningEffort;
  stream?: boolean;
  seed?: number;
}

export interface AiFeatureSetting {
  /** Connection id; 'inherit': the feature above (Lorebook → Story so far → Ask AI); '': the first one */
  connection: string;
  /** Empty: the provider's default model for the feature */
  model: string;
  /** Changes from the feature's defaults */
  params: AiSamplers;
}

/** Sent with every request unless the model doesn't take them. */
export const aiFeatureDefaults: Record<AiTextFeature, AiSamplers> = {
  ask: {
    temperature: 0.7,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_tokens: 1024,
    context: 2000,
    reasoning: 'off',
    stream: true
  },
  recap: {
    temperature: 0.3,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_tokens: 8192,
    reasoning: 'off',
    stream: true
  },
  lore: {
    temperature: 0.2,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_tokens: 16_384,
    context: 20_000,
    reasoning: 'off',
    // The answer is JSON.
    stream: false
  }
};

export const defaultAiFeatures: Record<AiFeature, AiFeatureSetting> = {
  ask: { connection: '', model: '', params: {} },
  recap: { connection: '', model: '', params: {} },
  lore: { connection: 'inherit', model: '', params: {} },
  voice: { connection: '', model: '', params: {} }
};

/** What the merge needs; other fields, an unknown provider included, are kept for newer clients. */
const isConnection = (item: unknown) =>
  isRecord(item) &&
  typeof item.id === 'string' &&
  typeof item.provider === 'string' &&
  Number.isFinite(item.modified) &&
  (item.endpoint === undefined || typeof item.endpoint === 'string');

/** Connections the merge can't use (from a malformed synced list) are dropped, the rest kept. */
function parseConnections(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return (value.every(isConnection) ? value : value.filter(isConnection)) as AiConnection[];
}

export const aiConnections$ = writableObjectLocalStorageSubject<AiConnection[]>()(
  'aiConnections',
  [],
  parseConnections
);

/** A key and where it may go: its connection's provider and base URL when it was saved. */
export interface AiConnectionKey {
  key: string;
  provider: string;
  base: string;
}

/**
 * Connection id → key, kept in this browser only (never synced). A plain string is a key saved before
 * keys were bound (ai-connections.ts binds those on load) and is never sent.
 */
export const aiConnectionKeys$ = writableObjectLocalStorageSubject<
  Record<string, AiConnectionKey | string>
>()('aiConnectionKeys', {});
export const aiFeatures$ = writableObjectLocalStorageSubject<Record<AiFeature, AiFeatureSetting>>()(
  'aiFeatures',
  defaultAiFeatures,
  record
);

/** Added to Ask AI's instructions, e.g. the reader's level; empty adds nothing. */
export const askAiReaderNote$ = writableStringLocalStorageSubject()('askAiReaderNote', '', string);

/** Language of the AI prompts and answers (Ask AI, recaps, lorebook): 'en' or 'ja'. */
export const aiLanguage$ = writableStringLocalStorageSubject()(
  'aiLanguage',
  'en',
  oneOf(['en', 'ja'])
);

/** Update the lorebook in the background every this many characters read; 0 is off. */
export const lorebookAutoInterval$ = writableNumberLocalStorageSubject()(
  'lorebookAutoInterval',
  0,
  finite
);

export interface AskAiPreset {
  id: string;
  label: string;
  prompt: string;
}

export const defaultAskAiPresets: AskAiPreset[] = [
  {
    id: 'explain',
    label: 'Explain',
    prompt: 'What does the selected passage mean, and what might I have missed?'
  },
  {
    id: 'translate',
    label: 'Translate',
    prompt:
      'Translate the selected passage into natural English. Then give a closer, more literal rendering and point out where the two differ.'
  },
  {
    id: 'nuance',
    label: 'Nuance',
    prompt:
      'Explain the tone, register and nuance of the selected passage: who is speaking and how (polite, rough, feminine, dialect...), and what it says about the character or situation.'
  },
  {
    id: 'grammar',
    label: 'Grammar',
    prompt:
      'Break down the grammar of the selected passage for a learner: go through each grammar point and conjugation used, give its dictionary form, and briefly explain what it does here.'
  }
];

const isPreset = (item: unknown) => isRecord(item) && typeof item.id === 'string';

export const askAiPresets$ = writableObjectLocalStorageSubject<AskAiPreset[]>()(
  'askAiPresets',
  defaultAskAiPresets,
  arrayOf<AskAiPreset>(isPreset)
);

/** Preset run as soon as the panel opens; empty waits for a choice. */
export const askAiDefaultPreset$ = writableStringLocalStorageSubject()(
  'askAiDefaultPreset',
  'explain',
  string
);

/** An OpenRouter model id as the panels show it: `~vendor/model` → `model`. */
export function modelShortName(id: string) {
  return id.replace(/^~/, '').split('/').pop() || id;
}

/** The system prompts readers can replace (`ai-prompts.ts`). */
export type AiPromptKey = 'ask' | 'chapter' | 'recap' | 'lore';

/** The reader's own system prompts per AI language (`en`/`ja`); a missing one uses the built-in. */
export const aiPromptOverrides$ = writableObjectLocalStorageSubject<
  Partial<Record<string, Partial<Record<AiPromptKey, string>>>>
>()('aiPromptOverrides', {}, record);
