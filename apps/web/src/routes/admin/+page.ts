/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { redirect } from '@sveltejs/kit';
import { pagePath, standalone } from '$lib/data/env';

// The admin panel manages a chimimouryou server; the standalone edition has none.
export function load() {
  if (standalone) redirect(307, `${pagePath}/manage`);
}
