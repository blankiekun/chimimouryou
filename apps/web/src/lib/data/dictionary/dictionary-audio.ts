/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Word audio for the built-in dictionary's popup, after Yomitan's AudioDownloader and
 * AudioSystem (media/audio-downloader.js, audio-system.js), for the sources a web page can use:
 * JapanesePod101's file URL (played by an <audio>, which needs no CORS; its "not available" clip
 * is told apart by its length, as AudioSystem does), Wikimedia Commons' API (Lingua Libre,
 * Wiktionary; it allows any origin), the browser's speech voices and custom URLs. Left out:
 * LanguagePod101's and Jisho's pages, which can only be read without CORS. Not part of upstream.
 */

import type { AudioOptions, AudioSourceOptions } from '$lib/vendor/yomitan/types/settings';
import { isStringEntirelyKana } from '$lib/vendor/yomitan/language/ja/japanese';

export const audioSourceTypes = [
  'jpod101',
  'lingua-libre',
  'wiktionary',
  'text-to-speech',
  'text-to-speech-reading',
  'custom',
  'custom-json'
] as const;

type Info = { type: 'url'; url: string } | { type: 'tts'; text: string; voice: string };

const fetchJson = async (url: string) => {
  const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error(`Invalid response: ${response.status}`);
  return response.json();
};

/** AudioDownloader._getCustomUrl */
export function customUrl(template: string, term: string, reading: string) {
  const data: Record<string, string> = { term, reading, language: 'ja' };
  return template.replace(/\{([^}]*)\}/g, (m0, m1) =>
    Object.prototype.hasOwnProperty.call(data, m1) ? `${data[m1]}` : m0
  );
}

/** AudioDownloader._getInfoJpod101 */
export function jpod101Url(term: string, reading: string) {
  if (reading === term && isStringEntirelyKana(term)) {
    term = '';
  }
  const params = new URLSearchParams();
  if (term.length > 0) params.set('kanji', term);
  if (reading.length > 0) params.set('kana', reading);
  return `https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?${params.toString()}`;
}

/** AudioDownloader._getInfoWikimediaCommons */
async function wikimediaCommons(
  fetchUrl: string,
  validateFilename: (filename: string) => boolean
): Promise<Info[]> {
  const lookup = await fetchJson(fetchUrl);
  const results = await Promise.all(
    (lookup.query?.search ?? []).map(async ({ title }: { title: string }) => {
      const file = await fetchJson(
        `https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=${title}&prop=imageinfo&iiprop=user|url&origin=*`
      );
      return Object.values(file.query?.pages ?? {})
        .filter(() => validateFilename(title))
        .map((page: any) => ({ type: 'url', url: page.imageinfo[0].url }) as Info);
    })
  );
  return results.flat();
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

async function infoList({ type, url, voice }: AudioSourceOptions, term: string, reading: string) {
  switch (type) {
    case 'jpod101':
      return [{ type: 'url', url: jpod101Url(term, reading) }] as Info[];
    case 'lingua-libre': {
      const category = 'incategory:"Lingua_Libre_pronunciation-jpn"';
      const test = new RegExp(`^File:LL-Q\\d+\\s+\\(jpn\\)-[^-]+-${escape(term)}\\.wav$`, 'i');
      return wikimediaCommons(
        `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srsearch=intitle:/-${term}.wav/i+${category}&srnamespace=6&origin=*`,
        (filename) => test.test(filename)
      );
    }
    case 'wiktionary': {
      const test = new RegExp(`^File:ja(-\\w\\w)?-${escape(term)}\\d*\\.ogg$`, 'i');
      return wikimediaCommons(
        `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srsearch=intitle:/ja(-[a-zA-Z]{2})?-${term}[0123456789]*.ogg/i&srnamespace=6&origin=*`,
        (filename) => test.test(filename)
      );
    }
    case 'text-to-speech':
      return [{ type: 'tts', text: term, voice }] as Info[];
    case 'text-to-speech-reading':
      return [{ type: 'tts', text: reading, voice }] as Info[];
    case 'custom':
      return url ? ([{ type: 'url', url: customUrl(url, term, reading) }] as Info[]) : [];
    case 'custom-json': {
      if (!url) return [];
      const list = await fetchJson(customUrl(url, term, reading));
      return ((list?.type === 'audioSourceList' && list.audioSources) || [])
        .filter((source: any) => typeof source?.url === 'string')
        .map((source: any) => ({ type: 'url', url: source.url }) as Info);
    }
    default:
      return [];
  }
}

let playing: HTMLAudioElement | undefined;

export function stopTermAudio() {
  playing?.pause();
  playing = undefined;
  globalThis.speechSynthesis?.cancel();
}

// AudioSystem: JapanesePod101's "the audio for this clip is not available" clip.
const jpod101Missing = new Set([5.694694, 5.651111]);

function loadAudio(url: string, sourceType: string, volume: number) {
  return new Promise<HTMLAudioElement>((resolve, reject) => {
    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, volume / 100));
    const timer = setTimeout(() => reject(new Error('Audio timed out')), 10000);
    audio.addEventListener('loadedmetadata', () => {
      clearTimeout(timer);
      if (sourceType === 'jpod101' && jpod101Missing.has(Math.round(audio.duration * 1e6) / 1e6)) {
        reject(new Error('Audio not available'));
      } else {
        resolve(audio);
      }
    });
    audio.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('Audio failed to load'));
    });
  });
}

function speak(text: string, voiceUri: string, volume: number) {
  const synthesis = globalThis.speechSynthesis;
  const voice = synthesis?.getVoices().find(({ voiceURI }) => voiceURI === voiceUri);
  if (!synthesis || !voice) return false;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ja-JP';
  utterance.voice = voice;
  utterance.volume = Math.max(0, Math.min(1, volume / 100));
  synthesis.speak(utterance);
  return true;
}

/** The sources in order, then the defaults not listed (getRequiredAudioSources, for Japanese). */
export function audioSources(audio: AudioOptions): AudioSourceOptions[] {
  const sources = audio.sources.filter(({ type }) =>
    (audioSourceTypes as readonly string[]).includes(type)
  );
  if (audio.enableDefaultAudioSources && !sources.some(({ type }) => type === 'jpod101')) {
    sources.push({ type: 'jpod101', url: '', voice: '' });
  }
  return sources;
}

/** Plays the first audio found for the word; false when no source has it. */
export async function playTermAudio(term: string, reading: string, audio: AudioOptions) {
  stopTermAudio();
  for (const source of audioSources(audio)) {
    let infos: Info[] = [];
    try {
      infos = await infoList(source, term, reading);
    } catch {
      continue;
    }
    for (const info of infos) {
      if (info.type === 'tts') {
        if (speak(info.text, info.voice, audio.volume)) return true;
        continue;
      }
      try {
        const element = await loadAudio(info.url, source.type, audio.volume);
        stopTermAudio();
        playing = element;
        await element.play();
        return true;
      } catch {
        // the next one
      }
    }
  }
  return false;
}
