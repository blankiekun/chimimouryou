/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Browser tests only (vitest.browser.config.js): what extension-runtime.browser.test.ts judges by.
 * - The fake sites (server/tests/fixtures/sources/serve.py, CORS on) for the fixture extensions.
 * - A sink on another origin that logs every request and connection, and a UDP sink (STUN): a
 *   request that reaches them is a leak, whatever the frame believed happened.
 * - Same-origin hits (/__probes/same…) with their cookies: the app's cookies must never go along.
 * - /source-sandbox-probe.html: the real static/source-sandbox.html (CSP and runtime) with
 *   frame-probes.js after the runtime, as if extension code had broken out of QuickJS.
 */

import { spawn } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

/** The part of Vite's dev server this uses (tsconfig's node resolution doesn't read vite's types). */
interface DevServer {
  middlewares: {
    use(
      handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void
    ): void;
  };
}

const here = (path: string) => new URL(path, import.meta.url);

export function extensionProbes() {
  const hits: { kind: string; path?: string; cookie?: string }[] = [];
  return {
    name: 'extension-probes',
    async configureServer(server: DevServer) {
      const sink = createServer((request, response) => {
        hits.push({ kind: 'request', path: request.url });
        response.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'text/html'
        });
        response.end('<p>sink</p>');
      });
      sink.on('connection', () => hits.push({ kind: 'connection' }));
      await new Promise<void>((resolve) => sink.listen(0, '127.0.0.1', resolve));
      const udp = createSocket('udp4');
      udp.on('message', () => hits.push({ kind: 'udp' }));
      await new Promise<void>((resolve) => udp.bind(0, '127.0.0.1', resolve));
      const sinkPort = (sink.address() as AddressInfo).port;
      const udpPort = udp.address().port;

      const fixturePort = await new Promise<number>((resolve) => {
        const probe = createServer().listen(0, '127.0.0.1', () => {
          const { port } = probe.address() as AddressInfo;
          probe.close(() => resolve(port));
        });
      });
      const fakeSites = spawn(
        'python3',
        [
          fileURLToPath(here('../../../../../../../server/tests/fixtures/sources/serve.py')),
          String(fixturePort)
        ],
        { stdio: 'ignore' }
      );
      const fixture = `http://127.0.0.1:${fixturePort}`;
      for (let i = 0; i < 100; i += 1) {
        if (
          await fetch(`${fixture}/fake-set?cors=1`).then(
            (r) => r.ok,
            () => false
          )
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      // Never keep the test run alive.
      process.once('exit', () => fakeSites.kill());
      fakeSites.unref();
      sink.unref();
      udp.unref();

      const sandboxHtml = here('../../../../../static/source-sandbox.html');
      server.middlewares.use((request, response, next) => {
        const [path] = (request.url ?? '').split('?');
        const send = (type: string, body: string) => {
          response.setHeader('Content-Type', type);
          response.setHeader('Cache-Control', 'no-store');
          response.end(body);
        };
        if (path === '/__probes/config') {
          return send(
            'application/json',
            JSON.stringify({ fixture, sink: `http://127.0.0.1:${sinkPort}`, udpPort })
          );
        }
        if (path === '/__probes/hits') return send('application/json', JSON.stringify(hits));
        if (path === '/__probes/record') {
          let body = '';
          request.on('data', (chunk: Buffer) => (body += chunk));
          request.on('end', () => {
            const browser = /Firefox\//.test(JSON.parse(body).browser) ? 'firefox' : 'chromium';
            const out = fileURLToPath(here('../../../../../node_modules/.vitest/'));
            mkdirSync(out, { recursive: true });
            writeFileSync(`${out}source-sandbox-probes-${browser}.json`, body);
            send('text/plain', 'ok');
          });
          return;
        }
        if (path.startsWith('/__probes/same')) {
          hits.push({ kind: 'same-origin', path: request.url, cookie: request.headers.cookie });
          return send('text/javascript', '/* hit */');
        }
        if (path.endsWith('/source-sandbox-probe.html')) {
          return send(
            'text/html',
            readFileSync(sandboxHtml, 'utf8').replace(
              '<script src="source-sandbox.js"></script>',
              '$&<script src="source-sandbox-probe.js"></script>'
            )
          );
        }
        if (path.endsWith('/source-sandbox-probe.js')) {
          return send(
            'text/javascript',
            readFileSync(here('./frame-probes.js'), 'utf8')
              .replaceAll('@SINK@', `http://127.0.0.1:${sinkPort}`)
              .replaceAll('@UDP@', String(udpPort))
          );
        }
        next();
      });
    }
  };
}
