/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import { isManga } from '$lib/data/manga';
import { bookContent } from '$lib/data/book-content';
import { isVn } from '$lib/data/vn';
import type { LoadData } from '$lib/functions/file-loaders/types';
import { parseBookHtml } from '$lib/functions/file-loaders/utils/sanitize-book-html';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * Sending a book to a friend, the part without WebRTC (book-transfer.ts has the rest): the book's
 * record as this browser keeps it, packed into one Blob, sent over a data channel in chunks with
 * backpressure and a SHA-256 the receiver checks before importing; the receiver confirms.
 */

export const CHUNK_BYTES = 64 * 1024;
/** Stop queueing past this, go on when the channel drains to a quarter of it */
export const HIGH_WATER = 4 * 1024 * 1024;

export class TransferError extends Error {
  constructor(public reason: string) {
    super(`Transfer: ${reason}`);
  }
}

/** The parts of RTCDataChannel used here (tests pass a fake) */
export interface TransferChannel {
  readonly readyState: string;
  readonly bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  binaryType: string;
  send(data: string | ArrayBuffer | ArrayBufferView<ArrayBuffer>): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(
    type: 'close' | 'bufferedamountlow',
    listener: () => void,
    options?: { once: boolean }
  ): void;
}

interface PackHeader {
  title: string;
  styleSheet: string;
  elementHtml: string;
  htmlBackup?: string;
  sections?: BooksDbBookData['sections'];
  characters: number;
  language?: string;
  series?: string;
  seriesIndex?: number;
  /** [name, size, type] in the order of the bytes after the header */
  blobs: [string, number, string][];
  cover: [number, string] | null;
}

/** [4-byte header length][header JSON][blobs…][cover] */
export function packBook(book: Omit<BooksDbBookData, 'id'>) {
  const names = Object.keys(book.blobs);
  const cover = book.coverImage instanceof Blob ? book.coverImage : undefined;
  const header: PackHeader = {
    title: book.title,
    styleSheet: book.styleSheet,
    elementHtml: book.elementHtml,
    htmlBackup: book.htmlBackup,
    sections: book.sections,
    characters: book.characters,
    language: book.language,
    series: book.series,
    seriesIndex: book.seriesIndex,
    blobs: names.map((name) => [name, book.blobs[name].size, book.blobs[name].type]),
    cover: cover ? [cover.size, cover.type] : null
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const length = new Uint8Array(4);

  new DataView(length.buffer).setUint32(0, json.length, true);
  return new Blob([
    length,
    json,
    ...names.map((name) => book.blobs[name]),
    ...(cover ? [cover] : [])
  ]);
}

const isSize = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0;

/** A received pack as a book to import; its HTML is sanitized like any import's. */
export async function unpackBook(blob: Blob, lastBookModified = Date.now()): Promise<LoadData> {
  const length =
    blob.size >= 4 ? new DataView(await blob.slice(0, 4).arrayBuffer()).getUint32(0, true) : -1;

  if (length < 0 || length > blob.size - 4) throw new TransferError('format');

  let header: PackHeader;

  try {
    header = JSON.parse(await blob.slice(4, 4 + length).text());
  } catch (_) {
    throw new TransferError('format');
  }
  if (
    typeof header?.title !== 'string' ||
    !header.title.trim() ||
    typeof header.elementHtml !== 'string' ||
    typeof header.styleSheet !== 'string' ||
    !isSize(header.characters) ||
    !Array.isArray(header.blobs) ||
    !header.blobs.every(
      (entry) =>
        Array.isArray(entry) &&
        typeof entry[0] === 'string' &&
        isSize(entry[1]) &&
        typeof entry[2] === 'string'
    ) ||
    (header.cover !== null && !(isSize(header.cover?.[0]) && typeof header.cover[1] === 'string'))
  ) {
    throw new TransferError('format');
  }

  let at = 4 + length;
  const blobs: Record<string, Blob> = {};

  for (const [name, size, type] of header.blobs) {
    blobs[name] = blob.slice(at, at + size, type);
    at += size;
  }

  const coverImage = header.cover
    ? blob.slice(at, at + header.cover[0], header.cover[1])
    : undefined;

  at += header.cover?.[0] ?? 0;
  if (at !== blob.size || isVn(header)) throw new TransferError('format');
  if (isManga(header) && bookContent(header).kind !== 'manga') throw new TransferError('format');

  // A manga's elementHtml is a marker and JSON page names, never rendered as HTML.
  const clean = (html: string) =>
    bookContent({ elementHtml: html }).kind === 'manga' ? html : parseBookHtml(html).innerHTML;

  return {
    title: header.title,
    styleSheet: header.styleSheet,
    elementHtml: clean(header.elementHtml),
    ...(typeof header.htmlBackup === 'string' ? { htmlBackup: clean(header.htmlBackup) } : {}),
    ...(typeof header.language === 'string' ? { language: header.language } : {}),
    ...(typeof header.series === 'string' && header.series.trim()
      ? { series: header.series.trim().slice(0, 500) }
      : {}),
    ...(Number.isFinite(header.seriesIndex) ? { seriesIndex: header.seriesIndex } : {}),
    sections: Array.isArray(header.sections) ? header.sections : [],
    characters: header.characters,
    blobs,
    coverImage,
    hasThumb: true,
    lastBookModified,
    lastBookOpen: 0
  };
}

function control(data: unknown): { t?: string; sha256?: string; reason?: string } | null {
  if (typeof data !== 'string') return null;
  try {
    return JSON.parse(data);
  } catch (_) {
    return null;
  }
}

/**
 * Sends `blob` and resolves once the receiver confirmed it ('done'); rejects with the receiver's
 * reason, or 'closed' when the channel goes first.
 */
export async function sendBlob(
  channel: TransferChannel,
  blob: Blob,
  onProgress: (bytes: number) => void,
  chunk = CHUNK_BYTES
) {
  let failure: TransferError | undefined;
  const outcome = new Promise<void>((resolve, reject) => {
    const stop = (error: TransferError) => {
      failure = failure ?? error;
      reject(failure);
    };

    channel.addEventListener('message', ({ data }) => {
      const message = control(data);

      if (message?.t === 'done') resolve();
      else if (message?.t === 'fail') stop(new TransferError(message.reason || 'failed'));
    });
    channel.addEventListener('close', () => stop(new TransferError('closed')));
  });
  const hash = sha256.create();

  outcome.catch(() => {});
  channel.bufferedAmountLowThreshold = HIGH_WATER / 4;
  for (let at = 0; at < blob.size; at += chunk) {
    if (failure) throw failure;
    if (channel.bufferedAmount > HIGH_WATER) {
      await Promise.race([
        new Promise<void>((resolve) =>
          channel.addEventListener('bufferedamountlow', resolve, { once: true })
        ),
        outcome
      ]);
    }

    const bytes = new Uint8Array(await blob.slice(at, at + chunk).arrayBuffer());

    if (failure) throw failure;
    hash.update(bytes);
    channel.send(bytes);
    onProgress(Math.min(at + chunk, blob.size));
  }
  channel.send(JSON.stringify({ t: 'end', sha256: bytesToHex(hash.digest()) }));
  return outcome;
}

/**
 * Collects what `sendBlob` sends: resolves with the Blob once its size and SHA-256 match, else
 * tells the sender and rejects. The caller then answers with `confirm`.
 */
export function receiveBlob(
  channel: TransferChannel,
  size: number,
  onProgress: (bytes: number) => void
) {
  channel.binaryType = 'arraybuffer';
  return new Promise<Blob>((resolve, reject) => {
    const parts: ArrayBuffer[] = [];
    const hash = sha256.create();
    let received = 0;
    let settled = false;
    const fail = (reason: string) => {
      if (settled) return;
      settled = true;
      if (channel.readyState === 'open') confirm(channel, reason);
      reject(new TransferError(reason));
    };

    channel.addEventListener('message', ({ data }) => {
      if (settled) return;
      if (data instanceof ArrayBuffer) {
        received += data.byteLength;
        if (received > size) return fail('size');
        hash.update(new Uint8Array(data));
        parts.push(data);
        onProgress(received);
        return;
      }

      const message = control(data);

      if (message?.t !== 'end') return;
      if (received !== size || bytesToHex(hash.digest()) !== message.sha256)
        return fail('checksum');
      settled = true;
      resolve(new Blob(parts));
    });
    channel.addEventListener('close', () => {
      if (settled) return;
      settled = true;
      reject(new TransferError('closed'));
    });
  });
}

/** The receiver's answer: no reason = imported */
export function confirm(channel: TransferChannel, reason = '') {
  channel.send(JSON.stringify(reason ? { t: 'fail', reason } : { t: 'done' }));
}
