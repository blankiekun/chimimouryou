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
  write(buffer: Uint8Array, options: { at: number }): number;
  getSize(): number;
  flush(): void;
  close(): void;
}

const syncHandle = (file: FileSystemFileHandle) =>
  (
    file as FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccessHandle> }
  ).createSyncAccessHandle();

/**
 * A token file: the analysis' Sudachi rows, kept in the origin private file system between the
 * workers so neither the page nor a worker holds a second copy. A line per text,
 * `text \x1d rows` (chunks of the book have no newline; rows as browser.py's BrowserTokens reads
 * them). For workers: it uses a sync access handle.
 */
export async function openTokenFile(name: string) {
  const root = await navigator.storage.getDirectory();
  const handle = await syncHandle(await root.getFileHandle(name, { create: true }));
  const encoder = new TextEncoder();
  let at = handle.getSize();

  return {
    append(text: string, rows: string) {
      at += handle.write(encoder.encode(`${text}\x1d${rows}\n`), { at });
    },
    close() {
      handle.flush();
      handle.close();
    }
  };
}

/**
 * A token file's rows by text, read from the file when asked for (only the texts and where their rows
 * are stay in memory). For workers: it keeps a sync access handle open until `close`.
 */
export async function openTokenIndex(name: string) {
  const root = await navigator.storage.getDirectory();
  const handle = await syncHandle(await root.getFileHandle(name));
  const size = handle.getSize();
  const decoder = new TextDecoder();
  const where = new Map<string, [number, number]>();
  const chunk = new Uint8Array(1 << 20);
  let line: number[] = [];
  let cut = -1;

  // Both separators are ASCII, so they can be found in the UTF-8 bytes.
  for (let at = 0; at < size; at += chunk.length) {
    const read = handle.read(chunk, { at });

    for (let i = 0; i < read; i += 1) {
      const byte = chunk[i];

      if (cut < 0) {
        if (byte === 0x1d) {
          cut = at + i;
        } else {
          line.push(byte);
        }
      } else if (byte === 0x0a) {
        const key = decoder.decode(new Uint8Array(line));

        where.set(key, [cut + 1, at + i - cut - 1]);
        line = [];
        cut = -1;
      }
    }
  }

  let buffer = new Uint8Array(1 << 16);

  return {
    get(text: string) {
      const found = where.get(text);

      if (!found) return undefined;
      if (found[1] > buffer.length) buffer = new Uint8Array(found[1]);

      const view = buffer.subarray(0, found[1]);

      handle.read(view, { at: found[0] });

      return decoder.decode(view);
    },
    close() {
      handle.close();
    }
  };
}

export async function removeTokenFile(name: string) {
  await (await navigator.storage.getDirectory()).removeEntry(name).catch(() => undefined);
}

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
