/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Installing the standalone edition (plan S6): Chrome and Edge offer `beforeinstallprompt`,
 * Firefox on Android installs from its menu, Safari on iOS from Share → Add to Home Screen.
 * Not part of upstream.
 */

import { learningGuideUrl } from '$lib/data/app-update';
import { writableBooleanLocalStorageSubject } from '$lib/data/internal/writable-boolean-local-storage-subject';
import { storage } from '$lib/data/window/navigator/storage';
import { writableSubject } from '$lib/functions/svelte/store';

/** Installed apps keep their data: ask the browser not to evict the books. */
function persistStorage() {
  storage.persist().catch(() => {});
}

export type InstallWay = 'prompt' | 'firefox-android' | 'ios' | 'installed' | 'none';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const installPrompt$ = writableSubject<InstallPromptEvent | undefined>(undefined);
export const installed$ = writableSubject(false);
/** Home's hint was dismissed with "Not now"; Settings → General keeps the row. */
export const installHintDismissed$ = writableBooleanLocalStorageSubject()(
  'installHintDismissed',
  false
);

export function installWay(
  userAgent: string,
  maxTouchPoints: number,
  canPrompt: boolean,
  installed: boolean
): InstallWay {
  if (installed) return 'installed';
  if (canPrompt) return 'prompt';
  if (/Android/.test(userAgent) && /Firefox\//.test(userAgent)) return 'firefox-android';
  // iPadOS reports a Mac; only Safari can add to the Home Screen there.
  const apple =
    /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (apple && /Safari\//.test(userAgent) && !/CriOS|FxiOS|EdgiOS/.test(userAgent)) return 'ios';
  return 'none';
}

/** docs/LEARNING.md's section on phones: Yomitan on Android, Safari and Hoshi Reader on iOS. */
export const phonesGuideUrl = `${learningGuideUrl}#6-phones-and-tablets`;
const phonesGuide = { label: 'Reading on phones →', href: phonesGuideUrl };

export const installTexts: Record<
  Exclude<InstallWay, 'none'>,
  { title: string; text: string; links?: { label: string; href: string }[] }
> = {
  prompt: {
    title: 'Install chimimouryou',
    text: 'Opens in its own window and keeps working offline.'
  },
  'firefox-android': {
    title: 'Install from the Firefox menu',
    text: "Open the menu (⋮), then Install. For Yomitan lookups, read in a Firefox tab instead: it's the only Android browser that runs Yomitan.",
    links: [
      { label: 'Get Yomitan →', href: 'https://addons.mozilla.org/android/addon/yomitan/' },
      phonesGuide
    ]
  },
  ios: {
    title: 'Add to your Home Screen',
    text: "Tap Share, then Add to Home Screen. Safari deletes a site's data after 7 days without a visit; on the Home Screen your books stay.",
    links: [phonesGuide]
  },
  installed: {
    title: 'Installed',
    text: 'chimimouryou is installed on this device.'
  }
};

/** Listens for the browser's install offer; call once at start in the standalone edition. */
export function watchInstall(window: Window) {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt$.next(event as InstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => {
    installPrompt$.next(undefined);
    installed$.next(true);
    persistStorage();
  });
  const running = window.matchMedia?.('(display-mode: standalone)').matches;
  if (running || (window.navigator as any).standalone) {
    installed$.next(true);
    persistStorage();
  }
}

export async function promptInstall() {
  const event = installPrompt$.getValue();
  if (!event) return;
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === 'accepted') installPrompt$.next(undefined);
}
