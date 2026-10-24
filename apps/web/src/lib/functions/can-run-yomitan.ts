/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Whether this browser can run the Yomitan extension, so the built-in dictionary starts off there
 * (lib/data/dictionary.ts). Yes: the desktop app (it loads Yomitan), desktop Chromium browsers and
 * Firefox (desktop and Android). No: iOS/iPadOS (WebKit only; iPadOS reports a Mac with touch),
 * desktop Safari and the other Android browsers. Not part of upstream.
 */
export function canRunYomitan(userAgent: string, maxTouchPoints: number, desktopApp: boolean) {
  if (desktopApp) return true;
  const iOS =
    /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (iOS) return false;
  if (/Firefox\//.test(userAgent)) return true;
  if (/Android/.test(userAgent)) return false;
  return /Chrome\/|Chromium\//.test(userAgent);
}
