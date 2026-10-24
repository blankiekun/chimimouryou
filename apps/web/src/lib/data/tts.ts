/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Text-to-speech for the AI voice. Without an ElevenLabs key it uses this device's
 * Web Speech voices (free, offline; `boundary` events give a phrase-level highlight).
 * With one it calls ElevenLabs' API (with timestamps) directly from the browser; the
 * per-character timestamps let the reader highlight what is being said. Not part of upstream.
 */

import {
  aiConnectionKeys$,
  defaultElevenLabsModel,
  redactSecret,
  ttsVoiceId$
} from '$lib/data/ai-settings';
import { resolveFeature } from '$lib/data/ai-connections';
import { authHeaders, connectionBaseUrl } from '$lib/data/ai-providers';
import { speechText, type ReadingParagraph } from '$lib/functions/tts/extract-reading-text';
import { countTextCharacters } from '$lib/functions/get-character-count';

export interface SpeechAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface Speech {
  audio: Blob;
  alignment?: SpeechAlignment;
}

function base64ToBlob(base64: string, type: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type });
}

/** The AI voice's ElevenLabs connection with its key; undefined reads with this device's voices. */
export function elevenLabsVoice() {
  const { connection, provider, model } = resolveFeature('voice');
  const key = connection ? (aiConnectionKeys$.getValue()[connection.id] ?? '').trim() : '';

  if (!connection || provider?.id !== 'elevenlabs' || !key) {
    return undefined;
  }

  return {
    provider,
    key,
    model: model.trim() || defaultElevenLabsModel,
    baseUrl: connectionBaseUrl(provider, connection.endpoint)
  };
}

/** `previousText`/`nextText` let the voice keep its intonation across chunks; they aren't read. */
export async function synthesizeSpeech(
  text: string,
  signal?: AbortSignal,
  context: { previousText?: string; nextText?: string } = {}
): Promise<Speech> {
  const eleven = elevenLabsVoice();
  const voice = ttsVoiceId$.getValue();

  if (!eleven) {
    throw new Error('Add an ElevenLabs connection in Settings → AI first');
  }
  if (!voice) {
    throw new Error('Choose a voice in Settings → AI → Voice first');
  }

  const apiKey = eleven.key;
  const response = await fetch(
    `${eleven.baseUrl}/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(eleven.provider, apiKey) },
      body: JSON.stringify({
        text,
        model_id: eleven.model,
        ...(context.previousText && { previous_text: context.previousText }),
        ...(context.nextText && { next_text: context.nextText })
      }),
      signal
    }
  );

  if (!response.ok) {
    let detail = '';

    try {
      const body = await response.json();
      const message = body?.detail?.message ?? body?.detail;

      detail = typeof message === 'string' ? message : JSON.stringify(body);
    } catch (_) {
      // no JSON body
    }

    if (response.status === 401 || response.status === 403) {
      detail = `${detail} - check the ElevenLabs API key in Settings → AI`;
    }

    throw new Error(
      redactSecret(`ElevenLabs request failed (HTTP ${response.status}) ${detail}`.trim(), apiKey)
    );
  }

  const body = (await response.json()) as { audio_base64: string; alignment?: SpeechAlignment };

  return { audio: base64ToBlob(body.audio_base64, 'audio/mpeg'), alignment: body.alignment };
}

export interface TimelineEntry {
  /** Seconds into the chunk's audio (ElevenLabs), or offset in its speech text (device voice) */
  time: number;
  /** Character counts (as bookmarks) of the phrase */
  start: number;
  end: number;
}

/**
 * Phrases of a chunk (split after 。！？、 and closing quotes) with the time each
 * starts in the audio, from ElevenLabs' character timestamps. Without usable
 * timestamps the whole chunk is one entry.
 */
export function readingTimeline(chunk: ReadingParagraph, alignment?: SpeechAlignment) {
  const whole: TimelineEntry[] = [
    {
      time: 0,
      start: chunk.startCharCount,
      end: chunk.startCharCount + countTextCharacters(chunk.text)
    }
  ];

  if (!alignment?.characters.length) {
    return whole;
  }

  // Text offset of each timed character, so phrases can be looked up by offset.
  const offsets: number[] = [];
  let offset = 0;

  alignment.characters.forEach((character) => {
    offsets.push(offset);
    offset += character.length;
  });

  if (offset !== speechText(chunk.text).length) {
    return whole;
  }

  // Phrases are found in the chunk text; the voice read its speech text.
  const timeAt = (textOffset: number) => {
    const spokenOffset = speechText(chunk.text.slice(0, textOffset)).length;
    const index = offsets.findIndex((o) => o >= spokenOffset);

    return alignment.character_start_times_seconds[index < 0 ? offsets.length - 1 : index] ?? 0;
  };
  const timeline = phrases(chunk).map(({ offset, start, end }) => ({
    time: timeAt(offset),
    start,
    end
  }));

  return timeline.length ? timeline : whole;
}

/** Phrases of a chunk (split after 。！？、 and closing quotes) with their offset in its text. */
function phrases(chunk: ReadingParagraph) {
  const result: { offset: number; start: number; end: number }[] = [];
  let count = chunk.startCharCount;

  for (const match of chunk.text.matchAll(/[^。！？!?、\n]+[。！？!?、」』）]*|\n/g)) {
    const counted = countTextCharacters(match[0]);

    if (counted) {
      result.push({ offset: match.index ?? 0, start: count, end: count + counted });
    }
    count += counted;
  }

  return result;
}

/**
 * Phrases of a chunk keyed by where they start in its speech text (`time` is that
 * offset), so `timelineEntryAt(phrases, event.charIndex)` maps a Web Speech
 * `boundary` event to the phrase being said.
 */
export function spokenPhrases(chunk: ReadingParagraph): TimelineEntry[] {
  return phrases(chunk).map(({ offset, start, end }) => ({
    time: speechText(chunk.text.slice(0, offset)).length,
    start,
    end
  }));
}

export const deviceSpeechAvailable = () => typeof speechSynthesis !== 'undefined';

const isJapanese = (voice: SpeechSynthesisVoice) => /^ja\b/i.test(voice.lang);

/** This device's voices, Japanese first. Browsers may load them late, so this waits briefly. */
export async function deviceVoices() {
  if (!deviceSpeechAvailable()) {
    return [];
  }

  let voices = speechSynthesis.getVoices();

  if (!voices.length) {
    await new Promise((resolve) => {
      speechSynthesis.addEventListener('voiceschanged', resolve, { once: true });
      setTimeout(resolve, 1500);
    });
    voices = speechSynthesis.getVoices();
  }

  return [...voices].sort((a, b) => Number(isJapanese(b)) - Number(isJapanese(a)));
}

/** The chosen voice, else the first Japanese one; undefined lets the browser pick for ja-JP. */
export function pickDeviceVoice(voices: SpeechSynthesisVoice[], name: string) {
  return voices.find((voice) => voice.name === name) ?? voices.find(isJapanese);
}

export function deviceUtterance(
  text: string,
  voice: SpeechSynthesisVoice | undefined,
  rate: number
) {
  const utterance = new SpeechSynthesisUtterance(text);

  utterance.lang = voice?.lang ?? 'ja-JP';
  utterance.voice = voice ?? null;
  utterance.rate = rate;

  return utterance;
}

/** The entry being spoken at `seconds`. */
export function timelineEntryAt(timeline: TimelineEntry[], seconds: number) {
  let current = timeline[0];

  for (const entry of timeline) {
    if (entry.time > seconds) {
      break;
    }
    current = entry;
  }

  return current;
}
