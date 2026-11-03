/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * A phone browser in portrait turns to landscape on the first tap on the game, once per visit to
 * /v, so a reader who leaves full screen stays out. Browsers only lock the orientation in full
 * screen and only after a tap. iPhone Safari does neither: `showNote` asks the reader to turn the
 * phone. The Android app locks by route instead (android-bars.ts). Not part of upstream.
 */

import { Capacitor } from '@capacitor/core';
import { fullscreenManager } from '$lib/data/fullscreen-manager';
import { isPhone } from '$lib/functions/utils';

/** `lock` and `unlock` left TypeScript's DOM types; Safari has neither on iPhone. */
type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>;
  unlock?: () => void;
};

export function vnLandscape(showNote: (show: boolean) => void) {
  const portrait = matchMedia('(orientation: portrait)');
  const orientation = screen.orientation as LockableOrientation | undefined;
  let tapped = !isPhone(window) || Capacitor.isNativePlatform();
  let tried = false;
  let enteredFullscreen = false;
  let stopped = false;

  const hideNoteInLandscape = () => {
    if (!portrait.matches) showNote(false);
  };

  function leaveFullscreen() {
    if (!enteredFullscreen || !fullscreenManager.fullscreenElement) return;
    fullscreenManager.exitFullscreen().catch(() => {});
  }

  function release() {
    try {
      orientation?.unlock?.();
    } catch {
      // Nothing was locked.
    }
    leaveFullscreen();
  }

  async function turn() {
    if (!fullscreenManager.fullscreenEnabled || !orientation?.lock) {
      showNote(true);
      return;
    }
    tried = true;
    try {
      if (!fullscreenManager.fullscreenElement) {
        await fullscreenManager.requestFullscreen(document.documentElement);
        enteredFullscreen = true;
      }
      await orientation.lock('landscape');
    } catch {
      // The game stays as it was: in the page, unless the reader had asked for full screen.
      leaveFullscreen();
      if (!stopped && portrait.matches) showNote(true);
    }
    // Left /v while the browser was still turning.
    if (stopped) release();
  }

  // pointerup: touchend is the game's (vnbox.js stops it, overlay.js cancels it, so no click
  // follows), but pointerup counts as the tap browsers ask for. Listening changes nothing for it.
  function onTap() {
    if (tapped) return;
    tapped = true;
    if (portrait.matches) turn();
  }

  portrait.addEventListener('change', hideNoteInLandscape);

  return {
    /** For each new game frame (a restart replaces it); taps inside it never reach this page. */
    watchFrame(frame: Window) {
      if (!tapped) frame.addEventListener('pointerup', onTap, { capture: true, once: true });
    },
    stop() {
      stopped = true;
      tapped = true;
      portrait.removeEventListener('change', hideNoteInLandscape);
      if (tried) release();
    }
  };
}
