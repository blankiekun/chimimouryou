/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Google Drive in the Android app (apps/android): Google refuses its web sign-in inside a
 * WebView, so the app's DriveAuth plugin asks Play services for an access token. No refresh
 * token: an expired token is asked for again, silently once the reader has consented.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { gDriveScope } from '$lib/data/env';

interface DriveAuthPlugin {
  authorize(options: { scope: string; interactive: boolean }): Promise<{ accessToken: string }>;
}

const DriveAuth = registerPlugin<DriveAuthPlugin>('DriveAuth');

/** Running inside the Android app. */
export const nativeDrive = () => Capacitor.isNativePlatform();

/**
 * Kept in place of a refresh token once the reader consented: the next start renews silently
 * (`storedRefreshToken` then reports "signed in").
 */
export const nativeGrant = 'android-authorization';

/**
 * A token from Play services; `interactive` may show Google's consent screens (from a click).
 * Play services hands out a cached token, so its expiry comes from Google's tokeninfo.
 */
export async function nativeDriveToken(interactive: boolean, now = Date.now()) {
  const { accessToken } = await DriveAuth.authorize({ scope: gDriveScope, interactive });
  const info = await fetch('https://oauth2.googleapis.com/tokeninfo', {
    method: 'POST',
    body: new URLSearchParams({ access_token: accessToken })
  })
    .then((response) => (response.ok ? response.json() : undefined))
    .catch(() => undefined);
  // Unknown expiry: ask again after 5 minutes (Play services answers from its cache).
  const seconds = Number(info?.expires_in) || 360;

  return {
    accessToken,
    scope: gDriveScope,
    expiration: now + (seconds - 60) * 1000
  };
}
