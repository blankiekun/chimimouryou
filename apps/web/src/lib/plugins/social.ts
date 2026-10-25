/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Friends on the social hub as a plugin (on by default): Settings → Social, the status push while
 * reading, and Community in the reader (its panel tab and Post to community on a selection).
 * Home's Social section, /friends and /community check that it is on. Not part of upstream.
 */

import { faComments } from '@fortawesome/free-solid-svg-icons';
import CommunityComposer from '$lib/components/community/community-composer.svelte';
import CommunityPanel from '$lib/components/community/community-panel.svelte';
import SettingsSocial from '$lib/components/settings/settings-social.svelte';
import { markBookOnOpen } from '$lib/data/community-book';
import { noteReading } from '$lib/data/social';
import type { Plugin } from '$lib/plugins';

export const socialPlugin: Plugin = {
  id: 'social',
  name: 'prefs.plugins.social',
  description: 'prefs.plugins.socialHint',
  settingsArea: 'social',
  settings: SettingsSocial,
  companionTabs: [
    {
      key: 'community',
      label: 'nav.community',
      icon: faComments,
      component: CommunityPanel,
      props: ({ title, getIndex, sections, position, bookCharacters, active }) => ({
        title,
        getIndex,
        sections,
        position,
        bookCharacters,
        active
      })
    }
  ],
  selectionActions: [
    {
      label: 'community.postAction',
      title: 'community.postActionTitle',
      icon: faComments,
      panel: CommunityComposer
    }
  ],
  onBookOpened: (title, getIndex) => markBookOnOpen(title, getIndex).catch(() => {}),
  onPositionSettled: (title, _getIndex, position, characters) =>
    noteReading(title, position, characters),
  onBookLeft: (title, position, characters) => noteReading(title, position, characters, true)
};
