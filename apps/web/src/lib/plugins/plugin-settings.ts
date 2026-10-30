/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { writableArrayLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';
import { localStorage } from '$lib/data/window/local-storage';
import { strings } from '$lib/data/setting-parsers';

/** Ids of plugins switched on; built-in ones start on except Audiobookshelf and Discord. Synced with the account. */
export const enabledPlugins$ = writableArrayLocalStorageSubject<string>()(
  'enabledPlugins',
  ['ai', 'social'],
  strings
);

function readIntroduced(): string[] {
  try {
    return strings(JSON.parse(localStorage.getItem('pluginsIntroduced') || '[]')) ?? [];
  } catch {
    // Corrupt JSON must not stop the app from starting.
    return [];
  }
}

// Built-in plugins added after a reader's list was saved start on once too.
const addedLater = ['social'];
const introduced = readIntroduced();
const missing = addedLater.filter((id) => !introduced.includes(id));

if (missing.length) {
  if (localStorage.getItem('enabledPlugins')) {
    enabledPlugins$.next([...enabledPlugins$.getValue(), ...missing]);
  }
  localStorage.setItem('pluginsIntroduced', JSON.stringify([...introduced, ...missing]));
}
