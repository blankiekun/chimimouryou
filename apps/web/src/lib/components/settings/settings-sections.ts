/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Settings navigation (sidebar areas and their sections), modeled on
 * app.yatsu.moe/settings. Section ids are the anchors in the URL:
 * /settings?section=<area>#<section id>. Labels and descriptions are i18n keys
 * (`$t$(label)` where shown). Not part of upstream.
 */

import { getContext, setContext } from 'svelte';
import type { Writable } from 'svelte/store';
import type { MessageKey } from '$lib/i18n';
import { standalone } from '$lib/data/env';

export interface SettingsSectionInfo {
  id: string;
  label: MessageKey;
  description: MessageKey;
}

export interface SettingsArea {
  id: string;
  label: MessageKey;
  /** Shown under the area's title */
  description?: MessageKey;
  sections: SettingsSectionInfo[];
}

export const settingsAreas: SettingsArea[] = [
  {
    id: 'general',
    label: 'settings.area.general',
    sections: [
      // Accounts live on a chimimouryou server; the standalone edition has none.
      ...(standalone
        ? []
        : [
            {
              id: 'general-account',
              label: 'settings.section.general-account' as const,
              description: 'settings.section.general-account.text' as const
            }
          ]),
      {
        id: 'general-language',
        label: 'settings.section.general-language',
        description: 'settings.section.general-language.text'
      },
      {
        id: 'general-theme',
        label: 'settings.section.general-theme',
        description: 'settings.section.general-theme.text'
      },
      // The standalone edition is a web app people install; the server edition is reached by URL.
      ...(standalone
        ? [
            {
              id: 'general-install',
              label: 'settings.section.general-install' as const,
              description: 'settings.section.general-install.text' as const
            },
            {
              id: 'general-analysis',
              label: 'settings.section.general-analysis' as const,
              description: 'settings.section.general-analysis.text' as const
            }
          ]
        : []),
      {
        id: 'general-plugins',
        label: 'settings.section.general-plugins',
        description: 'settings.section.general-plugins.text'
      }
    ]
  },
  {
    id: 'reader',
    label: 'settings.area.reader',
    sections: [
      {
        id: 'reader-text',
        label: 'settings.section.reader-text',
        description: 'settings.section.reader-text.text'
      },
      {
        id: 'reader-writing',
        label: 'settings.section.reader-writing',
        description: 'settings.section.reader-writing.text'
      },
      {
        id: 'reader-layout',
        label: 'settings.section.reader-layout',
        description: 'settings.section.reader-layout.text'
      },
      {
        id: 'reader-progress',
        label: 'settings.section.reader-progress',
        description: 'settings.section.reader-progress.text'
      },
      {
        id: 'reader-navigation',
        label: 'settings.section.reader-navigation',
        description: 'settings.section.reader-navigation.text'
      },
      {
        id: 'reader-session',
        label: 'settings.section.reader-session',
        description: 'settings.section.reader-session.text'
      }
    ]
  },
  {
    id: 'ai',
    label: 'settings.area.ai',
    description: 'settings.area.ai.text',
    sections: [
      {
        id: 'ai-guide',
        label: 'settings.section.ai-guide',
        description: 'settings.section.ai-guide.text'
      },
      {
        id: 'ai-ask',
        label: 'settings.section.ai-ask',
        description: 'settings.section.ai-ask.text'
      },
      {
        id: 'ai-presets',
        label: 'settings.section.ai-presets',
        description: 'settings.section.ai-presets.text'
      },
      {
        id: 'ai-prompts',
        label: 'settings.section.ai-prompts',
        description: 'settings.section.ai-prompts.text'
      },
      {
        id: 'ai-voice',
        label: 'settings.section.ai-voice',
        description: 'settings.section.ai-voice.text'
      },
      {
        id: 'ai-read-aloud',
        label: 'settings.section.ai-read-aloud',
        description: 'settings.section.ai-read-aloud.text'
      },
      {
        id: 'ai-recap',
        label: 'settings.section.ai-recap',
        description: 'settings.section.ai-recap.text'
      },
      {
        id: 'ai-syncs',
        label: 'settings.section.ai-syncs',
        description: 'settings.section.ai-syncs.text'
      }
    ]
  },
  {
    id: 'audiobookshelf',
    label: 'settings.area.audiobookshelf',
    sections: [
      {
        id: 'audiobookshelf-connect',
        label: 'settings.section.audiobookshelf-connect',
        description: 'settings.section.audiobookshelf-connect.text'
      }
    ]
  },
  {
    id: 'anki',
    label: 'settings.area.anki',
    description: 'settings.area.anki.text',
    sections: [
      {
        id: 'anki-connect',
        label: 'settings.section.anki-connect',
        description: 'settings.section.anki-connect.text'
      },
      {
        id: 'anki-media',
        label: 'settings.section.anki-media',
        description: 'settings.section.anki-media.text'
      }
    ]
  },
  {
    id: 'tracking',
    label: 'settings.area.tracking',
    sections: [
      {
        id: 'tracking-statistics',
        label: 'settings.section.tracking-statistics',
        description: 'settings.section.tracking-statistics.text'
      },
      {
        id: 'tracking-day',
        label: 'settings.section.tracking-day',
        description: 'settings.section.tracking-day.text'
      },
      {
        id: 'tracking-merge',
        label: 'settings.section.tracking-merge',
        description: 'settings.section.tracking-merge.text'
      },
      {
        id: 'tracking-goals',
        label: 'settings.section.tracking-goals',
        description: 'settings.section.tracking-goals.text'
      }
    ]
  },
  // The standalone edition has no server: Sync (storage, status, backup) replaces Data.
  standalone
    ? {
        id: 'sync',
        label: 'settings.area.sync',
        description: 'settings.area.sync.text',
        sections: [
          {
            id: 'sync-storage',
            label: 'settings.section.sync-storage',
            description: 'settings.section.sync-storage.text'
          },
          {
            id: 'sync-status',
            label: 'settings.section.sync-status',
            description: 'settings.section.sync-status.text'
          },
          {
            id: 'sync-backup',
            label: 'settings.section.sync-backup',
            description: 'settings.section.sync-backup.text'
          },
          {
            id: 'sync-server',
            label: 'settings.section.sync-server',
            description: 'settings.section.sync-server.text'
          },
          {
            id: 'sync-selfhost',
            label: 'settings.section.sync-selfhost',
            description: 'settings.section.sync-selfhost.text'
          }
        ]
      }
    : {
        id: 'data',
        label: 'settings.area.data',
        sections: [
          {
            id: 'data-storage',
            label: 'settings.section.data-storage',
            description: 'settings.section.data-storage.text'
          },
          {
            id: 'data-import',
            label: 'settings.section.data-import',
            description: 'settings.section.data-import.text'
          },
          {
            id: 'data-sync',
            label: 'settings.section.data-sync',
            description: 'settings.section.data-sync.text'
          },
          {
            id: 'data-sources',
            label: 'settings.section.data-sources',
            description: 'settings.section.data-sources.text'
          }
        ]
      }
];

export const settingsSections = settingsAreas.flatMap((area, areaIndex) =>
  area.sections.map((section, index) => ({
    ...section,
    area: area.id,
    areaLabel: area.label,
    order: areaIndex * 100 + index,
    /** Numbered tag of the section head (01, 02… within the area) */
    number: index + 1
  }))
);

export function findSettingsSection(id: string) {
  return settingsSections.find((section) => section.id === id);
}

/** Old ?tab= links (the previous tab names) */
const legacySettingsTabs: Record<string, string> = {
  Reader: 'reader-text',
  Themes: 'general-theme',
  Data: 'data-storage',
  Statistics: 'tracking-statistics',
  AI: 'ai-ask'
};

export function isFirstSectionOfArea(id: string) {
  return settingsAreas.some((area) => area.sections[0].id === id);
}

/** Old links to Settings → Anki → Known Words, which is the Words page now. */
export function isKnownWordsLink(url: URL) {
  return url.hash === '#anki-known' || url.searchParams.get('section') === 'anki-known';
}

/** Sections merged into another one; old links still lead there. */
const movedSections: Record<string, string> = { 'general-custom-themes': 'general-theme' };

/** Section from #section-id, ?section=<area or section id> or a legacy ?tab=. */
export function sectionFromUrl(url: URL) {
  const section = url.searchParams.get('section') || '';
  const tab = url.searchParams.get('tab') || '';

  return (
    findSettingsSection(movedSections[url.hash.slice(1)] || url.hash.slice(1)) ||
    findSettingsSection(movedSections[section] || section) ||
    settingsSections.find((candidate) => candidate.area === section) ||
    findSettingsSection(legacySettingsTabs[tab] || '')
  );
}

export interface SettingsView {
  area: string;
  query: string;
}

const contextKey = Symbol('settings-view');

export function setSettingsView(view: Writable<SettingsView>) {
  setContext(contextKey, view);
}

export function getSettingsView(): Writable<SettingsView> | undefined {
  return getContext(contextKey);
}
