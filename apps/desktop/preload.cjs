/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Preload for the app's own windows: tells the web build it runs in the desktop app, where cloud
// sign-in continues in the system browser (oauth.js), and lets Sources fetch sites without CORS
// (main.js sourcesFetch), and plays Windows games natively (games.js). Nothing else is exposed.

/* global require */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- sandboxed preloads are CommonJS
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chimiDesktop', {
  browserSignIn: true,
  fetch: (url, options) => ipcRenderer.invoke('sources-fetch', url, options),
  games: {
    launch: (folder, saves) => ipcRenderer.invoke('games-launch', folder, saves),
    saves: (folder, names) => ipcRenderer.invoke('games-saves', folder, names),
    saveFolders: (folder, keep) => ipcRenderer.invoke('games-save-folders', folder, keep),
    pick: (game) => ipcRenderer.invoke('games-pick', game),
    link: (id, index, folder, title) => ipcRenderer.invoke('games-link', id, index, folder, title),
    forget: (folder) => ipcRenderer.invoke('games-forget', folder),
    list: () => ipcRenderer.invoke('games-list'),
    session: () => ipcRenderer.invoke('games-session'),
    onHook: (callback) => {
      const listener = (_event, message) => callback(message);
      ipcRenderer.on('native-hook', listener);
      return () => ipcRenderer.removeListener('native-hook', listener);
    }
  }
});
