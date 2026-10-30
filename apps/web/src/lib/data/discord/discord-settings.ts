/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The Discord plugin's settings: one activity template per activity, Show my status, Away and
 * Hide titles. Both stores follow the account (sharedSettings); stored templates may be partial
 * (older versions, another device), so they are read through `activityTemplate`. Not part of upstream.
 */

import { writableObjectLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';
import type { DiscordActivityTemplate, DiscordKind } from '$lib/data/discord/discord-template';
import { record } from '$lib/data/setting-parsers';

export interface DiscordOptions {
  /** Show my status: off clears it and sends nothing */
  show: boolean;
  /** Minutes without a page turn before Away */
  awayMinutes: number;
  /** Away shows the In the library activity (else nothing) */
  awayIdle: boolean;
  /** Every book shows its privacy text */
  hideTitles: boolean;
  /** Show activity from my other devices: this device also sends its status through the hub */
  relay: boolean;
}

export const discordOptionDefaults: DiscordOptions = {
  show: true,
  awayMinutes: 10,
  awayIdle: true,
  hideTitles: false,
  relay: false
};

export const discordOptions$ = writableObjectLocalStorageSubject<Partial<DiscordOptions>>()(
  'discordOptions',
  {},
  record
);

export const discordActivities$ = writableObjectLocalStorageSubject<
  Partial<Record<DiscordKind, Partial<DiscordActivityTemplate>>>
>()('discordActivities', {}, record);

export const discordKinds: DiscordKind[] = ['book', 'manga', 'vn', 'idle'];

export type DiscordPreset = 'minimal' | 'progress' | 'everything';

export const discordPresetNames: DiscordPreset[] = ['minimal', 'progress', 'everything'];

const base: DiscordActivityTemplate = {
  show: true,
  name: '',
  details: '',
  detailsUrl: '',
  state: '',
  stateUrl: '',
  largeImage: 'logo',
  largeCustom: '',
  largeText: '',
  smallImage: 'none',
  smallCustom: '',
  smallText: '',
  timestamp: 'session',
  party: false,
  partyCurrent: 'chapterNumber',
  partyMax: 'chapterCount',
  buttons: [],
  privacyText: 'Reading a book'
};

type PresetFields = Partial<Omit<DiscordActivityTemplate, 'show' | 'privacyText'>>;

const presets: Record<DiscordKind, Record<DiscordPreset, PresetFields>> = {
  book: {
    minimal: { name: 'Reading a book', details: '{title}' },
    progress: {
      name: 'Reading {title}',
      details: '{chapter}',
      state: '{percent} · {charsToday} chars today',
      largeImage: 'cover',
      largeText: '{title}',
      smallImage: 'logo',
      smallText: 'chimimouryou'
    },
    everything: {
      name: 'Reading {title}',
      details: '{title} {volume} · {author}',
      state:
        '{chapter} · {percent} · {charsToday} chars today · {speed} chars an hour · {timeLeftBook} left in the book · {streak} streak',
      largeImage: 'cover',
      largeText: 'Difficulty {difficulty} · {wordsKnown} words known',
      smallImage: 'logo',
      smallText: '{percent} read · {timeLeftBook} left',
      party: true,
      partyCurrent: 'chapterNumber',
      partyMax: 'chapterCount'
    }
  },
  manga: {
    minimal: { name: 'Reading manga', details: '{title}' },
    progress: {
      name: 'Reading {title} {volume}',
      details: '{title} {volume}',
      state: 'Page {page} of {pageCount}',
      largeImage: 'cover',
      largeText: '{title}',
      smallImage: 'logo',
      smallText: 'chimimouryou'
    },
    everything: {
      name: 'Reading {title} {volume}',
      details: '{title} {volume} · {author}',
      state: '{percent} · {timeToday} today · {streak} streak',
      largeImage: 'cover',
      largeText: '{series}',
      smallImage: 'logo',
      smallText: '{percent} read',
      party: true,
      partyCurrent: 'page',
      partyMax: 'pageCount'
    }
  },
  vn: {
    minimal: { name: 'Playing a visual novel', details: '{title}' },
    progress: {
      name: 'Playing {title}',
      details: '{title}',
      state: '{percent} · {charsToday} chars today',
      largeImage: 'cover',
      largeText: '{title}',
      smallImage: 'logo',
      smallText: 'chimimouryou'
    },
    everything: {
      name: 'Playing {title}',
      details: '{title} · {author}',
      state: '{percent} · {charsToday} chars today · {speed} chars an hour · {streak} streak',
      largeImage: 'cover',
      largeText: 'Difficulty {difficulty} · {wordsKnown} words known',
      smallImage: 'logo',
      smallText: '{timeLeftBook} left'
    }
  },
  idle: {
    minimal: { name: 'Choosing what to read next', timestamp: 'none' },
    progress: {
      name: 'Choosing what to read next',
      details: 'In the library',
      state: '{charsToday} chars today',
      timestamp: 'none'
    },
    everything: {
      name: 'Choosing what to read next',
      details: '{charsToday} chars today · {timeToday}',
      state: '{streak} streak · {wordsKnown} words known',
      largeText: '{speed} chars an hour',
      timestamp: 'none'
    }
  }
};

/** The preset's fields; Show, the buttons and the privacy text stay as they are */
export function presetFields(kind: DiscordKind, preset: DiscordPreset): PresetFields {
  const { show: _show, privacyText: _privacy, buttons: _buttons, ...fields } = base;

  return { ...fields, ...presets[kind][preset] };
}

/** The activity's default: the Progress preset, shown except In the library */
export function defaultTemplate(kind: DiscordKind): DiscordActivityTemplate {
  return { ...base, ...presetFields(kind, 'progress'), show: kind !== 'idle' };
}

export function activityTemplate(
  kind: DiscordKind,
  stored = discordActivities$.getValue()
): DiscordActivityTemplate {
  const saved = stored[kind] ?? {};

  return {
    ...defaultTemplate(kind),
    ...saved,
    buttons: Array.isArray(saved.buttons) ? saved.buttons.slice(0, 2) : []
  };
}

/** The preset the template's fields match, if any */
export function matchingPreset(kind: DiscordKind, template: DiscordActivityTemplate) {
  return discordPresetNames.find((preset) =>
    Object.entries(presetFields(kind, preset)).every(
      ([key, value]) =>
        JSON.stringify(template[key as keyof DiscordActivityTemplate]) === JSON.stringify(value)
    )
  );
}

export function saveActivityTemplate(kind: DiscordKind, template: DiscordActivityTemplate) {
  discordActivities$.next({ ...discordActivities$.getValue(), [kind]: template });
}

export function discordOptions(stored = discordOptions$.getValue()): DiscordOptions {
  return { ...discordOptionDefaults, ...stored };
}

export function setDiscordOption<K extends keyof DiscordOptions>(key: K, value: DiscordOptions[K]) {
  discordOptions$.next({ ...discordOptions$.getValue(), [key]: value });
}
