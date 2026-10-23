/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** The AI tools (Ask AI, Story so far, Lorebook, AI voice) as a plugin. Not part of upstream. */

import {
  faBookAtlas,
  faBookOpen,
  faRobot,
  faWandMagicSparkles
} from '@fortawesome/free-solid-svg-icons';
import AskAiPanel from '$lib/components/book-reader/ask-ai-panel.svelte';
import LorebookPanel from '$lib/components/book-reader/lorebook-panel.svelte';
import RecapPanel from '$lib/components/book-reader/recap-panel.svelte';
import TtsPlayer from '$lib/components/book-reader/tts-player.svelte';
import SettingsAi from '$lib/components/settings/settings-ai.svelte';
import { featureReady } from '$lib/data/ai-connections';
import { syncExtras } from '$lib/data/extras-sync';
import { autoUpdateLorebook } from '$lib/data/lorebook';
import { synthesizeSpeech } from '$lib/data/tts';
import type { Plugin } from '$lib/plugins';

export const aiPlugin: Plugin = {
  id: 'ai',
  name: 'prefs.plugins.ai',
  description: 'prefs.plugins.aiHint',
  settingsArea: 'ai',
  settings: SettingsAi,
  companionTabs: [
    {
      key: 'recap',
      label: 'reader.recap',
      icon: faBookOpen,
      component: RecapPanel,
      props: ({ title, getIndex, sections, position, bookCharacters, active }) => ({
        title,
        getIndex,
        sections,
        position,
        bookCharacters,
        active
      }),
      pausesTracker: true,
      offerAfterAbsence: () => featureReady('recap')
    },
    {
      key: 'lorebook',
      label: 'reader.lorebook',
      icon: faBookAtlas,
      component: LorebookPanel,
      props: ({ title, getIndex, position }) => ({ title, getIndex, position })
    }
  ],
  selectionActions: [
    {
      label: 'reader.askAi',
      title: 'reader.askAiTitle',
      icon: faWandMagicSparkles,
      panel: AskAiPanel
    }
  ],
  listenModes: [
    {
      key: 'voice',
      title: 'reader.aiVoice',
      icon: faRobot,
      component: TtsPlayer,
      props: ({ elementHtml, startCharCount }) => ({ elementHtml, startCharCount })
    }
  ],
  onPositionSettled(title, getIndex, position) {
    // Start from another device's progress, if newer.
    syncExtras('lorebook', title).then(() => autoUpdateLorebook(title, getIndex, position));
  },
  ankiSentenceAudio: async (sentence) => (await synthesizeSpeech(sentence)).audio
};
