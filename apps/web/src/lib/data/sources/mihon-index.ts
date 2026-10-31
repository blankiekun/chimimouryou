/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * A Mihon/Tachiyomi repository's index.pb (keiyoushi's), read without a protobuf dependency: gzip
 * via DecompressionStream, then the wire format for the fields of Mihon's NetworkExtensionStore
 * (store 1 name, 3 signingKey, 101 ExtensionList, 102 listUrl; extension 1 name, 2 package,
 * 3 resources {1 apkUrl, 2 iconUrl, 501 jarUrl (Suwayomi's)}, 4 extensionLib, 6 versionName,
 * 7 contentWarning, 8 sources {1 id int64, 2 name, 3 lang, 4 homeUrl}). Unknown fields are skipped.
 * Source ids are 64-bit: read as BigInt, kept as decimal strings (Numbers lose them past 2^53).
 */

export interface MihonSource {
  id: string;
  name: string;
  lang: string;
  baseUrl: string;
}

export interface MihonEntry {
  extensionType: 'mihon';
  /** The package name, e.g. eu.kanade.tachiyomi.extension.ja.rawkuma */
  id: string;
  name: string;
  lang: string;
  version: string;
  lib: string;
  jarUrl: string;
  apkUrl: string;
  iconUrl: string;
  /** 1 safe, 2 mixed, 3 nsfw (0 unspecified) */
  contentWarning: number;
  sources: MihonSource[];
  [key: string]: unknown;
}

export interface MihonStore {
  name: string;
  signingKey: string;
  entries: MihonEntry[];
  /** Set when the store keeps its list in a separate file */
  listUrl: string;
}

type Field = { field: number; value: bigint | Uint8Array };

function* fields(bytes: Uint8Array): Generator<Field> {
  let at = 0;
  const varint = () => {
    let result = 0n;
    for (let shift = 0n; ; shift += 7n) {
      if (at >= bytes.length || shift > 63n) throw new Error('Damaged index.pb');
      const byte = bytes[at++];
      result |= BigInt(byte & 0x7f) << shift;
      if (byte < 0x80) return result;
    }
  };
  while (at < bytes.length) {
    const key = Number(varint());
    const field = key >>> 3;
    switch (key & 7) {
      case 0:
        yield { field, value: varint() };
        break;
      case 1:
      case 5:
        // 64- and 32-bit fixed values: none of the fields read here.
        at += (key & 7) === 1 ? 8 : 4;
        if (at > bytes.length) throw new Error('Damaged index.pb');
        break;
      case 2: {
        const length = Number(varint());
        if (at + length > bytes.length) throw new Error('Damaged index.pb');
        yield { field, value: bytes.subarray(at, at + length) };
        at += length;
        break;
      }
      default:
        throw new Error('Damaged index.pb');
    }
  }
}

const decoder = new TextDecoder();
const str = (value: bigint | Uint8Array) =>
  value instanceof Uint8Array ? decoder.decode(value) : '';
const sub = (value: bigint | Uint8Array) =>
  value instanceof Uint8Array ? value : new Uint8Array();
const num = (value: bigint | Uint8Array) => (typeof value === 'bigint' ? value : 0n);

function source(bytes: Uint8Array): MihonSource {
  const out: MihonSource = { id: '', name: '', lang: '', baseUrl: '' };
  for (const { field, value } of fields(bytes)) {
    if (field === 1) out.id = BigInt.asIntN(64, num(value)).toString();
    else if (field === 2) out.name = str(value);
    else if (field === 3) out.lang = str(value);
    else if (field === 4) out.baseUrl = str(value);
  }
  return out;
}

function extension(bytes: Uint8Array): MihonEntry {
  const out: MihonEntry = {
    extensionType: 'mihon',
    id: '',
    name: '',
    lang: '',
    version: '',
    lib: '',
    jarUrl: '',
    apkUrl: '',
    iconUrl: '',
    contentWarning: 0,
    sources: []
  };
  for (const { field, value } of fields(bytes)) {
    if (field === 1) out.name = str(value);
    else if (field === 2) out.id = str(value);
    else if (field === 3) {
      for (const resource of fields(sub(value))) {
        if (resource.field === 1) out.apkUrl = str(resource.value);
        else if (resource.field === 2) out.iconUrl = str(resource.value);
        else if (resource.field === 501) out.jarUrl = str(resource.value);
      }
    } else if (field === 4) out.lib = str(value);
    else if (field === 6) out.version = str(value);
    else if (field === 7) out.contentWarning = Number(num(value));
    else if (field === 8) out.sources.push(source(sub(value)));
  }
  const langs = new Set(out.sources.map((s) => s.lang));
  out.lang = langs.size === 1 ? [...langs][0] : 'all';
  return out;
}

/** The extensions of an ExtensionList message (field 1, repeated). */
export function readExtensionList(bytes: Uint8Array) {
  const entries: MihonEntry[] = [];
  for (const { field, value } of fields(bytes)) {
    if (field === 1) entries.push(extension(sub(value)));
  }
  return entries.filter((e) => e.id && e.name);
}

export async function gunzip(body: ArrayBuffer) {
  const stream = new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** An index.pb's body (gzip or not) → the store. */
export async function readMihonIndex(body: ArrayBuffer): Promise<MihonStore> {
  const start = new Uint8Array(body.slice(0, 2));
  const bytes = start[0] === 0x1f && start[1] === 0x8b ? await gunzip(body) : new Uint8Array(body);
  const store: MihonStore = { name: '', signingKey: '', entries: [], listUrl: '' };
  for (const { field, value } of fields(bytes)) {
    if (field === 1) store.name = str(value);
    else if (field === 3) store.signingKey = str(value);
    else if (field === 101) store.entries = readExtensionList(sub(value));
    else if (field === 102) store.listUrl = str(value);
  }
  return store;
}
