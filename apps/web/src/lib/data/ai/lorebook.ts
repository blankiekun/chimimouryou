/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * SillyTavern-style lorebook of a book (characters, places, organisations,
 * items, terms), written by the AI from the text read so far. It records the
 * character count it has read up to and only sends the text after that on the
 * next update, so each update is small. Separate from "Story so far" recaps.
 * Not part of upstream.
 */

import { featureParams, featureReady } from '$lib/data/ai/ai-connections';
import { lorebookAutoInterval$ } from '$lib/data/ai/ai-settings';
import { aiPrompts } from '$lib/data/ai/ai-prompts';
import { askAi } from '$lib/data/ai/ask-ai';
import { readerDb } from '$lib/data/reader-db';
import { ownsRecord, textBetween } from '$lib/data/ai/recap';
import { orderSeries, seriesVolumes } from '$lib/data/library/library-sort';
import type { SearchIndex } from '$lib/functions/book-text/book-search';
import { BehaviorSubject, Subject } from 'rxjs';

export const loreCategories = [
  'character',
  'place',
  'organization',
  'item',
  'term',
  'event'
] as const;

export type LoreCategory = (typeof loreCategories)[number];

export interface LoreEntry {
  id: string;
  name: string;
  reading: string;
  category: LoreCategory;
  /** Words that refer to the entry (SillyTavern trigger keys) */
  keys: string[];
  content: string;
  /** Character counts where the entry was created and last updated */
  firstSeen: number;
  updated: number;
  /** Copied from an earlier book of the series (shown from the start of this one) */
  fromBook?: string;
}

export interface Lorebook {
  title: string;
  entries: LoreEntry[];
  /** Character count the lorebook has read up to */
  processedUpTo: number;
  /** Last change (epoch ms); the newer copy wins when syncing */
  modified?: number;
  /** Account the browser copy belongs to ('' signed out); set by extras-sync.ts */
  account?: string;
}

/**
 * lorebook.json from another device: entries without an id, name or keys are dropped; undefined
 * when `entries` isn't a list or a count isn't a number.
 */
export function parseLorebook(raw: any): Lorebook | undefined {
  if (
    !Array.isArray(raw?.entries) ||
    !Number.isFinite(raw.processedUpTo ?? 0) ||
    !Number.isFinite(raw.modified ?? 0)
  ) {
    return undefined;
  }

  return {
    ...raw,
    entries: raw.entries.filter(
      (entry: any) =>
        typeof entry?.id === 'string' &&
        typeof entry.name === 'string' &&
        Array.isArray(entry.keys) &&
        entry.keys.every((key: unknown) => typeof key === 'string')
    )
  };
}

/** Newer copy wins (lorebooks are rebuilt in order, so mixing two would be inconsistent). */
export function mergeLorebooks(title: string, local?: Lorebook, remote?: Lorebook): Lorebook {
  const newer = (remote?.modified ?? 0) > (local?.modified ?? 0) ? remote : (local ?? remote);
  const { account: _account, ...lorebook } = newer ?? { title, entries: [], processedUpTo: 0 };

  return { ...lorebook, title };
}

export function sameLorebooks(a?: Lorebook, b?: Lorebook) {
  return (
    (a?.modified ?? 0) === (b?.modified ?? 0) &&
    (a?.processedUpTo ?? 0) === (b?.processedUpTo ?? 0) &&
    (a?.entries.length ?? 0) === (b?.entries.length ?? 0)
  );
}

/** Text sent per request; longer stretches are split. */
/** Characters per request unless Settings → AI → Lorebook → Context sent says otherwise */
const defaultChunkCharacters = 20_000;
/** Below this, an update isn't worth a request. */
export const minUpdateCharacters = 500;

async function getStored(title: string): Promise<Lorebook> {
  const stored = await (await readerDb()).get('lorebooks', title);

  // Another sign-in state's copy (see extras-sync) is not this reader's: start empty.
  return stored && (await ownsRecord(stored)) ? stored : { title, entries: [], processedUpTo: 0 };
}

const processedCache = new Map<string, number>();
/** Updates in progress, by title. They belong to this module, not to the panel, so they keep running when it closes. */
const running = new Map<string, AbortController>();

/** Emits the lorebook after every saved change, including background updates and synced copies. */
export const lorebookChanged$ = new Subject<Lorebook>();

// Synced copies arrive here too, so the next update starts where they stopped.
lorebookChanged$.subscribe((lorebook) =>
  processedCache.set(lorebook.title, lorebook.processedUpTo)
);

/** What the current update of a book is doing, and the last error. */
export const lorebookProgress$ = new BehaviorSubject<{
  title: string;
  message: string;
  error: string;
}>({ title: '', message: '', error: '' });

export function isLorebookUpdating(title: string) {
  return running.has(title);
}

export function stopLorebookUpdate(title: string) {
  running.get(title)?.abort();
}

export async function getLorebook(title: string) {
  const lorebook = await getStored(title);

  processedCache.set(title, lorebook.processedUpTo);

  return lorebook;
}

async function putLorebook(lorebook: Lorebook) {
  const changed = { ...lorebook, modified: Date.now() };

  await (await readerDb()).put('lorebooks', changed);
  lorebookChanged$.next(changed);
}

export async function clearLorebook(title: string) {
  [...earlier.keys()]
    .filter((key) => key.startsWith(`${title}\n`))
    .forEach((key) => earlier.delete(key));
  await putLorebook({ title, entries: [], processedUpTo: 0 });
}

export async function saveLoreEntries(title: string, entries: LoreEntry[]) {
  await putLorebook({ ...(await getStored(title)), entries });
}

const honorific = /(さん|ちゃん|くん|君|様|さま|殿|先生|氏)$/;

/**
 * A name as compared: lower case, without an honorific (unless that leaves nothing, as for 先生),
 * its parts in a fixed order when spaces or ・ separate them (ジョン・スミス = スミス・ジョン).
 */
function nameKey(name: string) {
  const trimmed = name.trim().toLowerCase();
  const plain = trimmed.replace(honorific, '') || trimmed;
  const parts = plain.split(/[\s・･=＝]+/).filter(Boolean);

  return parts.length > 1 ? parts.sort().join(' ') : plain;
}

function sameName(a: string, b: string) {
  return nameKey(a) === nameKey(b);
}

/** Parses the model's JSON answer, tolerating code fences and stray text around it. */
export function parseLoreAnswer(answer: string): Partial<LoreEntry>[] {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');

  if (start < 0 || end < start) {
    throw new Error('The model did not return lorebook JSON');
  }

  const parsed = JSON.parse(answer.slice(start, end + 1));

  return Array.isArray(parsed?.entries) ? parsed.entries : [];
}

/**
 * Adds new entries and updates existing ones (matched by name or key) from a model answer.
 * `sentInFull`: ids of the entries the model was given with their content (all when left out);
 * the others only by name, so an update adds to their content instead of replacing it.
 */
export function mergeLoreEntries(
  entries: LoreEntry[],
  updates: Partial<LoreEntry>[],
  start: number,
  end: number,
  sentInFull?: Set<string>
): LoreEntry[] {
  const result = entries.map((entry) => ({ ...entry }));
  /** Entries this answer changed already: a second update for one adds to it */
  const updated = new Set<LoreEntry>();

  updates.forEach((update) => {
    const name = typeof update.name === 'string' ? update.name.trim() : '';
    const content = typeof update.content === 'string' ? update.content.trim() : '';

    if (!name || !content) {
      return;
    }

    const keys = Array.isArray(update.keys)
      ? update.keys.filter((key): key is string => typeof key === 'string' && !!key.trim())
      : [];
    const category = loreCategories.includes(update.category as LoreCategory)
      ? (update.category as LoreCategory)
      : undefined;
    // Same name first, so a key shared with another entry doesn't take the update.
    const byName = result.find((entry) => sameName(entry.name, name));
    // The model lists the old name as another name of this one: named after being described.
    const renamed = byName
      ? undefined
      : result.find((entry) => keys.some((key) => sameName(key, entry.name)));
    const existing =
      byName ?? renamed ?? result.find((entry) => entry.keys.some((key) => sameName(key, name)));

    if (existing) {
      const replace = !updated.has(existing) && (!sentInFull || sentInFull.has(existing.id));

      // Content the model didn't see (or a reader's edit of it) is kept; the new facts follow it.
      existing.content =
        replace || existing.content.includes(content) ? content : `${existing.content}\n${content}`;
      existing.keys = [...new Set([...existing.keys, existing.name, name, ...keys])];
      if (renamed) {
        existing.name = name;
      }
      updated.add(existing);
      existing.category = category ?? existing.category;
      existing.reading = (typeof update.reading === 'string' && update.reading) || existing.reading;
      existing.updated = end;
    } else {
      result.push({
        id: `${start}-${result.length}-${name}`,
        name,
        reading: typeof update.reading === 'string' ? update.reading : '',
        category: category ?? 'term',
        keys: keys.length ? [...new Set([name, ...keys])] : [name],
        content,
        firstSeen: start,
        updated: end
      });
    }
  });

  return result;
}

/** Existing entries for the prompt: in full if the passage mentions them, otherwise by name. */
function entriesForPrompt(entries: LoreEntry[], passage: string) {
  const mentioned = entries.filter((entry) => entry.keys.some((key) => passage.includes(key)));
  const others = entries.filter((entry) => !mentioned.includes(entry));
  const text = JSON.stringify({
    relevant: mentioned.map(({ name, reading, category, keys, content }) => ({
      name,
      reading,
      category,
      keys,
      content
    })),
    other_names: others.map((entry) => entry.name)
  });

  return { text, sentInFull: new Set(mentioned.map((entry) => entry.id)) };
}

/** Earlier versions of entries that updates in this session changed, by title and id. Not saved: lorebook.json holds the latest version only. */
const earlier = new Map<string, Pick<LoreEntry, 'name' | 'keys' | 'content' | 'updated'>[]>();
const versionKey = (title: string, id: string) => `${title}\n${id}`;

/**
 * The entry as it was at `position`, for going back to an earlier part: the entry itself when it
 * wasn't updated past it, else its last version before (from updates in this session);
 * undefined when that isn't known.
 */
export function loreEntryAt(title: string, entry: LoreEntry, position: number) {
  if (entry.fromBook || entry.updated <= position) {
    return entry;
  }

  return earlier
    .get(versionKey(title, entry.id))
    ?.findLast((version) => version.updated <= position);
}

function keepEarlierVersions(title: string, before: LoreEntry[], after: LoreEntry[]) {
  before.forEach(({ id, name, keys, content, updated }) => {
    if (after.find((entry) => entry.id === id)?.updated !== updated) {
      const key = versionKey(title, id);

      earlier.set(key, [...(earlier.get(key) ?? []), { name, keys, content, updated }]);
    }
  });
}

/** Characters an update from the stored position to `position` would send. */
export async function pendingLoreCharacters(title: string, position: number) {
  return Math.max(0, position - (await getLorebook(title)).processedUpTo);
}

/**
 * Reads the text from where the lorebook stopped up to `position`, in chunks,
 * saving after each so an interrupted update keeps its progress.
 */
export async function updateLorebook(title: string, index: SearchIndex, position: number) {
  if (running.has(title)) {
    throw new Error('The lorebook is already being updated');
  }

  const controller = new AbortController();
  const progress = (message: string, error = '') =>
    lorebookProgress$.next({ title, message, error });

  running.set(title, controller);
  progress('Starting');

  try {
    const lorebook = await readUntil(title, index, position, progress, controller.signal);

    progress('');

    return lorebook;
  } catch (e: any) {
    progress('', controller.signal.aborted ? '' : e.message);
    throw e;
  } finally {
    running.delete(title);
    // Lets open panels see that the update has ended.
    getStored(title).then((lorebook) => lorebookChanged$.next(lorebook));
  }
}

function loreChunkCharacters() {
  return Math.max(1000, featureParams('lore').context ?? defaultChunkCharacters);
}

async function readUntil(
  title: string,
  index: SearchIndex,
  position: number,
  onProgress: (message: string) => void,
  signal: AbortSignal
) {
  let lorebook = await getLorebook(title);
  const chunkCharacters = loreChunkCharacters();
  const total = Math.ceil((position - lorebook.processedUpTo) / chunkCharacters);

  for (let part = 1; lorebook.processedUpTo < position; part += 1) {
    signal.throwIfAborted();

    const start = lorebook.processedUpTo;
    const end = Math.min(start + chunkCharacters, position);
    const passage = textBetween(index, start, end);

    onProgress(
      `Reading characters ${start.toLocaleString()}–${end.toLocaleString()} (${part} of ${total})`
    );

    const existing = entriesForPrompt(lorebook.entries, passage);
    const answer = passage.trim()
      ? await askAi(
          [
            {
              role: 'user',
              content: `Book: ${title}\n\n<existing_entries>\n${existing.text}\n</existing_entries>\n\n<passage>\n${passage}\n</passage>`
            }
          ],
          () => {},
          signal,
          { feature: 'lore', system: aiPrompts().lore }
        )
      : [];
    const updates = answer.length ? parseLoreAnswer(answer[answer.length - 1].content) : [];

    const entries = mergeLoreEntries(lorebook.entries, updates, start, end, existing.sentInFull);

    keepEarlierVersions(title, lorebook.entries, entries);
    lorebook = { ...lorebook, entries, processedUpTo: end };
    await putLorebook(lorebook);
  }

  return lorebook;
}

const failedAt = new Map<string, number>();
const retryDelay = 10 * 60 * 1000;

/**
 * Background update every `lorebookAutoInterval$` characters (Settings → AI), skipped when the
 * position is more than three requests' worth past that (a jump, not reading).
 * After an error it waits 10 minutes; the panel shows the error.
 */
export async function autoUpdateLorebook(
  title: string,
  getIndex: () => Promise<SearchIndex>,
  position: number
) {
  const interval = lorebookAutoInterval$.getValue();

  if (!interval || !featureReady('lore') || running.has(title)) {
    return;
  }

  const processed = processedCache.get(title) ?? (await getLorebook(title)).processedUpTo;

  const pending = position - processed;
  const due = Math.max(interval, minUpdateCharacters);

  // More than three requests past the interval is a jump (to the end, the afterword…), not
  // reading: it would read ahead and spoil the entries, so it waits for the Update button.
  if (pending < due || pending > due + 3 * loreChunkCharacters()) {
    return;
  }

  if (Date.now() - (failedAt.get(title) ?? 0) < retryDelay) {
    return;
  }

  try {
    await updateLorebook(title, await getIndex(), position);
  } catch (_) {
    failedAt.set(title, Date.now());
  }
}

export interface SeriesBook {
  title: string;
  series?: string;
  seriesIndex?: number | null;
}

/**
 * Later books of the same series, next volume first; among volumes with the
 * same number, books on Home come first.
 */
export function laterInSeries<T extends SeriesBook>(
  books: T[],
  title: string,
  homeTitles: string[]
) {
  const current = books.find((book) => book.title === title);

  if (!current?.series) {
    return [];
  }

  const home = new Set(homeTitles);
  const series = books.filter((book) => book.series === current.series);
  // Same volume numbers as the Store's series order (title numbers when Calibre's indexes don't help).
  const volumes = seriesVolumes(series);
  const volume = (book: T) => volumes.get(book) ?? 0;

  return orderSeries(series)
    .filter((book) => volume(book) > volume(current))
    .sort((a, b) => volume(a) - volume(b) || Number(home.has(b.title)) - Number(home.has(a.title)));
}

/**
 * Copies the entries into another book's lorebook, so it starts knowing the
 * characters and places so far. Entries the target already has (same name or
 * key) are kept as they are. Returns how many were added.
 */
export async function copyLorebookTo(sourceTitle: string, targetTitle: string) {
  const source = await getStored(sourceTitle);
  const target = await getStored(targetTitle);
  const known = (name: string) =>
    target.entries.some(
      (entry) => sameName(entry.name, name) || entry.keys.some((key) => sameName(key, name))
    );
  const added = source.entries
    .filter((entry) => !known(entry.name) && !entry.keys.some(known))
    .map(
      (entry): LoreEntry => ({
        ...entry,
        id: `${sourceTitle}/${entry.id}`,
        firstSeen: 0,
        updated: 0,
        fromBook: entry.fromBook ?? sourceTitle
      })
    );

  await putLorebook({ ...target, entries: [...target.entries, ...added] });

  return added.length;
}
