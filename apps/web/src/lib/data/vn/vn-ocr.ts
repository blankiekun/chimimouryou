/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Reads a Windows game's screen for the overlay (functions/vn-ocr/vn-ocr.worker.ts, vita-vn-ocr's
 * models from scripts/vn-ocr/fetch.sh): a hooked line placed where the game drew it, or, for a game
 * read from the screen (VnInfo.textFrom), the dialogue lines themselves. vnbox.js calls readVnScreen
 * once the frame has settled. Not part of upstream.
 */

import { BehaviorSubject } from 'rxjs';
import { pagePath } from '$lib/data/env';
import type { VnOverlayLine } from '$lib/data/vn/vn';
import type { VnOcrLine, VnOcrMessage, VnOcrRequest } from '$lib/functions/vn-ocr/vn-ocr.worker';

let worker: Worker | undefined;
let nextId = 0;
const waiting = new Map<number, (message: VnOcrMessage) => void>();
/** One read at a time: a frame arriving meanwhile waits here, replaced by any newer one. */
let reading = false;
let queued:
  | {
      frame: ImageBitmap;
      hook?: string;
      resolve: (result: Awaited<ReturnType<typeof readFrame>>) => void;
      reject: (error: unknown) => void;
    }
  | undefined;
/** A blip passes (a read after it resets the count); this many in a row won't. */
const maxFailures = 3;
let failures = 0;
/** Why reading stopped (models missing or won't run here): stop asking. */
let off: string | undefined;
/** First load: about 15 MB (runtime and models) on a slow connection, then a phone compiling it. */
const readTimeoutMs = 5 * 60_000;

/** Why a game reading its text from the screen has none now; the player and Hooks sheet show it. */
export const screenTextOff$ = new BehaviorSubject<string | undefined>(undefined);

/** The worker won't answer: what waits on it fails, and the next read starts a new one. */
function failWorker(error: string) {
  worker?.terminate();
  worker = undefined;
  waiting.forEach((settle, id) => settle({ id, error }));
  waiting.clear();
}

function start() {
  worker = new Worker(new URL('../../functions/vn-ocr/vn-ocr.worker.ts', import.meta.url), {
    type: 'module'
  });
  worker.onmessage = ({ data }: MessageEvent<VnOcrMessage>) => {
    waiting.get(data.id)?.(data);
    waiting.delete(data.id);
  };
  worker.onerror = (event) => failWorker(event.message || "its worker file didn't load");
  return worker;
}

/**
 * An OCR'd line as an overlay row: font size = the box's height, pitch = the cell width. The end cells
 * are clipped to the spotter's box, which can cut the last character, so the pitch comes from the
 * inner cuts (halfway between character centres) when there are three characters or more.
 */
function overlayLine({ text, box, chars }: VnOcrLine): VnOverlayLine {
  const n = chars.length;
  const pitch =
    n >= 3 ? (chars[n - 1].x0 - chars[0].x1) / (n - 2) : (chars[n - 1].x1 - chars[0].x0) / n;

  return {
    text,
    x: n >= 3 ? chars[0].x1 - pitch : chars[0].x0,
    y: box[1],
    size: box[3],
    pitch
  };
}

async function readFrame(frame: ImageBitmap, hook?: string) {
  if (off) {
    frame.close();
    if (hook === undefined) screenTextOff$.next(off);
    return undefined;
  }

  const id = (nextId += 1);
  const reply = new Promise<VnOcrMessage>((resolve) => {
    const timer = setTimeout(() => {
      // Starting over would only fetch for another 5 minutes.
      off = 'no answer in 5 minutes';
      failWorker(off);
    }, readTimeoutMs);

    waiting.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
  const model = (file: string) => new URL(`${pagePath}/vn/ocr/${file}`, location.href).href;

  (worker ?? start()).postMessage(
    {
      id,
      models: {
        spotter: model('textspot8_exact.onnx'),
        recognizer: model('VOCR6.2_L_fast.onnx')
      },
      frame,
      hook
    } satisfies VnOcrRequest,
    [frame]
  );
  const message = await reply;

  if ('error' in message) {
    console.warn(`Screen text: ${message.error}`);
    failures += 1;
    if (failures >= maxFailures) off ??= message.error;
    if (off && hook === undefined) screenTextOff$.next(off);
    return undefined;
  }
  failures = 0;

  const lines = hook === undefined ? message.lines.filter(({ tag }) => tag === 0) : message.lines;

  if (!lines.length) return undefined;
  return {
    text: hook ?? lines.map(({ text }) => text).join('\n'),
    lines: lines.map(overlayLine),
    /** The worker's time for the frame */
    ms: message.ms
  };
}

async function readQueued() {
  reading = true;
  while (queued) {
    const { frame, hook, resolve, reject } = queued;

    queued = undefined;
    await readFrame(frame, hook).then(resolve, reject);
  }
  reading = false;
}

/**
 * The game's frame read: with a hooked line, that line's rows placed in the game's text box
 * (undefined when no OCR'd line matches it); without, the dialogue lines' text and rows (undefined
 * when there are none). Undefined too when OCR can't run here, or a newer frame replaced this one
 * before its turn (the frame is closed).
 */
export function readVnScreen(frame: ImageBitmap, hook?: string) {
  return new Promise<Awaited<ReturnType<typeof readFrame>>>((resolve, reject) => {
    queued?.frame.close();
    queued?.resolve(undefined);
    queued = { frame, hook, resolve, reject };
    if (!reading) readQueued();
  });
}

/** Frees the worker and its models when the player closes. */
export function stopVnOcr() {
  queued?.frame.close();
  queued?.resolve(undefined);
  queued = undefined;
  worker?.terminate();
  worker = undefined;
  waiting.forEach((resolve, id) => resolve({ id, lines: [], ms: 0 }));
  waiting.clear();
}
