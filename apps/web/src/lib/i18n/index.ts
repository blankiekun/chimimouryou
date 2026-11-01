/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The app's own UI language (English or Japanese), separate from the AI's
 * (`aiLanguage$`). Components use `$t$('key', params)`, other code `tr()`.
 * New strings go in both en.ts and ja.ts. Not part of upstream.
 */

import { BehaviorSubject, combineLatest, map } from 'rxjs';
import { writableStringLocalStorageSubject } from '$lib/data/internal/writable-string-local-storage-subject';
import { en, type MessageKey } from './en';
import { oneOf } from '$lib/data/setting-parsers';

export type { MessageKey };
export type UiLanguage = 'en' | 'ja';
export type MessageParams = Record<string, string | number>;

// Japanese loads only for readers who pick it (~95 KB): the root layout's load waits for it, so
// the first render is already in Japanese.
const messages$ = new BehaviorSubject<Partial<Record<UiLanguage, Record<MessageKey, string>>>>({
  en
});

export const uiLanguage$ = writableStringLocalStorageSubject<UiLanguage>()(
  'uiLanguage',
  'en',
  oneOf<UiLanguage>(['en', 'ja'])
);

/** The text for `key` in `lang` (English when missing), with its {param}s filled in. */
export function translate(lang: string, key: MessageKey, params: MessageParams = {}) {
  const text = messages$.getValue()[lang as UiLanguage]?.[key] || en[key];

  return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? `${params[name]}` : match));
}

/** Loads the strings of `lang` (Japanese) if they aren't yet. */
export async function loadUiLanguage(lang: string = uiLanguage$.getValue()) {
  if (lang !== 'ja' || messages$.getValue().ja) return;

  const { ja } = await import('./ja');

  messages$.next({ ...messages$.getValue(), ja });
}

uiLanguage$.subscribe((lang) => void loadUiLanguage(lang));

export const t$ = combineLatest([uiLanguage$, messages$]).pipe(
  map(
    ([lang]) =>
      (key: MessageKey, params?: MessageParams) =>
        translate(lang, key, params)
  )
);

export function tr(key: MessageKey, params?: MessageParams) {
  return translate(uiLanguage$.getValue(), key, params);
}
