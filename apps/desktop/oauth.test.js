/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { URLSearchParams } from 'node:url';
import {
  cancelBrowserSignIn,
  finishBrowserSignIn,
  isSignInUrl,
  startBrowserSignIn
} from './oauth.js';

const origin = 'http://127.0.0.1:41917';
const consent = `https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=${encodeURIComponent(`${origin}/auth`)}&response_type=code`;
const redirect = (query) => new URLSearchParams(query);

test('isSignInUrl wants https and a redirect to the app', () => {
  assert.equal(isSignInUrl(consent, origin), true);
  assert.equal(isSignInUrl(consent.replace('https:', 'http:'), origin), false);
  assert.equal(isSignInUrl('https://example.com/?redirect_uri=https://evil/auth', origin), false);
  assert.equal(isSignInUrl('not a url', origin), false);
});

test('only the waiting state finishes a sign-in, once', () => {
  const popup = {};
  const state = new URL(startBrowserSignIn(consent, popup)).searchParams.get('state');
  assert.ok(state.length >= 43);
  assert.equal(finishBrowserSignIn(redirect({ code: 'c', state: 'forged' })), undefined);
  assert.equal(finishBrowserSignIn(redirect({ code: 'c' })), undefined);
  assert.deepEqual(finishBrowserSignIn(redirect({ code: 'c', state })), { popup, code: 'c' });
  assert.equal(finishBrowserSignIn(redirect({ code: 'c', state })), undefined);

  const next = new URL(startBrowserSignIn(consent, popup)).searchParams.get('state');
  assert.notEqual(next, state);
  assert.deepEqual(finishBrowserSignIn(redirect({ error: 'access_denied', state: next })), {
    popup,
    error: 'access_denied'
  });

  const closed = new URL(startBrowserSignIn(consent, popup)).searchParams.get('state');
  cancelBrowserSignIn(popup);
  assert.equal(finishBrowserSignIn(redirect({ code: 'c', state: closed })), undefined);
});
