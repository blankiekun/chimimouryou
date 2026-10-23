/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Friends on the social hub as a plugin (on by default): Settings → Social, and the status
 * push while reading. Home's Social section and /friends check that it is on. Not part of upstream.
 */

import SettingsSocial from '$lib/components/settings/settings-social.svelte';
import { noteReading } from '$lib/data/social';
import type { Plugin } from '$lib/plugins';

export const socialPlugin: Plugin = {
  id: 'social',
  name: 'prefs.plugins.social',
  description: 'prefs.plugins.socialHint',
  settingsArea: 'social',
  settings: SettingsSocial,
  onPositionSettled: (title, _getIndex, position, characters) =>
    noteReading(title, position, characters),
  onBookLeft: (title, position, characters) => noteReading(title, position, characters, true)
};
