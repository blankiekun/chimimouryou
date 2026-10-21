/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Generated furigana (#17): the difficulty service's readings file for a Calibre book
 * (yurigana's readings in context, scripts/calibre/jiten/readings_file.py) turned into
 * `<ruby class="ttu-gen-ruby">` in the book's HTML before it is rendered. `rt` isn't
 * counted, so character counts (bookmarks, highlights) don't change.
 */

import { lastValueFrom, Observable } from 'rxjs';
import { difficultyApiUrl, loadCalibreCatalog } from '$lib/data/calibre';
import { readerDb } from '$lib/data/reader-db';
import { generatedFurigana$ } from '$lib/data/store';
import {
  getTextSegments,
  offsetForCount,
  type TextSegment
} from '$lib/functions/book-text/text-positions';

export interface ReadingsFile {
  characters: number;
  /** Furigana per kanji run: [offset from the word's start, length, base, ruby] */
  glosses: [number, number, string, string][][];
  /** [Δstart, word index, gloss index or -1, ...] */
  occ: number[];
}

/** A readings file kept in the browser (reader-db `readings`), so books open with it at once. */
export interface CachedReadings {
  title: string;
  etag: string;
  file: ReadingsFile;
}

// The server makes a new file in seconds to a minute: ask soon, then every 15 s (nginx allows
// 6 requests a minute per address, burst 10).
const pollDelays = [3_000, 5_000, 10_000];
const pollInterval = 15_000;
const pollLimit = 40;

async function requestReadings(
  id: number,
  etag?: string
): Promise<Omit<CachedReadings, 'title'> | 'unchanged' | 'queued' | undefined> {
  const url = `${difficultyApiUrl}readings/${id}`;
  const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(5000) });
  const status = response.ok ? (await response.json()).status : undefined;

  if (status === 'queued') return 'queued';
  if (status !== 'ready') return undefined;

  const file = await fetch(url, {
    cache: 'no-store',
    headers: etag ? { 'If-None-Match': etag } : {},
    signal: AbortSignal.timeout(15000)
  });

  if (file.status === 304) return 'unchanged';

  return file.ok ? { etag: file.headers.get('ETag') || '', file: await file.json() } : undefined;
}

/**
 * The book's readings file, or undefined first while the server makes it (then the file
 * once it is ready), or undefined when there is none (no catalog entry, no difficulty
 * service, offline). A copy kept in the browser is emitted first and stays when the server
 * can't be reached; the server's is emitted only when it differs. Always emits at least once.
 */
export function generatedReadings$(title: string) {
  return new Observable<ReadingsFile | undefined>((subscriber) => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cached: CachedReadings | undefined;

    const done = (file?: ReadingsFile) => {
      if (file || !cached) subscriber.next(file);
      subscriber.complete();
    };

    const attempt = async (id: number, tries: number) => {
      const result = await requestReadings(id, cached?.etag).catch(() => undefined);

      if (stopped) return;
      if (result === 'unchanged') {
        subscriber.complete();
      } else if (result !== 'queued') {
        if (result) {
          readerDb()
            .then((db) => db.put('readings', { title, ...result }))
            .catch(() => undefined);
        }
        done(result?.file);
      } else if (tries < pollLimit) {
        if (!tries && !cached) subscriber.next(undefined);
        timer = setTimeout(() => attempt(id, tries + 1), pollDelays[tries] ?? pollInterval);
      } else {
        subscriber.complete();
      }
    };

    const id = loadCalibreCatalog()
      .then((books) => books.find((book) => book.title === title)?.id)
      .catch(() => undefined);

    readerDb()
      .then((db) => db.get('readings', title))
      .catch(() => undefined)
      .then(async (file) => {
        if (stopped) return;
        cached = file;
        if (cached) subscriber.next(cached.file);

        const bookId = await id;

        if (stopped) return;
        if (bookId === undefined) {
          done();
        } else {
          attempt(bookId, 0);
        }
      });

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  });
}

let prefetching: Promise<void> | undefined;

/**
 * Keeps the readings files of these books (Home's) in the browser before they are opened,
 * one every 30 s: each check costs the server's rate limit (nginx: 6 a minute) that opening
 * a book needs too. Books already kept are skipped; the reader checks those when it opens them.
 */
export function prefetchReadings(titles: string[], pause = 30_000) {
  if (prefetching || !generatedFurigana$.getValue()) return prefetching;

  prefetching = (async () => {
    for (const title of titles) {
      if (!generatedFurigana$.getValue()) break;
      if (await (await readerDb()).getKey('readings', title)) continue;

      await lastValueFrom(generatedReadings$(title), { defaultValue: undefined });
      await new Promise((resolve) => setTimeout(resolve, pause));
    }
  })()
    .catch(() => {})
    .finally(() => {
      prefetching = undefined;
    });

  return prefetching;
}

/** Frees a book's kept readings file, e.g. when it leaves the library or Home. */
export async function deleteCachedReadings(title: string) {
  await (await readerDb()).delete('readings', title);
}

/** The book's HTML with the readings file's furigana added; unchanged if the counts differ. */
export function addGeneratedRuby(html: string, readings: ReadingsFile) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const segments = getTextSegments(doc.body);
  const last = segments[segments.length - 1];

  // Made from another processing of the book: offsets would be off.
  if (!last || last.startCount + last.count !== readings.characters) return html;

  const marks: [number, number, string, string][] = [];
  let start = 0;
  let claimedEnd = 0;

  for (let i = 0; i < readings.occ.length; i += 3) {
    start += readings.occ[i];
    const gloss = readings.glosses[readings.occ[i + 2]];

    // A counter span (三本 さんぼん) comes before its tokens at the same start and wins.
    if (!gloss || start < claimedEnd) continue;

    gloss.forEach(([offset, length, base, ruby]) => {
      marks.push([start + offset, length, base, ruby]);
      claimedEnd = Math.max(claimedEnd, start + offset + length);
    });
  }

  // Marks and text nodes are both in reading order: group the marks by node, then rebuild
  // each node once (DOM ranges per mark took ~20 s on a novel).
  const groups = new Map<TextSegment, typeof marks>();
  let index = 0;

  for (const mark of marks) {
    while (
      index < segments.length &&
      segments[index].startCount + segments[index].count <= mark[0]
    ) {
      index += 1;
    }
    const segment = segments[index];

    if (!segment) break;
    if (mark[0] + mark[1] <= segment.startCount + segment.count) {
      groups.set(segment, [...(groups.get(segment) || []), mark]);
    }
  }

  groups.forEach((group, { node, startCount, text }) => {
    if (node.nodeType !== Node.TEXT_NODE || node.parentElement?.closest('ruby')) return;

    const fragment = doc.createDocumentFragment();
    let position = 0;

    group.forEach(([at, length, base, ruby]) => {
      const from = offsetForCount(text, at - startCount);
      const to = offsetForCount(text, at - startCount + length, true);

      if (from < position || text.slice(from, to) !== base) return;

      const rubyEl = doc.createElement('ruby');
      const rt = doc.createElement('rt');

      rubyEl.className = 'ttu-gen-ruby';
      rt.textContent = ruby;
      rubyEl.append(base, rt);
      fragment.append(text.slice(position, from), rubyEl);
      position = to;
    });

    fragment.append(text.slice(position));
    (node as ChildNode).replaceWith(fragment);
  });

  return doc.body.innerHTML;
}
