/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Immersive readers in the Android app (apps/android): the book, manga and visual novel readers
 * hide the status and navigation bars through Capacitor's built-in SystemBars plugin; every other
 * page shows them. A no-op outside the app. Not part of upstream.
 */

import { Capacitor, SystemBars } from '@capacitor/core';

const readers = new Set(['/b', '/m', '/v']);
let hidden = false;
let watching = false;

function apply() {
  (hidden ? SystemBars.hide() : SystemBars.show()).catch(() => {});
}

/** Called with the route id on every navigation (root layout). */
export function barsForRoute(routeId: string | null) {
  if (!Capacitor.isNativePlatform()) return;
  if (!watching) {
    watching = true;
    // Some devices bring the bars back when the app returns from the background.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && hidden) apply();
    });
  }
  const next = readers.has(routeId ?? '');
  if (next === hidden) return;
  hidden = next;
  apply();
}
