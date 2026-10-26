/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Whisper subtitles', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    window.localStorage.clear();
  });

  it('keeps the SRT made per book, for the same audio only', async () => {
    const whisper = await import('$lib/data/whisper');

    await whisper.saveWhisperSubtitles({ title: '本', audio: 'a.m4b:10', model: 'm', srt: '1' });
    expect(await whisper.keptWhisperSubtitles('本', 'a.m4b:10')).toMatchObject({
      srt: '1',
      created: expect.any(Number)
    });
    expect(await whisper.keptWhisperSubtitles('本', 'b.m4b:10')).toBeUndefined();
    await whisper.removeWhisperSubtitles('本');
    expect(await whisper.keptWhisperSubtitles('本', 'a.m4b:10')).toBeUndefined();
  });

  it('needs the download in the standalone edition only', async () => {
    expect((await import('$lib/data/whisper')).whisperNeedsDownload).toBe(false);
    vi.resetModules();
    vi.stubEnv('VITE_EDITION', 'standalone');
    expect((await import('$lib/data/whisper')).whisperNeedsDownload).toBe(true);
  });

  it('counts a model as downloaded when it finished and is still cached', async () => {
    const urls: string[] = [];

    vi.stubGlobal('caches', {
      open: async () => ({
        keys: async () => urls.map((url) => new Request(url)),
        delete: async (request: Request) => urls.splice(urls.indexOf(request.url), 1)
      })
    });

    const whisper = await import('$lib/data/whisper');
    const model = whisper.whisperModel$.getValue();

    await whisper.checkWhisper();
    expect(whisper.whisperState$.getValue()).toBe('absent');
    // Files of a cut download don't count.
    urls.push(`https://huggingface.co/${model}/resolve/main/onnx/encoder_model_q8.onnx`);
    await whisper.checkWhisper();
    expect(whisper.whisperState$.getValue()).toBe('absent');
    window.localStorage.setItem('whisperReady', model);
    vi.resetModules();

    const again = await import('$lib/data/whisper');

    await again.checkWhisper();
    expect(again.whisperState$.getValue()).toBe('ready');
    urls.push('https://huggingface.co/other/model/resolve/main/x.onnx');
    await again.removeWhisper();
    expect(urls).toEqual(['https://huggingface.co/other/model/resolve/main/x.onnx']);
    expect(again.whisperState$.getValue()).toBe('absent');
  });
});
