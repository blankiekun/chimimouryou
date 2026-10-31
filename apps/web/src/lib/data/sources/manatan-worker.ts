/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * A Manatan v2 extension (a WebAssembly component of the `manatan:extensions/extension@2.0.0`
 * world) running in a Worker that the extension's frame makes from a blob (extension-sandbox.ts;
 * vite.config.js builds this file into a string for it). The worker inherits the frame's
 * no-network CSP; the frame terminates it at its deadline.
 *
 * Our own loader for this one world, no component runtime: it interprets the component's
 * sections (core modules, core instances, aliases, canon lift/lower, nested components, imports,
 * exports) and refuses anything else (resources, async, start functions, UTF-16, other imports).
 * Types aren't read: every function is lifted or lowered by its WIT name, whose shape the
 * `@2.0.0` world fixes. The guest's `net.fetch` is synchronous; JSPI (WebAssembly.Suspending /
 * promising) suspends the guest while the app makes the request. Every memory is capped at
 * MAX_PAGES before compiling, so a guest that grows past it traps.
 */

/** 256 MB */
const MAX_PAGES = 4096;
const WORLD = 'manatan:extensions';
const VERSION = '@2.0.0';

type Value = any;
interface Opts {
  memory?: WebAssembly.Memory;
  realloc?: (old: number, size: number, align: number, length: number) => number;
  post?: (ptr: number) => void;
}
interface Lifted {
  lift: { fn: (...args: number[]) => number; opts: Opts };
}
interface HostFn {
  host: string;
}

class Refused extends Error {}

class Reader {
  i = 0;
  b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
  }
  byte() {
    if (this.i >= this.b.length) throw new Refused('Truncated component');
    return this.b[this.i++];
  }
  u32() {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.byte();
      result += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return result;
      shift += 7;
      if (shift > 35) throw new Refused('Bad number in component');
    }
  }
  bytes(n: number) {
    if (this.i + n > this.b.length) throw new Refused('Truncated component');
    const out = this.b.subarray(this.i, this.i + n);
    this.i += n;
    return out;
  }
  name() {
    return new TextDecoder().decode(this.bytes(this.u32()));
  }
  get done() {
    return this.i >= this.b.length;
  }
}

function leb(value: number) {
  const out = [];
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 128);
    if (value) byte |= 0x80;
    out.push(byte);
  } while (value);
  return out;
}

/** The core module with every memory capped at MAX_PAGES. */
export function capMemory(module: Uint8Array) {
  const r = new Reader(module);
  r.bytes(8);
  const parts: Uint8Array[] = [module.subarray(0, 8)];
  while (!r.done) {
    const start = r.i;
    const id = r.byte();
    const size = r.u32();
    const body = r.bytes(size);
    if (id !== 5) {
      parts.push(module.subarray(start, r.i));
      continue;
    }
    const s = new Reader(body);
    const count = s.u32();
    const out = [...leb(count)];
    for (let n = 0; n < count; n += 1) {
      const flags = s.byte();
      if (flags & ~1) throw new Refused('Shared or 64-bit memory');
      const min = s.u32();
      const max = flags & 1 ? s.u32() : MAX_PAGES;
      if (min > MAX_PAGES) throw new Refused('The extension asks for too much memory');
      out.push(1, ...leb(min), ...leb(Math.min(max, MAX_PAGES)));
    }
    parts.push(new Uint8Array([5, ...leb(out.length), ...out]));
  }
  const whole = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    whole.set(part, at);
    at += part.length;
  }
  return whole;
}

/** Runs the component's sections with `imports` bound by name; its exports by name. */
function instantiate(bytes: Uint8Array, imports: Map<string, Value>, host: Host) {
  const r = new Reader(bytes);
  const head = r.bytes(8);
  // \0asm, version 0x0d, layer 1: a component
  if (head[0] !== 0 || head[1] !== 0x61 || head[4] !== 0x0d || head[6] !== 1) {
    throw new Refused('Not a WebAssembly component');
  }
  const spaces = new Map<string, Value[]>();
  const space = (sort: string) => spaces.get(sort) ?? spaces.set(sort, []).get(sort)!;
  const get = (sort: string, index: number) => {
    // Types aren't tracked (see above).
    if (sort === '3') return null;
    const list = space(sort);
    if (index >= list.length) throw new Refused(`Bad ${sort} index ${index}`);
    return list[index];
  };
  const exports = new Map<string, Value>();

  const sort = (s: Reader) => {
    const b = s.byte();
    return b === 0 ? `c${s.byte()}` : String(b);
  };
  const externName = (s: Reader) => {
    if (s.byte() !== 0) throw new Refused('Unsupported name form');
    return s.name();
  };
  const externDesc = (s: Reader) => {
    const b = s.byte();
    if (b === 0x00) {
      s.byte();
      s.u32();
      return 'c17';
    }
    if (b === 0x03) {
      if (s.byte() === 0) s.u32();
      return '3';
    }
    if (b === 0x01 || b === 0x04 || b === 0x05) {
      s.u32();
      return String(b);
    }
    throw new Refused('Unsupported import kind');
  };
  const options = (s: Reader): Opts => {
    const opts: Opts = {};
    for (let n = s.u32(); n > 0; n -= 1) {
      const b = s.byte();
      if (b === 0x00) continue;
      if (b === 0x03) opts.memory = get('c2', s.u32());
      else if (b === 0x04) opts.realloc = get('c0', s.u32());
      else if (b === 0x05) opts.post = get('c0', s.u32());
      else throw new Refused('Unsupported canonical option (UTF-16 or async)');
    }
    return opts;
  };

  while (!r.done) {
    const id = r.byte();
    const s = new Reader(r.bytes(r.u32()));
    if (id === 0 || id === 3 || id === 7) continue; // custom, core types, types
    if (id === 1) {
      space('c17').push(new WebAssembly.Module(capMemory(s.b)));
      continue;
    }
    if (id === 4) {
      space('4').push(s.b);
      continue;
    }
    for (let n = s.u32(); n > 0; n -= 1) {
      if (id === 2) {
        const kind = s.byte();
        const object: Record<string, Value> = {};
        if (kind === 0) {
          const module = get('c17', s.u32());
          for (let a = s.u32(); a > 0; a -= 1) {
            const name = s.name();
            if (s.byte() !== 0x12) throw new Refused('Bad core instance argument');
            object[name] = get('c18', s.u32());
          }
          space('c18').push(new WebAssembly.Instance(module, object).exports);
        } else if (kind === 1) {
          for (let a = s.u32(); a > 0; a -= 1) {
            const name = s.name();
            object[name] = get(`c${s.byte()}`, s.u32());
          }
          space('c18').push(object);
        } else throw new Refused('Bad core instance');
      } else if (id === 5) {
        const kind = s.byte();
        const map = new Map<string, Value>();
        if (kind === 0) {
          const component = get('4', s.u32());
          for (let a = s.u32(); a > 0; a -= 1) {
            const name = s.name();
            const sorted = sort(s);
            map.set(name, get(sorted, s.u32()));
          }
          space('5').push(instantiate(component, map, host));
        } else if (kind === 1) {
          for (let a = s.u32(); a > 0; a -= 1) {
            const name = externName(s);
            const sorted = sort(s);
            map.set(name, get(sorted, s.u32()));
          }
          space('5').push(map);
        } else throw new Refused('Bad instance');
      } else if (id === 6) {
        const sorted = sort(s);
        const target = s.byte();
        if (target === 0) {
          const instance = get('5', s.u32()) as Map<string, Value>;
          const name = s.name();
          if (!instance.has(name)) throw new Refused(`Missing export ${name}`);
          space(sorted).push(instance.get(name));
        } else if (target === 1) {
          const instance = get('c18', s.u32()) as Record<string, Value>;
          const name = s.name();
          if (!(name in instance)) throw new Refused(`Missing core export ${name}`);
          space(sorted).push(instance[name]);
        } else if (target === 2 && sorted === '3') {
          s.u32();
          s.u32();
          space('3').push(null);
        } else throw new Refused('Unsupported alias');
      } else if (id === 8) {
        const op = s.byte();
        if (s.byte() !== 0) throw new Refused('Unsupported canonical function');
        if (op === 0) {
          const fn = get('c0', s.u32());
          const opts = options(s);
          s.u32();
          space('1').push({ lift: { fn, opts } } satisfies Lifted);
        } else if (op === 1) {
          const fn = get('1', s.u32()) as HostFn;
          if (!fn?.host) throw new Refused('Only host functions can be lowered');
          space('c0').push(host.lower(fn.host, options(s)));
        } else throw new Refused('Unsupported canonical function (resources or async)');
      } else if (id === 10) {
        const name = externName(s);
        const sorted = externDesc(s);
        if (sorted === '3') space('3').push(null);
        else if (imports.has(name)) space(sorted).push(imports.get(name));
        else throw new Refused(`The extension needs ${name}, which this app doesn't offer`);
      } else if (id === 11) {
        const name = externName(s);
        const sorted = sort(s);
        const value = get(sorted, s.u32());
        if (s.byte() === 1) externDesc(s);
        exports.set(name, value);
        space(sorted).push(value);
      } else throw new Refused(`Unsupported component section ${id}`);
    }
  }
  return exports;
}

// The host ------------------------------------------------------------------------------------

interface Request {
  method: string;
  url: string;
  headers: [string, string][];
  body?: Uint8Array;
  maxBytes?: number;
}
interface Response {
  status: number;
  headers: [string, string][];
  finalUrl: string;
  body: ArrayBuffer;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

class Host {
  private fetch: (request: Request) => Promise<Response>;
  constructor(fetch: (request: Request) => Promise<Response>) {
    this.fetch = fetch;
  }

  lower(name: string, opts: Opts) {
    const memory = () => {
      if (!opts.memory) throw new Refused('Lowered function without memory');
      return opts.memory;
    };
    const view = () => new DataView(memory().buffer);
    const string = (ptr: number, len: number) =>
      decoder.decode(new Uint8Array(memory().buffer, ptr, len));
    const alloc = (size: number, align: number) => {
      if (!opts.realloc) throw new Refused('Lowered function without realloc');
      return opts.realloc(0, 0, align, size) >>> 0;
    };
    const put = (data: Uint8Array): [number, number] => {
      const ptr = alloc(data.length, 1);
      new Uint8Array(memory().buffer, ptr, data.length).set(data);
      return [ptr, data.length];
    };
    const putPair = (at: number, [ptr, len]: [number, number]) => {
      const v = view();
      v.setUint32(at, ptr, true);
      v.setUint32(at + 4, len, true);
    };
    const err = (ret: number, message: string) => {
      const pair = put(encoder.encode(message));
      view().setUint8(ret, 1);
      putPair(ret + 4, pair);
    };
    const suspending = (fn: (...args: number[]) => Promise<unknown>) =>
      new (WebAssembly as any).Suspending(fn);

    switch (name) {
      case 'net.fetch':
        return suspending(async (req: number, ret: number) => {
          const v = view();
          const str = (at: number) => string(v.getUint32(at, true), v.getUint32(at + 4, true));
          const headers: [string, string][] = [];
          const base = v.getUint32(req + 28, true);
          for (let n = 0; n < v.getUint32(req + 32, true); n += 1) {
            headers.push([str(base + n * 16), str(base + n * 16 + 8)]);
          }
          const request: Request = {
            method: str(req),
            url: str(req + 8),
            headers,
            body: v.getUint8(req + 36)
              ? new Uint8Array(
                  memory().buffer,
                  v.getUint32(req + 40, true),
                  v.getUint32(req + 44, true)
                ).slice()
              : undefined,
            maxBytes: v.getUint8(req + 72) ? Number(v.getBigUint64(req + 80, true)) : undefined
          };
          let response: Response;
          try {
            response = await this.fetch(request);
          } catch (error) {
            return err(ret, String((error as Error)?.message ?? error));
          }
          const list = alloc(response.headers.length * 16, 4);
          response.headers.forEach(([key, value], n) => {
            putPair(list + n * 16, put(encoder.encode(key)));
            putPair(list + n * 16 + 8, put(encoder.encode(value)));
          });
          const url = put(encoder.encode(response.finalUrl));
          const body = put(new Uint8Array(response.body));
          const w = view();
          w.setUint8(ret, 0);
          w.setUint16(ret + 4, response.status, true);
          putPair(ret + 8, [list, response.headers.length]);
          putPair(ret + 16, url);
          putPair(ret + 24, body);
        });
      case 'host.log':
        return () => undefined;
      case 'host.now-millis':
        return () => BigInt(Date.now());
      case 'host.api-version':
        return () => 2;
      case 'host.locale':
        return (ret: number) => putPair(ret, put(encoder.encode('ja')));
      case 'host.random-bytes':
        return (length: number, ret: number) => {
          if (length > 65536) return err(ret, 'Too many random bytes');
          const pair = put(crypto.getRandomValues(new Uint8Array(length)));
          view().setUint8(ret, 0);
          putPair(ret + 4, pair);
        };
      case 'host.sleep-millis':
        return suspending(async (ms: number, ret: number) => {
          await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5000)));
          view().setUint8(ret, 0);
        });
    }
    throw new Refused(`Unknown host function ${name}`);
  }
}

const HOST_FUNCTIONS: Record<string, string[]> = {
  net: ['fetch'],
  host: ['log', 'now-millis', 'api-version', 'locale', 'random-bytes', 'sleep-millis']
};

/** Instantiates the component; the guest's exports as `call(name, ...strings)`. */
export function load(wasm: Uint8Array, fetch: (request: Request) => Promise<Response>) {
  const imports = new Map<string, Value>();
  for (const [face, names] of Object.entries(HOST_FUNCTIONS)) {
    const instance = new Map(names.map((name) => [name, { host: `${face}.${name}` }]));
    imports.set(`${WORLD}/${face}${VERSION}`, instance);
  }
  const exports = instantiate(wasm, imports, new Host(fetch));
  const guest = exports.get(`${WORLD}/guest${VERSION}`) as Map<string, Value> | undefined;
  if (!(guest instanceof Map)) throw new Refused('Not a Manatan v2 extension (no guest export)');

  /** A guest function `(string…) -> result<string, string>` (init: `() -> result<_, string>`). */
  return async (name: string, ...args: string[]) => {
    const fn = (guest.get(name) as Lifted | undefined)?.lift;
    if (!fn) throw new Refused(`The extension has no ${name}`);
    const { memory, realloc, post } = fn.opts;
    if (!memory || (args.length && !realloc) || fn.fn.length !== args.length * 2) {
      throw new Refused(`The extension's ${name} isn't what the app expects`);
    }
    const flat: number[] = [];
    for (const arg of args) {
      const data = encoder.encode(arg);
      const ptr = realloc!(0, 0, 1, data.length) >>> 0;
      new Uint8Array(memory.buffer, ptr, data.length).set(data);
      flat.push(ptr, data.length);
    }
    const ret = (await (WebAssembly as any).promising(fn.fn)(...flat)) >>> 0;
    const v = new DataView(memory.buffer);
    const tag = v.getUint8(ret);
    const text =
      tag === 1 || name !== 'init'
        ? decoder.decode(
            new Uint8Array(memory.buffer, v.getUint32(ret + 4, true), v.getUint32(ret + 8, true))
          )
        : '';
    post?.(ret);
    if (tag > 1) throw new Error('The extension answered nonsense');
    return { ok: tag === 0, text };
  };
}

// The worker ----------------------------------------------------------------------------------

const scope = globalThis as any;
if (scope.WorkerGlobalScope && scope instanceof scope.WorkerGlobalScope) {
  const postMessage = (message: unknown) => scope.postMessage(message);
  const pending = new Map<number, { resolve(r: Response): void; reject(e: Error): void }>();
  let fetches = 0;
  let call: ReturnType<typeof load> | undefined;
  const fetch = (request: Request) =>
    new Promise<Response>((resolve, reject) => {
      const id = ++fetches;
      pending.set(id, { resolve, reject });
      postMessage({ op: 'fetch', id, request });
    });
  scope.onmessage = async ({ data }: MessageEvent<Record<string, any>>) => {
    if (data.op === 'fetched' || data.op === 'failed') {
      const waiting = pending.get(data.id);
      pending.delete(data.id);
      if (data.op === 'fetched') waiting?.resolve(data.response);
      else waiting?.reject(new Error(String(data.message)));
      return;
    }
    try {
      if (data.op === 'load') {
        call = load(new Uint8Array(data.code), fetch);
        const init = await call('init');
        if (!init.ok) throw new Error(init.text);
        postMessage({ op: 'result', id: data.id, value: '' });
      } else if (data.op === 'call' && call) {
        const answer = await call(String(data.method), ...(data.args as string[]).map(String));
        postMessage({
          op: answer.ok ? 'result' : 'error',
          id: data.id,
          value: answer.text,
          message: answer.text
        });
      }
    } catch (error) {
      // A trap (a panic, memory past the cap) leaves the guest broken: the frame ends this worker.
      postMessage({
        op: 'error',
        id: data.id,
        dead: !(error instanceof Refused) || data.op === 'load',
        message: String((error as Error)?.message ?? error)
      });
    }
  };
}
