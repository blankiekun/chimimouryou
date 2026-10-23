/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Cloud sign-in in the system browser (RFC 8252 loopback redirect): Google refuses embedded
// browsers. The app's /auth popup builds the consent URL as on the web; main.js opens it in the
// browser with a `state` added here, and the redirect back to http://127.0.0.1:<port>/auth hands
// the code to the popup, which exchanges it with its PKCE verifier like the web build.

import { Buffer } from 'node:buffer';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** The one sign-in waiting for its redirect: { state, popup }. */
let pending;

/** Whether `url` is the consent page of a sign-in that redirects to the app's /auth. */
export function isSignInUrl(url, origin) {
  try {
    const { protocol, searchParams } = new URL(url);
    return protocol === 'https:' && searchParams.get('redirect_uri') === `${origin}/auth`;
  } catch {
    return false;
  }
}

/** Remembers `popup` (whatever finishBrowserSignIn returns) and gives the URL to open, with a fresh state. */
export function startBrowserSignIn(url, popup) {
  const state = randomBytes(32).toString('base64url');
  pending = { state, popup };
  const target = new URL(url);
  target.searchParams.set('state', state);
  return target.href;
}

/** Forgets the waiting sign-in if it belongs to `popup` (closed). */
export function cancelBrowserSignIn(popup) {
  if (pending?.popup === popup) pending = undefined;
}

const sameState = (a, b) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * For a redirect to /auth carrying the waiting sign-in's state: { popup, code } or { popup, error },
 * once. Anything else (no sign-in waiting, another state) is undefined.
 */
export function finishBrowserSignIn(searchParams) {
  const state = searchParams.get('state') ?? '';
  if (!pending || !sameState(state, pending.state)) return undefined;
  const { popup } = pending;
  pending = undefined;
  const code = searchParams.get('code');
  return code ? { popup, code } : { popup, error: searchParams.get('error') || 'no code' };
}
