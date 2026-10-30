/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Sources: works fetched from sites into the Calibre library (server/import/sources/api.py).
 * The shapes the import service returns.
 */

export interface SourceVolume {
  number: number;
  /** First and last chapter */
  first: number;
  last: number;
  inLibrary: boolean;
  /** Being fetched or added to Calibre */
  pending: boolean;
}

export interface SourceWork {
  id: number;
  site: string;
  siteName: string;
  /** The site's domain, for "syosetu.com allows 1 page every 2 s" */
  domain: string;
  /** Seconds between two requests to one site */
  interval: number;
  workKey: string;
  url: string;
  title: string;
  authors: string;
  status: 'ongoing' | 'finished' | 'removed';
  chapters: number;
  /** The site's last update (ms) */
  updated: number;
  summary: string;
  latest: { n: number; title: string; date: string }[];
  volumeSize: number;
  volumes: SourceVolume[];
}

export interface SourceJob {
  id: string;
  workId: number;
  title: string;
  site: string;
  siteName: string;
  domain: string;
  kind: 'add' | 'update';
  /** Volumes still to fetch */
  volumes: number[];
  unit: 'chapters' | 'pages';
  done: number;
  total: number;
  state: 'queued' | 'fetching' | 'adding' | 'done' | 'failed' | 'cancelled';
  error: string;
  /** The chapter a failed job stopped at */
  failedAt: number | null;
  created: number;
  updated: number;
}
