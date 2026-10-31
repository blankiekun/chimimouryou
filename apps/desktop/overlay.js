/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// The overlay over a game played natively (games.js): a transparent, frameless window the size of
// the game's window that follows it, showing /hook's current line in the text box area (route
// /hook/overlay) for lookups, while clicks still reach the game.
// - Windows: click-through with mouse moves forwarded (setIgnoreMouseEvents forward), so hovering
//   the text looks it up and clicking it advances the game; input taken only over a popup.
// - X11: `forward` is Windows/macOS only, so the window's shape is the text's line boxes and any
//   open popup: hovering the text reaches the page, clicks elsewhere reach the game, a click on the
//   text itself stays here. The shape clips drawing too, so it works without a compositor (an
//   opaque strip then). setShape([]) empties a window for good on X11: never sent; hidden instead.
// - The page reports its rects (`rects`) and whether it wants the whole window (`solid`: over a
//   popup; on X11 also over the text while Yomitan is there, whose popup it can't measure).
// Hidden while the game is minimized or not in front, except while its text box area is adjusted.

/** The text box area as fractions of the game window: a bottom band. */
export const defaultArea = { x: 0.04, y: 0.68, w: 0.92, h: 0.28 };

/** A text box area: fractions inside the window, at least 5 % each way. */
export const isArea = (area) =>
  !!area &&
  ['x', 'y', 'w', 'h'].every(
    (key) => typeof area[key] === 'number' && area[key] >= 0 && area[key] <= 1
  ) &&
  area.w >= 0.05 &&
  area.h >= 0.05 &&
  area.x + area.w <= 1.001 &&
  area.y + area.h <= 1.001;

/** Overlay settings: on/off (default off), text size in px, background opacity. */
export function overlaySettings(value) {
  const fontSize = Math.round(Number(value?.fontSize));
  const opacity = Number(value?.opacity);
  return {
    on: value?.on === true,
    fontSize: fontSize >= 12 && fontSize <= 96 ? fontSize : 28,
    opacity: opacity >= 0 && opacity <= 1 ? opacity : 0.75
  };
}

export function gameOverlay({ BrowserWindow, screen, url, preload, prepare, platform }) {
  let win;
  let game = {}; // the helper's last `window` message, in DIP
  let area = defaultArea;
  let settings = overlaySettings();
  let saveArea = () => {};
  let editing = false;
  let rects = [];
  let solid = false;

  const alive = () => win && !win.isDestroyed();
  const send = () =>
    alive() &&
    win.webContents.send('overlay-state', {
      platform,
      area,
      editing,
      fontSize: settings.fontSize,
      opacity: settings.opacity
    });

  /** Screen pixels (the helper's) to Electron's DIP. */
  function toDip(rect) {
    if (platform === 'win32') return screen.screenToDipRect(null, rect);
    // X11: one scale for the whole screen.
    const scale = screen.getPrimaryDisplay().scaleFactor || 1;
    return {
      x: Math.round(rect.x / scale),
      y: Math.round(rect.y / scale),
      width: Math.round(rect.width / scale),
      height: Math.round(rect.height / scale)
    };
  }

  function apply() {
    if (!alive()) return;
    const { width, height } = win.getBounds();
    const whole = editing || solid;
    if (platform === 'win32') win.setIgnoreMouseEvents(!whole, { forward: true });
    else if (whole || rects.length) win.setShape(whole ? [{ x: 0, y: 0, width, height }] : rects);
    const show =
      editing || (game.width > 0 && game.active && !game.minimized && (whole || rects.length > 0));
    if (show && !win.isVisible()) win.showInactive();
    else if (!show && win.isVisible()) win.hide();
  }

  return {
    get webContents() {
      return alive() ? win.webContents : undefined;
    },

    /** Opens it for a game: its saved area (or the default) and where a new one is saved. */
    open(gameArea, overlay, onArea) {
      this.close();
      area = isArea(gameArea) ? gameArea : defaultArea;
      settings = overlay;
      saveArea = onArea;
      game = {};
      editing = false;
      rects = [];
      solid = false;
      win = new BrowserWindow({
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        focusable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        title: 'chimimouryou overlay',
        // Hidden until the game's window is known: rendering must not stop meanwhile.
        webPreferences: { preload, backgroundThrottling: false }
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      if (platform === 'win32') win.setIgnoreMouseEvents(true, { forward: true });
      prepare(win.webContents);
      win.webContents.on('did-finish-load', send);
      win.loadURL(url);
    },

    close() {
      if (alive()) win.destroy();
      win = undefined;
    },

    settings(overlay) {
      settings = overlay;
      send();
    },

    /** The helper's `window` message: the overlay takes the game window's place. */
    window({ x, y, width, height, active, minimized }) {
      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
      game = {
        ...toDip({ x, y, width, height }),
        active: active !== false,
        minimized: !!minimized
      };
      if (!alive()) return;
      // Minimized windows sit at -32000 on Windows: the overlay just hides.
      if (!game.minimized) {
        const { x: gx, y: gy, width: gw, height: gh } = game;
        const now = win.getBounds();
        if (now.x !== gx || now.y !== gy || now.width !== gw || now.height !== gh)
          win.setBounds({ x: gx, y: gy, width: gw, height: gh });
      }
      apply();
    },

    /** From the overlay page: its line boxes and popup (window coordinates), and `solid`. */
    rects(list, wholeWindow) {
      if (!alive() || !Array.isArray(list)) return;
      const { width, height } = win.getBounds();
      rects = list
        .slice(0, 16)
        .map((rect) => {
          const left = Math.max(0, Math.floor(Number(rect?.x)));
          const top = Math.max(0, Math.floor(Number(rect?.y)));
          const right = Math.min(width, Math.ceil(Number(rect?.x) + Number(rect?.width)));
          const bottom = Math.min(height, Math.ceil(Number(rect?.y) + Number(rect?.height)));
          return { x: left, y: top, width: right - left, height: bottom - top };
        })
        .filter((rect) => rect.width > 0 && rect.height > 0);
      solid = wholeWindow === true;
      apply();
    },

    /** Adjust mode (from /hook): the whole window takes input and shows the area's frame. */
    edit(on) {
      editing = on === true && alive();
      apply();
      send();
      return editing;
    },

    /** From the overlay page: the adjusted area, saved for this game. */
    area(value) {
      if (!isArea(value)) return;
      area = { x: value.x, y: value.y, w: value.w, h: value.h };
      saveArea(area);
      send();
    }
  };
}
