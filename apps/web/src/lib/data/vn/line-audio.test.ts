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

// How the click rules could go wrong, written before them: the clip runs on into the next line's
// voice; the pad brings in the end of the voice before; a voice still going from the line before
// passes as this line's on a voiceless line; speech long after the click passes as this line's; a
// long pause inside the line's only voice loses its second half (the bug #464 fixed); a voice
// starting with the click is taken for one already going; a line with no click, or a player that
// doesn't say, changes at all.
describe('lineAudio window', () => {
  const seconds = 12;
  const rate = 16000;

  async function clipLength(
    window: { start: number; end: number; earliest?: number },
    spans: [number, number][]
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
    const audio = lineAudio({ samples: new Int16Array(seconds * rate), rate, ...window }, 'あ');

    onmessage!({
      data: { id: posted[0].id, probs: Float32Array.from(probs(seconds, spans)) }
    });
    const blob = await audio;

    vi.unstubAllGlobals();
    return blob && (blob.size - 44) / 2 / rate;
  }

  const click = { start: 0.5, end: 5, earliest: 0.5 };

  it('from a click, starts 0.1 s before it and stops at the next line', async () => {
    expect(await clipLength(click, [[0.6, 7]])).toBeCloseTo(4.6, 1);
  });

  it('from a click, keeps a voice through a long pause and 0.5 s after it', async () => {
    const length = await clipLength({ ...click, end: 8 }, [
      [0.6, 1.6],
      [3.1, 4.2]
    ]);

    expect(length).toBeCloseTo(4.3, 1);
  });

  it('a voice still going at the click is not the line’s', async () => {
    expect(await clipLength(click, [[0, 2]])).toBeUndefined();
    expect(
      await clipLength(click, [
        [0, 1],
        [1.2, 3]
      ])
    ).toBeCloseTo(3.1, 1);
  });

  it('a voice starting with the click is the line’s, even if the detector hears it just before', async () => {
    expect(await clipLength(click, [[0.4, 3]])).toBeCloseTo(3.1, 1);
  });

  it('speech starting over 1 s after the click gives no sound', async () => {
    expect(await clipLength(click, [[1.7, 4]])).toBeUndefined();
    expect(await clipLength(click, [[1.4, 4]])).toBeCloseTo(4.1, 1);
  });

  it('a line with no click keeps its pad, its tail and any speech in the window', async () => {
    const noClick = { start: 3, end: 6, earliest: 0 };

    expect(await clipLength(noClick, [[0, 4]])).toBeCloseTo(1.9, 1);
    expect(await clipLength(noClick, [[3.5, 7]])).toBeCloseTo(3.9, 1);
    expect(await clipLength(noClick, [[5, 5.8]])).toBeCloseTo(3.7, 1);
  });

  it('a window that does not say whether a click brought it is treated as no click', async () => {
    const { earliest: _earliest, ...unknown } = click;

    expect(await clipLength(unknown, [[0, 2]])).toBeCloseTo(2.4, 1);
    expect(await clipLength(unknown, [[1.7, 4]])).toBeCloseTo(4.4, 1);
  });
});
