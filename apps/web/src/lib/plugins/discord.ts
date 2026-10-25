/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Discord status (off by default): Settings → Discord, and what the readers and the library
 * report, sent to the chimimouryou add-on in Anki (lib/data/discord.ts). Not part of upstream.
 */

import SettingsDiscord from '$lib/components/settings/discord/settings-discord.svelte';
import { discordActivity } from '$lib/data/discord';
import type { Plugin } from '$lib/plugins';

export const discordPlugin: Plugin = {
  id: 'discord',
  name: 'prefs.plugins.discord',
  description: 'prefs.plugins.discordHint',
  settingsArea: 'discord',
  settings: SettingsDiscord,
  onReadingActivity: discordActivity
};
