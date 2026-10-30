/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The texthooker page (`/hook`): game text sent by a hooking tool over a WebSocket on this
 * computer, or pasted. The lines stay in this browser (localStorage, never synced); their
 * characters and time go into the immersion log (immersion-log.ts). Not part of upstream.
 */

import { writableStringLocalStorageSubject } from '$lib/data/internal/writable-string-local-storage-subject';
import { countTextCharacters } from '$lib/functions/get-character-count';

/** The usual tools' default addresses (Textractor's WebSocket extension, LunaTranslator, agent). */
export const hookPresets = [
  { label: 'Textractor', url: 'ws://localhost:6677' },
  { label: 'LunaTranslator', url: 'ws://localhost:2333/api/ws/text/origin' },
  { label: 'agent', url: 'ws://localhost:9001' }
];

/** Per computer: the tool runs here. */
export const hookSocketUrl$ = writableStringLocalStorageSubject()(
  'hookSocketUrl',
  hookPresets[0].url
);

/** The game's name, for the log and Discord */
export const hookTitle$ = writableStringLocalStorageSubject()('hookTitle', '');

export const linesKey = 'hookLines';
/** Lines kept across reloads */
export const maxLines = 500;

export interface HookLine {
  id: string;
  text: string;
  /** Epoch ms */
  at: number;
}

export function isSocketUrl(url: string) {
  try {
    return ['ws:', 'wss:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * The text of a WebSocket message: plain text (Textractor, LunaTranslator), or JSON with a
 * `sentence` or `text` field (agent, GameSentenceMiner). '' for anything else.
 */
export function parseHookMessage(data: unknown) {
  if (typeof data !== 'string') return '';

  const text = data.trim();

  if (text.startsWith('{') || text.startsWith('"')) {
    try {
      const value = JSON.parse(text);

      if (typeof value === 'string') return value.trim();

      const field = value?.sentence ?? value?.text;

      return typeof field === 'string' ? field.trim() : '';
    } catch {
      // Not JSON after all: plain text that starts with a brace
    }
  }
  return text;
}

/**
 * What a new line adds: its characters (none for a repeat of the last line, which tools send
 * when a game redraws) and the time since the last line, at most `idleSeconds` so breaks count
 * like the reading tracker's idle pause. A last line from before `since` (the page was opened,
 * the lines are kept in localStorage) adds no time: the page was closed in between.
 */
export function lineCount(
  text: string,
  last: HookLine | undefined,
  now: number,
  idleSeconds: number,
  since = 0
) {
  if (last?.text === text) return { characters: 0, seconds: 0, repeat: true };

  const gap = last && last.at >= since ? Math.max(0, (now - last.at) / 1000) : 0;

  return {
    characters: countTextCharacters(text),
    seconds: Math.round(Math.min(gap, idleSeconds > 0 ? idleSeconds : 120)),
    repeat: false
  };
}

export function loadLines(): HookLine[] {
  try {
    const lines = JSON.parse(window.localStorage.getItem(linesKey) ?? '[]');

    return Array.isArray(lines) ? lines.filter((line) => typeof line?.text === 'string') : [];
  } catch {
    return [];
  }
}

export function saveLines(lines: HookLine[]) {
  try {
    window.localStorage.setItem(linesKey, JSON.stringify(lines.slice(-maxLines)));
  } catch {
    // Storage full or blocked: the lines stay on the page
  }
}
