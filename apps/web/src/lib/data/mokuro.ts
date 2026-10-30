/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Text of manga pages from mokuro (https://github.com/kha-white/mokuro). Calibre manga: made by the
 * server's mokuro service or uploaded as a .mokuro file, stored by catalog id
 * (server/mokuro/service.py). Manga stored in this browser: a .mokuro file uploaded or
 * imported beside its CBZ, or text made in this browser (manga-ocr.ts), kept in reader-db `mokuro`
 * by title; never synced. The manga reader lays it over the pages for Yomitan.
 * Not part of upstream.
 */

import { Subject } from 'rxjs';
import { readerDb } from '$lib/data/reader-db';
import { responseJson, serverFetch } from '$lib/data/server-connect';
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
  /** browser: made in this browser (manga-ocr.ts) */
  source: 'server' | 'upload' | 'browser';
  /** mokuro's version */
  mokuro: string;
  created: number;
  pages: MokuroPage[];
}

/** A browser-stored manga's text (reader-db `mokuro`) */
export interface LocalMokuro extends MokuroText {
  title: string;
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
  return responseJson(response, `mokuro service unavailable (HTTP ${response.status})`);
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

/** A volume's text for word lists: one speech bubble a line, as manga_text in jiten/service.py. */
export function mokuroPlainText(text: MokuroText) {
  return text.pages
    .flatMap((page) => (page.blocks ?? []).map((block) => block.lines.join('').trim()))
    .filter(Boolean)
    .join('\n');
}

/** The same as book HTML for the analysis tools (localEstimate): a paragraph per bubble. */
export function mokuroHtml(text: MokuroText) {
  const escape = (line: string) =>
    line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return mokuroPlainText(text)
    .split('\n')
    .map((line) => `<p>${escape(line)}</p>`)
    .join('');
}

// The limits of service.py's convert (keep them in sync).
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const MAX_PAGES = 5000;
const MAX_BLOCKS = 1000;
const MAX_LINES = 100;
const MAX_LINE = 2000;

function number(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) throw new Error('not a number');

  return Math.round(value * 10) / 10;
}

const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * mokuro's .mokuro output → what the reader loads, as service.py's convert: per page its path in
 * the CBZ, size and text blocks. Throws on anything else, since files come from anywhere.
 */
export function convertMokuro(mokuro: unknown, source: MokuroText['source']): MokuroText {
  const pages = isObject(mokuro) ? mokuro.pages : undefined;

  if (!Array.isArray(pages) || !pages.length || pages.length > MAX_PAGES) {
    throw new Error('Not a .mokuro file (no pages)');
  }

  const result = pages.map((page): MokuroPage => {
    try {
      if (!isObject(page)) throw new Error();

      const width = number(page.img_width);
      const height = number(page.img_height);
      const name = page.img_path;
      const blocks = page.blocks ?? [];

      if (
        typeof name !== 'string' ||
        !Array.isArray(blocks) ||
        blocks.length > MAX_BLOCKS ||
        width <= 0 ||
        height <= 0
      ) {
        throw new Error();
      }

      return {
        name: name.replace(/\\/g, '/').replace(/^(\.\/)+/, ''),
        width,
        height,
        blocks: blocks.map((block): MokuroBlock => {
          if (!isObject(block) || !Array.isArray(block.box)) throw new Error();

          const box = block.box.map(number);
          const { lines } = block;

          if (
            box.length !== 4 ||
            !Array.isArray(lines) ||
            lines.length > MAX_LINES ||
            !lines.every((line) => typeof line === 'string' && line.length <= MAX_LINE)
          ) {
            throw new Error();
          }

          return {
            box: box as MokuroBlock['box'],
            vertical: !!block.vertical,
            fontSize: number(block.font_size ?? 0),
            lines
          };
        })
      };
    } catch {
      throw new Error('Not a .mokuro file (a page is malformed)');
    }
  });
  const { version } = mokuro as Record<string, unknown>;

  return {
    source,
    mokuro: typeof version === 'string' ? version : '',
    created: Date.now(),
    pages: result
  };
}

/** A .mokuro file chosen or dropped by the reader, converted. */
export async function readMokuroFile(file: Blob) {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('The .mokuro file is too large');

  let json: unknown;

  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error('Not a .mokuro file (not JSON)');
  }

  return convertMokuro(json, 'upload');
}

/** The title of a browser-stored manga whose text changed */
export const localMokuroChanged$ = new Subject<string>();

export async function keptMokuro(title: string): Promise<MokuroText | undefined> {
  return (await readerDb()).get('mokuro', title).catch(() => undefined);
}

export async function saveLocalMokuro(title: string, text: MokuroText) {
  await (await readerDb()).put('mokuro', { ...text, title });
  localMokuroChanged$.next(title);
}

export async function removeLocalMokuro(title: string) {
  await (await readerDb()).delete('mokuro', title);
  localMokuroChanged$.next(title);
}

/**
 * .mokuro files imported with their CBZs (same base name), stored for the books imported; the
 * error of the first file that isn't one.
 */
export async function importMokuroFiles(files: File[], titles: string[]) {
  const imported = new Set(titles);
  let error = '';

  for (const file of files) {
    const title = file.name.replace(/\.mokuro$/i, '');

    if (!imported.has(title)) continue;

    try {
      await saveLocalMokuro(title, await readMokuroFile(file));
    } catch (err: any) {
      error ||= `${file.name}: ${err.message}`;
    }
  }

  return error;
}

/** A browser-stored manga's text, for its estimate and word list (localEstimate). */
export const localMokuro = keptMokuro;
