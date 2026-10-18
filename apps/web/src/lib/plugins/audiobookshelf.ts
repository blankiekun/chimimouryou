/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Audiobookshelf as a Listen source. Not part of upstream. */

import { faServer } from '@fortawesome/free-solid-svg-icons';
import AudiobookshelfPlayer from '$lib/components/book-reader/audiobookshelf-player.svelte';
import SettingsAudiobookshelf from '$lib/components/settings/settings-audiobookshelf.svelte';
import type { Plugin } from '$lib/plugins';

export const audiobookshelfPlugin: Plugin = {
  id: 'audiobookshelf',
  name: 'prefs.plugins.abs',
  description: 'prefs.plugins.absHint',
  settingsArea: 'audiobookshelf',
  settings: SettingsAudiobookshelf,
  listenModes: [
    {
      key: 'audiobookshelf',
      title: 'reader.audiobookshelf',
      icon: faServer,
      component: AudiobookshelfPlayer,
      props: ({ title, getIndex, position }) => ({ title, getIndex, position })
    }
  ]
};
