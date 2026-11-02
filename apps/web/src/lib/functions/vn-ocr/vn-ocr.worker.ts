/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Reads a visual novel's frame for the overlay (lib/data/vn/vn-ocr.ts): textspot8 finds the lines,
 * VOCR6.2 Large (fast) reads each horizontal one with every character's cell. Greedy decode, no
 * character LM. Models from the site (scripts/vn-ocr/fetch.sh), onnxruntime-web's wasm. With a hook line, its characters are aligned to the OCR'd dialogue and name
 * lines (align_map) and placed in their cells: the text stays the hook's.
 */

import * as ort from 'onnxruntime-web';
// The plain runtime, not the other workers' asyncify (WebGPU) one: that build has no float64 Cast,
// which textspot8's requantisation needs.
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

export interface VnOcrChar {
  text: string;
  /** The character's cell along the line, in game-screen px */
  x0: number;
  x1: number;
}

export interface VnOcrLine {
  text: string;
  /** The spotter's class: 0 dialogue, 1 name, 2 choice, 3 UI, 4 scene */
  tag: number;
  /** x, y, w, h in game-screen px */
  box: [number, number, number, number];
  chars: VnOcrChar[];
}

export interface VnOcrRequest {
  id: number;
  models: { spotter: string; recognizer: string };
  frame: ImageBitmap;
  /** A hooked line: the lines returned are its characters placed in the OCR'd cells, [] when it doesn't match */
  hook?: string;
}

export type VnOcrMessage =
  | { id: number; lines: VnOcrLine[]; ms: number }
  | { id: number; error: string };

// The runtime from this site, not a CDN.
ort.env.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm };
ort.env.wasm.numThreads = self.crossOriginIsolated
  ? Math.min(4, navigator.hardwareConcurrency || 1)
  : 1;

/** The frame size the models were trained at (upstream scales frames to fit it). */
const fitWidth = 960;
const fitHeight = 544;

type Meta = Record<string, any>;

/** The ONNX file's metadata_props (ModelProto field 14: key 1, value 2), where vocr keeps its settings. */
function onnxMeta(bytes: Uint8Array): Meta {
  const decoder = new TextDecoder();
  const out: Meta = {};
  const varint = (state: { at: number }) => {
    let value = 0;
    let scale = 1;
    let byte;

    do {
      byte = bytes[state.at++];
      value += (byte & 0x7f) * scale;
      scale *= 128;
    } while (byte & 0x80);
    return value;
  };
  const fields = (
    from: number,
    to: number,
    each: (field: number, start: number, end: number) => void
  ) => {
    const state = { at: from };

    while (state.at < to) {
      const key = varint(state);
      const wire = key % 8;

      if (wire === 0) varint(state);
      else if (wire === 1) state.at += 8;
      else if (wire === 5) state.at += 4;
      else if (wire === 2) {
        const length = varint(state);

        each(Math.floor(key / 8), state.at, state.at + length);
        state.at += length;
      } else throw new Error('not an ONNX file');
    }
  };

  fields(0, bytes.length, (field, start, end) => {
    if (field !== 14) return;
    const entry: string[] = [];

    fields(
      start,
      end,
      (part, from, to) => (entry[part] = decoder.decode(bytes.subarray(from, to)))
    );
    try {
      out[entry[1]] = JSON.parse(entry[2]);
    } catch {
      out[entry[1]] = entry[2];
    }
  });
  if (out['vocr.format'] !== 1) throw new Error('not a vocr ONNX file of format 1');
  return out;
}

async function load(url: string) {
  const response = await fetch(url);

  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());

  return {
    meta: onnxMeta(bytes),
    session: await ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    })
  };
}

// ----------------------------------------------------------------------------- images

/** A grey image, row-major. */
interface Grey {
  data: Uint8Array;
  width: number;
  height: number;
}

function crop({ data, width }: Grey, x: number, y: number, w: number, h: number): Grey {
  const out = new Uint8Array(w * h);

  for (let row = 0; row < h; row += 1) {
    out.set(data.subarray((y + row) * width + x, (y + row) * width + x + w), row * w);
  }
  return { data: out, width: w, height: h };
}

/** vocr_resized_width(): round(w * height / h), half to even, clamped to [min, max]. */
function resizedWidth(w: number, h: number, height: number, max: number, min = 8) {
  const num = w * height;
  let q = Math.floor((2 * num + h) / (2 * h));

  if ((2 * num + h) % (2 * h) === 0 && q & 1) q -= 1;
  return Math.max(min, Math.min(max, q));
}

const f32 = Math.fround;

/** cvRound of a float32 >= 0: half to even. */
function roundEven(v: number) {
  const floor = Math.floor(v);
  const rest = v - floor;

  return rest > 0.5 || (rest === 0.5 && floor % 2 === 1) ? floor + 1 : floor;
}

/** runtime/vocr.c's resize coefficients: per output index the source index and its float32 fraction. */
function coef(nOut: number, nIn: number) {
  const scale = 1.0 / (nOut / nIn);
  const s = new Int32Array(nOut);
  const f = new Float32Array(nOut);

  for (let i = 0; i < nOut; i += 1) {
    const at = f32((i + 0.5) * scale - 0.5);
    const index = Math.floor(at);

    s[i] = index;
    f[i] = f32(at - index);
  }
  return { s, f };
}

/** vocr_onnx.preprocess: the network's input (height × padded width) and the resized width. */
function preprocess(g: Grey, invert: boolean, height: number, stride: number, maxWidth: number) {
  const { width: w, height: h } = g;
  const src = invert ? g.data.map((v) => 255 - v) : g.data;
  const nw = resizedWidth(w, h, height, maxWidth);
  const padded = Math.ceil(nw / stride) * stride;
  const rows = coef(height, h);
  const cols = coef(nw, w);
  const sx = new Int32Array(nw);
  const s1 = new Int32Array(nw);
  const a0 = new Int32Array(nw);
  const a1 = new Int32Array(nw);

  for (let i = 0; i < nw; i += 1) {
    let x = cols.s[i];
    let fx = cols.f[i];

    if (x < 0) [x, fx] = [0, 0];
    if (x >= w - 1) [x, fx] = [w - 1, 0];
    sx[i] = x;
    s1[i] = x + 1 < w ? x + 1 : x;
    a0[i] = roundEven(f32(f32(1 - fx) * 2048));
    a1[i] = roundEven(f32(fx * 2048));
  }

  const out = new Uint8Array(height * padded);

  for (let y = 0; y < height; y += 1) {
    const r0 = Math.min(Math.max(rows.s[y], 0), h - 1) * w;
    const r1 = Math.min(Math.max(rows.s[y] + 1, 0), h - 1) * w;
    const fy = rows.f[y];
    const b0 = roundEven(f32(f32(1 - fy) * 2048));
    const b1 = roundEven(f32(fy * 2048));

    for (let x = 0; x < padded; x += 1) {
      // The pad repeats the last resized column.
      const c = Math.min(x, nw - 1);
      const h0 = src[r0 + sx[c]] * a0[c] + src[r0 + s1[c]] * a1[c];
      const h1 = src[r1 + sx[c]] * a0[c] + src[r1 + s1[c]] * a1[c];

      out[y * padded + x] = (((b0 * (h0 >> 4)) >> 16) + ((b1 * (h1 >> 4)) >> 16) + 2) >> 2;
    }
  }
  return { input: out, width: padded, nw };
}

// ----------------------------------------------------------------------------- recognizer

// eval/charbox.py's calibration groups
const groupSets = [
  '、。，．」』）】〉》〕｝］〙〗”’',
  '「『（【〈《〔｛［〘〖“‘',
  '…‥・',
  'ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ',
  'ー―─～〜－',
  '！？♪☆★♥♡※'
];
/** charbox fixed point: 1/16 px */
const Q = 16;

function charGroup(ch: string) {
  const points = [...ch];

  if (points.length !== 1) return 0;
  const found = groupSets.findIndex((set) => set.includes(ch));

  if (found >= 0) return found + 1;
  const code = ch.codePointAt(0)!;

  return code < 0x80 || (code >= 0xff61 && code <= 0xff9f) ? 7 : 0;
}

/** Python's (a + b // 2) // b, rounded away from zero for negatives as vocr_charbox.c. */
function divRound(a: number, b: number) {
  const half = Math.floor(b / 2);

  return a >= 0 ? Math.floor((a + half) / b) : -Math.floor((-a + half) / b);
}

/** The greedy characters (class, first frame) of a CTC best path. */
function spans(best: ArrayLike<bigint>) {
  const out: [number, number][] = [];
  let last = 0;

  for (let t = 0; t < best.length; t += 1) {
    const c = Number(best[t]);

    if (c && c !== last) out.push([c, t]);
    last = c;
  }
  return out;
}

/** vocr_charbox.c's cells without INK or PITCH: per character [x0, x1) in 1/16 crop px. */
function cells(
  sp: [number, number][],
  w: number,
  h: number,
  nw: number,
  cal: number[],
  groups: number[],
  stride: number
) {
  const n = sp.length;

  if (!n) return [];
  const c = sp.map(([cls, f0]) => {
    const r = Q * (stride * f0 + Math.floor(stride / 2)) + cal[0] + cal[1 + groups[cls]];

    return Math.min(Math.max(divRound(r * w, nw), 0), w * Q);
  });
  const d = c
    .slice(1)
    .map((v, i) => v - c[i])
    .sort((a, b) => a - b);
  let pitch = d.length ? d[Math.floor((d.length - 1) / 2)] : h * Q;

  if (pitch <= 0) pitch = h * Q;
  const cuts = c.slice(1).map((v, i) => divRound(c[i] + v, 2));
  const lo = [Math.max(0, c[0] - Math.floor(pitch / 2)), ...cuts];
  const hi = [...cuts, Math.min(w * Q, c[n - 1] + Math.floor(pitch / 2))];

  return lo.map((from, i) => [from, Math.max(from, hi[i])]);
}

interface Recognizer {
  session: ort.InferenceSession;
  vocab: string[];
  groups: number[];
  height: number;
  stride: number;
  maxWidth: number;
  cal: number[];
  sections: boolean;
}

/** One line crop → its greedy text and characters, cells in crop px. */
async function readLine(rec: Recognizer, g: Grey, invert: boolean) {
  const { input, width, nw } = preprocess(g, invert, rec.height, rec.stride, rec.maxWidth);
  const feeds: Record<string, ort.Tensor> = {
    grey: new ort.Tensor('uint8', input, [1, 1, rec.height, width])
  };

  if (rec.sections) feeds.head_sections = new ort.Tensor('bool', new Uint8Array([1]), []);
  const { best } = await rec.session.run(feeds, ['best']);
  const sp = spans(best.data as BigInt64Array);

  best.dispose();
  return cells(sp, g.width, g.height, nw, rec.cal, rec.groups, rec.stride).map(([x0, x1], i) => ({
    text: rec.vocab[sp[i][0]],
    x0: x0 / Q,
    x1: x1 / Q
  }));
}

// ----------------------------------------------------------------------------- spotter

/** x, y, w, h, vertical, conf, dark, tag, tconf (textspot6_twin's box tuple) */
type Box9 = [number, number, number, number, number, number, number, number, number];

const boxMax = 64;
const padPct = 18;
const padMin = 2;
const minAcross = 4;
const tconfMax = 127;

function compare(a: number[], b: number[]) {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

const sortedBy = <T>(items: T[], key: (item: T) => number[]) =>
  [...items].sort((a, b) => compare(key(a), key(b)));

/** The 2 × 2 mean (rounded) of the spotter's half scale. */
function halve({ data, width, height }: Grey): Grey {
  const w = Math.ceil(width / 2);
  const h = Math.ceil(height / 2);
  const out = new Uint8Array(w * h);

  for (let y = 0; y < h; y += 1) {
    const r0 = 2 * y * width;
    const r1 = Math.min(2 * y + 1, height - 1) * width;

    for (let x = 0; x < w; x += 1) {
      const c0 = 2 * x;
      const c1 = Math.min(2 * x + 1, width - 1);

      out[y * w + x] = (data[r0 + c0] + data[r0 + c1] + data[r1 + c0] + data[r1 + c1] + 2) >> 2;
    }
  }
  return { data: out, width: w, height: h };
}

/** vocr_line_dark: 1 when the box's text is darker than its background. */
function lineDark(g: Grey, x: number, y: number, w: number, h: number) {
  const a = crop(g, x, y, w, h).data;
  const border: number[] = [];

  for (let i = 0; i < w; i += 1) border.push(a[i]);
  for (let i = 0; i < w; i += 1) border.push(a[(h - 1) * w + i]);
  for (let i = 0; i < h; i += 1) border.push(a[i * w]);
  for (let i = 0; i < h; i += 1) border.push(a[i * w + w - 1]);
  border.sort((p, q) => p - q);
  const bg = border[Math.floor(border.length / 2)];
  const cum = new Array(256).fill(0);

  for (const v of a) cum[v] += 1;
  for (let v = 1; v < 256; v += 1) cum[v] += cum[v - 1];
  const n = w * h;
  const first = (k: number) => cum.findIndex((total) => total >= k);
  const lo = first(Math.floor((n * 2) / 100));
  const hi = first(Math.floor((n * 98) / 100));
  const d = Math.max(16, Math.floor((hi - lo) / 4));
  let nd = 0;
  let nb = 0;

  for (const v of a) {
    if (v < bg - d) nd += 1;
    else if (v > bg + d) nb += 1;
  }
  return nd > 8 * nb ? 1 : 0;
}

function joins(a: Box9, b: Box9) {
  if (a[7] !== b[7] || a[4] !== b[4]) return false;
  const [lo, size] = a[4] ? [1, 3] : [0, 2];
  const [aLo, aSize] = a[4] ? [0, 2] : [1, 3];
  const ov = Math.min(a[lo] + a[size], b[lo] + b[size]) - Math.max(a[lo], b[lo]);
  const gap = Math.max(a[aLo], b[aLo]) - Math.min(a[aLo] + a[aSize], b[aLo] + b[aSize]);
  const sa = a[aSize];
  const sb = b[aSize];

  return ov > 0 && gap <= Math.max(sa, sb) && 2 * Math.max(sa, sb) <= 3 * Math.min(sa, sb);
}

function rowsOf<T>(
  items: T[],
  keySort: (t: T) => number[],
  lo: (t: T) => number,
  size: (t: T) => number,
  keyRow: (t: T) => number[]
) {
  const out: T[] = [];
  let run: T[] = [];

  for (const it of sortedBy(items, keySort)) {
    if (run.length) {
      const f = run[0];
      const ov = Math.min(lo(it) + size(it), lo(f) + size(f)) - Math.max(lo(it), lo(f));

      if (2 * ov >= Math.min(size(it), size(f))) {
        run.push(it);
        continue;
      }
      out.push(...sortedBy(run, keyRow));
    }
    run = [it];
  }
  return [...out, ...sortedBy(run, keyRow)];
}

function orderBlock(members: Box9[]) {
  return members[0][4]
    ? rowsOf(
        members,
        (b) => [-(b[0] + b[2]), b[1], b[0], b[2], b[3]],
        (b) => b[0],
        (b) => b[2],
        (b) => [b[1], -(b[0] + b[2]), b[3], b[2]]
      )
    : rowsOf(
        members,
        (b) => [b[1], b[0], b[3], b[2]],
        (b) => b[1],
        (b) => b[3],
        (b) => [b[0], b[1], b[3], b[2]]
      );
}

/** textspot6_twin.group_and_order: the boxes in reading order (blocks, then rows in each). */
function groupAndOrder(unsorted: Box9[]) {
  const boxes = sortedBy(unsorted, (b) => b);
  const parent = boxes.map((_, i) => i);
  const find = (a: number) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };

  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (!joins(boxes[i], boxes[j])) continue;
      const [ri, rj] = [find(i), find(j)];

      if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
    }
  }
  const groups = new Map<number, Box9[]>();

  boxes.forEach((box, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), box]));
  type Block = { bb: number[]; members: Box9[] };
  const blocks: Block[] = [...groups.values()].map((members) => {
    const x0 = Math.min(...members.map((b) => b[0]));
    const y0 = Math.min(...members.map((b) => b[1]));
    const x1 = Math.max(...members.map((b) => b[0] + b[2]));
    const y1 = Math.max(...members.map((b) => b[1] + b[3]));

    return {
      bb: [x0, y0, x1 - x0, y1 - y0, members[0][4], members[0][7]],
      members: orderBlock(members)
    };
  });
  const rows: Block[][] = [];
  let run: Block[] = [];

  for (const block of sortedBy(blocks, ({ bb }) => [bb[1], bb[0], bb[3], bb[2], bb[5]])) {
    if (run.length) {
      const f = run[0].bb;
      const b = block.bb;
      const ov = Math.min(b[1] + b[3], f[1] + f[3]) - Math.max(b[1], f[1]);

      if (2 * ov >= Math.min(b[3], f[3])) {
        run.push(block);
        continue;
      }
      rows.push(run);
    }
    run = [block];
  }
  if (run.length) rows.push(run);

  return rows
    .flatMap((row) =>
      row.every(({ bb }) => bb[4])
        ? sortedBy(row, ({ bb }) => [-(bb[0] + bb[2]), bb[1], bb[3], bb[2], bb[5]])
        : sortedBy(row, ({ bb }) => [bb[0], bb[1], bb[3], bb[2], bb[5]])
    )
    .flatMap(({ members }) => members);
}

interface Spotter {
  session: ort.InferenceSession;
  tags: number;
  halfAbove: number;
  halfAboveH: number;
  confMin: number;
  minCells: number;
  stride: number;
}

/** Spotter.spot + decode on a whole frame: the boxes in reading order, in the frame's px. */
async function spot(sp: Spotter, g: Grey): Promise<Box9[]> {
  const { width: W, height: H } = g;
  const f = (sp.halfAbove && W > sp.halfAbove) || (sp.halfAboveH && H > sp.halfAboveH) ? 2 : 1;
  const x = f === 2 ? halve(g) : g;
  const { head } = await sp.session.run({
    grey: new ort.Tensor('uint8', x.data, [1, 1, x.height, x.width])
  });
  const [, , hn, wn] = head.dims;
  const data = head.data as Int8Array;
  const T = sp.tags;
  const mh = Math.ceil(x.height / 4);
  const mw = Math.ceil(x.width / 4);
  // maps[c][r][col]: the head's 2 × 2 sub-pixel channels laid out (Spotter.maps)
  const map = (c: number, r: number, col: number) => {
    const quarter = 2 * (r & 1) + (col & 1);
    const channel = c < 4 ? 4 * quarter + c : 16 + T * quarter + c - 4;

    return data[(channel * hn + (r >> 1)) * wn + (col >> 1)];
  };

  head.dispose();
  const s = sp.stride;
  const seen = new Uint8Array(mh * mw);
  const cands: { key: number[]; box: number[] }[] = [];

  for (let start = 0; start < mh * mw; start += 1) {
    if (seen[start] || map(0, Math.floor(start / mw), start % mw) <= 0) continue;
    // A 4-connected component of the kernel map.
    const cellsAt: number[] = [start];

    seen[start] = 1;
    for (let k = 0; k < cellsAt.length; k += 1) {
      const r = Math.floor(cellsAt[k] / mw);
      const col = cellsAt[k] % mw;

      for (const [nr, nc] of [
        [r - 1, col],
        [r + 1, col],
        [r, col - 1],
        [r, col + 1]
      ]) {
        if (nr < 0 || nc < 0 || nr >= mh || nc >= mw || seen[nr * mw + nc] || map(0, nr, nc) <= 0)
          continue;
        seen[nr * mw + nc] = 1;
        cellsAt.push(nr * mw + nc);
      }
    }
    const n = cellsAt.length;

    if (n < sp.minCells) continue;
    let sumK = 0;
    let sumO = 0;

    for (const at of cellsAt) {
      sumK += map(0, Math.floor(at / mw), at % mw);
      sumO += map(1, Math.floor(at / mw), at % mw);
    }
    const conf = Math.floor(sumK / n);

    if (conf < sp.confMin) continue;
    const vertical = sumO > 0 ? 1 : 0;
    let nearSum = 0;
    let farSum = 0;
    let alongMin = Infinity;
    let alongMax = -Infinity;
    const scores = new Array(T + 1).fill(0);

    for (const at of cellsAt) {
      const r = Math.floor(at / mw);
      const col = at % mw;
      const [across, along] = vertical ? [col, r] : [r, col];
      const c2 = 2 * s * across + s - 1;

      nearSum += c2 - map(2, r, col);
      farSum += c2 + map(3, r, col);
      alongMin = Math.min(alongMin, along);
      alongMax = Math.max(alongMax, along);
      for (let t = 0; t < T; t += 1) scores[t + 1] += map(4 + t, r, col);
    }
    const near = Math.floor((f * nearSum) / (2 * n));
    const far = Math.ceil((f * farSum) / (2 * n));
    const lo = f * s * alongMin;
    const hi = f * s * (alongMax + 1);
    const across = far - near;

    if (across < minAcross * f) continue;
    const pad = Math.max(padMin, Math.floor((across * padPct + 50) / 100));
    let [x0, x1, y0, y1] = vertical
      ? [near - pad, far + pad, lo - pad, hi + pad]
      : [lo - pad, hi + pad, near - pad, far + pad];

    [x0, y0, x1, y1] = [Math.max(0, x0), Math.max(0, y0), Math.min(W, x1), Math.min(H, y1)];
    if (x1 <= x0 || y1 <= y0) continue;
    let tag = 0;

    for (let c = 1; c < scores.length; c += 1) if (scores[c] > scores[tag]) tag = c;
    let tconf = 0;

    if (scores.length > 1) {
      const second = Math.max(...scores.filter((_, c) => c !== tag));

      tconf = Math.min(tconfMax, Math.floor((scores[tag] - second) / n));
    }
    cands.push({
      key: [-conf, -n, vertical, y0, x0, y1 - y0, x1 - x0, tag],
      box: [x0, y0, x1 - x0, y1 - y0, vertical, conf, tag, tconf]
    });
  }
  const kept = sortedBy(cands, ({ key, box }) => [...key, ...box]).slice(0, boxMax);

  return groupAndOrder(
    kept.map(({ box: [bx, by, bw, bh, v, conf, tag, tconf] }) => [
      bx,
      by,
      bw,
      bh,
      v,
      conf,
      lineDark(g, bx, by, bw, bh),
      tag,
      tconf
    ])
  );
}

// ----------------------------------------------------------------------------- hook text

const SYNC = 8;

/** eval/charbox.py align_map: dst[j] → the index of the src character it is aligned to, or -1. */
function alignMap(src: string[], dst: string[], sync = SYNC) {
  const n = src.length;
  const m = dst.length;
  const out = new Array(m).fill(-1);
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (src[i] === dst[j]) {
      out[j++] = i++;
      continue;
    }
    let found: [number, number] | undefined;

    for (let s = 1; s <= 2 * sync && !found; s += 1) {
      let best: [number, number, number] | undefined;

      for (let di = Math.max(0, s - sync); di <= Math.min(s, sync); di += 1) {
        const dj = s - di;

        if (i + di >= n || j + dj >= m || src[i + di] !== dst[j + dj]) continue;
        if (!(i + di + 1 >= n || j + dj + 1 >= m || src[i + di + 1] === dst[j + dj + 1])) continue;
        const key = Math.abs(di - dj) * 64 + dj;

        if (!best || key < best[0]) best = [key, di, dj];
      }
      if (best) found = [best[1], best[2]];
    }
    if (!found) {
      out[j++] = i++;
      continue;
    }
    const [di, dj] = found;

    for (let t = 0; t < Math.min(di, dj); t += 1) out[j + t] = i + t;
    i += di;
    j += dj;
  }
  return out;
}

/**
 * The hook line's characters in the cells of the OCR'd dialogue and name lines they align to (an
 * unaligned one shares its neighbour's cell, as vocr_onnx.place); [] when fewer than half of them
 * match an OCR'd character, so the caller keeps its guess.
 */
function placeHook(hook: string, lines: VnOcrLine[]): VnOcrLine[] {
  const src = lines.flatMap((line, index) => line.chars.map((char) => ({ char, index })));
  const dst = [...hook].filter((ch) => !/\s/u.test(ch));
  const map = alignMap(
    src.map(({ char }) => char.text),
    dst
  );
  const equal = map.filter((i, j) => i >= 0 && src[i].char.text === dst[j]).length;

  if (!dst.length || 2 * equal < dst.length) return [];
  const out: VnOcrLine[] = [];

  dst.forEach((text, j) => {
    const i =
      map[j] >= 0 ? map[j] : (map.slice(0, j).findLast((k) => k >= 0) ?? map.find((k) => k >= 0));

    if (i === undefined || i < 0) return;
    const { char, index } = src[i];
    const last = out[out.length - 1];
    const placed = { text, x0: char.x0, x1: char.x1 };

    if (last && last.box === lines[index].box) {
      last.text += text;
      last.chars.push(placed);
    } else {
      out.push({ text, tag: lines[index].tag, box: lines[index].box, chars: [placed] });
    }
  });
  return out;
}

// ----------------------------------------------------------------------------- frames

let models: Promise<{ spotter: Spotter; recognizer: Recognizer }> | undefined;

function loadModels(urls: VnOcrRequest['models']) {
  models ??= (async () => {
    const [s, r] = await Promise.all([load(urls.spotter), load(urls.recognizer)]);
    const vocab: string[] = r.meta['vocr.vocab'];

    if (s.meta['vocr.kind'] !== 'spotter' || r.meta['vocr.kind'] !== 'recognizer') {
      throw new Error('wrong vocr model files');
    }
    return {
      spotter: {
        session: s.session,
        tags: s.meta['vocr.tags'],
        halfAbove: s.meta['vocr.half_above'],
        halfAboveH: s.meta['vocr.half_above_h'],
        confMin: s.meta['vocr.conf_min'],
        minCells: s.meta['vocr.min_cells'],
        stride: s.meta['vocr.map_stride']
      },
      recognizer: {
        session: r.session,
        vocab,
        groups: vocab.map(charGroup),
        height: r.meta['vocr.height'],
        stride: r.meta['vocr.stride'],
        maxWidth: r.meta['vocr.max_width'],
        cal: r.meta['vocr.charbox_cal'] ?? new Array(9).fill(0),
        sections: r.session.inputNames.includes('head_sections')
      }
    };
  })();
  models.catch(() => (models = undefined));
  return models;
}

/** The frame scaled to fit 960 × 544, as grey ((77 R + 150 G + 29 B) >> 8), and its scale. */
function frameGrey(frame: ImageBitmap) {
  const scale = Math.min(fitWidth / frame.width, fitHeight / frame.height);
  const width = Math.round(frame.width * scale);
  const height = Math.round(frame.height * scale);
  const context = new OffscreenCanvas(width, height).getContext('2d', {
    willReadFrequently: true
  })!;

  context.imageSmoothingQuality = 'high';
  context.drawImage(frame, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height);

  for (let i = 0; i < data.length; i += 1) {
    data[i] = (77 * rgba[4 * i] + 150 * rgba[4 * i + 1] + 29 * rgba[4 * i + 2]) >> 8;
  }
  return { grey: { data, width, height }, scale: width / frame.width };
}

/** vocr_onnx.read_region on the whole frame: every horizontal line, in reading order. */
async function readGrey(spotter: Spotter, recognizer: Recognizer, g: Grey) {
  const lines: VnOcrLine[] = [];

  for (const [x, y, w, h, vertical, , dark, tag] of await spot(spotter, g)) {
    // shortcut: horizontal lines only; upstream didn't export its vertical recognizer.
    if (vertical) continue;
    const chars = await readLine(recognizer, crop(g, x, y, w, h), !!dark);

    lines.push({
      text: chars.map((char) => char.text).join(''),
      tag,
      box: [x, y, w, h],
      chars: chars.map((char) => ({ ...char, x0: char.x0 + x, x1: char.x1 + x }))
    });
  }
  return lines;
}

async function read({ models: urls, frame, hook }: VnOcrRequest) {
  const { spotter, recognizer } = await loadModels(urls);
  const { grey, scale } = frameGrey(frame);

  frame.close();
  const lines = (await readGrey(spotter, recognizer, grey)).map((line) => ({
    ...line,
    box: line.box.map((v) => v / scale) as VnOcrLine['box'],
    chars: line.chars.map((char) => ({ ...char, x0: char.x0 / scale, x1: char.x1 / scale }))
  }));

  return hook === undefined
    ? lines
    : placeHook(
        hook,
        lines.filter(({ tag }) => tag <= 1)
      );
}

self.onmessage = ({ data }: MessageEvent<VnOcrRequest>) => {
  const started = performance.now();

  read(data).then(
    (lines) =>
      self.postMessage({
        id: data.id,
        lines,
        ms: performance.now() - started
      } satisfies VnOcrMessage),
    (error) =>
      self.postMessage({
        id: data.id,
        error: error instanceof Error ? error.message : String(error)
      } satisfies VnOcrMessage)
  );
};
