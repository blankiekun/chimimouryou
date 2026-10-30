/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The immersion log: time (and characters) outside the book reader. Entries are added by hand on
 * the Statistics page, by the texthooker (`/hook`, per game and day) and by the Listen players
 * (per book and day). Kept in reader-db `known` under 'immersion' (so it is cleared with the known
 * words when the reader changes) and synced as immersion.json beside words.json
 * (extras-sync.ts). Only titles, times and counts are kept, never the text. Not part of upstream.
 */

import { BehaviorSubject } from 'rxjs';
import { immersionChanged, pullImmersion } from '$lib/data/sync/extras-sync';
import { readerDb } from '$lib/data/reader-db';
import { startDayHoursForTracker$, statisticsEnabled$ } from '$lib/data/store';
import { getDateKey } from '$lib/functions/statistic-util';

/** Preset types; any other string is the reader's own type. */
export const immersionTypes = ['vn', 'anime', 'podcast', 'listening', 'other'] as const;

export type ImmersionSource = 'manual' | 'hook' | 'listen';

export interface ImmersionEntry {
  id: string;
  /** One of `immersionTypes`, or a type the reader typed */
  type: string;
  title: string;
  /** Statistics day key (YYYY-MM-DD, after the tracker's start of day) */
  day: string;
  seconds: number;
  characters: number;
  source: ImmersionSource;
  modified: number;
  /** Kept so the removal wins over older copies */
  deleted?: boolean;
}

/** id → entry */
export type ImmersionLog = Record<string, ImmersionEntry>;

export const immersionLog$ = new BehaviorSubject<ImmersionLog>({});

const sources = new Set<string>(['manual', 'hook', 'listen']);

/** A well-formed entry, for files from other devices. */
export function isImmersionEntry(value: any): value is ImmersionEntry {
  return (
    typeof value?.id === 'string' &&
    typeof value.type === 'string' &&
    typeof value.title === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.day) &&
    Number.isFinite(value.seconds) &&
    value.seconds >= 0 &&
    Number.isFinite(value.characters) &&
    value.characters >= 0 &&
    sources.has(value.source) &&
    Number.isFinite(value.modified)
  );
}

/** Keeps the newest copy of each entry, removals included. */
export function mergeImmersion(local: ImmersionLog, remote: ImmersionLog) {
  const merged = { ...local };

  for (const [id, entry] of Object.entries(remote)) {
    if (!merged[id] || entry.modified > merged[id].modified) {
      merged[id] = entry;
    }
  }

  return merged;
}

export const sameImmersion = (a: ImmersionLog, b: ImmersionLog) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([id, entry]) => b[id]?.modified === entry.modified);

async function change(apply: (log: ImmersionLog) => ImmersionLog) {
  const tx = (await readerDb()).transaction('known', 'readwrite');
  const log = apply({ ...((await tx.store.get('immersion')) as ImmersionLog | undefined) });

  await tx.store.put(log, 'immersion');
  await tx.done;
  immersionLog$.next(log);
  immersionChanged();
}

export async function getImmersionLog() {
  await pullImmersion();

  const log = ((await (await readerDb()).get('known', 'immersion')) ?? {}) as ImmersionLog;

  immersionLog$.next(log);

  return log;
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Adds an entry by hand. */
export function addImmersionEntry(
  entry: Pick<ImmersionEntry, 'type' | 'title' | 'day' | 'seconds' | 'characters'>
) {
  const id = newId();

  return change((log) => ({
    ...log,
    [id]: { ...entry, id, source: 'manual', modified: Date.now() }
  }));
}

export function deleteImmersionEntry(id: string) {
  return change((log) =>
    log[id] ? { ...log, [id]: { ...log[id], deleted: true, modified: Date.now() } } : log
  );
}

/** Random per browser, so two devices logging the same title on one day keep both entries. */
function deviceId() {
  try {
    let id = window.localStorage.getItem('immersionDevice');

    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      window.localStorage.setItem('immersionDevice', id);
    }
    return id;
  } catch {
    return 'device';
  }
}

/** The automatic entry's id: one per source, day, device and title. */
export const autoEntryId = (source: ImmersionSource, day: string, device: string, title: string) =>
  `${source}:${day}:${device}:${title}`;

/** Adds time and characters to today's automatic entry (texthooker, Listen). */
export function addImmersionTime(
  source: Exclude<ImmersionSource, 'manual'>,
  type: string,
  title: string,
  seconds: number,
  characters = 0,
  now = new Date()
) {
  if (seconds <= 0 && characters <= 0) return Promise.resolve();

  const day = getDateKey(startDayHoursForTracker$.getValue(), now);
  const id = autoEntryId(source, day, deviceId(), title);

  return change((log) => {
    const old = log[id] && !log[id].deleted ? log[id] : undefined;

    return {
      ...log,
      [id]: {
        id,
        type,
        title,
        day,
        source,
        seconds: (old?.seconds ?? 0) + seconds,
        characters: (old?.characters ?? 0) + characters,
        modified: now.getTime()
      }
    };
  });
}

/** The entries of the days from `start` to `end` (day keys, inclusive), newest first. */
export function entriesBetween(log: ImmersionLog, start: string, end: string) {
  return Object.values(log)
    .filter((entry) => !entry.deleted && entry.day >= start && entry.day <= end)
    .sort((a, b) => b.day.localeCompare(a.day) || b.modified - a.modified);
}

/** Time and characters per type, the largest time first. */
export function totalsByType(entries: ImmersionEntry[]) {
  const totals = new Map<string, { type: string; seconds: number; characters: number }>();

  for (const entry of entries) {
    const total = totals.get(entry.type) ?? { type: entry.type, seconds: 0, characters: 0 };

    total.seconds += entry.seconds;
    total.characters += entry.characters;
    totals.set(entry.type, total);
  }

  return [...totals.values()].sort((a, b) => b.seconds - a.seconds);
}

/**
 * Counts play time of a Listen player's audio element into the log under the book's title:
 * wall time while it plays, written at each pause and every minute. Returns the cleanup.
 */
export function trackListening(audio: HTMLMediaElement, title: () => string) {
  let since = 0;

  const flush = () => {
    if (!since) return;

    const now = Date.now();
    const seconds = Math.round((now - since) / 1000);

    since = audio.paused ? 0 : now;
    if (seconds > 0 && title() && statisticsEnabled$.getValue()) {
      addImmersionTime('listen', 'listening', title(), seconds).catch(() => {});
    }
  };
  const play = () => (since ||= Date.now());
  const tick = () => {
    if (since && Date.now() - since >= 60_000) flush();
  };

  audio.addEventListener('playing', play);
  audio.addEventListener('pause', flush);
  audio.addEventListener('ended', flush);
  audio.addEventListener('timeupdate', tick);
  if (!audio.paused) play();

  return () => {
    flush();
    since = 0;
    audio.removeEventListener('playing', play);
    audio.removeEventListener('pause', flush);
    audio.removeEventListener('ended', flush);
    audio.removeEventListener('timeupdate', tick);
  };
}

/** `use:listening={title}` on a Listen player's audio element */
export function listening(audio: HTMLMediaElement, title: string) {
  let current = title;
  const stop = trackListening(audio, () => current);

  return {
    update(next: string) {
      current = next;
    },
    destroy: stop
  };
}
