/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { browser } from '$app/env';
import { loadUiLanguage } from '$lib/i18n';

// The UI's Japanese strings are a separate chunk: wait for them so the first render has them.
export const load = async () => {
  if (browser) await loadUiLanguage();
};
