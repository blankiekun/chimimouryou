/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Book page → Find details → Jiten, as nginx and the VPS's Caddy do: Jiten's API only answers
// jiten.moe's own origin, so the page's /jiten/ GETs go through here, on three read-only paths,
// without cookies or the page's origin. Its API is for small-scale use: 20 requests a minute.

/* global fetch, AbortSignal */
import { Buffer } from 'node:buffer';

const paths = /^\/jiten\/(search|api\/media-deck\/(?:by-link-id\/2\/v[0-9]+|[0-9]+\/detail))$/;
const perMinute = 20;
let recent = [];

/** api.jiten.moe's URL for a /jiten/ request URL, or undefined for any other path. */
export function jitenTarget(url) {
  const match = paths.exec(url.pathname);
  if (!match) return undefined;
  const path = match[1] === 'search' ? 'api/media-deck/get-media-decks' : match[1];
  return `https://api.jiten.moe/${path}${url.search}`;
}

/** `serve`'s handler for /jiten/ (true when it answers). */
export function handleJiten(url, res) {
  if (!url.pathname.startsWith('/jiten/')) return false;
  const target = jitenTarget(url);
  const now = Date.now();
  recent = recent.filter((time) => now - time < 60_000);
  if (!target) {
    res.writeHead(404).end();
  } else if (recent.length >= perMinute) {
    res.writeHead(429).end();
  } else {
    recent.push(now);
    fetch(target, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
      .then(async (response) => {
        res
          .writeHead(response.status, {
            'Content-Type': response.headers.get('content-type') ?? 'application/json',
            'Cache-Control': 'no-store'
          })
          .end(Buffer.from(await response.arrayBuffer()));
      })
      .catch(() => res.writeHead(502).end());
  }
  return true;
}
