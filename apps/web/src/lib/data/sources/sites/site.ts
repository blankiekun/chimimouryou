/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** What every site adapter (syosetu.ts, kakuyomu.ts) and a reader's server (opds.ts) return. */

export interface SiteDetails {
  title: string;
  authors: string;
  status: 'ongoing' | 'finished';
  chapters: number;
  short: boolean;
  summary: string;
  /** The site's last update (ms) */
  updated: number;
  latest: { n: number; title: string; date: string }[];
  cover: string;
  /** Kakuyomu: episode ids in reading order (chapter n = episodes[n - 1]) */
  episodes?: string[];
}

export interface SiteList {
  total: number;
  more: boolean;
  works: {
    workKey: string;
    url: string;
    title: string;
    authors: string;
    status: 'ongoing' | 'finished';
    chapters: number;
    updated: number;
  }[];
}

/** The site has no such work, or no longer lists that chapter (Python's LookupError). */
export class SiteMissing extends Error {}
