/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkMangaText,
  downloadMangaText,
  mangaTextBytes,
  mangaTextModels,
  mangaTextState$,
  makeMangaText,
  removeMangaText
} from '$lib/data/manga/manga-ocr';

describe('manga text', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches its models from huggingface.co at pinned revisions', () => {
    for (const { url } of Object.values(mangaTextModels)) {
      expect(url).toMatch(/^https:\/\/huggingface\.co\/[\w-]+\/[\w-]+\/resolve\/[0-9a-f]{40}\//);
    }
    expect(Math.round(mangaTextBytes / 1e6)).toBe(160);
  });

  it('downloads what the cache lacks, then is ready; removing empties it', async () => {
    const stored = new Map<string, Response>();

    vi.stubGlobal('caches', {
      open: async () => ({
        match: async (url: string) => stored.get(url),
        put: async (url: string, response: Response) => {
          await response.arrayBuffer();
          stored.set(url, response);
        }
      }),
      delete: async () => stored.clear()
    });
    stored.set(mangaTextModels.vocab.url, new Response('kept'));

    const fetched: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        return new Response('model');
      })
    );

    await checkMangaText();
    expect(mangaTextState$.getValue()).toBe('absent');
    await downloadMangaText();
    expect(fetched).toEqual([
      mangaTextModels.detector.url,
      mangaTextModels.encoder.url,
      mangaTextModels.decoder.url
    ]);
    expect(mangaTextState$.getValue()).toBe('ready');
    await removeMangaText();
    expect(mangaTextState$.getValue()).toBe('absent');
  });

  it('needs the volume’s pages in this browser', async () => {
    await expect(makeMangaText('Not stored')).rejects.toThrow('Open the volume once');
  });
});
