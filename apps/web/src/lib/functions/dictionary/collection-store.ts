/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Dictionaries imported from a Yomitan collection (collection-import.ts) live in the origin
 * private file system instead of Yomitan's IndexedDB tables: IndexedDB costs ~33 µs a row
 * whatever its size, so a 6 GB collection took 10 minutes. Each import is one pack, a folder of
 * `dictionary-collections/`:
 * - `rows.bin`: every row's JSON as the export wrote it (UTF-8, revived on read), one stream cut
 *   into `block`-byte blocks, each compressed alone (deflate-raw); rows may span blocks;
 * - `blocks.idx`: Float64 starts of the compressed blocks in `rows.bin` (one more than the blocks);
 * - `rows.idx`: Float64 offsets of the rows in the uncompressed stream (one more than the rows);
 * - `keys.bin`: the distinct lookup keys, sorted like IndexedDB sorts strings (UTF-16 code units);
 * - `keys.idx`: Uint32 key starts in `keys.bin` (K + 1), then posting starts (K + 1);
 * - `postings.bin`: per key, [row, kind << 16 | dictionary] pairs (Uint32), rows in import order;
 * - `manifest.json`, written last: version 2 and `block`, the dictionary titles (null once
 *   deleted). Version-1 packs (#181) have no blocks: `rows.bin` is uncompressed.
 * `DictionaryStore` answers the translator's find* calls from the packs for their dictionaries
 * and from IndexedDB for the rest, with the rows and order IndexedDB would give. Summaries stay in
 * IndexedDB's `dictionaries` table, so listing, enabling and the importer's duplicate check are
 * unchanged. Runs in the dictionary worker (sync access handles for writing). Not part of upstream.
 */

import { DictionaryDatabase } from '$lib/vendor/yomitan/dictionary/dictionary-database';
import { revive } from './dexie-json';
import { codecAll } from './pack-codec';

const folder = 'dictionary-collections';

/** What a posting's key is: a term's expression or reading, a sequence, a meta row's term… */
export const enum Kind {
  Expression,
  Reading,
  Sequence,
  TermMeta,
  Kanji,
  KanjiMeta,
  TagMeta,
  Media
}

// Sequences share the key list; no term contains NUL.
const sequenceKey = (sequence: number) => `\u0000${sequence}`;

// jsdom (the engine's tests) has none.
/** Inflated blocks a pack keeps */
const cachedBlocks = 1024;

const opfsAvailable = () => !!(globalThis.navigator?.storage as any)?.getDirectory;

const opfsRoot = async (create: boolean) => {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(folder, { create });
};

class Grow<T extends Uint32Array | Float64Array> {
  n = 0;
  constructor(public a: T) {}
  push(value: number) {
    if (this.n === this.a.length) {
      const b = new (this.a.constructor as any)(this.n * 2) as T;
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = value;
  }
}

type SyncHandle = {
  write(data: ArrayBufferView, options: { at: number }): number;
  flush(): void;
  close(): void;
};

async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: ArrayBufferView) {
  const handle = (await await dir.getFileHandle(name, { create: true })) as any;
  const sync = (await handle.createSyncAccessHandle()) as SyncHandle;
  try {
    sync.write(data, { at: 0 });
    sync.flush();
  } finally {
    sync.close();
  }
}

/** Writes one pack while a collection streams in; `finish` sorts the keys and writes the index. */
export class PackWriter {
  /** Uncompressed bytes per block of `rows.bin` (0 writes a version-1 pack, for the tests). 16 KB
   * measured best for lookups: blocks cost mostly per call, and a big lookup reads ~1,000. */
  static blockSize = 1 << 14;
  private keyIds = new Map<string, number>();
  /** [key id, row, kind << 16 | dictionary] per posting */
  private postings = new Grow(new Uint32Array(3 << 16));
  private offsets = new Grow(new Float64Array(1 << 16));
  private blockStarts = new Grow(new Float64Array(1 << 12));
  private block = PackWriter.blockSize;
  /** Rows not yet cut into blocks; a multiple of the block size */
  private buffer = new Uint8Array(8 << 20);
  private used = 0;
  /** Uncompressed bytes before `buffer` */
  private cutBytes = 0;
  /** Bytes in `rows.bin` */
  private written = 0;
  private pending: Promise<Uint8Array[]>[] = [];
  private encoder = new TextEncoder();

  constructor(
    readonly dir: FileSystemDirectoryHandle,
    readonly name: string,
    private rows: SyncHandle
  ) {
    this.blockStarts.push(0);
  }

  get rowCount() {
    return this.offsets.n;
  }

  /** One row of `table` (its id-less value for the keys, the export's text to store). */
  add(table: string, value: any, text: string, dictionary: number) {
    const row = this.offsets.n;
    this.offsets.push(this.cutBytes + this.used);
    if (this.used + text.length * 3 > this.buffer.length) this.cut(false);
    if (this.used + text.length * 3 > this.buffer.length) {
      const bytes = this.encoder.encode(text);
      for (let at = 0; at < bytes.length; ) {
        const n = Math.min(bytes.length - at, this.buffer.length - this.used);
        this.buffer.set(bytes.subarray(at, at + n), this.used);
        this.used += n;
        at += n;
        if (this.used === this.buffer.length) this.cut(false);
      }
    } else {
      this.used += this.encoder.encodeInto(text, this.buffer.subarray(this.used)).written;
    }
    const post = (kind: Kind, key: unknown) => {
      if (typeof key !== 'string') return;
      let id = this.keyIds.get(key);
      if (id === undefined) this.keyIds.set(key, (id = this.keyIds.size));
      this.postings.push(id);
      this.postings.push(row);
      this.postings.push((kind << 16) | dictionary);
    };
    switch (table) {
      case 'terms':
        post(Kind.Expression, value.expression);
        post(Kind.Reading, value.reading);
        if (typeof value.sequence === 'number' && value.sequence >= 0) {
          post(Kind.Sequence, sequenceKey(value.sequence));
        }
        break;
      case 'termMeta':
        post(Kind.TermMeta, value.expression);
        break;
      case 'kanji':
        post(Kind.Kanji, value.character);
        break;
      case 'kanjiMeta':
        post(Kind.KanjiMeta, value.character);
        break;
      case 'tagMeta':
        post(Kind.TagMeta, value.name);
        break;
      case 'media':
        post(Kind.Media, value.path);
        break;
    }
  }

  /** Hands the buffer's full blocks (and the rest when `last`) to compression. */
  private cut(last: boolean) {
    if (!this.block) {
      this.rows.write(this.buffer.subarray(0, this.used), { at: this.written });
      this.written += this.used;
      this.cutBytes += this.used;
      this.used = 0;
      return;
    }
    let at = 0;
    const blocks: Uint8Array[] = [];
    while (this.used - at >= this.block || (last && at < this.used)) {
      const end = Math.min(at + this.block, this.used);
      blocks.push(this.buffer.slice(at, end));
      at = end;
    }
    if (blocks.length) this.pending.push(codecAll('compress', blocks));
    this.buffer.copyWithin(0, at, this.used);
    this.used -= at;
    this.cutBytes += at;
  }

  /**
   * Writes compressed blocks in order. Between chunks the import leaves two cuts compressing,
   * so parsing goes on meanwhile; `finish` waits for all.
   */
  async drain(inFlight = 2) {
    while (this.pending.length > inFlight) {
      for (const bytes of await this.pending.shift()!) {
        this.rows.write(bytes, { at: this.written });
        this.written += bytes.length;
        this.blockStarts.push(this.written);
      }
    }
  }

  /** Writes the index and then the manifest, which makes the pack complete. */
  async finish(titles: string[]) {
    this.cut(true);
    await this.drain(0);
    this.offsets.push(this.cutBytes);
    this.rows.flush();
    this.rows.close();

    // Keys in IndexedDB's order; a counting sort by key keeps each key's rows in import order.
    const ids = this.keyIds;
    const sorted = [...ids.keys()].sort();
    const rank = new Uint32Array(sorted.length);
    let units = 0;
    sorted.forEach((key, r) => {
      rank[ids.get(key)!] = r;
      units += key.length;
    });
    this.keyIds = new Map();
    const keys = new Uint16Array(units);
    const index = new Uint32Array(2 * (sorted.length + 1));
    const postStart = index.subarray(sorted.length + 1);
    units = 0;
    sorted.forEach((key, r) => {
      index[r] = units;
      for (let i = 0; i < key.length; i++) keys[units++] = key.charCodeAt(i);
    });
    index[sorted.length] = units;
    const { a: posts, n } = this.postings;
    for (let p = 0; p < n; p += 3) postStart[rank[posts[p]] + 1]++;
    for (let r = 0; r < sorted.length; r++) postStart[r + 1] += postStart[r];
    const fill = postStart.slice(0, sorted.length);
    const out = new Uint32Array((n / 3) * 2);
    for (let p = 0; p < n; p += 3) {
      const at = 2 * fill[rank[posts[p]]]++;
      out[at] = posts[p + 1];
      out[at + 1] = posts[p + 2];
    }
    this.postings = new Grow(new Uint32Array(0));

    await writeFile(this.dir, 'keys.bin', keys);
    await writeFile(this.dir, 'keys.idx', index);
    await writeFile(this.dir, 'postings.bin', out);
    await writeFile(this.dir, 'rows.idx', this.offsets.a.subarray(0, this.offsets.n));
    if (this.block) {
      await writeFile(this.dir, 'blocks.idx', this.blockStarts.a.subarray(0, this.blockStarts.n));
    }
    const manifest: Manifest = this.block
      ? { version: 2, block: this.block, titles }
      : { version: 1, titles };
    await writeFile(this.dir, 'manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
  }

  /** Drops the unfinished pack. */
  async abort() {
    try {
      this.rows.close();
    } catch {
      // already closed
    }
    await (await opfsRoot(true)).removeEntry(this.name, { recursive: true });
  }
}

interface Manifest {
  version: number;
  /** Uncompressed bytes per block of `rows.bin` (version 2) */
  block?: number;
  titles: (string | null)[];
}

type ReadHandle = {
  read(buffer: ArrayBufferView, options: { at: number }): number;
  close(): void;
};

/**
 * A finished pack. Reads go through read-only sync access handles (several tabs can hold them),
 * or File slices where those aren't available, which are several times slower.
 */
class Pack {
  private loaded?: Promise<void>;
  private keys!: Uint16Array;
  private keyStart!: Uint32Array;
  private postStart!: Uint32Array;
  private blockStarts?: Float64Array;
  /** Recently inflated blocks, oldest first */
  private blocks = new Map<number, Uint8Array>();
  private files: Record<string, File> = {};
  private handles: Record<string, ReadHandle> = {};

  constructor(
    readonly name: string,
    readonly manifest: Manifest,
    /** Added to row numbers for the rows' ids, above IndexedDB's */
    readonly idBase: number,
    private dir: FileSystemDirectoryHandle
  ) {}

  titles() {
    return this.manifest.titles.filter((title): title is string => !!title);
  }

  ready() {
    return (this.loaded ??= (async () => {
      const names = ['rows.bin', 'rows.idx', 'keys.bin', 'keys.idx', 'postings.bin'];
      if (this.manifest.block) names.push('blocks.idx');
      for (const name of names) {
        const handle = (await this.dir.getFileHandle(name)) as any;
        this.files[name] = await handle.getFile();
        if (name.startsWith('keys') || name === 'blocks.idx') continue;
        try {
          this.handles[name] = await handle.createSyncAccessHandle({ mode: 'read-only' });
        } catch {
          // not in a worker, or the browser has no read-only handles and another tab holds it
        }
      }
      this.keys = new Uint16Array(await this.files['keys.bin'].arrayBuffer());
      const index = new Uint32Array(await this.files['keys.idx'].arrayBuffer());
      const count = index.length / 2;
      this.keyStart = index.subarray(0, count);
      this.postStart = index.subarray(count);
      if (this.manifest.block) {
        this.blockStarts = new Float64Array(await this.files['blocks.idx'].arrayBuffer());
      }
    })());
  }

  private async read(name: string, start: number, end: number) {
    const handle = this.handles[name];
    if (!handle) return this.files[name].slice(start, end).arrayBuffer();
    const buffer = new Uint8Array(end - start);
    handle.read(buffer, { at: start });
    return buffer.buffer;
  }

  close() {
    for (const handle of Object.values(this.handles)) handle.close();
    this.handles = {};
    this.files = {};
    this.blocks = new Map();
    this.loaded = undefined;
  }

  private get keyCount() {
    return this.keyStart.length - 1;
  }

  /** Key k compared with s, in UTF-16 code units like IndexedDB. */
  private compare(k: number, s: string) {
    const { keys } = this;
    const start = this.keyStart[k];
    const length = this.keyStart[k + 1] - start;
    const n = Math.min(length, s.length);
    for (let i = 0; i < n; i++) {
      const d = keys[start + i] - s.charCodeAt(i);
      if (d) return d;
    }
    return length - s.length;
  }

  private key(k: number) {
    return String.fromCharCode(...this.keys.subarray(this.keyStart[k], this.keyStart[k + 1]));
  }

  private lowerBound(s: string) {
    let lo = 0;
    let hi = this.keyCount;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.compare(mid, s) < 0) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** The keys a query matches, in the order IndexedDB's index would give them. */
  keysFor(query: string, matchType: string) {
    const found: number[] = [];
    if (matchType === 'suffix') {
      // shortcut: scans every key; only Yomitan's wildcard search asks for suffixes (not the app).
      const matches: [string, number][] = [];
      for (let k = 0; k < this.keyCount; k++) {
        const key = this.key(k);
        if (key.endsWith(query)) matches.push([[...key].reverse().join(''), k]);
      }
      matches.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return matches.map(([, k]) => k);
    }
    const upper = matchType === 'prefix' ? `${query}￿` : query;
    for (let k = this.lowerBound(query); k < this.keyCount && this.compare(k, upper) <= 0; k++) {
      found.push(k);
    }
    return found;
  }

  /** Each key's postings, as [row, kind << 16 | dictionary] pairs. */
  async postings(keys: number[]) {
    return Promise.all(
      keys.map(
        async (k) =>
          new Uint32Array(
            await this.read('postings.bin', this.postStart[k] * 8, this.postStart[k + 1] * 8)
          )
      )
    );
  }

  /** The inflated blocks the rows [start, end) need, from the cache or inflated together. */
  private async blocksFor(spans: Float64Array[]) {
    const size = this.manifest.block!;
    const found = new Map<number, Uint8Array>();
    const missing = new Set<number>();
    for (const [start, end] of spans) {
      for (let b = Math.floor(start / size); b * size < end; b++) {
        if (found.has(b) || missing.has(b)) continue;
        const cached = this.blocks.get(b);
        if (!cached) {
          missing.add(b);
          continue;
        }
        this.blocks.delete(b);
        this.blocks.set(b, cached);
        found.set(b, cached);
      }
    }
    const list = [...missing];
    const compressed = await Promise.all(
      list.map(
        async (b) =>
          new Uint8Array(
            await this.read('rows.bin', this.blockStarts![b], this.blockStarts![b + 1])
          )
      )
    );
    (await codecAll('inflate', compressed)).forEach((bytes, i) => {
      found.set(list[i], bytes);
      this.blocks.set(list[i], bytes);
      if (this.blocks.size > cachedBlocks) this.blocks.delete(this.blocks.keys().next().value!);
    });
    return found;
  }

  /** The rows, parsed and revived (keyed by row number). */
  async rows(rowNumbers: Iterable<number>) {
    const list = [...rowNumbers];
    const spans = await Promise.all(
      list.map(async (row) => new Float64Array(await this.read('rows.idx', row * 8, row * 8 + 16)))
    );
    const size = this.manifest.block;
    const blocks = size ? await this.blocksFor(spans) : undefined;
    const rows = new Map<number, any>();
    const decoder = new TextDecoder();
    await Promise.all(
      list.map(async (row, i) => {
        const [start, end] = spans[i];
        let bytes: Uint8Array;
        if (!size) bytes = new Uint8Array(await this.read('rows.bin', start, end));
        else {
          // A row may span blocks.
          const first = Math.floor(start / size);
          const last = Math.floor((end - 1) / size);
          if (first === last) {
            bytes = blocks!.get(first)!.subarray(start - first * size, end - first * size);
          } else {
            bytes = new Uint8Array(end - start);
            for (let b = first; b <= last; b++) {
              const from = Math.max(start, b * size);
              const to = Math.min(end, (b + 1) * size);
              bytes.set(blocks!.get(b)!.subarray(from - b * size, to - b * size), from - start);
            }
          }
        }
        const value: any = revive(JSON.parse(decoder.decode(bytes)));
        rows.set(row, Array.isArray(value) ? value[1] : value);
      })
    );
    return rows;
  }
}

type Find<T> = {
  kinds: Kind[];
  key: (item: T) => string;
  /** Whether rows of this dictionary are wanted for the item */
  dictionary: (title: string, item: T) => boolean;
  matchType?: string;
  /** Keeps a row once only per call (findTermsBulk's `visited`) */
  unique?: boolean;
  row?: (row: any, item: T) => boolean;
};

const dictionaryTitles = (dictionaries: Map<string, unknown> | Set<string>) => [
  ...dictionaries.keys()
];

/**
 * Yomitan's database with collection packs behind it. Results from both are merged by item index
 * (stable), so a lookup over only pack or only IndexedDB dictionaries keeps the exact order.
 */
export class DictionaryStore extends DictionaryDatabase {
  private packs: Pack[] = [];
  private packTitles = new Set<string>();

  async prepare() {
    await super.prepare();
    await this.loadPacks();
  }

  private async loadPacks() {
    for (const pack of this.packs) pack.close();
    this.packs = [];
    this.packTitles = new Set();
    if (!opfsAvailable()) return;
    const installed = new Set((await this.getDictionaryInfo()).map(({ title }) => title));
    const dir = await opfsRoot(true);
    const names: string[] = [];
    for await (const name of (dir as any).keys()) names.push(name);
    names.sort();
    for (const name of names) {
      const packDir = await dir.getDirectoryHandle(name);
      let manifest: Manifest | undefined;
      try {
        const file = await (await packDir.getFileHandle('manifest.json')).getFile();
        manifest = JSON.parse(await file.text());
      } catch {
        // an import that never finished
      }
      // Titles IndexedDB doesn't list were deleted (or their import never got that far).
      const titles = manifest?.titles.map((title) =>
        title && installed.has(title) ? title : null
      );
      if (!manifest || !titles?.some(Boolean)) {
        await dir.removeEntry(name, { recursive: true });
        continue;
      }
      if (titles.some((title, i) => title !== manifest!.titles[i])) {
        manifest.titles = titles;
        await this.saveManifest(packDir, manifest);
      }
      const pack = new Pack(name, manifest, 2 ** 40 + this.packs.length * 2 ** 32, packDir);
      this.packs.push(pack);
      for (const title of pack.titles()) this.packTitles.add(title);
    }
  }

  private async saveManifest(dir: FileSystemDirectoryHandle, manifest: Manifest) {
    await writeFile(dir, 'manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
  }

  /** A new pack for a collection import. */
  async createPack() {
    const name = `pack-${Date.now()}`;
    const dir = await (await opfsRoot(true)).getDirectoryHandle(name, { create: true });
    const file = (await dir.getFileHandle('rows.bin', { create: true })) as any;
    return new PackWriter(dir, name, await file.createSyncAccessHandle());
  }

  /** Finishes a pack, then lists its dictionaries (summaries in IndexedDB, as Yomitan keeps them). */
  async addPack(writer: PackWriter, summaries: { title: string }[]) {
    await writer.finish(summaries.map(({ title }) => title));
    if (summaries.length) await this.bulkAdd('dictionaries', summaries, 0, summaries.length);
    await this.loadPacks();
  }

  async deleteDictionary(...args: Parameters<DictionaryDatabase['deleteDictionary']>) {
    await super.deleteDictionary(...args);
    if (!this.packTitles.has(args[0])) return;
    for (const pack of this.packs) {
      const at = pack.manifest.titles.indexOf(args[0]);
      if (at < 0) continue;
      pack.manifest.titles[at] = null;
      // shortcut: a pack's files stay until all its dictionaries are deleted; compact it if
      // readers delete single dictionaries out of big collections.
      const dir = await opfsRoot(true);
      if (pack.titles().length)
        await this.saveManifest(await dir.getDirectoryHandle(pack.name), pack.manifest);
    }
    await this.loadPacks();
  }

  async purge() {
    for (const pack of this.packs) pack.close();
    const result = await super.purge();
    if (opfsAvailable()) {
      await (await navigator.storage.getDirectory())
        .removeEntry(folder, { recursive: true })
        .catch(() => undefined);
    }
    this.packs = [];
    this.packTitles = new Set();
    return result;
  }

  /** Rows of the packs for each item × kind, in IndexedDB's order. */
  private async packFind<T, R>(
    items: T[],
    find: Find<T>,
    create: (row: any, item: T, itemIndex: number, kindIndex: number) => R
  ) {
    const results: R[] = [];
    for (const pack of this.packs) {
      const wanted = pack.manifest.titles.map(
        (title) => title !== null && this.packTitles.has(title)
      );
      if (!wanted.some(Boolean)) continue;
      await pack.ready();
      const keyLists = items.map((item) => pack.keysFor(find.key(item), find.matchType ?? 'exact'));
      const distinct = [...new Set(keyLists.flat())];
      const postings = new Map(
        (await pack.postings(distinct)).map((list, i) => [distinct[i], list])
      );
      const hits: [row: number, item: number, kind: number][] = [];
      const visited = new Set<number>();
      items.forEach((item, i) => {
        find.kinds.forEach((kind, j) => {
          for (const k of keyLists[i]) {
            const list = postings.get(k)!;
            for (let p = 0; p < list.length; p += 2) {
              const row = list[p];
              const tag = list[p + 1];
              const dictionary = tag & 0xffff;
              if (tag >>> 16 !== kind || !wanted[dictionary]) continue;
              if (!find.dictionary(pack.manifest.titles[dictionary]!, item)) continue;
              if (find.unique) {
                if (visited.has(row)) continue;
                visited.add(row);
              }
              hits.push([row, i, j]);
            }
          }
        });
      });
      const rows = await pack.rows(new Set(hits.map(([row]) => row)));
      for (const [row, i, j] of hits) {
        const value = { ...rows.get(row), id: pack.idBase + row };
        if (!find.row || find.row(value, items[i])) results.push(create(value, items[i], i, j));
      }
    }
    return results;
  }

  /** Which sides a lookup over these dictionaries needs. */
  private sides(titles: string[]) {
    return {
      idb: titles.some((title) => !this.packTitles.has(title)),
      packs: titles.some((title) => this.packTitles.has(title))
    };
  }

  private async both<R extends { index: number }>(
    sides: { idb: boolean; packs: boolean },
    idb: () => Promise<R[]>,
    packs: () => Promise<R[]>
  ) {
    const a = sides.idb ? await idb() : [];
    const b = sides.packs ? await packs() : [];
    if (!b.length) return a;
    if (!a.length) return b;
    return [...a, ...b].sort((x, y) => x.index - y.index);
  }

  findTermsBulk(termList: string[], dictionaries: any, matchType: string) {
    const self = this as any;
    return this.both(
      this.sides(dictionaryTitles(dictionaries)),
      () => super.findTermsBulk(termList, dictionaries, matchType),
      () =>
        this.packFind(
          termList,
          {
            kinds: [Kind.Expression, Kind.Reading],
            key: (term) => term,
            dictionary: (title) => dictionaries.has(title),
            matchType,
            unique: true
          },
          (row, item, itemIndex, indexIndex) =>
            self._createTermGeneric(matchType, row, { item, itemIndex, indexIndex })
        )
    );
  }

  findTermsExactBulk(termList: { term: string; reading: string }[], dictionaries: any) {
    const self = this as any;
    return this.both(
      this.sides(dictionaryTitles(dictionaries)),
      () => super.findTermsExactBulk(termList, dictionaries),
      () =>
        this.packFind(
          termList,
          {
            kinds: [Kind.Expression],
            key: ({ term }) => term,
            dictionary: (title) => dictionaries.has(title),
            row: (row, { reading }) => row.reading === reading
          },
          (row, item, itemIndex) => self._createTermExact(row, { item, itemIndex, indexIndex: 0 })
        )
    );
  }

  findTermsBySequenceBulk(items: { query: number; dictionary: string }[]) {
    const self = this as any;
    return this.both(
      this.sides(items.map(({ dictionary }) => dictionary)),
      () => super.findTermsBySequenceBulk(items),
      () =>
        this.packFind(
          items,
          {
            kinds: [Kind.Sequence],
            key: ({ query }) => sequenceKey(query),
            dictionary: (title, item) => title === item.dictionary
          },
          (row, item, itemIndex) =>
            self._createTermSequenceExact(row, { item, itemIndex, indexIndex: 0 })
        )
    );
  }

  private metaFind(kind: Kind, list: string[], dictionaries: any, create: string) {
    const self = this as any;
    return this.packFind(
      list,
      { kinds: [kind], key: (key) => key, dictionary: (title) => dictionaries.has(title) },
      (row, item, itemIndex) => self[create](row, { item, itemIndex, indexIndex: 0 })
    );
  }

  findTermMetaBulk(termList: string[], dictionaries: any) {
    return this.both(
      this.sides(dictionaryTitles(dictionaries)),
      () => super.findTermMetaBulk(termList, dictionaries),
      () => this.metaFind(Kind.TermMeta, termList, dictionaries, '_createTermMeta')
    );
  }

  findKanjiBulk(kanjiList: string[], dictionaries: any) {
    return this.both(
      this.sides(dictionaryTitles(dictionaries)),
      () => super.findKanjiBulk(kanjiList, dictionaries),
      () => this.metaFind(Kind.Kanji, kanjiList, dictionaries, '_createKanji')
    );
  }

  findKanjiMetaBulk(kanjiList: string[], dictionaries: any) {
    return this.both(
      this.sides(dictionaryTitles(dictionaries)),
      () => super.findKanjiMetaBulk(kanjiList, dictionaries),
      () => this.metaFind(Kind.KanjiMeta, kanjiList, dictionaries, '_createKanjiMeta')
    );
  }

  async findTagMetaBulk(items: { query: string; dictionary: string }[]) {
    const { idb, packs } = this.sides(items.map(({ dictionary }) => dictionary));
    const results: any[] = idb ? await super.findTagMetaBulk(items) : new Array(items.length);
    if (packs) {
      const rows = await this.packFind(
        items,
        {
          kinds: [Kind.TagMeta],
          key: ({ query }) => query,
          dictionary: (title, item) => title === item.dictionary
        },
        (row, _item, index) => ({ row, index })
      );
      // The first row per item, as IndexedDB's findFirst gives it (rows have no id there).
      for (const {
        row: { id: _id, ...row },
        index
      } of rows)
        results[index] ??= row;
    }
    return results;
  }

  getMedia(items: { path: string; dictionary: string }[]) {
    const self = this as any;
    return this.both(
      this.sides(items.map(({ dictionary }) => dictionary)),
      () => super.getMedia(items),
      () =>
        this.packFind(
          items,
          {
            kinds: [Kind.Media],
            key: ({ path }) => path,
            dictionary: (title, item) => title === item.dictionary
          },
          (row, item, itemIndex) => self._createMedia(row, { item, itemIndex, indexIndex: 0 })
        )
    );
  }
}
