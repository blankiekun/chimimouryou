/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Tests only: the fake Syosetu, Kakuyomu, OPDS catalog and Suwayomi the Python tests use
 * (server/tests/fixtures/sources/serve.py), started on a free port, with the site requests of
 * transport.ts sent there and no wait between requests. No test reaches a real site.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { vi } from 'vitest';
import { pacing } from './transport';

// Tests run in apps/web.
export const fixtures = '../../server/tests/fixtures/sources/';

async function freePort() {
  return new Promise<number>((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/** Starts the fake sites; returns their address and a stop function. */
export async function startFakeSites() {
  const port = await freePort();
  const child: ChildProcess = spawn('python3', [`${fixtures}serve.py`, String(port)], {
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    if (
      await fetch(`${base}/none`).then(
        () => true,
        () => false
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  vi.stubEnv('VITE_SOURCES_FIXTURE_URL', base);
  pacing.site = 0;
  pacing.server = 0;
  return { base, stop: () => child.kill() };
}
