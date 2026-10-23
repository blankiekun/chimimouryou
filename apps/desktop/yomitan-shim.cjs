/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Preload for Yomitan's service worker and pages: Electron has no chrome.permissions, which
// Yomitan's backend reads on start. Electron grants the manifest's permissions, so report those.
// Yomitan's own files stay unmodified.

/* global chrome, location, require */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- sandboxed preloads are CommonJS
const { contextBridge } = require('electron');

// The check runs in the main world: a service worker's preload realm has no location.
contextBridge.executeInMainWorld({
  func: () => {
    if (
      location.protocol !== 'chrome-extension:' ||
      !globalThis.chrome?.runtime ||
      chrome.permissions
    )
      return;
    const manifest = chrome.runtime.getManifest();
    const granted = {
      permissions: manifest.permissions ?? [],
      origins: manifest.host_permissions ?? []
    };
    // Callback or promise style, like the chrome.* APIs.
    const answer =
      (value) =>
      (...args) => {
        const result = typeof value === 'function' ? value(args[0]) : value;
        const callback = args.find((arg) => typeof arg === 'function');
        if (callback) callback(result);
        else return Promise.resolve(result);
      };
    const event = { addListener() {}, removeListener() {}, hasListener: () => false };
    chrome.permissions = {
      getAll: answer(granted),
      contains: answer((asked) =>
        (asked?.permissions ?? []).every((name) => granted.permissions.includes(name))
      ),
      // The optional ones (clipboardRead, nativeMessaging) can't be granted here.
      request: answer(false),
      remove: answer(false),
      onAdded: event,
      onRemoved: event
    };
  }
});
