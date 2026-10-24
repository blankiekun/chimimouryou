/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Updates from GitHub releases: checked once per start in packaged builds, downloaded in the
// background, installed only when the reader picks "Restart to update". macOS builds are unsigned,
// which its updater refuses, so there the app only points at the release page.

import { app, dialog, net, shell } from 'electron';
import updater from 'electron-updater';
import { isNewerVersion } from './version.js';

const repo = 'blankiekun/chimimouryou';

async function offerReleasePage(window) {
  const response = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`);
  if (!response.ok) return;
  const { tag_name: tag, html_url: url } = await response.json();
  // A build newer than /releases/latest (prerelease, local dist) must not be offered an older one.
  if (!tag || !isNewerVersion(tag, app.getVersion())) return;
  const { response: choice } = await dialog.showMessageBox(window, {
    type: 'info',
    buttons: ['Open the release page', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: `chimimouryou ${tag.replace(/^v/, '')} is out`,
    detail: 'Download it from the release page and replace this copy in Applications.'
  });
  if (choice === 0) shell.openExternal(url);
}

export function checkForUpdates(window) {
  if (!app.isPackaged) return;
  if (process.platform === 'darwin') {
    offerReleasePage(window).catch((error) => console.error('Update check failed:', error));
    return;
  }
  const { autoUpdater } = updater;
  // Never install behind the reader's back; a declined update is offered again next start
  // (the download stays cached).
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('error', (error) => console.error('Update failed:', error.message));
  autoUpdater.on('update-downloaded', async ({ version }) => {
    const { response } = await dialog.showMessageBox(window, {
      type: 'info',
      buttons: ['Restart to update', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `chimimouryou ${version} is ready`,
      detail: 'Restart now to use it, or keep reading: it is offered again next time.'
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.checkForUpdates().catch(() => {});
}
