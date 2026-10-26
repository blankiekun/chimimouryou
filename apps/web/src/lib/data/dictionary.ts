/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The built-in dictionary: Yomitan's engine (lib/vendor/yomitan) in a worker
 * (functions/dictionary/dictionary.worker.ts) with dictionaries in this browser's IndexedDB (imported
 * collections in its private file system), for
 * readers whose browser can't run the extension (phones). Settings are Yomitan's own options
 * object (one profile), so an exported Yomitan settings file imports as it is. Per browser, no
 * sync. Not part of upstream.
 */

import { combineLatest, map } from 'rxjs';
import type { DictionarySummary } from '$lib/vendor/yomitan/dictionary/dictionary-importer';
import type {
  DictionaryOptions,
  Options,
  ProfileOptions
} from '$lib/vendor/yomitan/types/settings';
import type {
  DictionaryRequest,
  DictionaryResponse
} from '$lib/functions/dictionary/dictionary.worker';
import type { LookupResult } from '$lib/functions/dictionary/dictionary-engine';
import type { CollectionResult } from '$lib/functions/dictionary/collection-import';
import { canRunYomitan } from '$lib/functions/can-run-yomitan';
import { writableSubject } from '$lib/functions/svelte/store';
import { writableStorageSubject } from '$lib/data/internal/writable-storage-subject';
import { localStorage } from '$lib/data/window/local-storage';
import { yomitanSeen$ } from '$lib/data/yomitan';

export type { DictionarySummary, LookupResult, Options as YomitanOptions };

const optionsKey = 'yomitanOptions';

/** Yomitan's options, once loaded (loadYomitanOptions). */
export const yomitanOptions$ = writableSubject<Options | undefined>(undefined);

/** Installed dictionaries, refreshed by every call that changes them. */
export const dictionaries$ = writableSubject<DictionarySummary[]>([]);

/** The reader's own choice for the built-in lookups; null until they set the switch. */
export const builtInLookupsChoice$ = writableStorageSubject<boolean | null>(
  localStorage,
  (value) => (value === '1' ? true : value === '0' ? false : null),
  (value) => (value === null ? '' : value ? '1' : '0')
)('builtInLookups', null);

/**
 * On unless the reader said otherwise, the browser can run Yomitan, or Yomitan's popup was seen
 * here: two popups never compete. A choice the reader made is never overridden.
 */
export function builtInLookupsOn(choice: boolean | null, canRun: boolean, seen: boolean) {
  return choice ?? (!canRun && !seen);
}

const thisBrowserRunsYomitan = () =>
  typeof navigator !== 'undefined' &&
  canRunYomitan(navigator.userAgent, navigator.maxTouchPoints || 0, 'chimiDesktop' in globalThis);

export const builtInLookups$ = combineLatest([builtInLookupsChoice$, yomitanSeen$]).pipe(
  map(([choice, seen]) => builtInLookupsOn(choice, thisBrowserRunsYomitan(), seen))
);

// The worker

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (value: any) => void; reject: (error: Error) => void; onProgress?: Progress }
>();

type Progress = (done: number, total: number) => void;
type Request = DictionaryRequest extends infer R
  ? R extends { id: number }
    ? Omit<R, 'id'>
    : never
  : never;

function call<T>(request: Request, onProgress?: Progress) {
  if (!worker) {
    worker = new Worker(new URL('../functions/dictionary/dictionary.worker.ts', import.meta.url), {
      type: 'module'
    });
    worker.onmessage = ({ data }: MessageEvent<DictionaryResponse>) => {
      const waiting = pending.get(data.id);
      if (!waiting) return;
      if (data.type === 'progress') {
        waiting.onProgress?.(data.done, data.total);
        return;
      }
      pending.delete(data.id);
      if (data.type === 'error') waiting.reject(new Error(data.message));
      else waiting.resolve(data.value);
    };
  }
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    worker!.postMessage({ ...request, id });
  });
}

// Options (Yomitan's OptionsUtil: defaults, upgrades and validation from its options schema)

let optionsUtil: Promise<import('$lib/vendor/yomitan/data/options-util').OptionsUtil> | undefined;

function getOptionsUtil() {
  optionsUtil ??= import('$lib/vendor/yomitan/data/options-util').then(async ({ OptionsUtil }) => {
    const util = new OptionsUtil();
    await util.prepare();
    return util;
  });
  return optionsUtil;
}

export async function loadYomitanOptions() {
  const loaded = yomitanOptions$.getValue();
  if (loaded) return loaded;
  const util = await getOptionsUtil();
  let options: Options;
  try {
    const stored = localStorage.getItem(optionsKey);
    options = stored ? await util.update(JSON.parse(stored)) : util.getDefault();
  } catch {
    options = util.getDefault();
  }
  yomitanOptions$.next(options);
  return options;
}

export function saveYomitanOptions(options: Options) {
  yomitanOptions$.next(options);
  localStorage.setItem(optionsKey, JSON.stringify(options));
}

/** The current profile's options (the only one this app edits). */
export function profileOptions(options: Options): ProfileOptions {
  return options.profiles[options.profileCurrent].options;
}

/** Changes the current profile's options and saves them. */
export async function updateProfileOptions(change: (options: ProfileOptions) => void) {
  const options = structuredClone(await loadYomitanOptions());
  change(profileOptions(options));
  saveYomitanOptions(options);
}

/** Yomitan's defaults for a newly imported dictionary (DictionaryController.createDefaultDictionarySettings). */
function defaultDictionarySettings(name: string, enabled: boolean, styles = ''): DictionaryOptions {
  return {
    name,
    alias: name,
    enabled,
    allowSecondarySearches: false,
    definitionsCollapsible: 'not-collapsible',
    partsOfSpeechFilter: true,
    useDeinflections: true,
    styles
  };
}

/**
 * Every profile lists exactly the installed dictionaries: entries without one are dropped,
 * missing ones are added (after Yomitan's DictionaryController.ensureDictionarySettings).
 */
export function ensureDictionarySettings(
  options: Options,
  installed: DictionarySummary[],
  newEnabled: boolean
) {
  for (const { options: profile } of options.profiles) {
    profile.dictionaries = profile.dictionaries.filter(({ name }) =>
      installed.some(({ title }) => title === name)
    );
    for (const { title, styles } of installed) {
      if (!profile.dictionaries.some(({ name }) => name === title)) {
        profile.dictionaries.push(defaultDictionarySettings(title, newEnabled, styles));
      }
    }
  }
  return options;
}

// Dictionaries

export async function refreshDictionaries() {
  const list = await call<DictionarySummary[]>({ type: 'list' });
  dictionaries$.next(list);
  const options = structuredClone(await loadYomitanOptions());
  saveYomitanOptions(ensureDictionarySettings(options, list, false));
  return list;
}

/**
 * Imports a Yomitan dictionary zip (term banks, frequency and pitch meta, kanji, tags, images).
 * The new dictionary is enabled and goes last in the order.
 */
export async function importDictionary(file: Blob, onProgress?: Progress) {
  const { result, errors } = await call<{
    result: DictionarySummary | null;
    errors: string[];
  }>({ type: 'import', file }, onProgress);
  if (result) {
    await updateProfileOptions((profile) => {
      profile.dictionaries = profile.dictionaries.filter(({ name }) => name !== result.title);
      profile.dictionaries.push(defaultDictionarySettings(result.title, true, result.styles));
      // the first frequency list sorts results (Jiten's put the right entry first on 180 of 199 taps vs 173)
      if (result.counts?.termMeta.freq && !profile.general.sortFrequencyDictionary) {
        profile.general.sortFrequencyDictionary = result.title;
        profile.general.sortFrequencyDictionaryOrder =
          result.frequencyMode === 'rank-based' ? 'ascending' : 'descending';
      }
    });
  }
  await refreshDictionaries();
  return { result, errors };
}

/**
 * What a collection import needs, as a share of the file (its pack, measured in Chrome: 0.30-0.35;
 * media-heavy collections compress less).
 */
const collectionRoomShare = 0.5;

/**
 * Imports a Yomitan dictionary collection export (Settings → Backup → Export Dictionary
 * Collection), streamed in the worker. Installed titles are skipped; the new dictionaries are
 * enabled after the installed ones. A cancelled or failed import keeps none of them.
 */
export async function importDictionaryCollection(file: File, onProgress?: Progress) {
  await navigator.storage?.persist?.().catch(() => false);
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  if (estimate?.quota !== undefined) {
    const room = estimate.quota - (estimate.usage ?? 0);
    const needed = file.size * collectionRoomShare;
    if (room < needed) {
      const gb = (bytes: number) => (bytes / 1e9).toFixed(1);
      throw new Error(
        `Not enough room: this collection needs about ${gb(needed)} GB and the browser allows ${gb(room)} GB more.`
      );
    }
  }
  try {
    const result = await call<CollectionResult>({ type: 'importCollection', file }, onProgress);
    await updateProfileOptions((profile) => {
      for (const { title, styles } of result.imported) {
        profile.dictionaries = profile.dictionaries.filter(({ name }) => name !== title);
        profile.dictionaries.push(defaultDictionarySettings(title, true, styles ?? ''));
      }
    });
    return result;
  } finally {
    await refreshDictionaries();
  }
}

export function cancelDictionaryCollectionImport() {
  return call({ type: 'cancelImport' });
}

export async function deleteDictionary(name: string) {
  await call({ type: 'delete', name });
  await refreshDictionaries();
}

export async function deleteAllDictionaries() {
  await call({ type: 'deleteAll' });
  await refreshDictionaries();
}

/** Changes one dictionary's options (enabled, alias, …) in the current profile. */
export function setDictionaryOptions(name: string, change: Partial<DictionaryOptions>) {
  return updateProfileOptions((profile) => {
    profile.dictionaries = profile.dictionaries.map((dictionary) =>
      dictionary.name === name ? { ...dictionary, ...change } : dictionary
    );
  });
}

/** Moves a dictionary up (-1) or down (+1) in the lookup order. */
export function moveDictionary(name: string, by: -1 | 1) {
  return updateProfileOptions((profile) => {
    const list = [...profile.dictionaries];
    const from = list.findIndex((dictionary) => dictionary.name === name);
    const to = from + by;
    if (from < 0 || to < 0 || to >= list.length) return;
    [list[from], list[to]] = [list[to], list[from]];
    profile.dictionaries = list;
  });
}

/**
 * Terms at the start of `text` (longest match first), Yomitan-shaped: headwords, definitions,
 * deinflection reasons (`inflectionRuleChainCandidates`), frequencies and pronunciations.
 */
export async function lookup(text: string): Promise<LookupResult> {
  const options = profileOptions(await loadYomitanOptions());
  return call<LookupResult>({ type: 'lookup', text, options });
}

/** A dictionary's image (structured content), as a Blob; null when the dictionary lacks it. */
export function getDictionaryMedia(path: string, dictionary: string) {
  return call<Blob | null>({ type: 'media', path, dictionary });
}

// Backup (Yomitan's settings export format, BackupController)

/** A settings file Yomitan can import, and the same shape Yomitan exports. */
export async function exportYomitanSettings() {
  return JSON.stringify(
    {
      version: 0,
      date: new Date().toISOString(),
      userAgent: navigator.userAgent,
      options: await loadYomitanOptions()
    },
    null,
    4
  );
}

/** Imports a Yomitan settings export (or a bare options object), upgraded to this version. */
export async function importYomitanSettings(json: string) {
  const data = JSON.parse(json);
  const util = await getOptionsUtil();
  const options = await util.update(
    data && typeof data === 'object' && 'options' in data ? data.options : data
  );
  const installed = await call<DictionarySummary[]>({ type: 'list' });
  saveYomitanOptions(ensureDictionarySettings(options, installed, false));
  // Its Anki card format too, for the popup's Add to Anki (kept apart: it follows the account).
  const { dictionaryAnki$, dictionaryAnkiFromYomitan } = await import('$lib/data/anki-dictionary');
  const anki = dictionaryAnkiFromYomitan(options);
  if (anki) dictionaryAnki$.next(anki);
}

/** Yomitan's default settings, keeping the installed dictionaries (enabled). */
export async function resetYomitanSettings() {
  const util = await getOptionsUtil();
  const installed = await call<DictionarySummary[]>({ type: 'list' });
  saveYomitanOptions(ensureDictionarySettings(util.getDefault(), installed, true));
}
