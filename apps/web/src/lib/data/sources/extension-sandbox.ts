/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The runtime of a source extension's frame (static/source-sandbox.html), built by vite.config.js
 * into one classic script, source-sandbox.js: the frame has an opaque origin, which can't load
 * module chunks without CORS. Never imported by the app.
 *
 * The extension (Mangayomi's JS format: `class DefaultExtension extends MProvider`) runs in
 * QuickJS, so it sees only what PRELUDE gives it: no fetch, DOM, storage or timers. Its requests
 * go to the app over the MessageChannel the app hands over at init (extension-runtime.ts checks
 * and makes them); HTML is parsed by this frame's DOMParser and reached through numbered nodes.
 * Every slice of extension code is interrupted after SLICE_MS, so an endless loop stalls the app
 * at most that long, even where the frame shares the app's thread (Firefox, Android WebView).
 * The frame itself (sandbox without allow-same-origin, no-network CSP, inside the app's
 * source-jail.html) is the second wall, for a bug in QuickJS or in this bridge.
 */

import { newQuickJSWASMModuleFromVariant, type QuickJSHandle } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-browser-release-sync';

/** Bumped when the messages change; the app refuses a frame of another version (cached app). */
const PROTOCOL = 1;
const SLICE_MS = 500;
/** CPU time one call may use across all its slices */
const CALL_MS = 10_000;
const MAX_NODES = 200_000;

// Mangayomi's injected API (lib/eval/javascript/*.dart in the Mangayomi app), as far as the
// extensions we run use it. Not supported (they throw): xpath, crypto and unpacking helpers,
// WebView evaluation, HLS and EPUB helpers.
const PRELUDE = String.raw`
class Element {
  constructor(key) { this.key = key; }
  _s(type) { return __dom('str', this.key, type, ''); }
  _list(type, arg) { return JSON.parse(__dom('list', this.key, type, arg == null ? '' : String(arg))).map((k) => new Element(k)); }
  _one(type, arg) { const k = __dom('one', this.key, type, arg == null ? '' : String(arg)); return k < 0 ? null : new Element(k); }
  _match(re) { const m = re.exec(this.outerHtml); return m ? m[1] : ''; }
  get text() { return this._s('text'); }
  get innerHtml() { return this._s('innerHtml'); }
  get outerHtml() { return this._s('outerHtml'); }
  get className() { return this._s('className'); }
  get localName() { return this._s('localName'); }
  get namespaceUri() { return this._s('namespaceUri'); }
  get id() { return this.attr('id'); }
  get getSrc() { return this._match(/src="([^"]+)"/); }
  get getImg() { return this._match(/img="([^"]+)"/); }
  get getHref() { return this._match(/href="([^"]+)"/); }
  get getDataSrc() { return this._match(/data-src="([^"]+)"/); }
  attr(name) { return __dom('attr', this.key, String(name), ''); }
  hasAttr(name) { return __dom('hasAttr', this.key, String(name), '') === 'true'; }
  get children() { return this._list('children'); }
  getElementsByTagName(name) { return this._list('tag', name); }
  getElementsByClassName(name) { return this._list('class', name); }
  select(css) { return this._list('select', css); }
  selectFirst(css) { return this._one('select', css); }
  get nextElementSibling() { return this._one('next'); }
  get previousElementSibling() { return this._one('prev'); }
  get parent() { return this._one('parent'); }
  xpath() { throw new Error('xpath is not supported'); }
  xpathFirst() { throw new Error('xpath is not supported'); }
}
class Document extends Element {
  constructor(html) { super(__dom('parse', -1, String(html ?? ''), '')); }
  get body() { return this._one('body'); }
  get head() { return this._one('head'); }
  get documentElement() { return this._one('root'); }
  getElementById(id) { return this._one('id', id); }
}
class Client {
  constructor() {}
  async _send(method, url, headers, body) {
    const text = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    return JSON.parse(await __fetch(method, String(url), JSON.stringify(headers || {}), text));
  }
  get(url, headers) { return this._send('GET', url, headers); }
  head(url, headers) { return this._send('HEAD', url, headers); }
  post(url, headers, body) { return this._send('POST', url, headers, body); }
  put(url, headers, body) { return this._send('PUT', url, headers, body); }
  delete(url, headers, body) { return this._send('DELETE', url, headers, body); }
  patch(url, headers, body) { return this._send('PATCH', url, headers, body); }
}
class MProvider {
  get source() { return __source; }
  get supportsLatest() { return true; }
  getHeaders(url) { return {}; }
}
for (const name of ['getPopular', 'getLatestUpdates', 'search', 'getDetail', 'getPageList', 'getHtmlContent', 'getFilterList', 'getSourcePreferences']) {
  MProvider.prototype[name] = function () { throw new Error(name + ' not implemented'); };
}
const __prefs = {};
class SharedPreferences {
  get(key) {
    let pref;
    try { pref = globalThis.__ext.getSourcePreferences().find((p) => p.key === key); } catch (e) { return null; }
    const list = pref && pref.listPreference;
    if (list) return (list.entryValues || [])[list.valueIndex || 0] ?? null;
    const value = pref && (pref.switchPreferenceCompat || pref.checkBoxPreference || pref.editTextPreference);
    return value ? value.value : pref && pref.multiSelectListPreference ? pref.multiSelectListPreference.values : null;
  }
  getString(key, fallback) { return key in __prefs ? __prefs[key] : fallback; }
  setString(key, value) { __prefs[key] = value; return true; }
}
function parseDates(values) { return values.map((v) => String(Date.parse(v) || 0)); }
for (const name of ['cryptoHandler', 'encryptAESCryptoJS', 'decryptAESCryptoJS', 'decryptAESGCM', 'deobfuscateJsPassword', 'unpackJs', 'unpackJsAndCombine', 'evaluateJavascriptViaWebview', 'createHlsProxyUrl', 'parseEpub', 'parseEpubChapter']) {
  globalThis[name] = () => { throw new Error(name + ' is not supported'); };
}
const __quiet = () => {};
globalThis.console = { log: __quiet, warn: __quiet, error: __quiet, info: __quiet, debug: __quiet };
String.prototype.substringAfter = function (p) { const i = this.indexOf(p); return i === -1 ? this.substring(0) : this.substring(i + p.length); };
String.prototype.substringAfterLast = function (p) { return this.split(p).pop(); };
String.prototype.substringBefore = function (p) { const i = this.indexOf(p); return i === -1 ? this.substring(0) : this.substring(0, i); };
String.prototype.substringBeforeLast = function (p) { const i = this.lastIndexOf(p); return i === -1 ? this.substring(0) : this.substring(0, i); };
String.prototype.substringBetween = function (l, r) { const i = this.indexOf(l); if (i === -1) return ''; const j = this.indexOf(r, i + l.length); return j === -1 ? '' : this.substring(i + l.length, j); };
Object.assign(globalThis, { Element, Document, Client, MProvider, SharedPreferences, parseDates });
`;

type Message = { op: string; id: number; [key: string]: unknown };

// WebRTC reaches any host:port over UDP and no CSP directive stops it (Chromium ignores
// `webrtc 'block'`); child frames of this opaque-origin document can't hand a fresh copy back.
for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection']) {
  delete (globalThis as any)[name];
}

let port: MessagePort | undefined;

/** Starts QuickJS and answers the app's messages on `channel`. */
async function start(channel: MessagePort) {
  const QuickJS = await newQuickJSWASMModuleFromVariant(variant);
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(64 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  let deadline = Infinity;
  let budget = CALL_MS;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  const parser = new DOMParser();
  // Nodes the extension holds, freed after each call (calls come one at a time).
  let nodes: Node[] = [];
  const pending = new Map<number, ReturnType<typeof vm.newPromise>>();
  let fetchId = 0;

  /** Runs `work` as one slice of extension code: interrupted after SLICE_MS or the call's budget. */
  const slice = <T>(work: () => T) => {
    const started = Date.now();
    deadline = started + Math.min(SLICE_MS, budget);
    try {
      return work();
    } finally {
      deadline = Infinity;
      budget -= Date.now() - started;
    }
  };
  const failure = (handle: QuickJSHandle) => {
    const error = vm.dump(handle);
    handle.dispose();
    return new Error(String(error?.message ?? error));
  };
  const pump = () => {
    const result = slice(() => runtime.executePendingJobs());
    if (result.error) throw failure(result.error);
  };
  const run = (code: string) => {
    const result = slice(() => vm.evalCode(code));
    if (result.error) throw failure(result.error);
    return result.value;
  };

  const add = (node: Node | null | undefined) => {
    if (!node) return -1;
    if (nodes.length >= MAX_NODES) throw new Error('Too many elements');
    nodes.push(node);
    return nodes.length - 1;
  };
  const element = (node: Node) =>
    (node instanceof Document ? node.documentElement : node) as Element;
  const lists: Record<string, (node: Element, arg: string) => Iterable<Node>> = {
    children: (node) => node.children,
    tag: (node, arg) => node.getElementsByTagName(arg),
    class: (node, arg) => node.getElementsByClassName(arg),
    select: (node, arg) => node.querySelectorAll(arg)
  };
  const ones: Record<string, (node: Node, arg: string) => Node | null | undefined> = {
    select: (node, arg) => (node as Element).querySelector(arg),
    next: (node) => (node as Element).nextElementSibling,
    prev: (node) => (node as Element).previousElementSibling,
    parent: (node) => node.parentElement,
    body: (node) => (node as Document).body,
    head: (node) => (node as Document).head,
    root: (node) => (node as Document).documentElement,
    id: (node, arg) => (node as Document).getElementById(arg)
  };
  const strings: Record<string, (node: Element) => string | null | undefined> = {
    text: (node) => node.textContent,
    innerHtml: (node) => node.innerHTML,
    outerHtml: (node) => node.outerHTML,
    className: (node) => node.className,
    localName: (node) => node.localName,
    namespaceUri: (node) => node.namespaceURI
  };
  const dom = (op: string, key: number, a: string, b: string): string | number => {
    if (op === 'parse') return add(parser.parseFromString(a, 'text/html'));
    const node = nodes[key];
    if (!node) throw new Error('This element is gone (elements last one call)');
    if (op === 'str') return strings[a]?.(element(node)) ?? '';
    if (op === 'attr') return element(node).getAttribute?.(a) ?? '';
    if (op === 'hasAttr') return String(!!element(node).hasAttribute?.(a));
    if (op === 'list') {
      const target =
        lists[a] && (node instanceof Document && a === 'children' ? node : element(node));
      return JSON.stringify(target ? [...lists[a](target as Element, b)].map(add) : []);
    }
    if (op === 'one') return add(ones[a]?.(a === 'select' ? element(node) : node, b));
    throw new Error(`Unknown element operation ${op}`);
  };

  const domFn = vm.newFunction('__dom', (...args) => {
    const [op, key, a, b] = args.map((arg) => vm.dump(arg));
    const value = dom(op, key, a, b);
    return typeof value === 'number' ? vm.newNumber(value) : vm.newString(value);
  });
  vm.setProp(vm.global, '__dom', domFn);
  domFn.dispose();
  const fetchFn = vm.newFunction('__fetch', (...args) => {
    const [method, url, headers, body] = args.map((arg) => vm.getString(arg));
    const promise = vm.newPromise();
    const id = ++fetchId;
    pending.set(id, promise);
    channel.postMessage({ op: 'fetch', id, method, url, headers: JSON.parse(headers), body });
    promise.settled.then(() => {
      try {
        pump();
      } catch {
        // The call's own promise rejects with this error.
      }
    });
    return promise.handle;
  });
  vm.setProp(vm.global, '__fetch', fetchFn);
  fetchFn.dispose();
  run(PRELUDE).dispose();

  async function call(method: string, args: unknown[]) {
    budget = CALL_MS;
    try {
      const handle = run(
        `(async () => JSON.stringify(await __ext[${JSON.stringify(method)}](...${JSON.stringify(args)}) ?? null))()`
      );
      const settled = vm.resolvePromise(handle);
      handle.dispose();
      pump();
      const result = await settled;
      if (result.error) throw failure(result.error);
      const text = vm.getString(result.value);
      result.value.dispose();
      return text;
    } finally {
      nodes = [];
    }
  }

  channel.onmessage = async ({ data }: MessageEvent<Message>) => {
    if (data.op === 'fetched' || data.op === 'failed') {
      const promise = pending.get(data.id);
      pending.delete(data.id);
      if (!promise) return;
      const value =
        data.op === 'fetched'
          ? vm.newString(JSON.stringify(data.response))
          : vm.newError(String(data.message));
      if (data.op === 'fetched') promise.resolve(value);
      else promise.reject(value);
      value.dispose();
      return;
    }
    try {
      let value = '';
      if (data.op === 'load') {
        const source = vm.newString(JSON.stringify(data.source ?? {}));
        vm.setProp(vm.global, '__sourceJSON', source);
        source.dispose();
        budget = CALL_MS;
        run(
          `globalThis.__source = JSON.parse(__sourceJSON);\n(() => {\n${data.code}\n;globalThis.__ext = new DefaultExtension();\n})()`
        ).dispose();
      } else if (data.op === 'call') {
        value = await call(String(data.method), data.args as unknown[]);
      } else return;
      channel.postMessage({ op: 'result', id: data.id, value });
    } catch (error) {
      channel.postMessage({
        op: 'error',
        id: data.id,
        message: String((error as Error)?.message ?? error)
      });
    }
  };
  // A navigation the jail blocks leaves no load event to see: say so before this page goes.
  addEventListener('pagehide', () => channel.postMessage({ op: 'gone' }));
  channel.postMessage({ op: 'ready', v: PROTOCOL });
}

// Only ever inside the app's sandboxed frame: opened as a page, it would run with the app's origin.
if (self.origin === 'null') {
  addEventListener('message', function first(event) {
    // The app posts from its own window, two levels up (app > source-jail.html > this frame).
    if (port || event.source !== parent.parent || !event.ports[0]) return;
    removeEventListener('message', first);
    port = event.ports[0];
    start(port).catch((error) =>
      port?.postMessage({ op: 'fatal', message: String(error?.message ?? error) })
    );
  });
}
