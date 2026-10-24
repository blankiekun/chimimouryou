/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import hub, {
  AVATAR_BYTES,
  COVER_BYTES,
  COVER_UPLOADS,
  UPLOADS_PER_DAY,
  cleanUp,
  webpSize,
  type Env
} from '../src/hub';
import { memoryD1 } from './d1';

/** A WebP header (the hub reads no further): VP8L, or VP8X with metadata flags */
function webp(width: number, height: number, size = 200, flags = -1) {
  const bytes = new Uint8Array(size);
  const ascii = (at: number, text: string) =>
    [...text].forEach((char, i) => (bytes[at + i] = char.charCodeAt(0)));
  const u32 = (at: number, value: number) =>
    [0, 1, 2, 3].forEach((i) => (bytes[at + i] = (value >>> (8 * i)) & 255));

  ascii(0, 'RIFF');
  u32(4, size - 8);
  ascii(8, 'WEBP');
  if (flags < 0) {
    ascii(12, 'VP8L');
    bytes[20] = 0x2f;
    u32(21, (width - 1) | ((height - 1) << 14));
  } else {
    ascii(12, 'VP8X');
    bytes[20] = flags;
    u32(24, width - 1);
    u32(27, height - 1);
  }
  return bytes;
}

describe('hub images', () => {
  let env: Env;
  let db: ReturnType<typeof memoryD1>['db'];
  let objects: Map<string, Uint8Array>;
  let ip = 0;

  beforeEach(() => {
    const memory = memoryD1();

    objects = new Map();
    env = {
      DB: memory.d1,
      MEDIA: {
        get: async (key) => {
          const value = objects.get(key);

          return value ? { body: value.slice().buffer } : null;
        },
        put: async (key, value) => void objects.set(key, new Uint8Array(value)),
        delete: async (keys) => [keys].flat().forEach((key) => objects.delete(key))
      }
    };
    db = memory.db;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  async function call(method: string, path: string, body?: unknown, token = '') {
    const raw = body instanceof Uint8Array;
    const response = await hub.fetch(
      new Request(`https://hub.example${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(raw ? { 'Content-Type': 'image/webp' } : {}),
          'CF-Connecting-IP': `192.0.2.${++ip}`
        },
        body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body)
      }),
      env
    );
    const type = response.headers.get('Content-Type') ?? '';

    return {
      status: response.status,
      headers: response.headers,
      body: type.includes('json')
        ? await response.json()
        : new Uint8Array(await response.arrayBuffer())
    };
  }

  async function signUp(username: string) {
    const { body } = await call('POST', '/v1/signup', {
      username,
      name: username,
      salt: 'ab'.repeat(16),
      key: '0'.repeat(64)
    });

    return body as { token: string; me: { id: string; code: string; picture: number } };
  }

  type Account = Awaited<ReturnType<typeof signUp>>;

  async function friends(aki: Account, ren: Account) {
    await call('POST', '/v1/friends/request', { code: ren.me.code }, aki.token);
    await call('POST', `/v1/friends/${aki.me.id}/accept`, undefined, ren.token);
  }

  const book = (key: string) => ({ key, title: key, kind: 'book', pct: 0.4 });

  it('reads WebP headers and refuses anything else', () => {
    expect(webpSize(webp(160, 226))).toEqual({ width: 160, height: 226, metadata: false });
    expect(webpSize(webp(256, 256, 200, 0x10))).toEqual({
      width: 256,
      height: 256,
      metadata: false
    });
    expect(webpSize(webp(256, 256, 200, 0x08))?.metadata).toBe(true);
    expect(webpSize(new TextEncoder().encode('\x89PNG'.padEnd(40)))).toBeNull();
    // A RIFF size that doesn't match the file
    expect(webpSize(webp(160, 226).subarray(0, 100))).toBeNull();
  });

  it('takes one cover per reader and book key and shows it on that reader’s rows only', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');

    await friends(aki, ren);

    const pushed = await call('PUT', '/v1/status', { books: [book('k1'), book('k2')] }, aki.token);
    expect(pushed.body.needCovers).toEqual(['k1', 'k2']);

    const uploaded = await call('PUT', '/v1/cover?key=k1', webp(160, 226), aki.token);
    expect(uploaded.status).toBe(200);
    expect([...objects.keys()]).toEqual([`cover/${uploaded.body.cover}`]);

    expect((await call('PUT', '/v1/cover?key=k1', webp(160, 230), aki.token)).status).toBe(409);
    vi.advanceTimersByTime(60_000);
    expect(
      (await call('PUT', '/v1/status', { books: [book('k1'), book('k2')] }, aki.token)).body
        .needCovers
    ).toEqual(['k2']);

    // Ren reads it too: asked for his own, which shows on his rows only, and Aki's on hers.
    const renPush = await call('PUT', '/v1/status', { books: [book('k1')] }, ren.token);
    expect(renPush.body.needCovers).toEqual(['k1']);
    const renCover = await call('PUT', '/v1/cover?key=k1', webp(160, 230), ren.token);
    expect(renCover.status).toBe(200);
    expect(renCover.body.cover).not.toBe(uploaded.body.cover);
    // Only for a book the uploader shares.
    expect((await call('PUT', '/v1/cover?key=k9', webp(160, 226), ren.token)).status).toBe(404);

    const list = await call('GET', '/v1/friends', undefined, ren.token);
    expect(list.body.friends[0].books).toMatchObject([
      { key: 'k1', cover: uploaded.body.cover },
      { key: 'k2', cover: null }
    ]);
    const akiList = await call('GET', '/v1/friends', undefined, aki.token);
    expect(akiList.body.friends[0].books).toMatchObject([
      { key: 'k1', cover: renCover.body.cover }
    ]);
    expect((await call('GET', '/v1/profile/aki')).body.books[0].cover).toBe(uploaded.body.cover);
    expect((await call('GET', '/v1/profile/ren')).body.books[0].cover).toBe(renCover.body.cover);

    const image = await call('GET', `/v1/cover/${uploaded.body.cover}`);
    expect(image.status).toBe(200);
    expect(image.headers.get('Content-Type')).toBe('image/webp');
    expect(image.headers.get('Cache-Control')).toContain('immutable');
    expect(image.body).toEqual(webp(160, 226));
    expect((await call('GET', '/v1/cover/0123456789abcdef')).status).toBe(404);
  });

  it('refuses covers of another type, size or shape, and over 50 a day', async () => {
    const aki = await signUp('aki');

    await call('PUT', '/v1/status', { books: [book('k1')] }, aki.token);
    const put = (body: Uint8Array) =>
      call('PUT', '/v1/cover?key=k1', body, aki.token).then((r) => r.status);

    expect(await put(webp(160, 226, COVER_BYTES + 2))).toBe(413);
    expect(await put(webp(1600, 2260))).toBe(400);
    expect(await put(webp(160, 226, 200, 0x08))).toBe(415);
    expect(await put(new TextEncoder().encode('GIF89a'.padEnd(60)))).toBe(415);
    const png = await hub.fetch(
      new Request('https://hub.example/v1/cover?key=k1', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${aki.token}`, 'Content-Type': 'image/png' },
        body: webp(160, 226)
      }),
      env
    );
    expect(png.status).toBe(415);
    for (let i = 5; i < COVER_UPLOADS; i += 1) await put(webp(10, 10));
    expect(await put(webp(160, 226))).toBe(429);
    expect(objects.size).toBe(0);
  });

  it('serves an image from the edge cache whatever the query string', async () => {
    const aki = await signUp('aki');
    const store = new Map<string, Response>();
    const keys: string[] = [];

    vi.stubGlobal('caches', {
      default: {
        match: async (key: string) => (keys.push(key), store.get(key)?.clone()),
        put: async (key: string, response: Response) => void store.set(key, response),
        delete: async (key: string) => store.delete(key)
      }
    });
    try {
      await call('PUT', '/v1/status', { books: [book('k1')] }, aki.token);
      const { body } = await call('PUT', '/v1/cover?key=k1', webp(160, 226), aki.token);

      expect((await call('GET', `/v1/cover/${body.cover}?n=1`)).status).toBe(200);
      objects.clear();
      expect((await call('GET', `/v1/cover/${body.cover}?n=2`)).status).toBe(200);
      expect(new Set(keys)).toEqual(new Set([`https://hub.example/v1/cover/${body.cover}`]));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('counts a cover towards the daily ceiling only once its row is in', async () => {
    const aki = await signUp('aki');
    const uploads = () =>
      db.prepare(`SELECT count FROM limits WHERE subject = '*' AND action = 'upload'`).get();

    await call('PUT', '/v1/status', { books: [book('k1')] }, aki.token);
    await call('PUT', '/v1/cover?key=k1', webp(160, 226), aki.token);
    expect(uploads()).toEqual({ count: 1 });
    expect((await call('PUT', '/v1/cover?key=k1', webp(160, 230), aki.token)).status).toBe(409);
    expect(uploads()).toEqual({ count: 1 });
  });

  it('pauses uploads from everyone at the hub-wide daily ceiling', async () => {
    const aki = await signUp('aki');
    const day = Math.floor(Date.now() / 1000 / 86_400) * 86_400;

    await env.DB.prepare(
      "INSERT INTO limits (subject, action, win, count) VALUES ('*', 'upload', ?1, ?2)"
    )
      .bind(day, UPLOADS_PER_DAY)
      .run();
    const paused = await call('PUT', '/v1/avatar', webp(256, 256), aki.token);

    expect(paused.status).toBe(503);
    expect(paused.body.error).toBe('paused');
    expect(objects.size).toBe(0);
  });

  it('replaces and removes a picture, 5 uploads a day, and deletes it with the account', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');

    expect(aki.me.picture).toBe(0);
    const first = await call('PUT', '/v1/avatar', webp(256, 256), aki.token);
    expect(first.status).toBe(200);
    const v1 = first.body.picture;
    expect([...objects.keys()]).toEqual([`avatar/${aki.me.id}/${v1}`]);

    const second = await call('PUT', '/v1/avatar', webp(256, 256, 300), aki.token);
    const v2 = second.body.picture;
    expect(v2).toBeGreaterThan(v1);
    expect([...objects.keys()]).toEqual([`avatar/${aki.me.id}/${v2}`]);
    expect((await call('GET', `/v1/avatar/${aki.me.id}/${v2}`)).body).toHaveLength(300);
    expect((await call('GET', `/v1/avatar/${aki.me.id}/${v1}`)).status).toBe(404);

    // Square and at most 256 px and 64 KB.
    expect((await call('PUT', '/v1/avatar', webp(256, 200), aki.token)).status).toBe(400);
    expect(
      (await call('PUT', '/v1/avatar', webp(256, 256, AVATAR_BYTES + 2), aki.token)).status
    ).toBe(413);
    await call('PUT', '/v1/avatar', webp(256, 256), aki.token);
    expect((await call('PUT', '/v1/avatar', webp(256, 256), aki.token)).status).toBe(429);

    // Shown to friends with its version.
    await friends(aki, ren);
    vi.advanceTimersByTime(60_000);
    const list = await call('GET', '/v1/friends', undefined, ren.token);
    expect(list.body.friends[0].picture).toBeGreaterThan(v2);

    const removed = await call('DELETE', '/v1/avatar', undefined, aki.token);
    expect(removed.body.picture).toBe(0);
    expect(objects.size).toBe(0);

    await call('PUT', '/v1/avatar', webp(128, 128), aki.token).then((r) =>
      expect(r.status).toBe(429)
    );
    vi.advanceTimersByTime(86_400_000);
    await call('PUT', '/v1/avatar', webp(128, 128), aki.token);
    expect(objects.size).toBe(1);
    await call('DELETE', '/v1/me', undefined, aki.token);
    expect(objects.size).toBe(0);
    expect(db.prepare('SELECT * FROM pictures').all()).toEqual([]);
  });

  it('deletes the pictures and covers of accounts unused for a year', async () => {
    const aki = await signUp('aki');

    await call('PUT', '/v1/status', { books: [book('k1')] }, aki.token);
    await call('PUT', '/v1/cover?key=k1', webp(160, 226), aki.token);
    await call('PUT', '/v1/avatar', webp(256, 256), aki.token);
    expect(objects.size).toBe(2);
    vi.advanceTimersByTime(366 * 86_400_000);
    await cleanUp(env);
    expect(objects.size).toBe(0);
    expect(db.prepare('SELECT * FROM covers').all()).toEqual([]);
  });

  it('deletes covers no shared book shows any more, keeping files another upload uses', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');

    await call('PUT', '/v1/status', { books: [book('k1'), book('k2')] }, aki.token);
    await call('PUT', '/v1/status', { books: [book('k1')] }, ren.token);
    const same = await call('PUT', '/v1/cover?key=k1', webp(160, 226), aki.token);
    await call('PUT', '/v1/cover?key=k1', webp(160, 226), ren.token);
    const other = await call('PUT', '/v1/cover?key=k2', webp(160, 230), aki.token);
    expect(objects.size).toBe(2);

    // Aki stops reading both: her rows go, Ren's identical upload keeps the shared file.
    vi.advanceTimersByTime(60_000);
    await call('PUT', '/v1/status', { books: [] }, aki.token);
    await cleanUp(env);
    expect(db.prepare('SELECT user, book_key FROM covers').all()).toEqual([
      { user: ren.me.id, book_key: 'k1' }
    ]);
    expect([...objects.keys()]).toEqual([`cover/${same.body.cover}`]);
    expect(objects.has(`cover/${other.body.cover}`)).toBe(false);
  });

  it('takes reports of a picture and of a cover', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');

    const cover = { what: 'cover', key: 'k1', username: 'aki' };

    await call('PUT', '/v1/status', { books: [book('k1')] }, aki.token);
    expect((await call('POST', '/v1/report', cover, ren.token)).status).toBe(404);
    await call('PUT', '/v1/cover?key=k1', webp(160, 226), aki.token);
    expect((await call('POST', '/v1/report', cover, ren.token)).status).toBe(200);
    expect(
      (await call('POST', '/v1/report', { ...cover, username: 'ren' }, ren.token)).status
    ).toBe(404);
    expect(
      (await call('POST', '/v1/report', { username: 'aki', what: 'picture' }, ren.token)).status
    ).toBe(200);
    expect(db.prepare('SELECT target, what FROM reports ORDER BY what').all()).toEqual([
      { target: `${aki.me.id}:k1`, what: 'cover' },
      { target: aki.me.id, what: 'picture' }
    ]);

    // Removed by hand (README): friends get the title card and she can't upload another.
    db.exec(`UPDATE covers SET removed = 1 WHERE book_key = 'k1'`);
    vi.advanceTimersByTime(60_000);
    expect(
      (await call('PUT', '/v1/status', { books: [book('k1')] }, aki.token)).body.needCovers
    ).toEqual([]);
    expect((await call('GET', '/v1/profile/aki')).body.books[0].cover).toBeNull();
    expect((await call('PUT', '/v1/cover?key=k1', webp(160, 226), aki.token)).status).toBe(409);
  });
});
