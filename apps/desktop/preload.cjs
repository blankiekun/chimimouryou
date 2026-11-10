/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Preload for the app's own windows: tells the web build it runs in the desktop app, where cloud
// sign-in continues in the system browser (oauth.js), and lets Sources fetch sites without CORS
// (main.js sourcesFetch), runs Mihon extensions (mihon.js), and plays Windows games natively (games.js) with an overlay over them
// (overlay.js), and gives the page zoom for the dictionary popup's popupScaleRelativeToPageZoom.
// Nothing else is exposed.

/* global require */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- sandboxed preloads are CommonJS
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('chimiDesktop', {
  browserSignIn: true,
  zoomFactor: () => webFrame.getZoomFactor(),
  fetch: (url, options) => ipcRenderer.invoke('sources-fetch', url, options),
  mihon: {
    status: () => ipcRenderer.invoke('mihon-status'),
    installJava: () => ipcRenderer.invoke('mihon-install-jre'),
    removeJava: () => ipcRenderer.invoke('mihon-remove-jre'),
    // No signing key here: the desktop's jars are trust on first use.
    install: (url, _signingKey, replaces) => ipcRenderer.invoke('mihon-install', url, replaces),
    remove: (pin) => ipcRenderer.invoke('mihon-remove', pin),
    load: (pin) => ipcRenderer.invoke('mihon-load', pin),
    call: (pin, op, params) => ipcRenderer.invoke('mihon-call', pin, op, params),
    onProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on('mihon-progress', listener);
      return () => ipcRenderer.removeListener('mihon-progress', listener);
    }
  },
  games: {
    launch: (folder, saves) => ipcRenderer.invoke('games-launch', folder, saves),
    saves: (folder, names) => ipcRenderer.invoke('games-saves', folder, names),
    saveFolders: (folder, keep) => ipcRenderer.invoke('games-save-folders', folder, keep),
    pick: (game) => ipcRenderer.invoke('games-pick', game),
    link: (id, index, folder, title) => ipcRenderer.invoke('games-link', id, index, folder, title),
    forget: (folder) => ipcRenderer.invoke('games-forget', folder),
    list: () => ipcRenderer.invoke('games-list'),
    runner: (folder, runner) => ipcRenderer.invoke('games-runner', folder, runner),
    session: (folder) => ipcRenderer.invoke('games-session', folder),
    mark: (seq) => ipcRenderer.invoke('games-mark', seq),
    media: (seq, want) => ipcRenderer.invoke('games-media', seq, want),
    hotkeys: (changes) => ipcRenderer.invoke('games-hotkeys', changes),
    onHotkey: (callback) => {
      const listener = (_event, action) => callback(action);
      ipcRenderer.on('native-hotkey', listener);
      return () => ipcRenderer.removeListener('native-hotkey', listener);
    },
    options: (folder, changes) => ipcRenderer.invoke('games-options', folder, changes),
    insertHook: (code) => ipcRenderer.invoke('games-hook-code', code),
    stamp: () => ipcRenderer.invoke('games-stamp'),
    windows: (folder) => ipcRenderer.invoke('games-windows', folder),
    attach: (folder, index) => ipcRenderer.invoke('games-attach', folder, index),
    onHook: (callback) => {
      const listener = (_event, message) => callback(message);
      ipcRenderer.on('native-hook', listener);
      return () => ipcRenderer.removeListener('native-hook', listener);
    }
  },
  overlay: {
    settings: (changes) => ipcRenderer.invoke('overlay-settings', changes),
    edit: (on) => ipcRenderer.invoke('overlay-edit', on),
    setRects: (rects, solid) => ipcRenderer.invoke('overlay-rects', rects, solid),
    setArea: (area) => ipcRenderer.invoke('overlay-area', area),
    onState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('overlay-state', listener);
      return () => ipcRenderer.removeListener('overlay-state', listener);
    }
  }
});
