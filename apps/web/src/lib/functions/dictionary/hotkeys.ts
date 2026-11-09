/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Yomitan's shortcuts (options.inputs.hotkeys, HotkeyHandler) for the built-in popup: a hotkey is
 * a KeyboardEvent.code (null: modifiers only) plus exactly its modifiers. Popup actions run while
 * the popup shows; page ('web') actions anywhere, as Yomitan's Frontend runs them on pages and in
 * its popup. Not part of upstream.
 */

import type { InputsHotkeyOptions } from '$lib/vendor/yomitan/types/settings';
import { isInputElementFocused } from '$lib/vendor/yomitan/dom/document-util';

/** The popup actions the built-in popup carries out (profiles and the search page aren't here). */
export const popupHotkeyActions = [
  'close',
  'previousEntry',
  'nextEntry',
  'firstEntry',
  'lastEntry',
  'historyBackward',
  'historyForward',
  'playAudio',
  'addNote',
  'viewNotes'
] as const;

/** Page actions (Yomitan's 'web' scope, KeyboardShortcutController._actionDetails). */
export const pageHotkeyActions = ['scanSelectedText'] as const;

export type PopupHotkeyAction = (typeof popupHotkeyActions)[number];
export type HotkeyAction = PopupHotkeyAction | (typeof pageHotkeyActions)[number];
export type HotkeyScope = 'popup' | 'web';

/** The scope an action runs in here. */
export const hotkeyScope = (action: string): HotkeyScope =>
  (pageHotkeyActions as readonly string[]).includes(action) ? 'web' : 'popup';

const modifierOrder = ['ctrl', 'alt', 'shift', 'meta'] as const;
const modifierCodes = /^(Control|Shift|Alt|Meta|OS)(Left|Right)$/;

export function eventModifiers(event: KeyboardEvent) {
  return modifierOrder.filter((modifier) => event[`${modifier}Key`]);
}

/** A shortcut the built-in popup carries out, in the scope it runs in. */
export const isSupportedHotkey = ({ action, scopes }: InputsHotkeyOptions) =>
  [...popupHotkeyActions, ...pageHotkeyActions].some((known) => known === action) &&
  scopes.includes(hotkeyScope(action));

/** Kept for callers listing popup shortcuts. */
export const isPopupHotkey = (hotkey: InputsHotkeyOptions) =>
  isSupportedHotkey(hotkey) && hotkeyScope(hotkey.action) === 'popup';

export function hotkeyAction(
  hotkeys: InputsHotkeyOptions[],
  event: KeyboardEvent,
  scope: HotkeyScope = 'popup'
) {
  const held = eventModifiers(event);
  // HotkeyHandler._isHotkeyPermitted: typing a character in a field is never a shortcut.
  if (
    (held.length === 0 || (held.length === 1 && held[0] === 'shift')) &&
    (event.key.length === 1 || event.key === 'Process') &&
    isInputElementFocused()
  ) {
    return undefined;
  }
  const code = modifierCodes.test(event.code) ? null : event.code;
  return hotkeys.find(
    (hotkey) =>
      hotkey.enabled &&
      isSupportedHotkey(hotkey) &&
      hotkeyScope(hotkey.action) === scope &&
      hotkey.key === code &&
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
