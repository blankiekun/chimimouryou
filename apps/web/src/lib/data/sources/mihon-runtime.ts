/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * A Mihon extension's source as an ExtensionRuntime: every call goes to the app's host, which
 * loads the extension pinned by `pin`. The desktop app runs jars in its JVM host
 * (apps/desktop/mihon.js through `chimiDesktop.mihon`); the Android app's `github` build runs apks
 * in-process (Capacitor plugin `MihonHost`, MihonHostPlugin.kt, same protocol). Elsewhere (plain
 * browsers, the `play` build) `mihonHost()` is undefined and callers say it needs the app.
 * Filters aren't offered (an empty filter list), and keiyoushi has no novels, so `html` throws.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  ExtensionError,
  type ExtensionDetail,
  type ExtensionList,
  type ExtensionRuntime
} from './extension-runtime';

interface MihonHost {
  /** Downloads the extension (Android: checks its signer against `signingKey`) and pins it: its SHA-256 */
  install(url: string, signingKey: string): Promise<{ sha256: string }>;
  load(pin: string): Promise<{ sources: { id: string; name: string; lang: string }[] }>;
  call(pin: string, op: string, params: Record<string, unknown>): Promise<any>;
}

/** The desktop app's host, which also runs on a Java runtime downloaded from Settings. */
interface MihonDesktop extends MihonHost {
  status(): Promise<{
    supported: boolean;
    host: boolean;
    jre: boolean;
    downloading: { received: number; total: number } | null;
  }>;
  installJava(): Promise<unknown>;
  removeJava(): Promise<unknown>;
  onProgress(callback: (progress: { received: number; total: number }) => void): () => void;
}

interface MihonPlugin {
  install(options: { url: string; signingKey: string }): Promise<{ sha256: string }>;
  call(options: Record<string, unknown>): Promise<any>;
  drop(options: { paths: string[] }): Promise<void>;
}

const plugin = registerPlugin<MihonPlugin>('MihonHost');

/** Image files the Android host wrote, read through the WebView's file URLs, then deleted. */
async function files(found: { path: string; type: string }[]) {
  try {
    return await Promise.all(
      found.map(async (file) => {
        const response = await fetch(Capacitor.convertFileSrc(file.path));
        if (!response.ok) throw new ExtensionError('The extension’s image could not be read');
        return { type: file.type, body: new Uint8Array(await response.arrayBuffer()) };
      })
    );
  } finally {
    await plugin.drop({ paths: found.map((file) => file.path) }).catch(() => undefined);
  }
}

const android: MihonHost = {
  install: (url, signingKey) => plugin.install({ url, signingKey }),
  load: (pin) => plugin.call({ pin, op: 'load' }),
  async call(pin, op, params) {
    const result = await plugin.call({ ...params, pin, op });
    if (op === 'pages') return { files: await files(result.files) };
    if (op === 'image') return (await files([result]))[0];
    return result;
  }
};

/** The Android app's host (the `github` build only; `play` has no MihonHost plugin). */
const androidHost = () => (Capacitor.isPluginAvailable('MihonHost') ? android : undefined);

export const mihonDesktop = () =>
  (globalThis as { chimiDesktop?: { mihon?: MihonDesktop } }).chimiDesktop?.mihon;

/** The host runs apks (Android), else jars (the desktop app; also what a browser lists by). */
export const mihonRunsApks = () => !mihonDesktop() && !!androidHost();

export const mihonHost = (): MihonHost | undefined => mihonDesktop() ?? androidHost();

const text = (value: unknown) => (typeof value === 'string' ? value : '');

function list(value: any): ExtensionList {
  return {
    list: (Array.isArray(value?.list) ? value.list : [])
      .map((work: any) => ({
        name: text(work?.name),
        link: text(work?.link),
        imageUrl: text(work?.imageUrl)
      }))
      .filter((work: { link: string }) => work.link),
    hasNextPage: value?.hasNextPage === true
  };
}

const blob = (file: { type: string; body: Uint8Array | ArrayBuffer }) =>
  new Blob([file.body as BlobPart], { type: file.type });

export async function openMihon(pin: string, sourceId: string): Promise<ExtensionRuntime> {
  const host = mihonHost();
  if (!host) throw new ExtensionError('Mihon extensions run in the desktop and Android apps');
  const { sources } = await host.load(pin);
  if (!sources.some((s) => s.id === sourceId)) {
    throw new ExtensionError(
      'The extension no longer has this source: tap Update in its repository'
    );
  }
  let stopped = false;
  const call = async (op: string, params: Record<string, unknown> = {}) => {
    if (stopped) throw new ExtensionError('The extension was closed');
    try {
      return await host.call(pin, op, { source: sourceId, ...params });
    } catch (error) {
      // Electron wraps the host's message: "Error invoking remote method 'mihon-call': Error: …"
      throw new ExtensionError(String((error as Error).message).replace(/^.*?Error: /, ''));
    }
  };
  return {
    imageHosts: new Set(),
    get stopped() {
      return stopped;
    },
    popular: async (page) => list(await call('popular', { page })),
    latest: async (page) => list(await call('latest', { page })),
    search: async (query, page) => list(await call('search', { query, page })),
    async detail(url): Promise<ExtensionDetail> {
      const found = await call('detail', { url });
      return {
        name: text(found.name),
        imageUrl: text(found.imageUrl),
        description: text(found.description),
        author: text(found.author),
        artist: text(found.artist),
        status: typeof found.status === 'number' ? found.status : 5,
        genre: Array.isArray(found.genre) ? found.genre.map(text) : [],
        chapters: (Array.isArray(found.chapters) ? found.chapters : []).map((c: any) => ({
          name: text(c.name),
          url: text(c.url),
          dateUpload: text(c.dateUpload),
          scanlator: text(c.scanlator)
        }))
      };
    },
    async chapterPages(url) {
      const { files } = await call('pages', { url });
      return (files as { type: string; body: Uint8Array }[]).map(blob);
    },
    html() {
      throw new ExtensionError('Mihon extensions here are manga only');
    },
    async image(url) {
      const file = await call('image', { url });
      const body = file.body as Uint8Array;
      return {
        body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
        type: text(file.type)
      };
    },
    close() {
      stopped = true;
    }
  };
}
