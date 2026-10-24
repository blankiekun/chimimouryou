/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNewerVersion } from './version.js';

test('offers only a higher release', () => {
  assert.equal(isNewerVersion('v0.2.0', '0.1.9'), true);
  assert.equal(isNewerVersion('v0.10.0', '0.9.0'), true);
  assert.equal(isNewerVersion('v1.0.0', '1.0.0'), false);
  assert.equal(isNewerVersion('v0.1.0', '0.2.0'), false);
  assert.equal(isNewerVersion('nightly', '0.1.0'), false);
});
