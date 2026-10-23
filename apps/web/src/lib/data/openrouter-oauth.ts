/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * "Connect with OpenRouter" (Settings → AI → Get started): OpenRouter's OAuth PKCE
 * flow (openrouter.ai/docs/use-cases/oauth-pkce). The browser goes to OpenRouter,
 * comes back to the settings page with `?code=…&state=…`, and trades the code (plus
 * the verifier kept in sessionStorage) for an API key. The code leaves the URL
 * before the exchange; the key never enters one, and errors never echo a response
 * body. Not part of upstream.
 */

export const openRouterAuthUrl = 'https://openrouter.ai/auth';
export const openRouterKeysUrl = 'https://openrouter.ai/api/v1/auth/keys';

const pendingKey = 'openRouterOAuth';

interface PendingSignIn {
  verifier: string;
  state: string;
}

/**
 * Only on https pages: the redirect needs an address OpenRouter can send the reader back
 * to, and the desktop app would finish the sign-in in the system browser, which has
 * none of this window's sessionStorage.
 */
export function openRouterSignInAvailable(location: Location = window.location) {
  return (
    location.protocol === 'https:' &&
    typeof crypto !== 'undefined' &&
    !!crypto.subtle &&
    !('chimiDesktop' in globalThis)
  );
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function randomVerifier() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** S256: base64url(sha256(verifier)), RFC 7636. */
export async function codeChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));

  return base64Url(new Uint8Array(digest));
}

/** Where OpenRouter sends the reader back: this page without its query or hash. */
export function callbackUrl(location: Location = window.location) {
  return `${location.origin}${location.pathname}`;
}

/** Remembers a verifier and state for this tab and returns OpenRouter's sign-in address. */
export async function openRouterSignInUrl(location: Location = window.location) {
  const pending: PendingSignIn = { verifier: randomVerifier(), state: randomVerifier() };
  const url = new URL(openRouterAuthUrl);

  sessionStorage.setItem(pendingKey, JSON.stringify(pending));
  url.searchParams.set('callback_url', callbackUrl(location));
  url.searchParams.set('code_challenge', await codeChallenge(pending.verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', pending.state);
  url.searchParams.set('key_label', `chimimouryou (${location.host})`);

  return url.toString();
}

/**
 * The code and state of a redirect back from OpenRouter, and the address without them
 * (to put in the address bar before anything else happens). Undefined when the URL
 * is no such redirect or no sign-in was started in this tab.
 */
export function openRouterCallback(url: URL) {
  const code = url.searchParams.get('code');

  if (!code || sessionStorage.getItem(pendingKey) === null) {
    return undefined;
  }

  const clean = new URL(url);

  clean.searchParams.delete('code');
  clean.searchParams.delete('state');

  return { code, state: url.searchParams.get('state') ?? '', cleanUrl: clean.toString() };
}

const exchangeErrors: Record<number, string> = {
  400: 'OpenRouter refused the sign-in request. Try again.',
  403: 'The sign-in expired or was already used. Try again.'
};

/** Trades the code for an API key. Each started sign-in can be finished once. */
export async function exchangeOpenRouterCode(code: string, state: string) {
  const stored = sessionStorage.getItem(pendingKey);

  sessionStorage.removeItem(pendingKey);

  let pending: PendingSignIn | undefined;

  try {
    pending = stored ? JSON.parse(stored) : undefined;
  } catch {
    pending = undefined;
  }

  if (!pending?.verifier || !state || pending.state !== state) {
    throw new Error("This sign-in wasn't started on this page. Try again.");
  }

  let response: Response;

  try {
    response = await fetch(openRouterKeysUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: pending.verifier,
        code_challenge_method: 'S256'
      })
    });
  } catch {
    throw new Error("Couldn't reach OpenRouter. Check the connection and try again.");
  }

  if (!response.ok) {
    throw new Error(
      exchangeErrors[response.status] ??
        `OpenRouter couldn't finish the sign-in (HTTP ${response.status}). Try again.`
    );
  }

  let key = '';

  try {
    key = String((await response.json())?.key ?? '');
  } catch {
    // no JSON body
  }

  if (!key) {
    throw new Error("OpenRouter didn't send a key. Try again.");
  }

  return key;
}
