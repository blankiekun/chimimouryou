/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// The real mihon.js on a real folder, only the download stubbed. Ways an Update could lose code:
// - a failed download or write removes the old jar, so the extension stops working
// - `replaces` from the page names a path outside ext/, or anything but a pin, and that file goes
// - the index republishes the same bytes (new pin = old pin): the only copy is deleted
// - `replaces` left out still deletes something (another row can hold that pin; the page decides)
// - an old jar that can't be deleted (Windows, a running host has it open) fails the update
// - an old jar that is already gone fails the update
// Ways removing a repository's jar could go wrong:
// - the pin from the page names a path outside ext/, or anything but a pin, and that file goes
// - a jar that can't be deleted (Windows, a running host has it open) or is already gone fails the removal
/* global Response -- Node's fetch classes */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { registerMihon } from './mihon.js';

const pinOf = (text) => createHash('sha256').update(text).digest('hex');
const OLD = pinOf('old');
const NEW = pinOf('new');

function setup(t, respond = () => new Response('new')) {
  const root = mkdtempSync(join(tmpdir(), 'mihon-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const handlers = {};
  const fetches = [];
  registerMihon({
    app: { getPath: () => root, on: () => undefined },
    ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
    net: {
      fetch: async (url) => {
        fetches.push(url);
        return respond();
      }
    },
    isApp: () => true,
    hostDir: join(root, 'host')
  });
  const ext = join(root, 'mihon', 'ext');
  mkdirSync(ext, { recursive: true });
  const jar = (pin) => join(ext, `${pin}.jar`);
  writeFileSync(jar(OLD), 'old');
  const install = (replaces) =>
    handlers['mihon-install']({}, 'https://repo.example/new.jar', replaces);
  const remove = (pin) => handlers['mihon-remove']({}, pin);
  return { root, ext, jar, install, remove, fetches };
}

test('the new jar in place, the old one goes', async (t) => {
  const { jar, install } = setup(t);
  assert.deepEqual(await install(OLD), { sha256: NEW });
  assert.ok(existsSync(jar(NEW)));
  assert.ok(!existsSync(jar(OLD)));
});

test('without replaces nothing goes', async (t) => {
  const { jar, install } = setup(t);
  await install(undefined);
  assert.ok(existsSync(jar(OLD)));
});

test('a failed download leaves the old jar', async (t) => {
  const { jar, install } = setup(t, () => new Response('nope', { status: 500 }));
  await assert.rejects(install(OLD));
  assert.ok(existsSync(jar(OLD)));
});

test('a new jar that cannot be written leaves the old jar', async (t) => {
  const { jar, install } = setup(t);
  mkdirSync(jar(NEW)); // writeFile fails on it
  await assert.rejects(install(OLD));
  assert.ok(existsSync(jar(OLD)));
});

test('replaces must be a pin: refused before anything is downloaded or deleted', async (t) => {
  const { root, jar, install, fetches } = setup(t);
  const outside = join(root, 'secret.jar');
  writeFileSync(outside, 'secret');
  for (const bad of [
    '../../secret',
    `../ext/${OLD}`,
    `${OLD}/../../../secret`,
    OLD.toUpperCase(),
    OLD.slice(1),
    `${OLD}\n`,
    [`../../secret`]
  ]) {
    await assert.rejects(install(bad), /Not a pin/, String(bad));
  }
  assert.deepEqual(fetches, []);
  assert.ok(existsSync(outside));
  assert.ok(existsSync(jar(OLD)));
});

test('the same bytes published again keep their only copy', async (t) => {
  const { jar, install } = setup(t, () => new Response('old'));
  assert.deepEqual(await install(OLD), { sha256: OLD });
  assert.ok(existsSync(jar(OLD)));
});

test('an old jar already gone, or one that cannot be deleted, still updates', async (t) => {
  const { jar, install } = setup(t);
  rmSync(jar(OLD));
  assert.deepEqual(await install(OLD), { sha256: NEW });

  const held = setup(t);
  rmSync(held.jar(OLD));
  mkdirSync(join(held.jar(OLD), 'inside'), { recursive: true }); // rm without recursive fails on it
  assert.deepEqual(await held.install(OLD), { sha256: NEW });
  assert.ok(existsSync(held.jar(NEW)));
});

test('remove deletes only the pinned jar', async (t) => {
  const { jar, install, remove } = setup(t);
  await install(undefined);
  await remove(OLD);
  assert.ok(!existsSync(jar(OLD)));
  assert.ok(existsSync(jar(NEW)));
});

test('remove must be given a pin: refused with nothing deleted', async (t) => {
  const { root, jar, remove } = setup(t);
  const outside = join(root, 'secret.jar');
  writeFileSync(outside, 'secret');
  for (const bad of [
    '../../secret',
    `../ext/${OLD}`,
    `${OLD}/../../../secret`,
    OLD.toUpperCase(),
    `${OLD}\n`,
    '',
    undefined,
    [OLD]
  ]) {
    await assert.rejects(remove(bad), /Not a pin/, String(bad));
  }
  assert.ok(existsSync(outside));
  assert.ok(existsSync(jar(OLD)));
});

test('a jar already gone, or one that cannot be deleted, still removes', async (t) => {
  const { jar, remove } = setup(t);
  rmSync(jar(OLD));
  await remove(OLD);
  mkdirSync(join(jar(OLD), 'inside'), { recursive: true }); // rm without recursive fails on it
  await remove(OLD);
});
