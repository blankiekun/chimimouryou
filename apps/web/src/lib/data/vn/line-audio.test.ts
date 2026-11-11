/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The speech detector's worker is the boundary. Ways it fails: its file is gone (a redeploy while
// the game is open), it never answers, it reports an error. Each must end in no sound for that
// card, so the rest of its media still arrives, and leave the next card a working detector.
describe('lineAudio when the speech detector fails', () => {
  const workers: { posted: any[]; onmessage?: any; onerror?: any; terminated?: boolean }[] = [];
  const pcm = () => ({ samples: new Int16Array(16000), rate: 16000, start: 0, end: 1 });
  let lineAudio: typeof import('./line-audio').lineAudio;

  beforeEach(async () => {
    workers.length = 0;
    vi.stubGlobal(
      'Worker',
      class {
        posted: any[] = [];
        constructor() {
          workers.push(this);
        }
        postMessage(data: unknown) {
          this.posted.push(data);
        }
        terminate() {
          (this as any).terminated = true;
        }
      }
    );
    vi.resetModules();
    ({ lineAudio } = await import('./line-audio'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a worker file that fails to load gives no sound, and the next card tries a new worker', async () => {
    const audio = lineAudio(pcm(), 'あ');

    workers[0].onerror({ message: '' });
    await expect(audio).resolves.toBeUndefined();

    const next = lineAudio(pcm(), 'あ');

    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);
    workers[1].onmessage({ data: { id: workers[1].posted[0].id, error: 'bad model' } });
    await expect(next).resolves.toBeUndefined();
  });

  it('a worker that never answers gives no sound after the timeout', async () => {
    vi.useFakeTimers();
    const audio = lineAudio(pcm(), 'あ');

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await expect(audio).resolves.toBeUndefined();
    expect(workers[0].terminated).toBe(true);
  });
});

// How GameSentenceMiner's rules could go wrong: the clip runs on into the next line's voice; speech
// that starts before the window or late in it is thrown away (cards with no sound); a long pause
// loses the line's second half; the next line's first sound stretches the end; a short noise on a
// long line passes as its voice.
describe('lineAudio window', () => {
  const seconds = 12;
  const rate = 16000;

  async function clipLength(
    window: { start: number; end: number },
    spans: [number, number][],
    text = 'あ'
  ) {
    const posted: { id: number }[] = [];
    let onmessage: (event: { data: unknown }) => void;

    vi.stubGlobal(
      'Worker',
      class {
        set onmessage(handler: typeof onmessage) {
          onmessage = handler;
        }
        postMessage(data: { id: number }) {
          posted.push(data);
        }
        terminate() {}
      }
    );
    vi.resetModules();
    const { lineAudio } = await import('./line-audio');
    const audio = lineAudio({ samples: new Int16Array(seconds * rate), rate, ...window }, text);

    onmessage!({
      data: { id: posted[0].id, segments: spans }
    });
    const blob = await audio;

    vi.unstubAllGlobals();
    return blob && (blob.size - 44) / 2 / rate;
  }

  // Segments are seconds into the window, which starts 0.5 s into the samples.
  const line = { start: 0.5, end: 5 };

  it('stops at the next line', async () => {
    expect(await clipLength(line, [[0.1, 4.5]])).toBeCloseTo(4.5, 1);
  });

  it('keeps a voice through a long pause and 0.5 s after it', async () => {
    const length = await clipLength({ ...line, end: 8 }, [
      [0.1, 1.1],
      [2.6, 3.7]
    ]);

    expect(length).toBeCloseTo(4.2, 1);
  });

  it('a last segment starting in the final half second ends the clip before it', async () => {
    const length = await clipLength(line, [
      [0.5, 2.5],
      [4.2, 4.5]
    ]);

    expect(length).toBeCloseTo(3, 1);
  });

  it('too little speech for the text gives no sound', async () => {
    expect(await clipLength(line, [[0.5, 1.5]], 'あ'.repeat(40))).toBeUndefined();
    expect(await clipLength(line, [[0.5, 2.5]], 'あ'.repeat(40))).toBeGreaterThan(2);
  });
});
