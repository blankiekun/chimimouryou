/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The app's side of a source extension (a Mangayomi JS extension from a repository's index.json):
 * its code runs in QuickJS in a sandboxed frame (extension-sandbox.ts, static/source-sandbox.html)
 * inside a jail frame (static/source-jail.html), and everything it asks for is checked here.
 * - Requests: GET over https to the hosts of the source's baseUrl/apiUrl only, through
 *   transport.ts (pacing, size cap, redirects kept to those hosts), at most MAX_FETCHES per call,
 *   headers from an allow list (never cookies or credentials).
 * - Images (`image`): also from the hosts of the image URLs getDetail and getPageList returned
 *   (`imageHosts`, "Loads images from: …"), image/* answers only.
 * - On the server edition in a plain browser, pages go through the server's fetch proxy
 *   (transport.ts, with `repo`), which sends Referer; images still load directly.
 * - Referer: a plain browser can't send it; a request that drops it and is refused (401/403), or
 *   a site without CORS, is NeedsAppError ("needs the desktop app"), as for the built-in sites.
 * - Results are rebuilt from the fields the app uses, with their types checked.
 * - A frame that doesn't answer for IDLE_MS, or navigates, is removed with every other extension
 *   frame (Chromium runs them all in one process, so one spinning frame stalls the others).
 * Pinning the code's SHA-256 at install and updating on tap belong to the repository code.
 */

import { pagePath } from '$lib/data/env';
import {
  FetchError,
  NeedsAppError,
  nativeFetch,
  sourceFetch,
  viaProxy,
  type FetchOptions
} from './transport';

/** An entry of a Mangayomi repository's index.json (the fields an extension may read). */
export interface ExtensionSource {
  name: string;
  baseUrl: string;
  apiUrl?: string;
  lang?: string;
  /** A number in Mangayomi's indexes, the package id (a string) in a Manatan index */
  id?: number | string;
  itemType?: number;
  version?: string;
  [key: string]: unknown;
}

export interface ExtensionWork {
  name: string;
  link: string;
  imageUrl: string;
}

export interface ExtensionList {
  list: ExtensionWork[];
  hasNextPage: boolean;
}

export interface ExtensionChapter {
  name: string;
  url: string;
  dateUpload: string;
  scanlator: string;
}

export interface ExtensionDetail {
  name: string;
  imageUrl: string;
  description: string;
  author: string;
  artist: string;
  /** Mangayomi's status: 0 ongoing, 1 completed, 2 on hiatus, 3 cancelled, 4 publishing finished, 5 unknown */
  status: number;
  genre: string[];
  chapters: ExtensionChapter[];
}

export interface ExtensionImage {
  url: string;
  headers: Record<string, string>;
}

/** The extension failed, answered nonsense, or was stopped. */
export class ExtensionError extends Error {}

const PROTOCOL = 2;
/** Silence from a frame with a call running and no request out (QuickJS answers within 0.5 s) */
const IDLE_MS = 10_000;
const MAX_FETCHES = 100;
const SENT_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'referer',
  'user-agent',
  'x-requested-with'
];
/** Headers fetch() can't set in a plain browser (or that would need a CORS preflight). */
const APP_ONLY_HEADERS = new Set(['referer', 'user-agent']);

/** The frame's page; tests swap in the probe page. */
export const sandboxPage = { path: 'source-sandbox.html' };

const live = new Set<() => void>();

const pageUrl = (path: string) => new URL(`${pagePath}/${path}`, location.href).href;
const text = (value: unknown) =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
const object = (value: unknown, what: string) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExtensionError(`The extension's ${what} isn't what the app expects`);
  }
  return value as Record<string, unknown>;
};
const array = (value: unknown, what: string) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ExtensionError(`The extension's ${what} isn't a list`);
  return value as unknown[];
};
const headerMap = (value: unknown) =>
  Object.fromEntries(
    Object.entries(value && typeof value === 'object' ? value : {}).filter(
      ([key, header]) => SENT_HEADERS.includes(key.toLowerCase()) && typeof header === 'string'
    )
  ) as Record<string, string>;

function toList(value: unknown): ExtensionList {
  const page = object(value, 'list');
  return {
    list: array(page.list, 'list')
      .map((item) => {
        const work = object(item, 'list');
        return { name: text(work.name), link: text(work.link), imageUrl: text(work.imageUrl) };
      })
      .filter((work) => work.link),
    hasNextPage: page.hasNextPage === true
  };
}

function toDetail(value: unknown): ExtensionDetail {
  const detail = object(value, 'details');
  return {
    name: text(detail.name),
    imageUrl: text(detail.imageUrl),
    description: text(detail.description),
    author: text(detail.author),
    artist: text(detail.artist),
    status: typeof detail.status === 'number' ? detail.status : 5,
    genre: array(detail.genre, 'genres').map(text).filter(Boolean),
    chapters: array(detail.chapters, 'chapters')
      .map((item) => {
        const chapter = object(item, 'chapters');
        return {
          name: text(chapter.name),
          url: text(chapter.url),
          dateUpload: text(chapter.dateUpload),
          scanlator: text(chapter.scanlator)
        };
      })
      .filter((chapter) => chapter.url)
  };
}

function toImages(value: unknown): ExtensionImage[] {
  return array(value, 'pages')
    .map((item) =>
      typeof item === 'string'
        ? { url: item, headers: {} }
        : {
            url: text(object(item, 'pages').url),
            headers: headerMap((item as { headers?: unknown }).headers)
          }
    )
    .filter((image) => image.url);
}

function httpsHost(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

function decode(body: ArrayBuffer, type: string) {
  const charset = /charset=["']?([\w-]+)/i.exec(type)?.[1] || 'utf-8';
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder().decode(body);
  }
}

/** One GET for the extension or the app, Referer and NeedsAppError as described above. */
async function get(
  url: string,
  hosts: Set<string>,
  sent: Record<string, string>,
  proxy?: FetchOptions['proxy'],
  maxBytes?: number
) {
  const headers = { ...sent };
  let dropped = false;
  if (!nativeFetch() && !viaProxy(proxy)) {
    for (const key of Object.keys(headers)) {
      if (APP_ONLY_HEADERS.has(key.toLowerCase())) {
        dropped ||= key.toLowerCase() === 'referer';
        delete headers[key];
      }
    }
  }
  try {
    return await sourceFetch(url, { hosts, headers, proxy, maxBytes });
  } catch (error) {
    if (dropped && error instanceof FetchError && (error.status === 401 || error.status === 403)) {
      throw new NeedsAppError(new URL(url).hostname);
    }
    throw error;
  }
}

async function openFrame() {
  const jail = document.createElement('iframe');
  jail.src = pageUrl('source-jail.html');
  jail.setAttribute('aria-hidden', 'true');
  jail.tabIndex = -1;
  jail.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
  await new Promise((resolve, reject) => {
    // Cleared on load: left running, it removed every frame IDLE_MS after it opened.
    const late = setTimeout(() => {
      jail.remove();
      reject(new ExtensionError("The extension's frame didn't open"));
    }, IDLE_MS);
    jail.onload = () => {
      clearTimeout(late);
      jail.onload = null;
      resolve(undefined);
    };
    document.body.append(jail);
  });
  const jailDocument = jail.contentDocument;
  if (!jailDocument) throw new ExtensionError("The extension's frame didn't open");
  const frame = jailDocument.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.referrerPolicy = 'no-referrer';
  frame.src = pageUrl(sandboxPage.path);
  return { jail, jailDocument, frame };
}

export interface ExtensionRuntime {
  /** Hosts `image` may load from beyond the source's own, from the extension's results */
  readonly imageHosts: ReadonlySet<string>;
  /** Stopped (closed, crashed or ran too long): open it again */
  readonly stopped: boolean;
  popular(page: number): Promise<ExtensionList>;
  latest(page: number): Promise<ExtensionList>;
  search(query: string, page: number, filters?: unknown[]): Promise<ExtensionList>;
  detail(url: string): Promise<ExtensionDetail>;
  /** A chapter's page images in order (`work`: the work's link, for Manatan extensions) */
  chapterPages(url: string, work: string): Promise<Blob[]>;
  html(name: string, url: string, work?: string): Promise<string>;
  /** An image of the source (a cover or a page): its bytes and type */
  image(
    url: string,
    headers?: Record<string, string>
  ): Promise<{ body: ArrayBuffer; type: string }>;
  close(): void;
}

/** A Mangayomi extension's runtime: also its page list and headers. */
export interface MangayomiRuntime extends ExtensionRuntime {
  readonly source: ExtensionSource;
  pages(url: string): Promise<ExtensionImage[]>;
  headers(url: string): Promise<Record<string, string>>;
}

interface Waiting {
  resolve(value: string): void;
  reject(error: Error): void;
  fetches: number;
  needsApp?: NeedsAppError;
}

/**
 * Opens a frame for one extension and returns its call(); `onFetch` makes (or refuses) the
 * extension's requests, answering with the message the frame gets back.
 */
async function connect(
  format: 'mangayomi' | 'manatan2',
  load: Record<string, unknown>,
  onFetch: (message: Record<string, unknown>) => Promise<Record<string, unknown>>
) {
  const { jail, frame, jailDocument } = await openFrame();
  const channel = new MessageChannel();
  const port = channel.port1;
  const waiting = new Map<number, Waiting>();
  let seq = 0;
  let stopped = '';
  let idle: ReturnType<typeof setTimeout> | undefined;
  let outstanding = 0;
  let ready: { resolve(): void; reject(error: Error): void } | undefined;
  const started = new Promise<void>((resolve, reject) => (ready = { resolve, reject }));

  const stop = (why: string) => {
    if (stopped) return;
    stopped = why;
    clearTimeout(idle);
    live.delete(kill);
    jail.remove();
    port.close();
    ready?.reject(new ExtensionError(why));
    for (const call of waiting.values()) call.reject(new ExtensionError(why));
    waiting.clear();
  };
  const kill = () => stop('The extension stopped responding');
  live.add(kill);
  // Armed while the frame owes an answer: a call or init running and no request out.
  const watch = () => {
    clearTimeout(idle);
    if (stopped || (!waiting.size && !ready) || outstanding) return;
    idle = setTimeout(() => [...live].forEach((other) => other()), IDLE_MS);
  };

  let loads = 0;
  frame.addEventListener('load', () => {
    // A second load: the extension navigated its frame.
    if ((loads += 1) > 1) return stop('The extension tried to leave its frame');
    frame.contentWindow?.postMessage({ op: 'init', v: PROTOCOL, format }, '*', [channel.port2]);
  });

  const fetched = async (id: number, message: Record<string, unknown>) => {
    // Calls run one at a time, so a request belongs to the one waiting.
    const [call] = waiting.values();
    outstanding += 1;
    watch();
    let reply: Record<string, unknown>;
    try {
      if (!call) throw new Error('No call is running');
      if ((call.fetches += 1) > MAX_FETCHES)
        throw new Error(`More than ${MAX_FETCHES} requests in one call`);
      reply = await onFetch(message);
    } catch (error) {
      if (error instanceof NeedsAppError && call) call.needsApp = error;
      reply = { op: 'failed', message: (error as Error).message };
    }
    outstanding -= 1;
    const body = (reply.response as { body?: unknown } | undefined)?.body;
    if (!stopped) port.postMessage({ id, ...reply }, body instanceof ArrayBuffer ? [body] : []);
    watch();
  };

  port.onmessage = ({ data }: MessageEvent<Record<string, unknown>>) => {
    if (stopped || !data || typeof data !== 'object') return;
    if (data.op === 'ready') {
      if (data.v !== PROTOCOL)
        return stop('The extension runtime is from another version: reload the app');
      ready?.resolve();
      ready = undefined;
      return watch();
    }
    if (data.op === 'gone') return stop('The extension tried to leave its frame');
    if (data.op === 'dead') return stop(text(data.message) || 'The extension was stopped');
    if (data.op === 'fatal')
      return stop(`The extension runtime didn't start: ${text(data.message)}`);
    if (data.op === 'fetch') return void fetched(Number(data.id), data);
    const call = waiting.get(Number(data.id));
    if (!call) return;
    waiting.delete(Number(data.id));
    watch();
    if (call.needsApp) call.reject(call.needsApp);
    else if (data.op === 'result') call.resolve(text(data.value));
    else call.reject(new ExtensionError(text(data.message) || 'The extension failed'));
  };

  // One call at a time: the frame frees its parsed pages after each.
  let queue: Promise<unknown> = Promise.resolve();
  const send = (message: Record<string, unknown>) => {
    const result = queue.then(
      () =>
        new Promise<string>((resolve, reject) => {
          if (stopped) return reject(new ExtensionError(stopped));
          const id = ++seq;
          waiting.set(id, { resolve, reject, fetches: 0 });
          port.postMessage({ ...message, id });
          watch();
        })
    );
    queue = result.catch(() => undefined);
    return result;
  };

  jailDocument.body.append(frame);
  watch();
  try {
    await started;
    // Copied, not transferred: the caller may open the same code again.
    await send({ op: 'load', ...load });
  } catch (error) {
    stop((error as Error).message);
    throw error;
  }
  return {
    call: (method: string, args: unknown[]) => send({ op: 'call', method, args }),
    stop,
    stopped: () => !!stopped
  };
}

/**
 * Starts `code` (the extension's JS) for `source`; ExtensionError if it doesn't load. `repo` (the
 * repository's index.json URL) lets the server edition's fetch proxy check the source's hosts.
 */
export async function openExtension(
  code: string,
  source: ExtensionSource,
  repo?: string
): Promise<MangayomiRuntime> {
  const proxy = repo && typeof source.id === 'number' ? { repo, source: source.id } : undefined;
  const hosts = new Set(
    [httpsHost(source.baseUrl), httpsHost(text(source.apiUrl))].filter(Boolean)
  );
  const imageHosts = new Set<string>();

  const onFetch = async (message: Record<string, unknown>) => {
    const url = text(message.url);
    if (message.method !== 'GET')
      throw new Error(`${text(message.method)} requests aren't supported yet`);
    if (!hosts.has(httpsHost(url))) throw new Error(`Not a host this extension may fetch (${url})`);
    try {
      const fetched = await get(url, hosts, headerMap(message.headers), proxy);
      return {
        op: 'fetched',
        response: {
          body: decode(fetched.body, fetched.type),
          statusCode: 200,
          headers: { 'content-type': fetched.type },
          request: { url: fetched.url, method: 'GET' }
        }
      };
    } catch (error) {
      if (!(error instanceof FetchError && error.status)) throw error;
      return {
        op: 'fetched',
        response: {
          body: '',
          statusCode: error.status,
          headers: {},
          request: { url, method: 'GET' }
        }
      };
    }
  };
  const runtime = await connect(
    'mangayomi',
    { code, source: JSON.parse(JSON.stringify(source)) },
    onFetch
  );
  const call = async (method: string, ...args: unknown[]) => {
    const value = await runtime.call(method, args);
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new ExtensionError("The extension's answer isn't JSON");
    }
  };
  const noteImages = (urls: string[]) => {
    for (const url of urls) {
      const host = httpsHost(url);
      if (host) imageHosts.add(host);
    }
  };
  const image = async (url: string, sent: Record<string, string> = {}) => {
    const host = httpsHost(url);
    if (!hosts.has(host) && !imageHosts.has(host)) {
      throw new FetchError(`Not a host this extension may fetch (${url})`);
    }
    const answer = await get(url, new Set([...hosts, ...imageHosts]), headerMap(sent));
    if (!/^image\//i.test(answer.type)) throw new FetchError(`${host} didn't send an image`);
    return { body: answer.body, type: answer.type };
  };
  const pages = async (url: string) => {
    const images = toImages(await call('getPageList', url));
    noteImages(images.map((found) => found.url));
    return images;
  };

  return {
    source,
    imageHosts,
    get stopped() {
      return runtime.stopped();
    },
    popular: async (page) => toList(await call('getPopular', page)),
    latest: async (page) => toList(await call('getLatestUpdates', page)),
    search: async (query, page, filters = []) => toList(await call('search', query, page, filters)),
    detail: async (url) => {
      const detail = toDetail(await call('getDetail', url));
      noteImages([detail.imageUrl]);
      return detail;
    },
    pages,
    chapterPages: async (url) => {
      const blobs: Blob[] = [];
      for (const page of await pages(url)) {
        const found = await image(page.url, page.headers);
        blobs.push(new Blob([found.body], { type: found.type }));
      }
      return blobs;
    },
    html: async (name, url) => {
      const value = await call('getHtmlContent', name, url);
      if (typeof value !== 'string') throw new ExtensionError("The extension's chapter isn't text");
      return value;
    },
    headers: async (url) => headerMap(await call('getHeaders', url)),
    image,
    close: () => runtime.stop('Closed')
  };
}

// Manatan v2 extensions -----------------------------------------------------------------------

/** What a Manatan package's manifest.json says about one of its sources. */
export interface ManatanSource {
  id: string;
  name: string;
  contentType: string;
  listings?: { id: string; name?: string }[];
  capabilities?: { pageProcessing?: boolean };
}

/** Headers a Manatan extension may send (it also asks for Range, for parts of an archive). */
const MANATAN_HEADERS = [...SENT_HEADERS, 'range'];

/** `permissions.network.allow` entries (`https://host` or `https://*.domain`) as a host test. */
export function allowedHosts(allow: unknown) {
  const exact = new Set<string>();
  const suffixes: string[] = [];
  for (const entry of Array.isArray(allow) ? allow : []) {
    const match = /^https:\/\/(\*\.)?([a-z0-9.-]+)\/?$/i.exec(text(entry));
    if (!match) continue;
    if (match[1]) suffixes.push(`.${match[2].toLowerCase()}`);
    else exact.add(match[2].toLowerCase());
  }
  return {
    exact,
    has: (host: string) => !!host && (exact.has(host) || suffixes.some((s) => host.endsWith(s)))
  };
}

/** The image type of `bytes` by their first bytes, '' if they aren't an image. */
function sniffImage(bytes: Uint8Array) {
  const starts = (...values: number[]) => values.every((value, i) => bytes[i] === value);
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  const ascii = new TextDecoder().decode(bytes.slice(0, 12));
  if (ascii.startsWith('RIFF') && ascii.endsWith('WEBP')) return 'image/webp';
  if (ascii.slice(4, 8) === 'ftyp' && /avi[fs]/.test(ascii)) return 'image/avif';
  return '';
}

function base64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);

/**
 * Starts a Manatan v2 extension (`wasm`, its component) for one of its package's sources. Requests
 * go only to the hosts of `allow` (the package manifest's `permissions.network.allow`), GET only,
 * headers from the allow list plus Range; covers and pages only from those hosts too, and a page
 * counts only when its final bytes are an image. Calls are the guest's JSON functions
 * (`manga-list`, `novel-text`…), mapped onto the runtime's methods here.
 */
export async function openManatan(
  wasm: ArrayBuffer,
  source: ManatanSource,
  allow: unknown
): Promise<ExtensionRuntime> {
  const hosts = allowedHosts(allow);
  const kind = source.contentType === 'novel' ? 'novel' : 'manga';
  const field = kind === 'manga' ? 'manga' : 'item';

  const fetchFor = async (url: string, sent: Record<string, string>, maxBytes?: number) => {
    const host = httpsHost(url);
    if (!hosts.has(host)) throw new Error(`Not a host this extension may fetch (${url})`);
    // The guest's own cap only ever lowers the transport's.
    const cap = maxBytes && maxBytes < 20 * 1024 * 1024 ? Math.max(1, maxBytes) : undefined;
    return get(url, new Set([...hosts.exact, host]), sent, undefined, cap);
  };
  const onFetch = async (message: Record<string, unknown>) => {
    const request = object(message.request, 'request');
    const url = text(request.url);
    if (request.method !== 'GET')
      throw new Error(`${text(request.method)} requests aren't supported yet`);
    const sent = Object.fromEntries(
      array(request.headers, 'request')
        .filter(
          (pair): pair is [string, string] =>
            Array.isArray(pair) &&
            typeof pair[1] === 'string' &&
            MANATAN_HEADERS.includes(text(pair[0]).toLowerCase())
        )
        .map(([key, value]) => [key, value])
    );
    const maxBytes = typeof request.maxBytes === 'number' ? request.maxBytes : undefined;
    try {
      const answer = await fetchFor(url, sent, maxBytes);
      return {
        op: 'fetched',
        response: {
          status: answer.status,
          headers: [
            ['content-type', answer.type],
            ...(answer.range ? [['content-range', answer.range]] : [])
          ],
          finalUrl: answer.url,
          body: answer.body
        }
      };
    } catch (error) {
      if (!(error instanceof FetchError && error.status)) throw error;
      return {
        op: 'fetched',
        response: { status: error.status, headers: [], finalUrl: url, body: new ArrayBuffer(0) }
      };
    }
  };
  const runtime = await connect('manatan2', { code: wasm }, onFetch);
  const call = async (name: string, request: unknown) => {
    const value = await runtime.call(`${name}`, [source.id, JSON.stringify(request)]);
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new ExtensionError("The extension's answer isn't JSON");
    }
  };

  const listing = (id: string, fallback: number) =>
    source.listings?.find((l) => l.id === id)?.id ?? source.listings?.[fallback]?.id ?? id;
  const toWorks = (value: unknown): ExtensionList => {
    const page = object(value, 'list');
    return {
      list: array(page.entries, 'list')
        .map((entry) => {
          const item = object(entry, 'list');
          const cover = item.cover && typeof item.cover === 'object' ? item.cover : {};
          return {
            name: text(item.title),
            link: text(item.key),
            imageUrl: text((cover as { url?: unknown }).url)
          };
        })
        .filter((work) => work.link),
      hasNextPage: page.hasNextPage === true
    };
  };
  // A work's item and chapters as the extension gave them: the next calls take them whole.
  const works = new Map<string, { item: unknown; chapters: Record<string, unknown>[] }>();
  const work = async (key: string) => {
    const known = works.get(key);
    if (known) return known;
    const item = object(await call(`${kind}-details`, { [field]: { key, title: '' } }), 'details');
    const chapters = array(await call(`${kind}-chapters`, { [field]: item }), 'chapters').map(
      (chapter) => object(chapter, 'chapters')
    );
    const found = { item, chapters };
    works.set(key, found);
    return found;
  };
  const chapterOf = (found: { chapters: Record<string, unknown>[] }, key: string) =>
    found.chapters.find((chapter) => chapter.key === key) ?? { key };
  const coverImage = async (url: string, sent: Record<string, string> = {}) => {
    const answer = await fetchFor(url, headerMap(sent));
    const type = sniffImage(new Uint8Array(answer.body));
    if (!type) throw new FetchError(`${httpsHost(url)} didn't send an image`);
    return { body: answer.body, type };
  };

  return {
    imageHosts: new Set(),
    get stopped() {
      return runtime.stopped();
    },
    popular: async (page) =>
      toWorks(await call(`${kind}-list`, { listing: listing('popular', 0), page })),
    latest: async (page) =>
      toWorks(await call(`${kind}-list`, { listing: listing('latest', 1), page })),
    search: async (query, page) => toWorks(await call(`${kind}-search`, { query, page })),
    detail: async (key) => {
      works.delete(key);
      const found = await work(key);
      const item = found.item as Record<string, unknown>;
      const cover = item.cover && typeof item.cover === 'object' ? item.cover : {};
      const status = text(item.status).toLowerCase();
      const number = (chapter: Record<string, unknown>) =>
        typeof chapter.chapterNumber === 'number' ? chapter.chapterNumber : NaN;
      // Newest first, as Mangayomi lists them (extensions.ts turns them round); the order
      // differs per extension, so by number where every chapter has one.
      const chapters = found.chapters.every((c) => !Number.isNaN(number(c)))
        ? [...found.chapters].sort((a, b) => number(b) - number(a))
        : found.chapters;
      return {
        name: text(item.title),
        imageUrl: text((cover as { url?: unknown }).url),
        description: text(item.description),
        author: array(item.authors, 'authors').map(text).join(', '),
        artist: array(item.artists, 'artists').map(text).join(', '),
        status: /complet|finish|end/.test(status) ? 1 : /ongoing|publish/.test(status) ? 0 : 5,
        genre: array(item.tags, 'tags').map(text).filter(Boolean),
        chapters: chapters
          .map((chapter) => {
            const date = typeof chapter.dateUploaded === 'number' ? chapter.dateUploaded : 0;
            return {
              name: text(chapter.title) || `Chapter ${text(chapter.chapterNumber)}`,
              url: text(chapter.key),
              // seconds or ms
              dateUpload: date ? String(date < 1e11 ? date * 1000 : date) : '',
              scanlator: array(chapter.scanlators, 'scanlators').map(text).join(', ')
            };
          })
          .filter((chapter) => chapter.url)
      };
    },
    chapterPages: async (key, workKey) => {
      const found = await work(workKey);
      const context = { manga: found.item, chapter: chapterOf(found, key) };
      const blobs: Blob[] = [];
      for (const raw of array(await call('manga-pages', context), 'pages')) {
        const page = object(raw, 'pages');
        const content = object(page.content, 'pages');
        let bytes: Uint8Array;
        let type = '';
        if (content.inline) {
          const inline = object(content.inline, 'pages');
          bytes = Uint8Array.from(atob(text(inline.dataBase64)), (c) => c.charCodeAt(0));
        } else {
          const target = await call('manga-resolve-page-image', { ...context, page });
          if (!target) continue;
          const resolved = object(target, 'pages');
          const answer = await fetchFor(text(resolved.url), headerMap(resolved.headers));
          bytes = new Uint8Array(answer.body);
          type = answer.type;
        }
        if (source.capabilities?.pageProcessing) {
          const processed = await call('manga-process-page-image', {
            ...context,
            page,
            imageBase64: base64(bytes),
            mimeType: type || null
          });
          if (processed) {
            bytes = Uint8Array.from(
              array(object(processed, 'pages').bytes, 'pages').map((b) => Number(b) & 255)
            );
          }
        }
        const sniffed = sniffImage(bytes);
        if (!sniffed) throw new ExtensionError("The extension's page isn't an image");
        blobs.push(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: sniffed }));
      }
      return blobs;
    },
    html: async (_, key, workKey = '') => {
      const found = await work(workKey);
      const chapter = object(
        await call('novel-text', { item: found.item, chapter: chapterOf(found, key) }),
        'chapter'
      );
      if (typeof chapter.html === 'string') return chapter.html;
      return text(chapter.text)
        .split(/\n+/)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('');
    },
    image: coverImage,
    close: () => runtime.stop('Closed')
  };
}
