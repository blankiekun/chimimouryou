/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  codeChallenge,
  exchangeOpenRouterCode,
  openRouterCallback,
  openRouterKeysUrl,
  openRouterSignInAvailable,
  openRouterSignInUrl,
  randomVerifier
} from './openrouter-oauth';

const page = (href: string) => new URL(href) as unknown as Location;

describe('OpenRouter PKCE', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('makes the S256 challenge of RFC 7636', async () => {
    // RFC 7636 appendix B
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    );
    expect(randomVerifier()).toMatch(/^[\w-]{43}$/);
    expect(randomVerifier()).not.toBe(randomVerifier());
  });

  it('is offered on https only', () => {
    expect(openRouterSignInAvailable(page('https://reader.example/settings'))).toBe(true);
    expect(openRouterSignInAvailable(page('http://192.0.2.1/settings'))).toBe(false);
  });

  it('sends the reader to OpenRouter and back to this page without its query', async () => {
    const url = new URL(
      await openRouterSignInUrl(page('https://example.github.io/app/settings?section=ai#x'))
    );
    const pending = JSON.parse(sessionStorage.getItem('openRouterOAuth')!);

    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
    expect(url.searchParams.get('callback_url')).toBe('https://example.github.io/app/settings');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(await codeChallenge(pending.verifier));
    expect(url.searchParams.get('state')).toBe(pending.state);
    // The verifier stays in this tab.
    expect(url.toString()).not.toContain(pending.verifier);
  });

  it('reads the redirect back and the address without the code', async () => {
    expect(openRouterCallback(new URL('https://r.example/settings?code=c1&state=s'))).toBe(
      undefined
    );

    await openRouterSignInUrl(page('https://r.example/settings'));

    expect(openRouterCallback(new URL('https://r.example/settings?code=c1&state=s'))).toEqual({
      code: 'c1',
      state: 's',
      cleanUrl: 'https://r.example/settings'
    });
    expect(openRouterCallback(new URL('https://r.example/settings'))).toBe(undefined);
  });

  it('exchanges the code with the verifier for a key, once', async () => {
    await openRouterSignInUrl(page('https://r.example/settings'));
    const { verifier, state } = JSON.parse(sessionStorage.getItem('openRouterOAuth')!);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ key: 'sk-or-v1-secret' })));

    expect(await exchangeOpenRouterCode('c1', state)).toBe('sk-or-v1-secret');

    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe(openRouterKeysUrl);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      code: 'c1',
      code_verifier: verifier,
      code_challenge_method: 'S256'
    });
    expect(sessionStorage.getItem('openRouterOAuth')).toBe(null);
    await expect(exchangeOpenRouterCode('c1', state)).rejects.toThrow(/wasn't started/);
  });

  it('refuses a state it did not make', async () => {
    await openRouterSignInUrl(page('https://r.example/settings'));

    await expect(exchangeOpenRouterCode('c1', 'forged')).rejects.toThrow(/wasn't started/);
    await expect(exchangeOpenRouterCode('c1', '')).rejects.toThrow(/wasn't started/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains failures without echoing the response', async () => {
    const start = async () => {
      await openRouterSignInUrl(page('https://r.example/settings'));
      return JSON.parse(sessionStorage.getItem('openRouterOAuth')!).state as string;
    };

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Invalid code sk-or-v1-leak' }), { status: 403 })
    );
    await expect(exchangeOpenRouterCode('c1', await start())).rejects.toThrow(
      /^The sign-in expired/
    );

    fetchMock.mockResolvedValueOnce(new Response('sk-or-v1-leak', { status: 500 }));
    const failed = exchangeOpenRouterCode('c1', await start());

    await expect(failed).rejects.toThrow(/HTTP 500/);
    await expect(failed).rejects.not.toThrow(/leak/);

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(exchangeOpenRouterCode('c1', await start())).rejects.toThrow(/Couldn't reach/);

    fetchMock.mockResolvedValueOnce(new Response('{}'));
    await expect(exchangeOpenRouterCode('c1', await start())).rejects.toThrow(/didn't send a key/);
  });
});
