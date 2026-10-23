/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Settings for text-to-speech and "Ask AI", stored per browser. Not part of upstream.
 */

import { writableNumberLocalStorageSubject } from '$lib/data/internal/writable-number-local-storage-subject';
import { writableObjectLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';
import { writableStringLocalStorageSubject } from '$lib/data/internal/writable-string-local-storage-subject';

/** ElevenLabs' API, called directly from the browser (it allows cross-origin requests). */
export const elevenLabsApiUrl = 'https://api.elevenlabs.io/v1';
export const defaultElevenLabsModel = 'eleven_v4';

/** Removes an API key from text that may be shown or logged (e.g. an echoed error). */
export function redactSecret(text: string, secret: string) {
  return secret ? text.split(secret).join('[API key]') : text;
}

export const elevenLabsApiKey$ = writableStringLocalStorageSubject()('elevenLabsApiKey', '');
export const elevenLabsModel$ = writableStringLocalStorageSubject()(
  'elevenLabsModel',
  defaultElevenLabsModel
);
export const ttsVoiceId$ = writableStringLocalStorageSubject()('ttsVoiceId', '');
/** Playback speed of the AI voice (the highlight follows the audio clock). */
export const ttsPlaybackRate$ = writableNumberLocalStorageSubject()('ttsPlaybackRate', 1);

export const defaultOpenRouterModel = '~google/gemini-flash-latest';

export const openRouterApiKey$ = writableStringLocalStorageSubject()('openRouterApiKey', '');
export const openRouterModel$ = writableStringLocalStorageSubject()(
  'openRouterModel',
  defaultOpenRouterModel
);

/** Model for "Story so far" recaps and the lorebook; empty means the Ask AI model. */
export const openRouterRecapModel$ = writableStringLocalStorageSubject()(
  'openRouterRecapModel',
  '~deepseek/deepseek-flash-latest'
);

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
    max_tokens: 2048,
    reasoning: 'off',
    stream: true
  },
  lore: {
    temperature: 0.2,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_tokens: 4096,
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

export const aiConnections$ = writableObjectLocalStorageSubject<AiConnection[]>()(
  'aiConnections',
  []
);
/** Connection id → API key. A secret setting: only in the account's settings.json. */
export const aiConnectionKeys$ = writableObjectLocalStorageSubject<Record<string, string>>()(
  'aiConnectionKeys',
  {}
);
export const aiFeatures$ = writableObjectLocalStorageSubject<Record<AiFeature, AiFeatureSetting>>()(
  'aiFeatures',
  defaultAiFeatures
);

/** Added to Ask AI's instructions, e.g. the reader's level; empty adds nothing. */
export const askAiReaderNote$ = writableStringLocalStorageSubject()('askAiReaderNote', '');

/** Language of the AI prompts and answers (Ask AI, recaps, lorebook): 'en' or 'ja'. */
export const aiLanguage$ = writableStringLocalStorageSubject()('aiLanguage', 'en');

/** Update the lorebook in the background every this many characters read; 0 is off. */
export const lorebookAutoInterval$ = writableNumberLocalStorageSubject()('lorebookAutoInterval', 0);

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

export const askAiPresets$ = writableObjectLocalStorageSubject<AskAiPreset[]>()(
  'askAiPresets',
  defaultAskAiPresets
);

/** Preset run as soon as the panel opens; empty waits for a choice. */
export const askAiDefaultPreset$ = writableStringLocalStorageSubject()(
  'askAiDefaultPreset',
  'explain'
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
>()('aiPromptOverrides', {});
