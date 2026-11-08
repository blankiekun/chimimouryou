/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Smoke test of the packaged app's start in a Wayland session: with the game overlay off (the app
// runs on Wayland) and on (main.js restarts it on X11 through XWayland). In CI after "Package".
//
//   weston --backend=headless --xwayland --socket=wayland-e2e &   (DISPLAY: its socket in /tmp/.X11-unix)
//   WAYLAND_DISPLAY=wayland-e2e DISPLAY=:0 node e2e/wayland.e2e.mjs [path to the app's binary]
//
// It fails when: the GPU process crashes or draws to the wrong platform (an X11 GPU process
// under a Wayland browser: no window shows), the app exits on its own, or with the overlay on it
// runs on Wayland or shows no X11 window.

import { execFileSync, spawn } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const binary = process.argv[2] ?? join(import.meta.dirname, '../dist/linux-unpacked/chimimouryou');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const x11Windows = () => {
  try {
    return execFileSync('xdotool', ['search', '--onlyvisible', '--classname', 'chimimouryou'])
      .toString()
      .split('\n')
      .filter(Boolean);
  } catch {
    return []; // xdotool exits 1 when nothing matches
  }
};

if (!process.env.WAYLAND_DISPLAY) throw new Error('WAYLAND_DISPLAY is unset: start Weston first');

async function start(overlay) {
  const root = mkdtempSync(join(tmpdir(), 'chimi-wayland-'));
  const profile = join(root, 'chimimouryou');
  mkdirSync(profile);
  writeFileSync(join(profile, 'native-games.json'), JSON.stringify({ overlay: { on: overlay } }));
  const logFile = join(root, 'app.log');
  const out = openSync(logFile, 'w');
  // The restarted app inherits these descriptors, so its log lands in the same file.
  const app = spawn(binary, ['--no-sandbox', '--enable-logging=stderr'], {
    env: { ...process.env, XDG_CONFIG_HOME: root, XDG_SESSION_TYPE: 'wayland' },
    stdio: ['ignore', out, out]
  });
  await wait(15_000);
  // The instance running now (the restarted one with the overlay on) owns the profile's lock.
  let pid;
  try {
    pid = Number(readlinkSync(join(profile, 'SingletonLock')).split('-').pop());
  } catch {
    pid = undefined;
  }
  const windows = x11Windows();
  const running = pid !== undefined && alive(pid);
  for (const p of [pid, app.pid]) if (p && alive(p)) process.kill(p, 'SIGKILL');
  await wait(1_000);
  const log = readFileSync(logFile, 'utf8');
  rmSync(root, { recursive: true, force: true });
  return { log, windows, running };
}

const failures = [];
for (const overlay of [false, true]) {
  const name = `overlay ${overlay ? 'on' : 'off'}`;
  const { log, windows, running } = await start(overlay);
  const problems = [];
  if (!running) problems.push('the app is not running');
  if (/GPU process exited unexpectedly|GPU process has crashed/.test(log))
    problems.push('the GPU process crashed');
  if (/XGetWindowAttributes failed/.test(log)) problems.push('drawing went to the wrong platform');
  if (overlay && windows.length === 0) problems.push('no X11 window');
  if (!overlay && windows.length > 0) problems.push('it runs on X11 with the overlay off');
  console.log(`- ${name}: ${problems.length ? problems.join(', ') : 'ok'}`);
  if (problems.length) {
    failures.push(name);
    console.log(log.split('\n').slice(-40).join('\n'));
  }
}
if (failures.length) throw new Error(`Failed: ${failures.join('; ')}`);
