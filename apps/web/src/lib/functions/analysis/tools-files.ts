/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The analysis tools' files (scripts/analysis-tools/build.sh), for the page and the analysis
 * workers. They are kept in the Cache API when downloaded, never precached by the service
 * worker. Not part of upstream.
 */

/** Not `chimi:…`: the service worker deletes those it didn't make (service-worker-caches.ts). */
export const analysisToolsCacheName = 'analysis-tools';

export interface AnalysisToolsManifest {
  version: string;
  /** The difficulty engine's fingerprint (scripts/calibre/jiten/engine.py); older tools: none */
  engine?: string;
  /**
   * `raw`: the size once gunzipped, for the files streamed into wasm memory; `features`: the only
   * features that need the file (none: every feature)
   */
  files: { name: string; bytes: number; raw?: number; features?: ('difficulty' | 'furigana')[] }[];
}

/** A tools file from the cache, else from the network (the download was evicted or is partial). */
export async function toolsFile(base: string, name: string) {
  const url = new URL(name, base).href;
  const cached = await caches
    .open(analysisToolsCacheName)
    .then((cache) => cache.match(url))
    .catch(() => undefined);
  const response = cached ?? (await fetch(url));

  if (!response.ok) throw new Error(`${name}: ${response.status}`);

  return response;
}

/** A module from the tools, imported through a blob URL so it comes from the cache too. */
export async function importToolsModule(base: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([await (await toolsFile(base, name)).text()], { type: 'text/javascript' })
  );

  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** FileSystemSyncAccessHandle (workers only, so not in the app's DOM types) */
interface SyncAccessHandle {
  read(buffer: Uint8Array, options: { at: number }): number;
  getSize(): number;
  close(): void;
}

const syncHandle = (file: FileSystemFileHandle) =>
  (
    file as FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccessHandle> }
  ).createSyncAccessHandle();

/**
 * The OPFS folder where the tools' big files (the dictionary, the packs; `raw` in the manifest) are
 * kept unpacked, so workers read them straight into wasm memory: streaming them in through JS left
 * as much garbage as the file's size.
 */
export async function rawFolder(create = false) {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(analysisToolsCacheName, {
    create
  });
}

export const rawName = (name: string) => name.replace(/\.gz$/, '');

/** For workers: reads an unpacked tools file into `view`, which must be exactly its size. */
export async function readRawInto(name: string, view: Uint8Array) {
  const file = await (await rawFolder()).getFileHandle(rawName(name));
  const handle = await syncHandle(file);

  try {
    if (handle.getSize() !== view.length) throw new Error(`${name}: incomplete`);

    for (let done = 0; done < view.length; ) {
      const read = handle.read(view.subarray(done), { at: done });

      if (!read) throw new Error(`${name}: incomplete`);
      done += read;
    }
  } finally {
    handle.close();
  }
}
