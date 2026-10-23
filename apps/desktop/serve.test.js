/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveFile } from './serve.js';

test('resolveFile maps pages and stays in the root', () => {
  const base = mkdtempSync(join(tmpdir(), 'serve-'));
  const root = join(base, 'web');
  mkdirSync(join(root, 'b'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '');
  writeFileSync(join(root, 'auth.html'), '');
  writeFileSync(join(root, 'b', 'index.html'), '');
  writeFileSync(join(base, 'secret.txt'), '');

  assert.equal(resolveFile(root, '/'), join(root, 'index.html'));
  assert.equal(resolveFile(root, '/auth'), join(root, 'auth.html'));
  assert.equal(resolveFile(root, '/b/'), join(root, 'b', 'index.html'));
  assert.equal(resolveFile(root, '/manage'), undefined);
  assert.equal(resolveFile(root, '/../secret.txt'), undefined);
  assert.equal(resolveFile(root, '/%2e%2e/secret.txt'), undefined);
  assert.equal(resolveFile(root, '/..%5csecret.txt'), undefined);
  assert.equal(resolveFile(root, '/%E0%A4%A'), undefined);
});
