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
  description?: MessageKey;
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
        label: 'settings.section.general-language'
      },
      {
        id: 'general-theme',
        label: 'settings.section.general-theme'
      },
      // The standalone edition is a web app people install; the server edition is reached by URL.
      ...(standalone
        ? [
            {
              id: 'general-install',
              label: 'settings.section.general-install' as const
            },
            {
              id: 'general-analysis',
              label: 'settings.section.general-analysis' as const
            }
          ]
        : []),
      {
        id: 'general-plugins',
        label: 'settings.section.general-plugins'
      }
    ]
  },
  {
    id: 'reader',
    label: 'settings.area.reader',
    sections: [
      {
        id: 'reader-text',
        label: 'settings.section.reader-text'
      },
      {
        id: 'reader-writing',
        label: 'settings.section.reader-writing'
      },
      {
        id: 'reader-layout',
        label: 'settings.section.reader-layout'
      },
      {
        id: 'reader-progress',
        label: 'settings.section.reader-progress'
      },
      {
        id: 'reader-navigation',
        label: 'settings.section.reader-navigation'
      },
      {
        id: 'reader-session',
        label: 'settings.section.reader-session'
      }
    ]
  },
  // The built-in dictionary (lib/data/dictionary.ts), in Yomitan's own sections.
  {
    id: 'dictionary',
    label: 'settings.area.dictionary',
    description: 'settings.area.dictionary.text',
    sections: [
      {
        id: 'dictionary-general',
        label: 'settings.section.dictionary-general'
      },
      {
        id: 'dictionary-dictionaries',
        label: 'settings.section.dictionary-dictionaries'
      },
      {
        id: 'dictionary-popup',
        label: 'settings.section.dictionary-popup'
      },
      {
        id: 'dictionary-scanning',
        label: 'settings.section.dictionary-scanning'
      },
      {
        id: 'dictionary-translation',
        label: 'settings.section.dictionary-translation'
      },
      {
        id: 'dictionary-audio',
        label: 'settings.section.dictionary-audio'
      },
      {
        id: 'dictionary-shortcuts',
        label: 'settings.section.dictionary-shortcuts'
      },
      {
        id: 'dictionary-backup',
        label: 'settings.section.dictionary-backup'
      }
    ]
  },
  {
    id: 'ai',
    label: 'settings.area.ai',
    sections: [
      {
        id: 'ai-connections',
        label: 'settings.section.ai-connections'
      },
      {
        id: 'ai-features',
        label: 'settings.section.ai-features'
      },
      {
        id: 'ai-presets',
        label: 'settings.section.ai-presets'
      },
      {
        id: 'ai-prompts',
        label: 'settings.section.ai-prompts'
      },
      {
        id: 'ai-read-aloud',
        label: 'settings.section.ai-read-aloud'
      },
      {
        id: 'ai-syncs',
        label: 'settings.section.ai-syncs',
        description: 'settings.section.ai-syncs.text'
      },
      {
        id: 'ai-guide',
        label: 'settings.section.ai-guide'
      }
    ]
  },
  {
    id: 'audiobookshelf',
    label: 'settings.area.audiobookshelf',
    sections: [
      {
        id: 'audiobookshelf-connect',
        label: 'settings.section.audiobookshelf-connect'
      }
    ]
  },
  {
    id: 'social',
    label: 'settings.area.social',
    sections: [
      {
        id: 'social-features',
        label: 'settings.section.social-features',
        description: 'settings.section.social-features.text'
      },
      {
        id: 'social-account',
        label: 'settings.section.social-account',
        description: 'settings.section.social-account.text'
      },
      {
        id: 'social-profile',
        label: 'settings.section.social-profile'
      },
      {
        id: 'social-shows',
        label: 'settings.section.social-shows',
        description: 'settings.section.social-shows.text'
      },
      {
        id: 'social-hub',
        label: 'settings.section.social-hub'
      }
    ]
  },
  {
    id: 'discord',
    label: 'settings.area.discord',
    description: 'settings.area.discord.text',
    sections: [
      {
        id: 'discord-connection',
        label: 'settings.section.discord-connection'
      },
      {
        id: 'discord-activities',
        label: 'settings.section.discord-activities',
        description: 'settings.section.discord-activities.text'
      },
      {
        id: 'discord-away',
        label: 'settings.section.discord-away'
      }
    ]
  },
  {
    id: 'anki',
    label: 'settings.area.anki',
    sections: [
      {
        id: 'anki-connect',
        label: 'settings.section.anki-connect'
      },
      {
        id: 'anki-dictionary',
        label: 'settings.section.anki-dictionary'
      },
      {
        id: 'anki-media',
        label: 'settings.section.anki-media'
      }
    ]
  },
  {
    id: 'tracking',
    label: 'settings.area.tracking',
    sections: [
      {
        id: 'tracking-statistics',
        label: 'settings.section.tracking-statistics'
      },
      {
        id: 'tracking-day',
        label: 'settings.section.tracking-day'
      },
      {
        id: 'tracking-merge',
        label: 'settings.section.tracking-merge'
      },
      {
        id: 'tracking-goals',
        label: 'settings.section.tracking-goals'
      }
    ]
  },
  // The standalone edition has no server: Sync (storage, status, backup) replaces Data.
  standalone
    ? {
        id: 'sync',
        label: 'settings.area.sync',
        sections: [
          {
            id: 'sync-storage',
            label: 'settings.section.sync-storage'
          },
          {
            id: 'sync-status',
            label: 'settings.section.sync-status'
          },
          {
            id: 'sync-backup',
            label: 'settings.section.sync-backup',
            description: 'settings.section.sync-backup.text'
          },
          {
            id: 'sync-server',
            label: 'settings.section.sync-server'
          },
          {
            id: 'sync-selfhost',
            label: 'settings.section.sync-selfhost'
          }
        ]
      }
    : {
        id: 'data',
        label: 'settings.area.data',
        sections: [
          {
            id: 'data-storage',
            label: 'settings.section.data-storage'
          },
          {
            id: 'data-import',
            label: 'settings.section.data-import'
          },
          {
            id: 'data-sync',
            label: 'settings.section.data-sync'
          },
          {
            id: 'data-sources',
            label: 'settings.section.data-sources'
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
  AI: 'ai-connections'
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
