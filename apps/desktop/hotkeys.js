/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Global shortcuts while a game runs natively (games.js's session), for use with the game in front:
// put the newest line on the last Anki card (/hook does it, as the Backlog's "Use for last card"),
// and bring /hook to the front (pressed there, the app steps back behind the game). Registered only
// while a game runs and /hook's window is open, so they never take keys otherwise.

export const hotkeyDefaults = {
  mine: 'CommandOrControl+Shift+M',
  show: 'CommandOrControl+Shift+H'
};

/** The stored shortcuts with the defaults filled in; '' turns one off. */
export const hotkeySettings = (stored = {}) =>
  Object.fromEntries(
    Object.entries(hotkeyDefaults).map(([action, fallback]) => [
      action,
      typeof stored[action] === 'string' ? stored[action].slice(0, 60).trim() : fallback
    ])
  );

const onHook = (url) => {
  try {
    return new URL(url).pathname.replace(/\/$/, '') === '/hook';
  } catch {
    return false;
  }
};

export function gameHotkeys({ globalShortcut, BrowserWindow }) {
  /** What is registered now: the session, its /hook address, the shortcuts and which failed */
  let active;

  function show() {
    const { sender, page } = active;
    const window = BrowserWindow.fromWebContents(sender);
    if (!window) return;
    if (window.isFocused()) {
      window.minimize();
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    // The page went elsewhere: back to the game's /hook.
    if (!onHook(sender.getURL()) && page) sender.loadURL(page);
  }

  const actions = {
    mine: () =>
      onHook(active.sender.getURL()) ? active.sender.send('native-hotkey', 'mine') : show(),
    show
  };

  /** Registers `keys` for `session` while it runs and its page is open; no session unregisters. */
  function sync(session, keys = {}) {
    const wanted = session?.running && !session.sender.isDestroyed();
    const same =
      wanted &&
      active?.session === session &&
      active.sender === session.sender &&
      JSON.stringify(active.keys) === JSON.stringify(keys);
    if (same) return active.failed;
    for (const accelerator of Object.values(active?.keys ?? {}))
      if (accelerator) globalShortcut.unregister(accelerator);
    // No session and nothing registered (a setting changed before any game ran): no page.
    const page = active && active.session === session ? active.page : undefined;
    active = undefined;
    if (!wanted) return [];
    const url = session.sender.getURL();
    active = {
      session,
      sender: session.sender,
      page: onHook(url) ? url : page,
      keys,
      failed: []
    };
    for (const [action, accelerator] of Object.entries(keys)) {
      if (!accelerator) continue;
      let ok = false;
      try {
        ok = globalShortcut.register(accelerator, actions[action]);
      } catch {
        // Not a shortcut Electron understands
      }
      if (!ok) active.failed.push(action);
    }
    return active.failed;
  }

  return { sync };
}
