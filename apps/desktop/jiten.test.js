/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jitenTarget } from './jiten.js';

const target = (path) => jitenTarget(new URL(path, 'http://127.0.0.1:41917'));

test('jitenTarget maps the three paths and nothing else', () => {
  assert.equal(
    target('/jiten/search?titleFilter=%E3%81%82'),
    'https://api.jiten.moe/api/media-deck/get-media-decks?titleFilter=%E3%81%82'
  );
  assert.equal(
    target('/jiten/api/media-deck/by-link-id/2/v17'),
    'https://api.jiten.moe/api/media-deck/by-link-id/2/v17'
  );
  assert.equal(
    target('/jiten/api/media-deck/42/detail?pageSize=1'),
    'https://api.jiten.moe/api/media-deck/42/detail?pageSize=1'
  );
  assert.equal(target('/jiten/api/user/me'), undefined);
  assert.equal(target('/jiten/api/media-deck/42/detail/../../user'), undefined);
});
