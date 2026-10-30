/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Parsers for synced settings (`writableStorageSubject`'s `parse`, required by
 * account-settings-sync.ts): the value when it is valid, else undefined. They check the type and
 * closed sets only, never ranges: a stricter parser silently resets a reader's setting. Open sets
 * (theme ids, font names) stay plain strings. Not part of upstream.
 */

export const bool = (value: unknown) => (typeof value === 'boolean' ? value : undefined);

export const finite = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export const finiteOrNull = (value: unknown) => (value === null ? null : finite(value));

export const string = (value: unknown) => (typeof value === 'string' ? value : undefined);

export function oneOf<T extends string>(values: readonly T[]) {
  return (value: unknown) => (values.includes(value as T) ? (value as T) : undefined);
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A plain object; its entries are the feature's own business. */
export const record = <T extends object>(value: unknown) =>
  isRecord(value) ? (value as T) : undefined;

export const recordOrNull = <T extends object>(value: unknown) =>
  value === null ? null : record<T>(value);

/** An array whose items all pass `valid`; one bad item rejects the whole value. */
export function arrayOf<T>(valid: (item: unknown) => boolean = () => true) {
  return (value: unknown) =>
    Array.isArray(value) && value.every(valid) ? (value as T[]) : undefined;
}

export const strings = arrayOf<string>((item) => typeof item === 'string');
