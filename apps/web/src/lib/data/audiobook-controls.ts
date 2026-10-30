/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Listening options shared by both audiobook players; they follow the account (sharedSettings).
 * The speed is per book (`getAudiobookRate`). Not part of upstream.
 */

import { writableObjectLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';
import { record } from '$lib/data/setting-parsers';

export interface AudiobookControls {
  /** Seek step, in seconds */
  seekSeconds: number;
  /** Times each line plays while looping, 0 = until looping is switched off */
  loopCount: number;
  /** Pause after each line */
  autoPause: boolean;
  /** Seconds before going on after an auto-pause: 0 = wait for play, -1 = the line's length */
  autoPauseGap: number;
  /** Pause while a word is looked up (popup open or text selected), go on after */
  pauseOnLookup: boolean;
  /** Turn pages to keep the line being read on screen */
  follow: boolean;
}

export const audiobookControlDefaults: AudiobookControls = {
  seekSeconds: 5,
  loopCount: 0,
  autoPause: false,
  autoPauseGap: 0,
  pauseOnLookup: true,
  follow: true
};

export const audiobookControls$ = writableObjectLocalStorageSubject<Partial<AudiobookControls>>()(
  'audiobookControls',
  {},
  record
);

export function audiobookControls(): AudiobookControls {
  return { ...audiobookControlDefaults, ...audiobookControls$.getValue() };
}

export function setAudiobookControl<K extends keyof AudiobookControls>(
  key: K,
  value: AudiobookControls[K]
) {
  audiobookControls$.next({ ...audiobookControls$.getValue(), [key]: value });
}
