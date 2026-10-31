/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Windows games played natively in the desktop app (apps/desktop/games.js): the game's record is
 * the same VN record VNBox plays (`engine: 'vnbox'`, `folder`, `exe`); where it is installed on
 * this computer lives only in the app's main process, set through its own folder dialog. The
 * built-in hook (LunaHook) sends lines on many threads; /hook shows the picked one, saved on the
 * record as `VnInfo.nativeHook`. Nothing here exists outside the desktop app.
 */

import { logger } from '$lib/data/logger';
// Types only: settings-sections imports this file, and the save code opens IndexedDB on load.
import type { VnSaves } from './vn';
import type { VnSaveSync } from './vn-save-store';
import type { HookThread } from './windows-game';

/** The thread a game's text comes from, kept across starts and devices. */
export interface NativeHook {
  hookcode: string;
  name: string;
}

export interface NativeThreadInfo {
  pid: number;
  addr: number;
  ctx: number;
  ctx2: number;
  hookcode: string;
  name: string;
}

export type NativeMessage =
  /** `seq`: the line's number for its Anki media (`media`), `at` its arrival time */
  | { type: 'text'; thread: NativeThreadInfo; sentence: string; seq?: number; at?: number }
  /** Where Anki clips' sound comes from: the game alone, the whole system, or nowhere */
  | { type: 'audio'; mode: 'game' | 'process' | 'system' | 'none' }
  | { type: 'thread'; thread: NativeThreadInfo }
  | { type: 'status'; text: string }
  | { type: 'error'; message: string }
  | { type: 'inject'; ok: boolean; bits: number }
  | { type: 'connect' | 'disconnect'; pid: number }
  | { type: 'exit' };

export type LaunchResult =
  | { status: 'started' | 'missing' | 'unsupported' }
  | { status: 'gone'; path: string }
  | { status: 'running'; title: string }
  | { status: 'error'; message: string };

export type PickResult =
  | { status: 'cancelled' }
  | {
      status: 'picked';
      id: string;
      dir: string;
      folderName: string;
      /** .exe paths relative to the folder, the record's program first */
      programs: string[];
      /** The record's program among them, else -1 */
      match: number;
      nameDiffers: boolean;
    };

export interface NativeGameEntry {
  folder: string;
  title: string;
  installDir: string;
  exe: string;
  linkedAt: number;
  present: boolean;
}

export interface NativeGamesList {
  platform: string;
  /** chimihook and LunaHook are bundled */
  hook: boolean;
  wine?: { version?: string; japaneseLocale: boolean; winetricks: boolean };
  running?: string;
  games: NativeGameEntry[];
}

export interface NativeSaveList {
  files: { name: string; modified: number; size: number }[];
  /** Windows: folders the game's first run here wrote, to confirm as its save folders */
  pending?: string[];
}

export interface DesktopGames {
  /** `saves`: the synced vnsaves.json, written in before the game starts where newer */
  launch(folder: string, saves?: VnSaves): Promise<LaunchResult>;
  /** The game's save files on this computer (undefined while it runs), or the named ones' contents */
  saves(folder: string): Promise<NativeSaveList | undefined>;
  saves(folder: string, names: string[]): Promise<VnSaves>;
  saveFolders(folder: string, keep: boolean): Promise<void>;
  pick(game: { title: string; exe?: string; gone?: string }): Promise<PickResult>;
  link(
    id: string,
    index: number,
    folder: string,
    title: string
  ): Promise<{ status: 'ok'; exe: string } | { status: 'error'; message: string }>;
  forget(folder: string): Promise<void>;
  list(): Promise<NativeGamesList>;
  session(): Promise<{ folder: string; running: boolean; messages: NativeMessage[] } | undefined>;
  onHook(callback: (message: NativeMessage) => void): () => void;
  /** /hook shows the line: its screenshot is taken once drawn */
  mark(seq: number): Promise<void>;
  /** A mined line's screenshot (JPEG) and sound (WAV), each when kept */
  media(
    seq: number,
    want: { picture: boolean; audio: boolean }
  ): Promise<{ picture?: Uint8Array<ArrayBuffer>; audio?: Uint8Array<ArrayBuffer> }>;
}

/** The desktop app's games API, undefined everywhere else (web, Android, server builds). */
export function desktopGames(): DesktopGames | undefined {
  return (globalThis as { chimiDesktop?: { games?: DesktopGames } }).chimiDesktop?.games;
}

/** The game overlay's text box area: fractions of the game window. */
export interface OverlayArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OverlaySettings {
  on: boolean;
  /** Text size in px */
  fontSize: number;
  /** Background opacity, 0-1 */
  opacity: number;
}

/** What the overlay page is told (apps/desktop/overlay.js). */
export interface OverlayState {
  platform: string;
  area: OverlayArea;
  editing: boolean;
  fontSize: number;
  opacity: number;
}

/** The text overlay over a game played natively (apps/desktop/overlay.js). */
export interface DesktopOverlay {
  /** Reads, or changes, its settings; `restart`: on Wayland it starts with the app's next start */
  settings(changes?: Partial<OverlaySettings>): Promise<OverlaySettings & { restart: boolean }>;
  /** Adjust mode: the text box area can be moved and resized; false when no overlay is open */
  edit(on: boolean): Promise<boolean>;
  /** Overlay page: the parts that take the mouse (window coordinates), or all of it (`solid`) */
  setRects(
    rects: { x: number; y: number; width: number; height: number }[],
    solid: boolean
  ): Promise<void>;
  /** Overlay page: the adjusted area, saved for this game on this computer */
  setArea(area: OverlayArea): Promise<void>;
  onState(callback: (state: OverlayState) => void): () => void;
}

export function desktopOverlay(): DesktopOverlay | undefined {
  return (globalThis as { chimiDesktop?: { overlay?: DesktopOverlay } }).chimiDesktop?.overlay;
}

/** /hook's shown lines go to the overlay page (same origin) on this channel. A newly opened
 * overlay page posts `{ ask: true }` and gets the line shown now. */
export const overlayChannel = 'chimi-overlay';
let overlayLines: BroadcastChannel | undefined;
let overlayText = '';

/** A line /hook shows, for the overlay (desktop app only). */
export function postOverlayLine(text: string) {
  if (!desktopOverlay()) return;
  overlayText = text;
  if (!overlayLines) {
    overlayLines = new BroadcastChannel(overlayChannel);
    overlayLines.onmessage = (event) => {
      if (event.data?.ask) overlayLines?.postMessage({ text: overlayText });
    };
  }
  overlayLines.postMessage({ text });
}

export interface NativeThread extends HookThread {
  hookcode: string;
}

const threadId = (thread: NativeThreadInfo) =>
  `${thread.hookcode}|${thread.addr}|${thread.ctx}|${thread.ctx2}`;

/** Lines closer together than this count as one "click" for rankThreads (one game event). */
const burstMs = 250;

/**
 * Threads as /hook keeps them, in the shape rankThreads reads. LunaHook gives no clicks, so a
 * burst of lines (a game drawing one page through several hooks) stands in for one: a hook that
 * sends a page character by character fills one burst with many lines and ranks low.
 */
export class NativeThreads {
  threads = new Map<string, NativeThread>();
  private burst = 0;
  private lastAt = -Infinity;

  /** Adds a text line; returns its thread. */
  add(info: NativeThreadInfo, text: string, now: number) {
    if (now - this.lastAt > burstMs) this.burst += 1;
    this.lastAt = now;

    const id = threadId(info);
    const thread = this.threads.get(id) ?? {
      id,
      hookcode: info.hookcode,
      label: info.name || info.hookcode,
      kind: 'hcode' as const,
      count: 0,
      recent: []
    };
    const next = {
      ...thread,
      last: text,
      count: thread.count + 1,
      recent: [...thread.recent, { text, click: this.burst }].slice(-20)
    };

    this.threads.set(id, next);
    return next;
  }
}

/** The saved hook's threads: same hook code (its address and context change between starts). */
export function isSavedThread(thread: { hookcode: string }, hook: NativeHook | undefined) {
  return !!hook && thread.hookcode === hook.hookcode;
}

/** Before a native start: the synced saves VNBox's rules allow, or none when offline. */
export async function nativeSavesToPull(sync: VnSaveSync): Promise<VnSaves> {
  const { isWindowsSaveKey } = await import('./vn-save-store');

  try {
    const saves = await sync.fetch();

    return Object.fromEntries(Object.entries(saves).filter(([name]) => isWindowsSaveKey(name)));
  } catch (error: any) {
    logger.warn(`Visual novel save sync failed: ${error.message}`);
    return {};
  }
}

/**
 * After the game closed: its save files on this computer merged into vnsaves.json as VNBox's
 * pushWindows does (same names and merge, the cap, skipped while `windowsSavesStamp`'s form is
 * unchanged). Returns the new stamp, a note when they don't sync and Windows folders to confirm.
 */
export async function pushNativeSaves(
  games: DesktopGames,
  folder: string,
  sync: VnSaveSync,
  lastStamp?: string
): Promise<{ stamp?: string; note?: string; pending?: string[] }> {
  const [
    { syncJsonFile },
    { mergeVnSaves, parseVnSaves, sameVnSaves },
    { formatBytes },
    saveStore
  ] = await Promise.all([
    import('$lib/data/sync/sync-files'),
    import('./vn'),
    import('./vn-upload'),
    import('./vn-save-store')
  ]);
  const { isWindowsSaveKey, windowsSavesCap } = saveStore;
  const list = await games.saves(folder);

  if (!list) return { stamp: lastStamp };

  const files = list.files.filter((file) => isWindowsSaveKey(file.name));
  const stamp = files
    .map((file) => `${file.name}\0${file.modified}`)
    .sort()
    .join('\n');
  const size = files.reduce((sum, file) => sum + file.size, 0);

  if (size > windowsSavesCap) {
    return {
      stamp: lastStamp,
      pending: list.pending,
      note: `This game's saves are ${formatBytes(size)}, over the ${formatBytes(windowsSavesCap)} that sync. They stay on this computer.`
    };
  }

  const store = await sync.store();

  if (stamp === lastStamp || !store) return { stamp: lastStamp, pending: list.pending };

  const saves = await games.saves(
    folder,
    files.map((file) => file.name)
  );

  await syncJsonFile(store, 'vnsaves.json', sync.title, parseVnSaves, async (remote = {}) => {
    const merged = mergeVnSaves(saves, remote, isWindowsSaveKey);

    return sameVnSaves(merged, remote) ? undefined : merged;
  });

  return { stamp, pending: list.pending };
}
