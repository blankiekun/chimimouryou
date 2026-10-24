/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Text of Calibre manga pages from mokuro (https://github.com/kha-white/mokuro): made by the
 * server's mokuro service or uploaded as a .mokuro file, stored by catalog id
 * (scripts/calibre/mokuro/service.py). The manga reader lays it over the pages for Yomitan.
 * Not part of upstream.
 */

import { serverFetch } from '$lib/data/server-connect';
import { writableStringLocalStorageSubject } from '$lib/data/internal/writable-string-local-storage-subject';

export interface MokuroBlock {
  /** x1, y1, x2, y2 in image pixels */
  box: [number, number, number, number];
  vertical: boolean;
  /** Image pixels */
  fontSize: number;
  lines: string[];
}

export interface MokuroPage {
  /** The page's path in the CBZ */
  name: string;
  width: number;
  height: number;
  blocks: MokuroBlock[];
}

export interface MokuroText {
  source: 'server' | 'upload';
  /** mokuro's version */
  mokuro: string;
  created: number;
  pages: MokuroPage[];
}

export interface MokuroStatus {
  job: { id: number; title: string; done: number; total: number; started: number } | null;
  queue: number[];
  last: { id: number; title: string; error: string | null; finished: number } | null;
  /** Whether the server can run mokuro (else only uploads) */
  generator: boolean;
}

/** hover: shown under the pointer; always: on every bubble; off: not laid over the pages */
export type MangaText = 'hover' | 'always' | 'off';

export const mangaText$ = writableStringLocalStorageSubject<MangaText>()('mangaText', 'hover');

export const mokuroApiUrl = '/calibre/mokuro/api/';

export async function loadMokuro(calibreId: number): Promise<MokuroText | undefined> {
  const response = await serverFetch(`/calibre/mokuro/${calibreId}.json`, { cache: 'no-cache' });

  return response.ok ? response.json() : undefined;
}

/**
 * The text of each of the book's pages: by path, else by file name (when those are unique, for
 * .mokuro files made from an unpacked folder), else by position when the page counts match.
 */
export function pagesText(text: MokuroText, pageNames: string[]): (MokuroPage | undefined)[] {
  const byName = new Map(text.pages.map((page) => [page.name, page]));
  const baseName = (name: string) => name.slice(name.lastIndexOf('/') + 1);
  const byBase = new Map(text.pages.map((page) => [baseName(page.name), page]));
  const basesUnique = byBase.size === text.pages.length;
  const sameCount = text.pages.length === pageNames.length;

  return pageNames.map(
    (name, index) =>
      byName.get(name) ??
      (basesUnique ? byBase.get(baseName(name)) : undefined) ??
      (sameCount ? text.pages[index] : undefined)
  );
}

/** Position of a block on its page, in percent, so it follows the page's size. */
export function blockStyle(block: MokuroBlock, page: MokuroPage, scale: number) {
  const [x1, y1, x2, y2] = block.box;

  return (
    `left: ${(x1 / page.width) * 100}%; top: ${(y1 / page.height) * 100}%;` +
    `width: ${((x2 - x1) / page.width) * 100}%; height: ${((y2 - y1) / page.height) * 100}%;` +
    `font-size: ${Math.max(block.fontSize * scale, 1)}px;`
  );
}

async function api(action: string, init: RequestInit) {
  const response = await serverFetch(`${mokuroApiUrl}${action}`, { cache: 'no-store', ...init });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || `mokuro service unavailable (HTTP ${response.status})`);
  }

  return body;
}

export function mokuroStatus(): Promise<MokuroStatus> {
  return api('status', {});
}

function post(action: string, body: object): Promise<MokuroStatus> {
  return api(action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export const generateMokuro = (ids: number[]) => post('generate', { ids });
export const cancelMokuro = () => post('cancel', {});
export const removeMokuro = (id: number) => post('remove', { id });

export function uploadMokuro(id: number, file: File): Promise<{ pages: number }> {
  return api(`upload?id=${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: file
  });
}
