/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Yomitan's popup shortcuts (options.inputs.hotkeys, HotkeyHandler) for the built-in popup:
 * a hotkey is a KeyboardEvent.code plus exactly its modifiers. Not part of upstream.
 */

import type { InputsHotkeyOptions } from '$lib/vendor/yomitan/types/settings';

/** The popup actions the built-in popup carries out (Anki, profiles and the search page aren't here). */
export const popupHotkeyActions = [
  'close',
  'previousEntry',
  'nextEntry',
  'firstEntry',
  'lastEntry',
  'historyBackward',
  'historyForward',
  'playAudio'
] as const;

export type PopupHotkeyAction = (typeof popupHotkeyActions)[number];

const modifierOrder = ['ctrl', 'alt', 'shift', 'meta'] as const;

export function eventModifiers(event: KeyboardEvent) {
  return modifierOrder.filter((modifier) => event[`${modifier}Key`]);
}

export const isPopupHotkey = ({ action, scopes }: InputsHotkeyOptions) =>
  scopes.includes('popup') && (popupHotkeyActions as readonly string[]).includes(action);

export function hotkeyAction(hotkeys: InputsHotkeyOptions[], event: KeyboardEvent) {
  const held = eventModifiers(event);
  return hotkeys.find(
    (hotkey) =>
      hotkey.enabled &&
      isPopupHotkey(hotkey) &&
      hotkey.key === event.code &&
      hotkey.modifiers.length === held.length &&
      hotkey.modifiers.every((modifier) => (held as string[]).includes(modifier))
  );
}

/** "Alt + PageDown", as Yomitan's settings show a hotkey. */
export function hotkeyLabel({ key, modifiers }: Pick<InputsHotkeyOptions, 'key' | 'modifiers'>) {
  const name = (key ?? '').replace(/^Key(?=[A-Z]$)|^Digit(?=\d$)/, '');
  return [...modifiers.map((m) => m[0].toUpperCase() + m.slice(1)), name]
    .filter(Boolean)
    .join(' + ');
}
