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

import {
  faBookOpen,
  faBookmark,
  faBullseye,
  faChartLine,
  faCircleInfo,
  faClockRotateLeft,
  faCodeMerge,
  faCommentDots,
  faDatabase,
  faDisplay,
  faFileImport,
  faFont,
  faHandPointer,
  faHardDrive,
  faHeadphones,
  faLanguage,
  faListUl,
  faNoteSticky,
  faPhotoFilm,
  faPlug,
  faPalette,
  faRotate,
  faServer,
  faSliders,
  faStopwatch,
  faSun,
  faSwatchbook,
  faTableColumns,
  faUser,
  faWandMagicSparkles
} from '@fortawesome/free-solid-svg-icons';
import { getContext, setContext } from 'svelte';
import type { Writable } from 'svelte/store';
import type { MessageKey } from '$lib/i18n';

type Icon = typeof faUser;

export interface SettingsSectionInfo {
  id: string;
  label: MessageKey;
  description: MessageKey;
  icon: Icon;
}

export interface SettingsArea {
  id: string;
  label: MessageKey;
  icon: Icon;
  sections: SettingsSectionInfo[];
}

export const settingsAreas: SettingsArea[] = [
  {
    id: 'general',
    label: 'settings.area.general',
    icon: faSliders,
    sections: [
      {
        id: 'general-account',
        label: 'settings.section.general-account',
        description: 'settings.section.general-account.text',
        icon: faUser
      },
      {
        id: 'general-language',
        label: 'settings.section.general-language',
        description: 'settings.section.general-language.text',
        icon: faLanguage
      },
      {
        id: 'general-theme',
        label: 'settings.section.general-theme',
        description: 'settings.section.general-theme.text',
        icon: faPalette
      },
      {
        id: 'general-custom-themes',
        label: 'settings.section.general-custom-themes',
        description: 'settings.section.general-custom-themes.text',
        icon: faSwatchbook
      },
      {
        id: 'general-plugins',
        label: 'settings.section.general-plugins',
        description: 'settings.section.general-plugins.text',
        icon: faPlug
      }
    ]
  },
  {
    id: 'reader',
    label: 'settings.area.reader',
    icon: faBookOpen,
    sections: [
      {
        id: 'reader-text',
        label: 'settings.section.reader-text',
        description: 'settings.section.reader-text.text',
        icon: faFont
      },
      {
        id: 'reader-writing',
        label: 'settings.section.reader-writing',
        description: 'settings.section.reader-writing.text',
        icon: faLanguage
      },
      {
        id: 'reader-layout',
        label: 'settings.section.reader-layout',
        description: 'settings.section.reader-layout.text',
        icon: faTableColumns
      },
      {
        id: 'reader-progress',
        label: 'settings.section.reader-progress',
        description: 'settings.section.reader-progress.text',
        icon: faBookmark
      },
      {
        id: 'reader-navigation',
        label: 'settings.section.reader-navigation',
        description: 'settings.section.reader-navigation.text',
        icon: faHandPointer
      },
      {
        id: 'reader-session',
        label: 'settings.section.reader-session',
        description: 'settings.section.reader-session.text',
        icon: faDisplay
      }
    ]
  },
  {
    id: 'ai',
    label: 'settings.area.ai',
    icon: faWandMagicSparkles,
    sections: [
      {
        id: 'ai-guide',
        label: 'settings.section.ai-guide',
        description: 'settings.section.ai-guide.text',
        icon: faCircleInfo
      },
      {
        id: 'ai-ask',
        label: 'settings.section.ai-ask',
        description: 'settings.section.ai-ask.text',
        icon: faCommentDots
      },
      {
        id: 'ai-presets',
        label: 'settings.section.ai-presets',
        description: 'settings.section.ai-presets.text',
        icon: faListUl
      },
      {
        id: 'ai-read-aloud',
        label: 'settings.section.ai-read-aloud',
        description: 'settings.section.ai-read-aloud.text',
        icon: faHeadphones
      },
      {
        id: 'ai-recap',
        label: 'settings.section.ai-recap',
        description: 'settings.section.ai-recap.text',
        icon: faClockRotateLeft
      }
    ]
  },
  {
    id: 'audiobookshelf',
    label: 'settings.area.audiobookshelf',
    icon: faHeadphones,
    sections: [
      {
        id: 'audiobookshelf-connect',
        label: 'settings.section.audiobookshelf-connect',
        description: 'settings.section.audiobookshelf-connect.text',
        icon: faServer
      }
    ]
  },
  {
    id: 'anki',
    label: 'settings.area.anki',
    icon: faNoteSticky,
    sections: [
      {
        id: 'anki-connect',
        label: 'settings.section.anki-connect',
        description: 'settings.section.anki-connect.text',
        icon: faPlug
      },
      {
        id: 'anki-media',
        label: 'settings.section.anki-media',
        description: 'settings.section.anki-media.text',
        icon: faPhotoFilm
      }
    ]
  },
  {
    id: 'tracking',
    label: 'settings.area.tracking',
    icon: faChartLine,
    sections: [
      {
        id: 'tracking-statistics',
        label: 'settings.section.tracking-statistics',
        description: 'settings.section.tracking-statistics.text',
        icon: faStopwatch
      },
      {
        id: 'tracking-day',
        label: 'settings.section.tracking-day',
        description: 'settings.section.tracking-day.text',
        icon: faSun
      },
      {
        id: 'tracking-merge',
        label: 'settings.section.tracking-merge',
        description: 'settings.section.tracking-merge.text',
        icon: faCodeMerge
      },
      {
        id: 'tracking-goals',
        label: 'settings.section.tracking-goals',
        description: 'settings.section.tracking-goals.text',
        icon: faBullseye
      }
    ]
  },
  {
    id: 'data',
    label: 'settings.area.data',
    icon: faDatabase,
    sections: [
      {
        id: 'data-storage',
        label: 'settings.section.data-storage',
        description: 'settings.section.data-storage.text',
        icon: faHardDrive
      },
      {
        id: 'data-import',
        label: 'settings.section.data-import',
        description: 'settings.section.data-import.text',
        icon: faFileImport
      },
      {
        id: 'data-sync',
        label: 'settings.section.data-sync',
        description: 'settings.section.data-sync.text',
        icon: faRotate
      },
      {
        id: 'data-sources',
        label: 'settings.section.data-sources',
        description: 'settings.section.data-sources.text',
        icon: faServer
      }
    ]
  }
];

export const settingsSections = settingsAreas.flatMap((area, areaIndex) =>
  area.sections.map((section, index) => ({
    ...section,
    area: area.id,
    areaLabel: area.label,
    order: areaIndex * 100 + index
  }))
);

export function findSettingsSection(id: string) {
  return settingsSections.find((section) => section.id === id);
}

/** Old ?tab= links (the previous tab names) */
const legacySettingsTabs: Record<string, string> = {
  Reader: 'reader-text',
  Themes: 'general-custom-themes',
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

/** Section from #section-id, ?section=<area or section id> or a legacy ?tab=. */
export function sectionFromUrl(url: URL) {
  const section = url.searchParams.get('section') || '';
  const tab = url.searchParams.get('tab') || '';

  return (
    findSettingsSection(url.hash.slice(1)) ||
    findSettingsSection(section) ||
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
