/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Mihon (Tachiyomi) extensions on the desktop: our own JVM host (apps/mihon-host, its jars shipped
// in the installer) run on a stock Temurin 21 JRE downloaded when the reader turns Mihon on (pinned
// SHA-256 below). One host process for all extensions, spoken to over stdin/stdout in JSON lines;
// nothing else on the machine can reach it. Extension jars are downloaded here (https only), kept
// as <userData>/mihon/ext/<sha256>.jar and re-hashed before every load. The page calls in through
// `chimiDesktop.mihon` (preload.cjs), app pages only.

import { Buffer } from 'node:buffer';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { clearTimeout, setTimeout } from 'node:timers';

/** Temurin 21.0.13+9 JRE per platform/arch (api.adoptium.net, checksums from its release). */
const JRE = {
  'linux-x64': [
    'OpenJDK21U-jre_x64_linux_hotspot_21.0.13_9.tar.gz',
    'a535a1df9c6284d9618872984e026ae0352d1f7e9e0605425c0e6114f47351dd'
  ],
  'linux-arm64': [
    'OpenJDK21U-jre_aarch64_linux_hotspot_21.0.13_9.tar.gz',
    'b1734db7ade49c3f6acc6ae06233b8c2dd90e3e2f00f67000ae1c972aaa64d8c'
  ],
  'win32-x64': [
    'OpenJDK21U-jre_x64_windows_hotspot_21.0.13_9.zip',
    '2332c0b4cff6bed722da3567c91d5e47568bcba863fa4945d0a8d6fc76158628'
  ],
  'darwin-x64': [
    'OpenJDK21U-jre_x64_mac_hotspot_21.0.13_9.tar.gz',
    'c909674b1c10c261b9a3fb7e9c0efebd303e33f88a4fe84be7135b5e2d711f89'
  ],
  'darwin-arm64': [
    'OpenJDK21U-jre_aarch64_mac_hotspot_21.0.13_9.tar.gz',
    '225bab0a09491ef06835488cd942f5d2befa9a0410a2484f0c8bbcf7506ec09a'
  ]
};
const JRE_BASE =
  'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/';
const CALL_MS = 60_000;
// shortcut: a chapter's pages come back in one answer (one image after another), so its call gets
// longer; per-page calls would let the timeout stay at 60 s.
const PAGES_MS = 10 * 60_000;
const IDLE_MS = 5 * 60_000;
const MAX_JAR = 20 * 1024 * 1024;

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/**
 * Registers the `mihon-*` handlers. `hostDir` holds the host's jars (lib/*.jar); `jvmArgs` adds
 * JVM options (the E2E's hosts file and trust store, from CHIMI_MIHON_JVM_ARGS).
 */
export function registerMihon({ app, ipcMain, net, isApp, hostDir, jvmArgs = [] }) {
  const dir = join(app.getPath('userData'), 'mihon');
  const jreDir = join(dir, 'jre');
  const extDir = join(dir, 'ext');
  let host = null;
  let downloading = null;

  const platform = `${process.platform}-${process.arch}`;
  const hostReady = () =>
    existsSync(hostDir) && readdirSync(hostDir).some((f) => f.endsWith('.jar'));

  function javaPath() {
    if (!existsSync(jreDir)) return '';
    const exe = process.platform === 'win32' ? 'java.exe' : 'java';
    for (const top of readdirSync(jreDir)) {
      for (const bin of ['bin', 'Contents/Home/bin']) {
        const path = join(jreDir, top, bin, exe);
        if (existsSync(path)) return path;
      }
    }
    return '';
  }

  const status = () => ({
    supported: !!JRE[platform],
    host: hostReady(),
    jre: !!javaPath(),
    downloading
  });

  /** A download through the app's network stack, redirects followed (GitHub → its CDN). */
  async function download(url, maxBytes, onProgress) {
    if (!url.startsWith('https://')) throw new Error('Only https addresses');
    const response = await net.fetch(url, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const total = Number(response.headers.get('Content-Length') || 0);
    if (total > maxBytes) throw new Error('Too big');
    const chunks = [];
    let received = 0;
    for await (const chunk of response.body) {
      received += chunk.byteLength;
      if (received > maxBytes) throw new Error('Too big');
      chunks.push(chunk);
      onProgress?.(received, total);
    }
    return Buffer.concat(chunks);
  }

  async function installJre(event) {
    const pinned = JRE[platform];
    if (!pinned) throw new Error(`No Java runtime for ${platform}`);
    if (javaPath()) return status();
    if (downloading) throw new Error('Already downloading');
    const [file, pin] = pinned;
    downloading = { received: 0, total: 0 };
    try {
      const body = await download(JRE_BASE + file, 200 * 1024 * 1024, (received, total) => {
        downloading = { received, total };
        if (!event.sender.isDestroyed()) event.sender.send('mihon-progress', downloading);
      });
      if (sha256(body) !== pin)
        throw new Error('The Java download doesn’t match its pin (SHA-256)');
      mkdirSync(dir, { recursive: true });
      const archive = join(dir, file);
      const unpacked = join(dir, 'jre-new');
      await rm(unpacked, { recursive: true, force: true });
      mkdirSync(unpacked);
      await writeFile(archive, body);
      try {
        // bsdtar on Windows 10+ and macOS reads zip too; GNU tar on Linux gets the tar.gz.
        await new Promise((resolve, reject) =>
          execFile('tar', ['-xf', archive, '-C', unpacked], (error) =>
            error ? reject(error) : resolve()
          )
        );
      } finally {
        await unlink(archive).catch(() => undefined);
      }
      await rm(jreDir, { recursive: true, force: true });
      await rename(unpacked, jreDir);
      if (!javaPath()) throw new Error('The Java download has no java program');
      return status();
    } finally {
      downloading = null;
    }
  }

  async function removeJre() {
    stop();
    await rm(jreDir, { recursive: true, force: true });
    return status();
  }

  function stop() {
    if (!host) return;
    const old = host;
    host = null;
    clearTimeout(old.idle);
    old.child.kill('SIGKILL');
    for (const { reject, timer } of old.waiting.values()) {
      clearTimeout(timer);
      reject(new Error('The Mihon host stopped'));
    }
  }

  function start() {
    const java = javaPath();
    if (!java) throw new Error('Turn on Mihon extensions in Settings first (it downloads Java)');
    if (!hostReady()) throw new Error('This build of the app has no Mihon host');
    const data = join(dir, 'data');
    mkdirSync(data, { recursive: true });
    const child = spawn(
      java,
      [
        '-Xmx256m',
        '-XX:+UseSerialGC',
        '-XX:TieredStopAtLevel=1',
        `-Dmihon.data=${data}`,
        ...jvmArgs,
        '-cp',
        join(hostDir, '*'),
        'moe.chimimouryou.mihon.MainKt'
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    );
    const started = { child, waiting: new Map(), loaded: new Set(), next: 1, idle: null };
    started.ready = new Promise((resolve, reject) => {
      started.readyResolve = resolve;
      child.once('error', reject);
    });
    child.stderr.on('data', () => undefined);
    child.on('exit', () => host === started && stop());
    createInterface({ input: child.stdout }).on('line', (line) => {
      let answer;
      try {
        answer = JSON.parse(line);
      } catch {
        return;
      }
      if (answer.ready) return started.readyResolve();
      const call = started.waiting.get(answer.id);
      if (!call) return;
      started.waiting.delete(answer.id);
      clearTimeout(call.timer);
      if ('error' in answer) call.reject(new Error(String(answer.error)));
      else call.resolve(answer.result);
    });
    host = started;
    return started;
  }

  async function send(op, params) {
    const current = host ?? start();
    await current.ready;
    clearTimeout(current.idle);
    const id = current.next++;
    const result = await new Promise((resolve, reject) => {
      // A thread inside the JVM can't be stopped: a call that hangs restarts the host.
      const timer = setTimeout(
        () => {
          reject(new Error('The extension took too long'));
          if (host === current) stop();
        },
        op === 'pages' ? PAGES_MS : CALL_MS
      );
      current.waiting.set(id, { resolve, reject, timer });
      current.child.stdin.write(JSON.stringify({ id, op, ...params }) + '\n');
    });
    if (host === current && !current.waiting.size) {
      current.idle = setTimeout(() => host === current && stop(), IDLE_MS);
    }
    return result;
  }

  async function installJar(_event, url) {
    const body = await download(String(url), MAX_JAR);
    const pin = sha256(body);
    mkdirSync(extDir, { recursive: true });
    await writeFile(join(extDir, `${pin}.jar`), body);
    return { sha256: pin };
  }

  /** Loads the pinned jar into the host (once per host run): its sources. */
  async function load(pin) {
    if (!/^[0-9a-f]{64}$/.test(pin)) throw new Error('Not a pin');
    const path = join(extDir, `${pin}.jar`);
    const body = await readFile(path).catch(() => null);
    if (!body || sha256(body) !== pin) {
      throw new Error('This extension’s stored code is damaged: tap Update in its repository');
    }
    const current = host ?? start();
    const answer = await send('load', { jar: path });
    current.loaded.add(pin);
    return answer;
  }

  /** Image files the host wrote: read into the answer, then deleted. */
  async function images(files) {
    const out = [];
    for (const file of files) {
      out.push({ type: file.type, body: await readFile(file.path) });
      await unlink(file.path).catch(() => undefined);
    }
    return out;
  }

  async function call(_event, pin, op, params = {}) {
    if (!['popular', 'latest', 'search', 'detail', 'pages', 'image'].includes(op)) {
      throw new Error(`Unknown op ${op}`);
    }
    if (!host?.loaded.has(pin)) await load(pin);
    const result = await send(op, params);
    if (op === 'pages') return { files: await images(result.files) };
    if (op === 'image') return (await images([result]))[0];
    return result;
  }

  const guarded =
    (fn) =>
    (event, ...args) => {
      if (!isApp(event)) throw new Error('Not the app');
      return fn(event, ...args);
    };
  ipcMain.handle('mihon-status', guarded(status));
  ipcMain.handle('mihon-install-jre', guarded(installJre));
  ipcMain.handle('mihon-remove-jre', guarded(removeJre));
  ipcMain.handle('mihon-install', guarded(installJar));
  ipcMain.handle(
    'mihon-load',
    guarded((_event, pin) => load(String(pin)))
  );
  ipcMain.handle('mihon-call', guarded(call));
  app.on('before-quit', stop);
}
