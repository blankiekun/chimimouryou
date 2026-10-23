/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  TransferError,
  confirm,
  packBook,
  receiveBlob,
  sendBlob,
  unpackBook,
  type TransferChannel
} from '$lib/data/book-transfer-channel';
import { isVn } from '$lib/data/vn';
import { isManga } from '$lib/data/manga';
import { addImportsToHome } from '$lib/data/library-home';
import { HubError, hubFetch, socialSession$ } from '$lib/data/social-account';
import type { Person } from '$lib/data/social';
import { storageSource$ } from '$lib/data/storage/storage-view';
import { StorageKey } from '$lib/data/storage/storage-types';
import {
  cacheStorageData$,
  database,
  readingGoalsMergeMode$,
  replicationSaveBehavior$,
  statisticsMergeMode$
} from '$lib/data/store';
import { BehaviorSubject } from 'rxjs';

/**
 * Send a book to a friend (Friends only, peer to peer): the hub (deploy/social-hub, /v1/transfers)
 * passes only the SDP; the book goes browser to browser over a WebRTC data channel
 * (book-transfer-channel.ts). STUN only, no relay: when the two can't connect directly it fails.
 * The receiver offers (with all its ICE candidates, no trickle), the sender answers. Both must
 * have the app open; the hub is polled only while a transfer is being set up.
 */

export const MAX_TRANSFER_BYTES = 300 * 1024 ** 2;
const ICE_SERVERS = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' }
];
/** The hub drops a transfer after this */
const TRANSFER_LIFE = 10 * 60_000;
/** The sender waits for the friend to accept: one poll per 3 s */
const WAIT_POLL = 3000;
/** The receiver waits for the answer, which comes within seconds: one poll a second */
const ANSWER_POLL = 1000;
const ANSWER_WAIT = 60_000;
const GATHER_WAIT = 5000;
const CONNECT_WAIT = 20_000;
const INCOMING_GAP = 20_000;

export type TransferKind = 'book' | 'manga';

export interface IncomingTransfer {
  id: string;
  title: string;
  kind: TransferKind;
  size: number;
  expires: number;
  from: Person;
}

export type TransferPhase = 'waiting' | 'connecting' | 'moving' | 'saving' | 'done' | 'failed';

export interface Transfer {
  id: string;
  direction: 'send' | 'receive';
  friend: Pick<Person, 'id' | 'name' | 'username'>;
  title: string;
  size: number;
  bytes: number;
  phase: TransferPhase;
  /** The reason it failed (book-transfer.error.* in the i18n files) */
  error?: string;
}

/** Books friends are offering this reader (from the hub, refreshed on Home and /friends) */
export const incoming$ = new BehaviorSubject<IncomingTransfer[]>([]);
/** This tab's transfers, both ways, until dismissed */
export const transfers$ = new BehaviorSubject<Transfer[]>([]);

const live = new Map<string, { pc?: RTCPeerConnection; cancelled: boolean }>();
let incomingAt = 0;

function update(id: string, patch: Partial<Transfer>) {
  transfers$.next(transfers$.getValue().map((one) => (one.id === id ? { ...one, ...patch } : one)));
}

export function dismissTransfer(id: string) {
  transfers$.next(transfers$.getValue().filter((one) => one.id !== id));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What a failure shows: a known reason, else the generic one */
function reasonOf(error: unknown) {
  const reason =
    error instanceof TransferError
      ? error.reason
      : error instanceof HubError
        ? { 404: 'gone', 409: 'busy', 429: 'limit', 403: 'friend', 413: 'tooBig' }[error.status]
        : '';
  const known = [
    'gone',
    'busy',
    'limit',
    'friend',
    'tooBig',
    'declined',
    'direct',
    'closed',
    'checksum',
    'size',
    'format',
    'import',
    'cancelled',
    'notLocal',
    'vn'
  ];

  return reason && known.includes(reason) ? reason : 'other';
}

function fail(id: string, error: unknown) {
  const entry = live.get(id);

  entry?.pc?.close();
  live.delete(id);
  const reason = entry?.cancelled ? 'cancelled' : reasonOf(error);

  update(id, { phase: 'failed', error: reason });
  // Best effort: the hub forgets it at once instead of after 10 minutes (already gone after these).
  if (reason !== 'declined' && reason !== 'gone') {
    hubFetch(`/v1/transfers/${id}`, 'DELETE').catch(() => {});
  }
}

function checkCancelled(id: string) {
  if (live.get(id)?.cancelled !== false) throw new TransferError('cancelled');
}

/** Cancels this tab's transfer; the friend's side sees the channel close or the hub's 404. */
export function cancelTransfer(id: string) {
  const entry = live.get(id);

  if (entry) entry.cancelled = true;
  fail(id, new TransferError('cancelled'));
}

/** Every ICE candidate in the description (no trickle), or what came within 5 s */
function gathered(pc: RTCPeerConnection) {
  return new Promise<string>((resolve) => {
    const done = () => resolve(pc.localDescription?.sdp ?? '');
    const timer = setTimeout(done, GATHER_WAIT);

    if (pc.iceGatheringState === 'complete') {
      clearTimeout(timer);
      done();
      return;
    }
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        done();
      }
    });
  });
}

/** The data channel open, or 'direct' (no direct route: no relay is used) */
function opened(pc: RTCPeerConnection, channel: Promise<RTCDataChannel>) {
  return new Promise<RTCDataChannel>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TransferError('direct')), CONNECT_WAIT);

    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') {
        clearTimeout(timer);
        reject(new TransferError('direct'));
      }
    });
    channel.then((one) => {
      const ready = () => {
        clearTimeout(timer);
        resolve(one);
      };

      if (one.readyState === 'open') ready();
      else one.addEventListener('open', ready);
    });
  });
}

/** Books offered to this reader; at most every 20 s unless forced. */
export async function loadIncoming(force = false) {
  if (!socialSession$.getValue() || (!force && Date.now() - incomingAt < INCOMING_GAP)) return;
  incomingAt = Date.now();
  await hubFetch<{ incoming: IncomingTransfer[] }>('/v1/transfers').then(
    ({ incoming }) => {
      const mine = new Set(transfers$.getValue().map((one) => one.id));

      incoming$.next(incoming.filter((one) => !mine.has(one.id)));
    },
    () => {}
  );
}

/** This browser's copy of the book, packed, or why it can't be sent */
export async function bookToSend(title: string) {
  const data = await database.getDataByTitle(title);

  if (!data) throw new TransferError('notLocal');
  if (isVn(data)) throw new TransferError('vn');

  const blob = packBook(data);

  if (blob.size > MAX_TRANSFER_BYTES) throw new TransferError('tooBig');
  return { blob, kind: (isManga(data) ? 'manga' : 'book') as TransferKind };
}

/** Sends a book; resolves when it is done or failed (the state is in transfers$). */
export async function sendBook(title: string, friend: Transfer['friend']) {
  const { blob, kind } = await bookToSend(title);
  const { id } = await hubFetch<{ id: string }>('/v1/transfers', 'POST', {
    to: friend.id,
    title,
    kind,
    size: blob.size
  });

  live.set(id, { cancelled: false });
  transfers$.next([
    ...transfers$.getValue(),
    { id, direction: 'send', friend, title, size: blob.size, bytes: 0, phase: 'waiting' }
  ]);

  try {
    let offer: string | null = null;
    const until = Date.now() + TRANSFER_LIFE;

    while (!offer) {
      await sleep(WAIT_POLL);
      checkCancelled(id);
      if (Date.now() > until) throw new TransferError('gone');

      const state = await hubFetch<{ state: string; offer: string | null }>(`/v1/transfers/${id}`);

      if (state.state === 'declined') throw new TransferError('declined');
      offer = state.offer;
    }
    update(id, { phase: 'connecting' });

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const channel = new Promise<RTCDataChannel>((resolve) =>
      pc.addEventListener('datachannel', (event) => resolve(event.channel))
    );

    live.set(id, { pc, cancelled: false });
    await pc.setRemoteDescription({ type: 'offer', sdp: offer });
    await pc.setLocalDescription(await pc.createAnswer());
    await hubFetch(`/v1/transfers/${id}/answer`, 'POST', { answer: await gathered(pc) });

    const open = await opened(pc, channel);

    checkCancelled(id);
    // Connected: the SDP (with both addresses) leaves the hub.
    hubFetch(`/v1/transfers/${id}`, 'DELETE').catch(() => {});
    update(id, { phase: 'moving' });
    await sendBlob(open as unknown as TransferChannel, blob, (bytes) => update(id, { bytes }));
    update(id, { phase: 'done', bytes: blob.size });
    pc.close();
    live.delete(id);
  } catch (error) {
    fail(id, error);
  }
}

export async function declineTransfer(id: string) {
  incoming$.next(incoming$.getValue().filter((one) => one.id !== id));
  await hubFetch(`/v1/transfers/${id}`, 'DELETE').catch(() => {});
}

/** The titles in the current library and this browser: a received book never replaces one. */
export async function titleTaken(title: string) {
  if (await database.getDataByTitle(title)) return true;

  const { getStorageHandler } = await import('$lib/data/storage/storage-handler-factory');
  const books = await getStorageHandler(window, storageSource$.getValue(), '')
    .getBookList()
    .catch(() => []);

  return books.some((book) => book.title === title);
}

/** A title not taken yet: "<title> (from <name>)", numbered if needed */
export async function freeTitle(title: string, from: string) {
  for (let n = 1; ; n += 1) {
    const candidate = `${title} (from ${from}${n > 1 ? ` ${n}` : ''})`;

    if (!(await titleTaken(candidate))) return candidate;
  }
}

/** Imports the book into the current library source, like importing a file. */
async function importReceived(book: Awaited<ReturnType<typeof unpackBook>>) {
  const [{ getStorageHandler }, { importData }] = await Promise.all([
    import('$lib/data/storage/storage-handler-factory'),
    import('$lib/functions/replication/replicator')
  ]);
  const source = storageSource$.getValue();
  const error = await importData(
    document,
    getStorageHandler(
      window,
      source,
      '',
      source === StorageKey.BROWSER,
      cacheStorageData$.getValue(),
      replicationSaveBehavior$.getValue(),
      statisticsMergeMode$.getValue(),
      readingGoalsMergeMode$.getValue()
    ),
    [book],
    new AbortController().signal
  ).catch((caught: Error) => caught.message);

  if (error) throw new TransferError('import');
  addImportsToHome([book.title]);
}

/**
 * Accepts a book; `title` is the name it gets here (another one when the reader already has a
 * book with its title). Resolves when done or failed (transfers$).
 */
export async function receiveBook(offered: IncomingTransfer, title = offered.title) {
  const { id, from, size } = offered;

  incoming$.next(incoming$.getValue().filter((one) => one.id !== id));
  live.set(id, { cancelled: false });
  transfers$.next([
    ...transfers$.getValue(),
    { id, direction: 'receive', friend: from, title, size, bytes: 0, phase: 'connecting' }
  ]);

  try {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const channel = pc.createDataChannel('book', { ordered: true });

    live.set(id, { pc, cancelled: false });
    await pc.setLocalDescription(await pc.createOffer());
    await hubFetch(`/v1/transfers/${id}/accept`, 'POST', { offer: await gathered(pc) });

    let answer: string | null = null;
    const until = Date.now() + ANSWER_WAIT;

    while (!answer) {
      await sleep(ANSWER_POLL);
      checkCancelled(id);
      if (Date.now() > until) throw new TransferError('direct');
      answer = (await hubFetch<{ answer: string | null }>(`/v1/transfers/${id}`)).answer;
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });

    const open = (await opened(pc, Promise.resolve(channel))) as unknown as TransferChannel;

    checkCancelled(id);
    update(id, { phase: 'moving' });

    const blob = await receiveBlob(open, size, (bytes) => update(id, { bytes }));

    update(id, { phase: 'saving' });
    try {
      const book = await unpackBook(blob);

      book.title = title;
      await importReceived(book);
    } catch (error) {
      confirm(open, reasonOf(error));
      throw error;
    }
    confirm(open);
    update(id, { phase: 'done', bytes: size });
    // Let the confirmation go out before closing.
    setTimeout(() => pc.close(), 1000);
    live.delete(id);
  } catch (error) {
    fail(id, error);
  }
}
