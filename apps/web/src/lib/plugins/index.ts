/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Built-in plugins: optional features that add to the reader and settings
 * through the extension points below, and can be switched off per account (the built-in ones start on)
 * (Settings → General → Plugins). Not part of upstream.
 */

import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';
import type { ComponentType } from 'svelte';
import { map } from 'rxjs';
import type { SearchIndex } from '$lib/functions/book-text/book-search';
import type { Section } from '$lib/data/database/books-db/versions/v3/books-db-v3';
import type { MessageKey } from '$lib/i18n';
import { aiPlugin } from '$lib/plugins/ai';
import { audiobookshelfPlugin } from '$lib/plugins/audiobookshelf';
import { socialPlugin } from '$lib/plugins/social';
import { enabledPlugins$ } from '$lib/plugins/plugin-settings';

export { enabledPlugins$ };

/** What the reader tells plugin panels about the open book */
export interface ReaderContext {
  title: string;
  getIndex: () => Promise<SearchIndex>;
  sections: Section[];
  /** Current reading position (characters) */
  position: number;
  bookCharacters: number;
  /** The panel is the one shown */
  active: boolean;
}

export interface CompanionTabContribution {
  key: string;
  label: MessageKey;
  icon: IconDefinition;
  component: ComponentType;
  /** The component's props, picked from the reader context */
  props: (context: ReaderContext) => Record<string, unknown>;
  /** Opening the tab pauses the reading tracker */
  pausesTracker?: boolean;
  /** Offered when the reader comes back after days away, named `label` */
  absenceOffer?: { ready: () => boolean; label: MessageKey };
}

export interface SelectionActionContribution {
  label: MessageKey;
  title: MessageKey;
  icon: IconDefinition;
  /** Shown with `passage` (PassageContext from data/ask-ai: the selection and text around it, without furigana); dispatches `close` */
  panel: ComponentType;
}

export interface ListenContext {
  title: string;
  elementHtml: string;
  getIndex: () => Promise<SearchIndex>;
  position: number;
  /** Position when the Listen bar opened */
  startCharCount: number;
}

/**
 * A source in the Listen bar besides the audiobook. The component may dispatch
 * `reading` ({ start, end } | undefined), `position` (follow) and `jump`.
 */
export interface ListenModeContribution {
  key: string;
  title: MessageKey;
  icon: IconDefinition;
  component: ComponentType;
  props: (context: ListenContext) => Record<string, unknown>;
}

export interface Plugin {
  id: string;
  /** i18n keys */
  name: MessageKey;
  description: MessageKey;
  /** Settings area (settings-sections.ts) shown only while the plugin is on */
  settingsArea?: string;
  /** Rendered on the settings page; holds its SettingsSections */
  settings?: ComponentType;
  companionTabs?: CompanionTabContribution[];
  selectionActions?: SelectionActionContribution[];
  listenModes?: ListenModeContribution[];
  /** Called 15 s after the reading position settles */
  onPositionSettled?: (
    title: string,
    getIndex: () => Promise<SearchIndex>,
    position: number,
    characters: number
  ) => void;
  /** Called when the reader leaves a book */
  onBookLeft?: (title: string, position: number, characters: number) => void;
  /** Sentence audio for Anki cards when the book has no audiobook clip */
  ankiSentenceAudio?: (sentence: string) => Promise<Blob | undefined>;
}

export const plugins: Plugin[] = [aiPlugin, audiobookshelfPlugin, socialPlugin];

export function isPluginEnabled(id: string, enabled = enabledPlugins$.getValue()) {
  return enabled.includes(id);
}

export function activePlugins() {
  return plugins.filter((plugin) => isPluginEnabled(plugin.id));
}

export const activePlugins$ = enabledPlugins$.pipe(
  map((enabled) => plugins.filter((plugin) => isPluginEnabled(plugin.id, enabled)))
);

export function setPluginEnabled(id: string, enabled: boolean) {
  const others = enabledPlugins$.getValue().filter((other) => other !== id);

  enabledPlugins$.next(enabled ? [...others, id] : others);
}
