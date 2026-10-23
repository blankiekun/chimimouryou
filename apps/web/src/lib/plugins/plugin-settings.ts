/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { writableArrayLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';
import { localStorage } from '$lib/data/window/local-storage';

/** Ids of plugins switched on; the built-in ones start on. Synced with the account. */
export const enabledPlugins$ = writableArrayLocalStorageSubject<string>()('enabledPlugins', [
  'ai',
  'audiobookshelf',
  'social'
]);

// Built-in plugins added after a reader's list was saved start on once too.
const addedLater = ['social'];
const introduced: string[] = JSON.parse(localStorage.getItem('pluginsIntroduced') || '[]');
const missing = addedLater.filter((id) => !introduced.includes(id));

if (missing.length) {
  if (localStorage.getItem('enabledPlugins')) {
    enabledPlugins$.next([...enabledPlugins$.getValue(), ...missing]);
  }
  localStorage.setItem('pluginsIntroduced', JSON.stringify([...introduced, ...missing]));
}
