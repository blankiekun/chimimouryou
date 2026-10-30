/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Subtitles for an audiobook made by Whisper in this browser
 * (functions/audiobook/whisper.worker.ts), for the audiobook and Audiobookshelf
 * players. Models come from Hugging Face and stay in the browser's cache (transformers.js's
 * `transformers-cache`). Standalone: an analysis tool (Settings → Analysis tools → Audiobook
 * subtitles) downloaded before the players offer it. The SRT made is kept per book in reader-db
 * `whisperSubtitles`, in this browser only. Not part of upstream.
 */

import { BehaviorSubject } from 'rxjs';
import type { AnalysisToolsState } from '$lib/data/analysis-tools';
import { standalone } from '$lib/data/env';
import { readerDb } from '$lib/data/reader-db';
import { writableStringLocalStorageSubject } from '$lib/data/internal/writable-string-local-storage-subject';
import type { SubtitleCue } from '$lib/functions/audiobook/subtitles';
import { cuesToSrt } from '$lib/functions/audiobook/whisper-audio';
import { toTimeString } from '$lib/functions/statistic-util';

export const whisperModels = [
  { id: 'onnx-community/whisper-base', name: 'Base (fast, 0.2 GB)' },
  { id: 'onnx-community/whisper-small', name: 'Small (0.4 GB)' },
  { id: 'onnx-community/whisper-large-v3-turbo', name: 'Large v3 Turbo (best, 1.6 GB)' }
];

export const whisperModel$ = writableStringLocalStorageSubject()(
  'whisperModel',
  whisperModels[1].id
);

/** One audio file, `offset` seconds into the audiobook. */
export interface WhisperSource {
  blob?: Blob;
  url?: string;
  offset: number;
}

export interface WhisperRequest {
  model: string;
  sources: WhisperSource[];
}

export type WhisperMessage =
  | { type: 'loading'; progress: number }
  | { type: 'cues'; cues: SubtitleCue[]; seconds: number; duration: number }
  | { type: 'done' }
  | { type: 'error'; message: string };

/**
 * Transcribes the sources and resolves with an SRT; rejects with an AbortError when aborted.
 * shortcut: the work is lost if the tab closes; keep finished blocks in IndexedDB if long books need resuming.
 */
export function transcribeAudio(
  sources: WhisperSource[],
  onProgress: (text: string) => void,
  signal: AbortSignal
) {
  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(
      new URL('../functions/audiobook/whisper.worker.ts', import.meta.url),
      { type: 'module' }
    );
    const cues: SubtitleCue[] = [];
    const finish = () => {
      worker.terminate();
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException('Stopped', 'AbortError'));
    };

    signal.addEventListener('abort', abort);
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || 'Whisper could not start'));
    };
    worker.onmessage = ({ data }: MessageEvent<WhisperMessage>) => {
      if (data.type === 'loading') {
        onProgress(`Loading Whisper ${Math.round(data.progress * 100)}%`);
      } else if (data.type === 'cues') {
        cues.push(...data.cues);
        onProgress(`Whisper ${toTimeString(data.seconds)} / ${toTimeString(data.duration)}`);
      } else if (data.type === 'error') {
        finish();
        reject(new Error(data.message));
      } else {
        finish();
        resolve(cuesToSrt(cues));
      }
    };
    worker.postMessage({ model: whisperModel$.getValue(), sources } satisfies WhisperRequest);
  });
}

/** An SRT Whisper made for a book's audio (reader-db `whisperSubtitles`) */
export interface WhisperSubtitles {
  /** The book's title */
  title: string;
  /** The audio it was made from (file name, or the Audiobookshelf item), so another isn't taken for it */
  audio: string;
  model: string;
  created: number;
  srt: string;
}

export async function keptWhisperSubtitles(title: string, audio: string) {
  const kept = await (await readerDb()).get('whisperSubtitles', title).catch(() => undefined);

  return kept?.audio === audio ? kept : undefined;
}

export async function saveWhisperSubtitles(subtitles: Omit<WhisperSubtitles, 'created'>) {
  await (await readerDb()).put('whisperSubtitles', { ...subtitles, created: Date.now() });
}

export async function removeWhisperSubtitles(title: string) {
  await (await readerDb()).delete('whisperSubtitles', title);
}

/**
 * Standalone: whether the players offer Whisper, which needs the model downloaded in Settings
 * first. The server edition offers it as before, downloading the model on first use.
 */
export const whisperNeedsDownload = standalone;

export const whisperState$ = new BehaviorSubject<AnalysisToolsState>('unknown');
export const whisperDownload$ = new BehaviorSubject<
  { progress: number; error?: string } | undefined
>(undefined);

const transformersCache = 'transformers-cache';
/** The models whose download finished (the cache alone can't tell a cut one) */
const readyModels$ = writableStringLocalStorageSubject()('whisperReady', '');
const readyModels = () => readyModels$.getValue().split(' ').filter(Boolean);

/** Sets whisperState$ for the model chosen: downloaded whole and still in the cache. */
export async function checkWhisper(model = whisperModel$.getValue()) {
  if (downloadController) return;

  try {
    const keys = await (await caches.open(transformersCache)).keys();

    whisperState$.next(
      readyModels().includes(model) && keys.some(({ url }) => url.includes(`/${model}/`))
        ? 'ready'
        : 'absent'
    );
  } catch {
    whisperState$.next('absent');
  }
}

let downloadController: AbortController | undefined;

export function cancelWhisperDownload() {
  downloadController?.abort();
}

/** Loads the chosen model once (transformers.js caches its files). Never throws. */
export async function downloadWhisper() {
  if (downloadController) return;

  const model = whisperModel$.getValue();

  downloadController = new AbortController();
  whisperState$.next('downloading');
  whisperDownload$.next({ progress: 0 });

  try {
    await navigator.storage?.persist?.().catch(() => false);
    await transcribeAudio(
      [],
      (text) => {
        const percent = /(\d+)%/.exec(text);

        if (percent) whisperDownload$.next({ progress: Number(percent[1]) / 100 });
      },
      downloadController.signal
    );
    readyModels$.next([...new Set([...readyModels(), model])].join(' '));
    whisperDownload$.next(undefined);
  } catch (error: any) {
    whisperDownload$.next(
      error.name === 'AbortError' ? undefined : { progress: 0, error: error.message }
    );
  } finally {
    downloadController = undefined;
    await checkWhisper();
  }
}

/** Removes every Whisper model from the cache; subtitles made stay. */
export async function removeWhisper() {
  const cache = await caches.open(transformersCache);

  for (const request of await cache.keys()) {
    if (whisperModels.some(({ id }) => request.url.includes(`/${id}/`)))
      await cache.delete(request);
  }
  readyModels$.next('');
  await checkWhisper();
}
