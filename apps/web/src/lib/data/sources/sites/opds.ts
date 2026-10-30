/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * OPDS 1.2 catalogs (Komga, Kavita, Calibre-web) and Suwayomi on this device: server/import/
 * sources/servers/opds.py in TypeScript, tested on the same fake catalog (servers.py). A work is a
 * series feed whose publication entries, every page read, are its items: whole files (EPUB, CBZ;
 * one volume each) or page images (Suwayomi's OPDS-PSE: chapters made into manga volumes). Every
 * request goes through sourceFetch with the server's origin, so nothing leaves its scheme, host
 * and port, and the credentials go only there. A plain browser reaches servers that allow CORS.
 */

import { sourceFetch, originOf } from '../transport';
import { imageType } from './build';
import { SiteMissing, type SiteDetails } from './site';

const A = 'http://www.w3.org/2005/Atom';
const PSE = 'http://vaemendis.net/opds-pse/ns';
const OPENSEARCH = 'http://a9.com/-/spec/opensearch/1.1/';
const PSE_STREAM = 'http://vaemendis.net/opds-pse/stream';
const FILE_TYPES: Record<string, 'epub' | 'cbz'> = {
  'application/epub+zip': 'epub',
  'application/vnd.comicbook+zip': 'cbz',
  'application/x-cbz': 'cbz',
  'application/zip': 'cbz'
};
const FILE_BYTES = 300 * 1024 * 1024;
const IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_FEED_PAGES = 100;
const SUWAYOMI_OPDS = '/api/opds/v1.2';

export class NotCatalog extends Error {}

export interface Entry {
  id: string;
  title: string;
  authors: string;
  summary: string;
  updated: string;
  nav: string | null;
  navKind: '' | 'acquisition' | 'navigation';
  meta: string | null;
  file: { href: string; ext: 'epub' | 'cbz' } | null;
  pages: { href: string; count: number } | null;
  cover: string | null;
}

export interface Feed {
  title: string;
  updated: string;
  cover: string | null;
  next: string | null;
  search: [string, string] | null;
  entries: Entry[];
}

const children = (element: Element, name: string, ns = A) =>
  [...element.children].filter((child) => child.localName === name && child.namespaceURI === ns);

const text = (element: Element, name: string) =>
  (children(element, name)[0]?.textContent ?? '').trim();

function links(element: Element, base: string) {
  return children(element, 'link')
    .filter((link) => link.getAttribute('href'))
    .map((link) => ({
      rel: link.getAttribute('rel') || '',
      kind: (link.getAttribute('type') || '').toLowerCase().replace(/ /g, ''),
      href: new URL(link.getAttribute('href') as string, base).href,
      link
    }));
}

function entry(element: Element, base: string): Entry {
  const out: Entry = {
    id: text(element, 'id'),
    title: text(element, 'title'),
    authors: children(element, 'author')
      .map((author) => text(author, 'name'))
      .filter(Boolean)
      .join(', '),
    summary: text(element, 'content') || text(element, 'summary'),
    updated: text(element, 'updated'),
    nav: null,
    navKind: '',
    meta: null,
    file: null,
    pages: null,
    cover: null
  };
  for (const { rel, kind, href, link } of links(element, base)) {
    if (rel.startsWith('http://opds-spec.org/acquisition')) {
      const ext = FILE_TYPES[kind.split(';')[0]];
      if (ext && !out.file) out.file = { href, ext };
    } else if (rel === PSE_STREAM) {
      const count = link.getAttributeNS(PSE, 'count') || '';
      // A template: URL() escaped its braces.
      const template = href.replace(/%7B/gi, '{').replace(/%7D/gi, '}');
      if (/^\d+$/.test(count) && Number(count) > 0)
        out.pages = { href: template, count: Number(count) };
    } else if (rel.startsWith('http://opds-spec.org/image')) {
      // Thumbnails are small enough for a shelf.
      if (rel.endsWith('thumbnail') || !out.cover) out.cover = href;
    } else if (kind.startsWith('application/atom+xml')) {
      if (kind.includes('type=entry')) {
        out.meta = href;
      } else if (!out.nav) {
        out.nav = href;
        out.navKind = kind.includes('kind=acquisition') ? 'acquisition' : 'navigation';
      }
    }
  }
  return out;
}

/** An OPDS feed (or a single entry); NotCatalog for anything else. */
export function parse(data: string, url: string): Feed {
  const doc = new DOMParser().parseFromString(data, 'application/xml');
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName('parsererror').length) throw new NotCatalog('not XML');
  if (root.namespaceURI === A && root.localName === 'entry') {
    return {
      title: '',
      updated: '',
      cover: null,
      next: null,
      search: null,
      entries: [entry(root, url)]
    };
  }
  if (root.namespaceURI !== A || root.localName !== 'feed') {
    throw new NotCatalog(`not an Atom feed (${root.localName})`);
  }
  const all = links(root, url);
  const search = all.find((link) => link.rel === 'search');
  return {
    title: text(root, 'title'),
    updated: text(root, 'updated'),
    cover: all.find((link) => link.rel.startsWith('http://opds-spec.org/image'))?.href ?? null,
    next: all.find((link) => link.rel === 'next')?.href ?? null,
    search: search ? [search.href, search.kind.split(';')[0]] : null,
    entries: children(root, 'entry').map((element) => entry(element, url))
  };
}

/** The entry's own id, else its first link: what stays the same when the feed is reordered. */
export function itemKey(item: Entry) {
  return item.id || item.file?.href || item.meta || item.pages?.href || '';
}

/** A publication: a file the app can open, pages, or (Suwayomi) a metadata entry with the pages. */
export const isItem = (item: Entry) => !!(item.file || item.pages || item.meta);

/** The OPDS root: the address itself, or Suwayomi's OPDS feed under the server's address. */
export function catalogUrl(type: 'opds' | 'suwayomi', url: string) {
  return type === 'suwayomi' && !url.includes(SUWAYOMI_OPDS)
    ? url.replace(/\/+$/, '') + SUWAYOMI_OPDS
    : url;
}

/** A series feed's path and query; Suwayomi's chapters in reading order (its default is newest first). */
export function workKey(type: 'opds' | 'suwayomi', href: string) {
  const parts = new URL(href);
  if (
    type === 'suwayomi' &&
    /\/series\/\d+\/chapters$/.test(parts.pathname) &&
    !parts.search.includes('sort=')
  ) {
    return `${parts.pathname}?sort=number_asc`;
  }
  return parts.pathname + parts.search;
}

export interface ServerRow {
  id: number;
  type: 'opds' | 'suwayomi';
  name: string;
  url: string;
  user: string;
  password: string;
}

export interface ServerDetails extends SiteDetails {
  items: (Entry | null)[];
  mode: 'files' | 'pages';
  kind: 'novel' | 'manga';
}

/** A file of the server as it came, or a chapter's page images in order. */
export type ServerChapter =
  | { title: string; item: string; file: File }
  | { title: string; item: string; pages: Blob[] };

/** A reader's server as a site: details, chapters, and fetching from it alone. */
export class Server {
  readonly root: string;
  readonly origin: string;
  readonly domain: string;

  constructor(readonly row: ServerRow) {
    this.root = catalogUrl(row.type, row.url);
    this.origin = originOf(this.root);
    this.domain = new URL(this.root).host;
  }

  /** href (absolute, or relative to the catalog) as a URL on this server; an Error for any other. */
  url(href: string) {
    const url = new URL(href, this.root).href;
    if (originOf(url) !== this.origin) throw new Error('Not a link on this server');
    return url;
  }

  get(url: string, maxBytes?: number) {
    const { user, password } = this.row;
    const headers: Record<string, string> =
      user || password
        ? { Authorization: `Basic ${btoa(unescape(encodeURIComponent(`${user}:${password}`)))}` }
        : {};
    return sourceFetch(url, { origin: this.origin, headers, maxBytes });
  }

  async feed(url: string) {
    const { body, url: final } = await this.get(url);
    return parse(new TextDecoder().decode(body), final);
  }

  /** The catalog's search for q (OpenSearch description or template). */
  async searchUrl(q: string) {
    const search = (await this.feed(this.root)).search;
    if (!search) throw new SiteMissing("This catalog can't be searched");
    // URL() escapes a template's braces.
    let href = search[0].replace(/%7B/gi, '{').replace(/%7D/gi, '}');
    if (search[1] === 'application/opensearchdescription+xml') {
      const doc = new DOMParser().parseFromString(
        new TextDecoder().decode((await this.get(this.url(href))).body),
        'application/xml'
      );
      const template = [...doc.getElementsByTagNameNS(OPENSEARCH, 'Url')]
        .find((u) => (u.getAttribute('type') || '').includes('atom'))
        ?.getAttribute('template');
      if (!template) throw new SiteMissing("This catalog can't be searched");
      href = new URL(template, href).href.replace(/%7B/gi, '{').replace(/%7D/gi, '}');
    }
    return this.url(
      href.replace('{searchTerms}', encodeURIComponent(q)).replace(/\{[^}]*\?\}/g, '')
    );
  }

  /** The series feed (every page) as a work. */
  async details(url: string): Promise<ServerDetails> {
    let first: Feed | undefined;
    let items: Entry[] = [];
    const seen = new Set<string>();
    let page: string | null = this.url(url);
    while (page && !seen.has(page) && seen.size < MAX_FEED_PAGES) {
      seen.add(page);
      let feed: Feed;
      try {
        feed = await this.feed(page);
      } catch (error) {
        if (error instanceof NotCatalog) {
          throw new SiteMissing('This address is no longer an OPDS feed');
        }
        throw error;
      }
      first ??= feed;
      items = [...items, ...feed.entries.filter(isItem)];
      page = feed.next ? this.url(feed.next) : null;
    }
    const files = this.row.type !== 'suwayomi' && items.some((e) => e.file);
    if (files) items = items.filter((e) => e.file);
    let cover = first?.cover || items.find((e) => e.cover)?.cover || '';
    try {
      cover = cover ? this.url(cover) : '';
    } catch {
      cover = '';
    }
    return {
      title: first?.title || this.row.name,
      status: 'ongoing',
      short: false,
      chapters: items.length,
      authors: items.find((e) => e.authors)?.authors ?? '',
      summary: items.find((e) => e.summary)?.summary ?? '',
      updated: Date.parse(first?.updated ?? '') || 0,
      cover,
      latest: items
        .map((e, i) => ({ n: i + 1, title: e.title, date: e.updated.slice(0, 10) }))
        .slice(-3)
        .reverse(),
      items,
      mode: files ? 'files' : 'pages',
      kind: files && items.every((e) => e.file?.ext === 'epub') ? 'novel' : 'manga'
    };
  }

  /** Item n: the whole file as it came, or its page images in order. */
  async chapter(n: number, info: ServerDetails): Promise<ServerChapter> {
    const item = info.items[n - 1];
    if (!item) throw new SiteMissing(`No. ${n} is no longer on the server`);
    if (info.mode === 'files' && item.file) {
      const { ext, href } = item.file;
      const { body } = await this.get(this.url(href), FILE_BYTES);
      const file = new File([body], `${item.title || n}.${ext}`, {
        type: ext === 'epub' ? 'application/epub+zip' : 'application/vnd.comicbook+zip'
      });
      // PK: a zip, not a login page the server sent instead.
      const head = new Uint8Array(body.slice(0, 2));
      if (head[0] !== 0x50 || head[1] !== 0x4b) {
        throw new Error(`The server sent something that isn't a ${ext.toUpperCase()} file`);
      }
      return { title: item.title, item: itemKey(item), file };
    }
    let pages = item.pages;
    if (!pages && item.meta) {
      pages = (await this.feed(this.url(item.meta))).entries.find((e) => e.pages)?.pages ?? null;
    }
    if (!pages) throw new SiteMissing('The server lists no pages for it');
    const blobs: Blob[] = [];
    // OPDS-PSE counts pages from 0.
    for (let page = 0; page < pages.count; page += 1) {
      const href = pages.href.replace('{pageNumber}', String(page)).replace('{maxWidth}', '4096');
      const { body } = await this.get(this.url(href), IMAGE_BYTES);
      const type = imageType(body);
      if (!type) throw new Error(`Page ${page + 1} is not an image`);
      blobs.push(new Blob([body], { type }));
    }
    return { title: item.title, item: itemKey(item), pages: blobs };
  }
}
