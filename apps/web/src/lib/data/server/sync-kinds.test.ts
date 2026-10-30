/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
// The server's list of sync kinds (server/api/sync-kinds.json: apidb.py, service.py and migrate.py
// read it, test_api_service.py checks its routes).
import kindsJson from '../../../../../server/api/sync-kinds.json?raw';
import { syncKinds } from './server-rows';

describe('sync kinds', () => {
  // Bug: a kind added on one side only. A file missing here is never written to the server while
  // Drive and folders sync it; a kind missing there answers 404 to every write.
  it('are the server’s', () => {
    expect(syncKinds).toEqual(JSON.parse(kindsJson));
  });
});
