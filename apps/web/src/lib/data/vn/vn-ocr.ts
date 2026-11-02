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

import { pagePath } from '$lib/data/env';
import type { VnOverlayLine } from '$lib/data/vn/vn';
import type { VnOcrLine, VnOcrMessage, VnOcrRequest } from '$lib/functions/vn-ocr/vn-ocr.worker';

let worker: Worker | undefined;
let nextId = 0;
const waiting = new Map<number, (message: VnOcrMessage) => void>();
/** The models are missing or won't run here: stop asking. */
let broken = false;

function start() {
  worker = new Worker(new URL('../../functions/vn-ocr/vn-ocr.worker.ts', import.meta.url), {
    type: 'module'
  });
  worker.onmessage = ({ data }: MessageEvent<VnOcrMessage>) => {
    waiting.get(data.id)?.(data);
    waiting.delete(data.id);
  };
  return worker;
}

/** An OCR'd line as an overlay row: font size = the box's height, pitch = the mean cell width. */
function overlayLine({ text, box, chars }: VnOcrLine): VnOverlayLine {
  const x0 = chars[0].x0;

  return {
    text,
    x: x0,
    y: box[1],
    size: box[3],
    pitch: (chars[chars.length - 1].x1 - x0) / chars.length
  };
}

/**
 * The game's frame read: with a hooked line, that line's rows placed in the game's text box
 * (undefined when no OCR'd line matches it); without, the dialogue lines' text and rows (undefined
 * when there are none). Undefined too when OCR can't run here.
 */
export async function readVnScreen(
  frame: ImageBitmap,
  hook?: string
): Promise<{ text: string; lines: VnOverlayLine[]; ms: number } | undefined> {
  if (broken) {
    frame.close();
    return undefined;
  }

  const id = (nextId += 1);
  const reply = new Promise<VnOcrMessage>((resolve) => waiting.set(id, resolve));
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
    broken = true;
    console.warn(`Screen text is off: ${message.error}`);
    return undefined;
  }

  const lines = hook === undefined ? message.lines.filter(({ tag }) => tag === 0) : message.lines;

  if (!lines.length) return undefined;
  return {
    text: hook ?? lines.map(({ text }) => text).join('\n'),
    lines: lines.map(overlayLine),
    /** The worker's time for the frame */
    ms: message.ms
  };
}

/** Frees the worker and its models when the player closes. */
export function stopVnOcr() {
  worker?.terminate();
  worker = undefined;
  waiting.forEach((resolve, id) => resolve({ id, lines: [], ms: 0 }));
  waiting.clear();
}
