/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Serves the standalone build like GitHub Pages does: /auth is auth.html, unknown paths get 404.html
// (SvelteKit's fallback page, which routes on the client).

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The file under `root` that answers `urlPath`, or undefined. Never leaves `root`. */
export function resolveFile(root, urlPath) {
  root = resolve(root);
  let rel;
  try {
    rel = normalize(decodeURIComponent(urlPath)).replace(/^[/\\]+/, '');
  } catch {
    return undefined;
  }
  for (const candidate of [rel, `${rel}.html`, join(rel, 'index.html')]) {
    const file = join(root, candidate);
    if (file.startsWith(root + sep) && isFile(file)) return file;
  }
  return undefined;
}

/** Starts the server on 127.0.0.1:`port`; rejects if the port is taken. */
export function serve(root, port) {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const found = resolveFile(root, path);
    const file = found ?? join(resolve(root), '404.html');
    res.writeHead(found ? 200 : 404, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') res.end();
    else
      createReadStream(file)
        .on('error', () => res.end())
        .pipe(res);
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolvePromise(server));
  });
}
