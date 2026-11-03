/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lineSpeech } from './line-audio';

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

const frame = 512 / 16000;
/** Speech probabilities over `seconds`, 0.9 inside the given [from, to] spans. */
const probs = (seconds: number, spans: [number, number][]) =>
  Array.from({ length: Math.round(seconds / frame) }, (_, i) =>
    spans.some(([from, to]) => i * frame >= from && i * frame < to) ? 0.9 : 0
  );

describe('lineSpeech', () => {
  it('keeps a voice through a long pause, up to the next line', () => {
    // 「私が娘を、」 1.5 s of silence 「見ていないとでも？」, next click at 8 s.
    const speech = lineSpeech(
      probs(12, [
        [0.6, 1.6],
        [3.1, 4.2]
      ]),
      { start: 0.5, end: 8 }
    );

    expect(speech.at(-1)![1]).toBeGreaterThan(4);
  });

  it('cuts at the next line and drops speech outside the window', () => {
    const speech = lineSpeech(
      probs(12, [
        [0.1, 0.3],
        [0.6, 3],
        [4, 5]
      ]),
      { start: 0.5, end: 2 }
    );

    expect(speech).toHaveLength(1);
    expect(speech[0][1]).toBeCloseTo(2, 1);
  });
});
