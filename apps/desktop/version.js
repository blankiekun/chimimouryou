/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

const parts = (version) => version.replace(/^v/, '').split(/[.-]/).slice(0, 3).map(Number);

/** Whether release `tag` (v1.2.3) is a higher version than `current` (1.2.3); anything unparsable is not. */
export function isNewerVersion(tag, current) {
  const [a, b] = [parts(tag), parts(current)];

  if ([...a, ...b].some(Number.isNaN) || a.length < 3 || b.length < 3) return false;
  const index = a.findIndex((part, i) => part !== b[i]);

  return index >= 0 && a[index] > b[index];
}
