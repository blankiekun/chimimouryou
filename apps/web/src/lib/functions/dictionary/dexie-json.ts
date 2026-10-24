/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * A streaming reader for Dexie exports (dexie-export-import's JSON, what Yomitan's "Export
 * Dictionary Collection" writes): text goes in as it arrives and each table row comes out on
 * its own, so a multi-GB file is never held whole. Only the containers on the way to the rows
 * are walked; every other value is found by a fast scan and handed to JSON.parse. Rows are
 * revived from Typeson's `$types` (arrays, ArrayBuffers, undefined). Not part of upstream.
 */

export interface DexieHeader {
  formatName: unknown;
  formatVersion: unknown;
  databaseName: unknown;
  databaseVersion: unknown;
  tables: unknown;
}

export interface DexieHandlers {
  /** Called once, before the first table's rows */
  header(header: DexieHeader): void;
  /** One row of `table`, revived (outbound tables give their [key, value] pair); size: its characters */
  row(table: string, row: unknown, size: number): void;
}

// Containers walked into; any other value is captured whole.
const walked = new Set(['', 'data', 'data.data', 'data.data.*', 'data.data.*.rows']);
const wanted = new Set([
  'formatName',
  'formatVersion',
  'data.databaseName',
  'data.databaseVersion',
  'data.tables',
  'data.data.*.tableName',
  'data.data.*.rows.*'
]);

interface Frame {
  array: boolean;
  path: string;
  /** key: expects a key or the end; colon; value; next: expects a comma or the end */
  state: 'key' | 'colon' | 'value' | 'next';
  key: string;
}

interface Capture {
  start: number;
  /** Where the scan goes on from */
  at: number;
  depth: number;
  inString: boolean;
  /** Path of the value; null for an object key */
  path: string | null;
}

const isSpace = (c: number) => c === 32 || c === 10 || c === 13 || c === 9;

export class DexieJsonReader {
  private buf = '';
  private pos = 0;
  private stack: Frame[] = [];
  private capture: Capture | null = null;
  private done = false;
  private header: Partial<DexieHeader> = {};
  private headerSent = false;
  private table = '';
  private handlers: DexieHandlers;

  constructor(handlers: DexieHandlers) {
    this.handlers = handlers;
  }

  /** Feeds the next piece of text. */
  push(text: string) {
    const keep = this.capture ? this.capture.start : this.pos;
    if (keep > 0) this.shift(keep);
    this.buf += text;
    this.run(false);
  }

  /** The text has ended; throws when the JSON is incomplete. */
  end() {
    this.run(true);
    if (!this.done) throw new Error('The file ends before the collection does');
  }

  private shift(by: number) {
    this.buf = this.buf.slice(by);
    this.pos -= by;
    if (this.capture) {
      this.capture.start -= by;
      this.capture.at -= by;
    }
  }

  private run(final: boolean) {
    const { buf } = this;
    while (true) {
      if (this.capture) {
        const end = this.scan(this.capture, final);
        if (end < 0) return;
        this.finishCapture(end);
        continue;
      }
      while (this.pos < buf.length && isSpace(buf.charCodeAt(this.pos))) this.pos++;
      if (this.pos >= buf.length) return;
      if (this.done) throw new Error('Unexpected text after the collection');
      const c = buf[this.pos];
      const top = this.stack[this.stack.length - 1];
      if (!top) {
        this.startValue('', c);
        continue;
      }
      switch (top.state) {
        case 'key':
          if (c === '}') this.close();
          else if (c === '"') this.capture = this.newCapture(null);
          else this.fail();
          break;
        case 'colon':
          if (c !== ':') this.fail();
          this.pos++;
          top.state = 'value';
          break;
        case 'value':
          if (top.array && c === ']') this.close();
          else this.startValue(top.array ? `${top.path}.*` : join(top.path, top.key), c);
          break;
        case 'next':
          if (c === ',') {
            this.pos++;
            top.state = top.array ? 'value' : 'key';
          } else if (c === (top.array ? ']' : '}')) this.close();
          else this.fail();
          break;
      }
    }
  }

  private startValue(path: string, c: string) {
    if (walked.has(path) && (c === '{' || c === '[')) {
      if (path === 'data.data') this.sendHeader();
      this.stack.push({ array: c === '[', path, state: c === '[' ? 'value' : 'key', key: '' });
      this.pos++;
    } else {
      this.capture = this.newCapture(path);
    }
  }

  private newCapture(path: string | null): Capture {
    return { start: this.pos, at: this.pos, depth: 0, inString: false, path };
  }

  private close() {
    this.pos++;
    this.stack.pop();
    this.afterValue();
  }

  private afterValue() {
    const top = this.stack[this.stack.length - 1];
    if (top) top.state = 'next';
    else this.done = true;
  }

  private fail(): never {
    const near = this.buf.slice(this.pos, this.pos + 40);
    throw new Error(`Not a Dexie export (unexpected text: ${JSON.stringify(near)})`);
  }

  /** The end of the captured value, or -1 when more text is needed. */
  private scan(cap: Capture, final: boolean) {
    const s = this.buf;
    const n = s.length;
    let i = cap.at;
    let { depth, inString } = cap;
    while (i < n) {
      if (inString) {
        const q = s.indexOf('"', i);
        if (q < 0) {
          i = n;
          break;
        }
        let b = q - 1;
        while (s.charCodeAt(b) === 92) b--;
        i = q + 1;
        if ((q - 1 - b) % 2 === 1) continue; // an escaped quote
        inString = false;
        if (depth === 0) return i;
        continue;
      }
      const c = s.charCodeAt(i);
      if (c === 34) {
        inString = true;
      } else if (c === 123 || c === 91) {
        depth++;
      } else if (c === 125 || c === 93) {
        if (depth === 0) return i; // a number or literal, ended by its container
        if (--depth === 0) return i + 1;
      } else if (depth === 0 && (c === 44 || isSpace(c))) {
        return i;
      }
      i++;
    }
    cap.at = i;
    cap.depth = depth;
    cap.inString = inString;
    return final && depth === 0 && !inString && i > cap.start ? i : -1;
  }

  private finishCapture(end: number) {
    const cap = this.capture!;
    this.capture = null;
    this.pos = end;
    const text = this.buf.slice(cap.start, end);
    const top = this.stack[this.stack.length - 1];
    if (cap.path === null) {
      top.key = JSON.parse(text);
      top.state = 'colon';
      return;
    }
    if (wanted.has(cap.path)) this.take(cap.path, JSON.parse(text), text.length);
    this.afterValue();
  }

  private take(path: string, value: unknown, size: number) {
    switch (path) {
      case 'data.data.*.rows.*':
        if (!this.headerSent) this.sendHeader();
        this.handlers.row(this.table, revive(value), size);
        break;
      case 'data.data.*.tableName':
        this.table = String(value);
        break;
      default:
        this.header[path.replace(/^data\./, '') as keyof DexieHeader] = value;
    }
  }

  private sendHeader() {
    if (this.headerSent) return;
    this.headerSent = true;
    this.handlers.header(this.header as DexieHeader);
  }
}

const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null;

/**
 * Undoes Typeson's encapsulation as dexie-export-import writes it: `{$: value, $types: {$: …}}`
 * around an array, `$types` beside an object's own keys.
 */
export function revive(row: unknown): unknown {
  if (!isObject(row) || Array.isArray(row) || !isObject(row.$types)) return row;
  let value: any;
  let types: Record<string, unknown>;
  if ('$' in row && isObject(row.$types.$)) {
    value = row.$;
    types = row.$types.$;
  } else {
    const { $types, ...rest } = row;
    value = rest;
    types = $types;
  }
  // Deepest first, so a revived parent never hides the paths below it.
  const paths = Object.keys(types).sort((a, b) => depthOf(b) - depthOf(a));
  for (const path of paths) value = reviveAt(value, path, types[path]);
  return value;
}

const depthOf = (path: string) => (path === '' ? 0 : path.split('.').length);

function reviveAt(root: any, path: string, type: unknown) {
  if (path === '') return reviveValue(root, type);
  const parts = path.split('.').map((part) => part.replace(/~1/g, '.').replace(/~0/g, '~'));
  const last = parts.pop()!;
  let parent = root;
  for (const part of parts) parent = parent?.[part];
  if (!isObject(parent)) throw new Error(`Broken value path "${path}" in the collection`);
  const revived = reviveValue(parent[last], type);
  if (revived === undefined) delete parent[last];
  else parent[last] = revived;
  return root;
}

function reviveValue(value: any, type: unknown) {
  switch (type) {
    case 'arrayNonindexKeys':
      if (Array.isArray(value)) return value;
      if (isObject(value)) {
        const array: unknown[] = [];
        for (const key of Object.keys(value)) if (key !== 'length') array[Number(key)] = value[key];
        return array;
      }
      return value;
    case 'arraybuffer':
      return base64ToArrayBuffer(String(value));
    case 'undef':
      return undefined;
    default:
      throw new Error(`Unsupported value type "${String(type)}" in the collection`);
  }
}

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
