/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Home reopens the last item at launch. A Windows game that crashes or hangs the app while VNBox
 * starts would then do it again at every launch (a phone softlocked until its data is cleared), so
 * /v marks the game while it starts and clears the mark once VNBox shows its screen.
 */
const key = 'ttu-vn-starting';

export function markVnStarting(id: number) {
  try {
    localStorage.setItem(key, String(id));
  } catch {
    // No storage: no guard.
  }
}

export function clearVnStarting() {
  try {
    localStorage.removeItem(key);
  } catch {
    // No storage: nothing to clear.
  }
}

/** Whether game `id` never finished starting last time; asking clears the mark (one launch). */
export function vnStartFailed(id: number) {
  try {
    const failed = localStorage.getItem(key) === String(id);

    localStorage.removeItem(key);
    return failed;
  } catch {
    return false;
  }
}
