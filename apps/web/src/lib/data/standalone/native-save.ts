/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Downloads in the Android app (apps/android): its WebView drops `<a download>` saves (Export →
 * Zip File, CSVs, reports), so they go to the app's FileSave plugin, which asks where to save and
 * takes the file in chunks (a backup can be larger than one bridge message). Not part of upstream.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { logger } from '$lib/data/logger';

interface FileSavePlugin {
  pick(options: { name: string; mimeType: string }): Promise<void>;
  write(options: { data: string }): Promise<void>;
  close(options: { ok: boolean }): Promise<void>;
}

const FileSave = registerPlugin<FileSavePlugin>('FileSave');

const chunkSize = 3 << 20;

function base64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',', 2)[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Asks where to save `blob` and writes it there; resolves without saving when cancelled. */
export async function saveNative(blob: Blob, name: string) {
  try {
    await FileSave.pick({ name, mimeType: blob.type.split(';')[0] || 'application/octet-stream' });
  } catch (error: any) {
    if (error.code === 'cancelled') return;
    throw error;
  }
  try {
    for (let start = 0; start < blob.size; start += chunkSize) {
      await FileSave.write({ data: await base64(blob.slice(start, start + chunkSize)) });
    }
  } catch (error) {
    await FileSave.close({ ok: false }).catch(() => {});
    throw error;
  }
  await FileSave.close({ ok: true });
}

function saveLink(link: HTMLAnchorElement) {
  // Fetched at once: some callers revoke the blob URL soon after the click.
  fetch(link.href)
    .then((response) => response.blob())
    .then((blob) => saveNative(blob, link.download || 'download'))
    .catch((error) => logger.error(`Could not save ${link.download}: ${error.message}`));
}

const isDownload = (link: HTMLAnchorElement) =>
  link.hasAttribute('download') && /^(blob|data):/.test(link.href);

/**
 * In the Android app, sends every `<a download>` of a blob/data URL to saveNative: links clicked in
 * the page, and the detached links the app's save helpers create and `click()`.
 */
export function catchDownloads(win: Window) {
  if (!Capacitor.isNativePlatform()) return;

  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (isDownload(this)) saveLink(this);
    else click.call(this);
  };

  win.document.addEventListener(
    'click',
    (event) => {
      const link = (event.target as Element | null)?.closest?.('a');
      if (!link || !isDownload(link) || event.defaultPrevented) return;
      event.preventDefault();
      saveLink(link);
    },
    true
  );
}
