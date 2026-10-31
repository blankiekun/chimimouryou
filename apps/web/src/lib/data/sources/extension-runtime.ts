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
  id?: number;
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

const PROTOCOL = 1;
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
  proxy?: FetchOptions['proxy']
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
    return await sourceFetch(url, { hosts, headers, proxy });
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
  readonly source: ExtensionSource;
  /** Hosts `image` may load from beyond the source's own, from the extension's results */
  readonly imageHosts: ReadonlySet<string>;
  popular(page: number): Promise<ExtensionList>;
  latest(page: number): Promise<ExtensionList>;
  search(query: string, page: number, filters?: unknown[]): Promise<ExtensionList>;
  detail(url: string): Promise<ExtensionDetail>;
  pages(url: string): Promise<ExtensionImage[]>;
  html(name: string, url: string): Promise<string>;
  headers(url: string): Promise<Record<string, string>>;
  /** An image of the source (a cover or a page): its bytes and type */
  image(
    url: string,
    headers?: Record<string, string>
  ): Promise<{ body: ArrayBuffer; type: string }>;
  close(): void;
}

/**
 * Starts `code` (the extension's JS) for `source`; ExtensionError if it doesn't load. `repo` (the
 * repository's index.json URL) lets the server edition's fetch proxy check the source's hosts.
 */
export async function openExtension(
  code: string,
  source: ExtensionSource,
  repo?: string
): Promise<ExtensionRuntime> {
  const proxy = repo && typeof source.id === 'number' ? { repo, source: source.id } : undefined;
  const hosts = new Set(
    [httpsHost(source.baseUrl), httpsHost(text(source.apiUrl))].filter(Boolean)
  );
  const imageHosts = new Set<string>();
  const { jail, frame, jailDocument } = await openFrame();
  const channel = new MessageChannel();
  const port = channel.port1;
  const waiting = new Map<
    number,
    {
      resolve(value: string): void;
      reject(error: Error): void;
      fetches: number;
      needsApp?: NeedsAppError;
    }
  >();
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
    frame.contentWindow?.postMessage({ op: 'init', v: PROTOCOL }, '*', [channel.port2]);
  });

  const onFetch = async (id: number, message: Record<string, unknown>) => {
    // Calls run one at a time, so a request belongs to the one waiting.
    const [call] = waiting.values();
    const answer = (reply: Record<string, unknown>) => {
      outstanding -= 1;
      if (!stopped) port.postMessage({ id, ...reply });
      watch();
    };
    outstanding += 1;
    watch();
    const url = text(message.url);
    try {
      if (!call) throw new Error('No call is running');
      if ((call.fetches += 1) > MAX_FETCHES)
        throw new Error(`More than ${MAX_FETCHES} requests in one call`);
      if (message.method !== 'GET')
        throw new Error(`${text(message.method)} requests aren't supported yet`);
      if (!hosts.has(httpsHost(url)))
        throw new Error(`Not a host this extension may fetch (${url})`);
      const fetched = await get(url, hosts, headerMap(message.headers), proxy);
      answer({
        op: 'fetched',
        response: {
          body: decode(fetched.body, fetched.type),
          statusCode: 200,
          headers: { 'content-type': fetched.type },
          request: { url: fetched.url, method: 'GET' }
        }
      });
    } catch (error) {
      if (error instanceof NeedsAppError && call) call.needsApp = error;
      if (error instanceof FetchError && error.status) {
        answer({
          op: 'fetched',
          response: {
            body: '',
            statusCode: error.status,
            headers: {},
            request: { url, method: 'GET' }
          }
        });
      } else answer({ op: 'failed', message: (error as Error).message });
    }
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
    if (data.op === 'fatal')
      return stop(`The extension runtime didn't start: ${text(data.message)}`);
    if (data.op === 'fetch') return void onFetch(Number(data.id), data);
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
  const call = async (method: string, ...args: unknown[]) => {
    const value = await send({ op: 'call', method, args });
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

  jailDocument.body.append(frame);
  watch();
  try {
    await started;
    await send({ op: 'load', code, source: JSON.parse(JSON.stringify(source)) });
  } catch (error) {
    stop((error as Error).message);
    throw error;
  }

  return {
    source,
    imageHosts,
    popular: async (page) => toList(await call('getPopular', page)),
    latest: async (page) => toList(await call('getLatestUpdates', page)),
    search: async (query, page, filters = []) => toList(await call('search', query, page, filters)),
    detail: async (url) => {
      const detail = toDetail(await call('getDetail', url));
      noteImages([detail.imageUrl]);
      return detail;
    },
    pages: async (url) => {
      const images = toImages(await call('getPageList', url));
      noteImages(images.map((image) => image.url));
      return images;
    },
    html: async (name, url) => {
      const value = await call('getHtmlContent', name, url);
      if (typeof value !== 'string') throw new ExtensionError("The extension's chapter isn't text");
      return value;
    },
    headers: async (url) => headerMap(await call('getHeaders', url)),
    image: async (url, sent = {}) => {
      const host = httpsHost(url);
      if (!hosts.has(host) && !imageHosts.has(host)) {
        throw new FetchError(`Not a host this extension may fetch (${url})`);
      }
      const answer = await get(url, new Set([...hosts, ...imageHosts]), headerMap(sent));
      if (!/^image\//i.test(answer.type)) throw new FetchError(`${host} didn't send an image`);
      return { body: answer.body, type: answer.type };
    },
    close: () => stop('Closed')
  };
}
