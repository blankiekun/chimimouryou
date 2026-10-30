/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The texthooker page (`/hook`): game text sent by a hooking tool over a WebSocket on this
 * computer, or pasted. The lines stay in this browser (localStorage, never synced); their
 * characters and time go into the immersion log (immersion-log.ts). Line editing, notes, setting
 * presets, the stats strip and the layout settings follow texthooker-ui (Renji-XD, MIT; NOTICE).
 * Not part of upstream.
 */

import { writableBooleanLocalStorageSubject } from '$lib/data/internal/writable-boolean-local-storage-subject';
import { writableNumberLocalStorageSubject } from '$lib/data/internal/writable-number-local-storage-subject';
import {
  writableArrayLocalStorageSubject,
  writableObjectLocalStorageSubject
} from '$lib/data/internal/writable-object-local-storage-subject';
import { writableStringLocalStorageSubject } from '$lib/data/internal/writable-string-local-storage-subject';
import type { HookCleanup } from '$lib/data/vn/hook-cleanup';
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

/** A second tool's address, '' for none: both feed the same list. */
export const hookSocketUrl2$ = writableStringLocalStorageSubject()('hookSocketUrl2', '');

/** The game's name, for the log and Discord */
export const hookTitle$ = writableStringLocalStorageSubject()('hookTitle', '');

export const minFontSize = 14;
export const maxFontSize = 48;

/** The lines' text size in px */
export const hookFontSize$ = writableNumberLocalStorageSubject()('hookFontSize', 20, (value) =>
  typeof value === 'number' && value >= minFontSize && value <= maxFontSize
    ? Math.round(value)
    : undefined
);

/** Newest line on top */
export const hookReverse$ = writableBooleanLocalStorageSubject()('hookReverse', false);

/** A new line lights up briefly */
export const hookFlash$ = writableBooleanLocalStorageSubject()('hookFlash', true);

const isCleanup = (value: unknown): value is HookCleanup =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * The WebSocket lines' cleanup (hook-cleanup.ts). New text only is off: a tool's lines are
 * whole lines already, and turning it on would change what they show.
 */
export const hookCleanup$ = writableObjectLocalStorageSubject<HookCleanup>()(
  'hookCleanup',
  { newOnly: false },
  (value) => (isCleanup(value) ? value : undefined)
);

export const maxNotes = 20_000;

/** The notes beside the lines */
export const hookNotes$ = writableStringLocalStorageSubject()('hookNotes', '', (value) =>
  typeof value === 'string' ? value.slice(0, maxNotes) : undefined
);

export interface HookSettingPreset {
  name: string;
  url: string;
  url2: string;
  fontSize: number;
  reverse: boolean;
  flash: boolean;
  cleanup: HookCleanup;
}

export const maxPresets = 20;
export const maxPresetName = 40;

const isPreset = (value: any): value is HookSettingPreset =>
  typeof value?.name === 'string' &&
  !!value.name &&
  typeof value.url === 'string' &&
  typeof value.url2 === 'string' &&
  typeof value.fontSize === 'number' &&
  isCleanup(value.cleanup);

/** Named sets of the settings above (not the game's name, notes or lines) */
export const hookSettingPresets$ = writableArrayLocalStorageSubject<HookSettingPreset>()(
  'hookSettingPresets',
  [],
  (value) => (Array.isArray(value) ? value.filter(isPreset).slice(0, maxPresets) : undefined)
);

/** The settings now, as a preset */
export function currentPreset(name: string): HookSettingPreset {
  return {
    name: name.trim().slice(0, maxPresetName),
    url: hookSocketUrl$.getValue(),
    url2: hookSocketUrl2$.getValue(),
    fontSize: hookFontSize$.getValue(),
    reverse: hookReverse$.getValue(),
    flash: hookFlash$.getValue(),
    cleanup: hookCleanup$.getValue()
  };
}

/** Saved under its name, replacing one of the same name; false when the list is full. */
export function savePreset(preset: HookSettingPreset) {
  const presets = hookSettingPresets$.getValue();
  const others = presets.filter((other) => other.name !== preset.name);

  if (!preset.name || others.length >= maxPresets) return false;
  hookSettingPresets$.next(
    others.length === presets.length
      ? [...presets, preset]
      : presets.map((other) => (other.name === preset.name ? preset : other))
  );
  return true;
}

export function deletePreset(name: string) {
  hookSettingPresets$.next(hookSettingPresets$.getValue().filter((other) => other.name !== name));
}

export function applyPreset(preset: HookSettingPreset) {
  hookSocketUrl$.next(preset.url);
  hookSocketUrl2$.next(preset.url2);
  hookFontSize$.next(preset.fontSize);
  hookReverse$.next(!!preset.reverse);
  hookFlash$.next(preset.flash !== false);
  hookCleanup$.next(preset.cleanup);
}

export const linesKey = 'hookLines';
/** Lines kept across reloads */
export const maxLines = 500;

export interface HookLine {
  id: string;
  text: string;
  /** Epoch ms */
  at: number;
  /** A natively played game's line: its number for its Anki media (native-games.ts) */
  seq?: number;
}

export type HookStatus = 'connecting' | 'connected' | 'closed' | 'blocked' | 'invalid' | 'off';

/**
 * One tool's WebSocket: retried quietly with backoff (2 s to 30 s) while the tool isn't running.
 * `denied`: whether the browser blocks local network access (discord.ts `localNetworkDenied`).
 */
export class HookSocket {
  status: HookStatus = 'off';
  #socket: WebSocket | undefined;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #delay = 2000;
  #url = '';

  constructor(
    private onmessage: (data: unknown) => void,
    private onstatus: (status: HookStatus) => void,
    private denied: () => Promise<boolean>
  ) {}

  #set(status: HookStatus) {
    this.status = status;
    this.onstatus(status);
  }

  connect(url = this.#url) {
    this.disconnect();
    this.#url = url;
    if (!isSocketUrl(url)) {
      this.#set('invalid');
      return;
    }

    let ws: WebSocket;

    this.#set('connecting');
    try {
      ws = new WebSocket(url);
    } catch {
      this.#set('invalid');
      return;
    }
    this.#socket = ws;
    ws.onopen = () => {
      this.#set('connected');
      this.#delay = 2000;
    };
    ws.onmessage = (event) => this.onmessage(event.data);
    ws.onclose = async () => {
      if (this.#socket !== ws) return;
      this.#socket = undefined;
      this.#set((await this.denied()) ? 'blocked' : 'closed');
      // The tool may start later: keep trying quietly.
      this.#retry = setTimeout(() => this.connect(), this.#delay);
      this.#delay = Math.min(this.#delay * 2, 30_000);
    };
  }

  disconnect() {
    clearTimeout(this.#retry);
    const ws = this.#socket;

    this.#socket = undefined;
    ws?.close();
    this.#set('off');
  }
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

/** What undo puts back: removed lines, or a line's text before an edit. */
export type HookUndo = { removed: HookLine[] } | { edited: string; text: string };

export const maxUndo = 50;

export function removeLines(lines: HookLine[], ids: Set<string>) {
  return {
    lines: lines.filter((line) => !ids.has(line.id)),
    undo: { removed: lines.filter((line) => ids.has(line.id)) }
  };
}

/** undefined when nothing changes (same or empty text) */
export function editLine(lines: HookLine[], id: string, text: string) {
  const line = lines.find((other) => other.id === id);
  const next = text.trim();

  if (!line || !next || next === line.text) return undefined;

  return {
    lines: lines.map((other) => (other.id === id ? { ...other, text: next } : other)),
    undo: { edited: id, text: line.text }
  };
}

/**
 * Undone by time, not position: lines that came in after a delete stay where they are. An edited
 * line that has since gone (deleted, or past maxLines) can't be undone.
 */
export function undoLines(lines: HookLine[], undo: HookUndo) {
  if ('edited' in undo) {
    return lines.map((line) => (line.id === undo.edited ? { ...line, text: undo.text } : line));
  }

  const ids = new Set(lines.map((line) => line.id));

  return [...lines, ...undo.removed.filter((line) => !ids.has(line.id))]
    .sort((a, b) => a.at - b.at)
    .slice(-maxLines);
}

/** h:mm:ss, tabular in the stats strip */
export function clock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const pad = (value: number) => String(value).padStart(2, '0');

  return `${Math.floor(total / 3600)}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}

/** Characters per hour over the logged time; 0 before a minute has passed (too noisy). */
export function charsPerHour(characters: number, seconds: number) {
  return seconds >= 60 ? Math.round((characters * 3600) / seconds) : 0;
}
