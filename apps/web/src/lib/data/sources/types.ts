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
  /** Hours between two checks of a followed work */
  checkHours: number;
  /** This account follows the work */
  following: boolean;
  paused: boolean;
  /** The server has a cover for it (covers/{id}) */
  cover: boolean;
  kind: 'novel' | 'manga';
  /** Manga as pages: one CBZ per chapter or per volume */
  per: 'volume' | 'chapter';
  /** Chapters per volume when the reader may still choose per volume or per chapter, else null */
  perChoice: number | null;
  /** The added server it comes from (an OPDS catalog or Suwayomi), else null */
  server: number | null;
  /** A server's work whose volumes are whole files, queued as they come */
  files: boolean;
}

/** An OPDS catalog or Suwayomi server this account added (GET servers); the password never comes back. */
export interface SourceServer {
  id: number;
  type: 'opds' | 'suwayomi';
  name: string;
  url: string;
  user: string;
  hasPassword: boolean;
}

/** An entry of a server's feed: a section to open, a series (a work) or a single book of the feed. */
export interface SourceServerEntry {
  kind: 'section' | 'work' | 'book';
  title: string;
  authors: string;
  /** The section's path on the server (sections and works) */
  href: string | null;
  workKey: string | null;
  /** The cover's path on the server (servers/{id}/image) */
  cover: string | null;
  inLibrary: boolean;
  following: boolean;
}

export interface SourceServerFeed {
  server: { id: number; name: string; type: 'opds' | 'suwayomi' };
  title: string;
  section: string;
  /** The next page's path */
  next: string | null;
  /** The catalog can be searched */
  search: boolean;
  entries: SourceServerEntry[];
}

/** A work in a site's search, popular or latest list (GET sites/{site}/…). */
export interface SourceSearchWork {
  workKey: string;
  url: string;
  title: string;
  authors: string;
  status: 'ongoing' | 'finished';
  chapters: number;
  /** The site's last update (ms) */
  updated: number;
  inLibrary: boolean;
  following: boolean;
}

export interface SourceSearch {
  site: string;
  siteName: string;
  domain: string;
  /** How the site orders search results, e.g. "most bookmarked" */
  order: string;
  total: number;
  page: number;
  more: boolean;
  works: SourceSearchWork[];
}

/** A work this account follows (GET following). */
export interface SourceFollow {
  workId: number;
  title: string;
  site: string;
  siteName: string;
  domain: string;
  chapters: number;
  /** Volumes of it in the library */
  volumes: number;
  paused: boolean;
  /** '' until the first check; detail says what the last check added or why it failed */
  /** Standalone: wifi = waiting for Wi-Fi, app = the site needs the desktop app */
  state: '' | 'checking' | 'current' | 'new' | 'failed' | 'removed' | 'wifi' | 'app';
  detail: string;
  lastCheck: number | null;
  nextCheck: number | null;
  /** When the follow was made, paused or resumed (ms) */
  modified: number;
  cover: boolean;
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
  unit: 'chapters' | 'pages' | 'volumes';
  done: number;
  total: number;
  state: 'queued' | 'fetching' | 'adding' | 'done' | 'failed' | 'cancelled';
  error: string;
  /** The chapter a failed job stopped at */
  failedAt: number | null;
  created: number;
  updated: number;
}

/** An error of Sources; `field` names the form field it concerns (Add a source). */
export class SourceError extends Error {
  constructor(
    message: string,
    public field = ''
  ) {
    super(message);
  }
}
