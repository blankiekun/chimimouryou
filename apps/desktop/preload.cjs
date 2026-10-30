/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Preload for the app's own windows: tells the web build it runs in the desktop app, where cloud
// sign-in continues in the system browser (oauth.js), and lets Sources fetch sites without CORS
// (main.js sourcesFetch). Nothing else is exposed.

/* global require */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- sandboxed preloads are CommonJS
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chimiDesktop', {
  browserSignIn: true,
  fetch: (url, options) => ipcRenderer.invoke('sources-fetch', url, options)
});
