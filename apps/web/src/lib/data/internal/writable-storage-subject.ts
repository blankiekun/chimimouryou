/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { skip } from 'rxjs';
import type { localStorage } from '../window/local-storage';
import { writableSubject } from '$lib/functions/svelte/store';

type Storage = typeof localStorage;

/** A setting's valid value, or undefined when the value isn't one (setting-parsers.ts). Not upstream. */
export type Parse<T> = (value: unknown) => T | undefined;

type Subject<T> = ReturnType<typeof writableSubject<T>>;

/** A store that only takes valid values: from localStorage, `next`/`set` and the settings sync. */
export type ParsedStore<T> = Subject<T> & { parse: Parse<T> };

export function writableStorageSubject<T>(
  storage: Storage,
  mapFromString: (s: string) => T,
  mapToString: (t: T) => string
) {
  function create(key: string, defaultValue: T): Subject<T>;
  function create(key: string, defaultValue: T, parse: Parse<T>): ParsedStore<T>;
  function create(key: string, defaultValue: T, parse?: Parse<T>) {
    const initValue = getStoredOrDefault(storage)(key, defaultValue, mapFromString, parse);
    const subject = writableSubject(initValue);
    if (parse) guard(subject, parse);
    subject.pipe(skip(1)).subscribe((updatedValue) => {
      storage.setItem(key, mapToString(updatedValue ?? defaultValue));
    });
    return subject;
  }

  return create;
}

/** An invalid value (an emptied number field, a malformed synced one) leaves the setting as it is. */
function guard<T>(subject: Subject<T>, parse: Parse<T>) {
  const next = subject.next.bind(subject);
  const guarded = (value: T) => {
    const parsed = parse(value);
    if (parsed !== undefined) next(parsed);
  };

  // subjectToSvelteWritable copied `next` to `set`, which Svelte bindings write through.
  Object.assign(subject, { next: guarded, set: guarded, parse });
}

function getStoredOrDefault(storage: Storage) {
  return <T>(key: string, defaultVal: T, mapFn: (s: string) => T, parse?: Parse<T>) => {
    const stored = storage.getItem(key);
    if (!stored) return defaultVal;
    try {
      const value = mapFn(stored);
      const parsed = parse ? parse(value) : value;
      return parsed === undefined ? defaultVal : parsed;
    } catch {
      // Corrupt JSON must not stop the app from starting.
      return defaultVal;
    }
  };
}
