/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTEXTS_PER_WORK, lineHash, ROOTS_PER_WORK } from '../src/community';
import hub, { cleanUp, type Env } from '../src/hub';
import { memoryD1, webp } from './d1';

const fixtures: { line: string; occurrence?: number; hash: string }[] = JSON.parse(
  readFileSync(new URL('line-hashes.json', import.meta.url), 'utf8')
);
const DAY = 86400;
const WORK = 'anilist:12345/3';
const LINE = '吾輩は猫である。名前はまだ無い。';
const CONTEXT = `どこで生れたかとんと見当がつかぬ。${LINE}何でも薄暗いじめじめした所で泣いていた。`;

describe('hub community', () => {
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
        get: async (key) => (objects.has(key) ? { body: objects.get(key)!.slice().buffer } : null),
        put: async (key, value) => void objects.set(key, new Uint8Array(value)),
        delete: async (keys) => [keys].flat().forEach((key) => objects.delete(key))
      }
    };
    db = memory.db;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  async function call(method: string, path: string, body?: unknown, token = '', address = '') {
    const response = await hub.fetch(
      new Request(`https://hub.example${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'CF-Connecting-IP': address || `192.0.2.${++ip % 250}`
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      }),
      env
    );

    return { status: response.status, body: await response.json() };
  }

  /** An account; `days` old (old enough to count as aged by default) */
  async function signUp(username: string, days = 10) {
    const { body } = await call('POST', '/v1/signup', {
      username,
      name: `${username} name`,
      salt: 'ab'.repeat(16),
      key: '0'.repeat(64)
    });

    db.prepare('UPDATE users SET created = created - ? WHERE id = ?').run(days * DAY, body.me.id);
    return body as { token: string; me: { id: string } };
  }

  const post = (token: string, extra: object = {}, address = '') =>
    call(
      'POST',
      '/v1/community/posts',
      {
        work: WORK,
        title: '吾輩は猫である',
        quote: LINE,
        context: CONTEXT,
        body: 'これは何？',
        ...extra
      },
      token,
      address
    );

  const thread = async (token: string, line = '') =>
    call(
      'GET',
      `/v1/community/thread?work=${WORK}&line=${line || (await lineHash(LINE))}`,
      undefined,
      token
    );

  const listing = (token: string, query = '') =>
    call('GET', `/v1/community/threads?work=${WORK}${query}`, undefined, token);

  it('hashes lines like the app (two editions of a line meet)', async () => {
    for (const { line, occurrence, hash } of fixtures) {
      expect(await lineHash(line, occurrence)).toBe(hash);
    }
    expect(new Set(fixtures.slice(0, 4).map((one) => one.hash)).size).toBe(1);
  });

  it('reads without a session; every write needs one', async () => {
    const aki = await signUp('aki');

    await post(aki.token, { spoiler: true });
    for (const path of [
      `/v1/community/threads?work=${WORK}`,
      `/v1/community/thread?work=${WORK}&line=${await lineHash(LINE)}`,
      '/v1/community/feed'
    ]) {
      expect((await call('GET', path)).status).toBe(200);
    }
    // Spoilers stay marked; nothing says who is asking.
    expect((await call('GET', '/v1/community/feed')).body.posts[0]).toMatchObject({
      spoiler: true,
      mine: false,
      voted: false
    });
    for (const [method, path] of [
      ['POST', '/v1/community/posts'],
      ['PUT', '/v1/community/posts/0123456789abcdef'],
      ['DELETE', '/v1/community/posts/0123456789abcdef'],
      ['POST', '/v1/community/posts/0123456789abcdef/helpful'],
      ['PUT', `/v1/community/cover?work=${WORK}`],
      ['GET', '/v1/community/notes'],
      ['GET', '/v1/community/work?book=猫3&vol=3'],
      ['PUT', '/v1/community/work']
    ]) {
      expect((await call(method, path, method === 'GET' ? undefined : {})).status).toBe(401);
    }
  });

  it('caches anonymous reads at the edge and counts misses per address', async () => {
    const aki = await signUp('aki');
    const stored = new Map<string, Response>();

    vi.stubGlobal('caches', {
      default: {
        match: async (key: string) => stored.get(key)?.clone(),
        put: async (key: string, response: Response) => void stored.set(key, response),
        delete: async () => true
      }
    });
    try {
      await post(aki.token);
      await call('GET', '/v1/community/feed');
      await call('GET', '/v1/community/feed');
      expect(
        stored.get('https://hub.example/v1/community/feed')?.headers.get('Cache-Control')
      ).toBe('public, max-age=60');
      expect(
        db
          .prepare(
            `SELECT SUM(count) AS n FROM limits WHERE action = 'feed' AND subject LIKE 'ip:%'`
          )
          .get()
      ).toEqual({ n: 1 });
      // Signed-in reads skip the shared cache (blocks and helpful marks are per reader).
      await call('GET', '/v1/community/feed', undefined, aki.token);
      expect(
        db.prepare(`SELECT count FROM limits WHERE action = 'feed' AND subject = ?`).get(aki.me.id)
      ).toEqual({ count: 1 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('gives a repeated line a thread per copy', async () => {
    const aki = await signUp('aki');
    const first = await post(aki.token);
    const second = await post(aki.token, { occurrence: 2 });

    expect(first.body.line).toBe(await lineHash(LINE));
    expect(second.body.line).toBe(await lineHash(LINE, 2));
    expect(second.body.line).not.toBe(first.body.line);
    expect((await post(aki.token, { occurrence: 0 })).status).toBe(400);
    expect((await post(aki.token, { occurrence: '2' })).status).toBe(400);
  });

  it('lists hash prefixes only; the line, context and posts need the full hash', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');
    const created = await post(aki.token);

    expect(created.status).toBe(200);
    expect(created.body.line).toBe(await lineHash(LINE));
    vi.advanceTimersByTime(1000);
    await post(ren.token, { body: 'わかる', spoiler: true });

    const list = await listing(ren.token);

    expect(list.body).toEqual({
      threads: [{ prefix: created.body.line.slice(0, 8), posts: 2, spoiler: true }],
      next: null
    });
    expect(JSON.stringify(list.body)).not.toContain(LINE.slice(0, 4));
    // A prefix is not a line.
    expect((await thread(ren.token, created.body.line.slice(0, 8))).status).toBe(400);

    const { body } = await thread(ren.token);

    expect(body.quote).toBe(LINE);
    expect(body.context).toBe(CONTEXT);
    expect(body.posts.map((one: { body: string }) => one.body)).toEqual(['これは何？', 'わかる']);
  });

  it('keeps one quote and context per line', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');

    await post(aki.token);
    await post(ren.token, { context: `${LINE}別の版の文脈` });
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM posts WHERE context != '' OR quote != ''`).get()
    ).toEqual({ n: 1 });
  });

  it('refuses garbage: control, bidi and stacked marks, sizes, short lines, foreign contexts', async () => {
    const aki = await signUp('aki');
    const bad: [object, string][] = [
      [{ body: 'a\u0007b' }, 'body'],
      [{ body: 'abc\u202eevil' }, 'body'],
      [{ body: 'ze\u0300\u0301\u0302\u0303ro' }, 'body'],
      [{ body: 'あ'.repeat(1001) }, 'body'],
      [{ body: '😀'.repeat(800) }, 'body'],
      [{ body: '\u200b \n ' }, 'body'],
      [{ body: Array(25).fill('行').join('\n') }, 'body'],
      [{ quote: 'はい。', context: 'はい。' }, 'line'],
      [{ context: '全然違う文章です。' }, 'context'],
      [{ quote: 'あ'.repeat(301) }, 'quote'],
      [{ context: `${LINE}${'あ'.repeat(600)}` }, 'context'],
      [{ title: '' }, 'title'],
      [{ title: 'a\u202eb' }, 'title'],
      [{ work: 'title:has space' }, 'work'],
      [{ work: 'https://evil' }, 'work']
    ];

    for (const [extra, error] of bad) {
      expect(await post(aki.token, extra)).toEqual({ status: 400, body: { error } });
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM posts').get()).toEqual({ n: 0 });
  });

  it('caps one account’s top-level posts per work (book text it can store)', async () => {
    const aki = await signUp('aki');
    const insert = db.prepare(
      `INSERT INTO posts (id, work, line, user, kind, body, at) VALUES (?, ?, ?, ?, 'post', 'x', 0)`
    );

    for (let n = 0; n < ROOTS_PER_WORK; n++) {
      insert.run(
        n.toString(16).padStart(16, '0'),
        WORK,
        n.toString(16).padStart(32, '0'),
        aki.me.id
      );
    }
    expect(await post(aki.token)).toEqual({ status: 429, body: { error: 'work' } });
    expect((await post(aki.token, { work: 'vndb:v17' })).status).toBe(200);
  });

  it('limits new accounts harder, refuses their links, and limits per address', async () => {
    const fresh = await signUp('fresh', 1);
    const old = await signUp('old');

    expect(await post(fresh.token, { body: 'see https://spam.example' })).toEqual({
      status: 403,
      body: { error: 'links' }
    });
    expect((await post(old.token, { body: 'see https://example.org' })).status).toBe(200);
    for (let n = 0; n < 3; n++) expect((await post(fresh.token)).status).toBe(200);
    expect(await post(fresh.token)).toEqual({ status: 429, body: { error: 'limit' } });

    // 100 posts a day from one address, whichever accounts they come from.
    await post(old.token, {}, '198.51.100.7');
    db.prepare(`UPDATE limits SET count = 100 WHERE subject LIKE 'ip:%' AND action = 'post'`).run();
    expect((await post(old.token, {}, '198.51.100.7')).status).toBe(429);
  });

  it('counts helpful on replies, once per account, never one’s own, only from aged accounts', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');
    const fresh = await signUp('fresh', 1);
    const root = (await post(ren.token)).body.id;

    vi.advanceTimersByTime(1000);
    const { id } = (
      await call('POST', '/v1/community/posts', { parent: root, body: '答え' }, aki.token)
    ).body;
    const helpful = (token: string, method = 'POST', post = id) =>
      call(method, `/v1/community/posts/${post}/helpful`, undefined, token);

    expect(await helpful(aki.token, 'POST', root)).toEqual({
      status: 400,
      body: { error: 'reply' }
    });
    expect(await helpful(aki.token)).toEqual({ status: 400, body: { error: 'own' } });
    expect((await helpful(ren.token)).status).toBe(200);
    expect((await helpful(ren.token)).status).toBe(200);
    expect((await helpful(fresh.token)).status).toBe(200);

    const answer = (await thread(ren.token)).body.posts[1];

    expect(answer).toMatchObject({ helpful: 1, voted: true });
    await helpful(ren.token, 'DELETE');
    expect((await thread(aki.token)).body.posts[1].helpful).toBe(0);
  });

  it('hides blocked readers both ways: threads, listing, replies, helpful, notes', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');
    const { id } = (await post(aki.token)).body;

    await call('POST', `/v1/community/posts`, { parent: id, body: '答えです' }, ren.token);
    expect(
      (await call('GET', '/v1/community/notes', undefined, aki.token)).body.notes
    ).toHaveLength(1);
    vi.advanceTimersByTime(61_000);
    await call('POST', `/v1/block/${ren.me.id}`, undefined, aki.token);

    for (const [viewer, hidden] of [
      [aki, '答えです'],
      [ren, 'これは何？']
    ] as const) {
      const { body } = await thread(viewer.token);

      expect(body.posts.map((one: { body: string }) => one.body)).not.toContain(hidden);
      expect((await listing(viewer.token)).body.threads[0].posts).toBe(1);
    }
    expect(
      (await call('POST', '/v1/community/posts', { parent: id, body: 'もう一度' }, ren.token))
        .status
    ).toBe(404);
    expect(
      (await call('POST', `/v1/community/posts/${id}/helpful`, undefined, ren.token)).status
    ).toBe(404);
    expect((await call('GET', '/v1/community/notes', undefined, aki.token)).body.notes).toEqual([]);
  });

  it('lets only the author edit or delete a post (no IDOR)', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');
    const { id } = (await post(aki.token)).body;

    expect(
      (await call('PUT', `/v1/community/posts/${id}`, { body: '乗っ取り' }, ren.token)).status
    ).toBe(404);
    expect((await call('DELETE', `/v1/community/posts/${id}`, undefined, ren.token)).status).toBe(
      404
    );
    expect(
      (await call('PUT', `/v1/community/posts/${id}`, { body: '直した' }, aki.token)).status
    ).toBe(200);

    const [mine] = (await thread(ren.token)).body.posts;

    expect(mine).toMatchObject({ body: '直した', mine: false, edited: expect.any(Number) });
    expect((await call('DELETE', `/v1/community/posts/${id}`, undefined, aki.token)).status).toBe(
      200
    );
    expect(db.prepare('SELECT COUNT(*) AS n FROM posts').get()).toEqual({ n: 0 });
  });

  it('keeps an answered question as a tombstone until its last reply goes', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');
    const { id } = (await post(aki.token)).body;

    vi.advanceTimersByTime(1000);
    const reply = (
      await call('POST', '/v1/community/posts', { parent: id, body: '答え' }, ren.token)
    ).body;

    vi.advanceTimersByTime(1000);
    await call('DELETE', `/v1/community/posts/${id}`, undefined, aki.token);

    const { body } = await thread(ren.token);

    expect(body.posts[0]).toMatchObject({ id, body: '', author: null });
    expect(body.quote).toBe(LINE);
    expect((await listing(ren.token)).body.threads[0].posts).toBe(1);
    await call('DELETE', `/v1/community/posts/${reply.id}`, undefined, ren.token);
    expect(db.prepare('SELECT COUNT(*) AS n FROM posts').get()).toEqual({ n: 0 });
  });

  it('deletes an account’s posts, marks and confirmations with it', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');
    const asked = (await post(aki.token)).body;
    const lone = (await post(aki.token, { work: 'vndb:v17' })).body;

    const answer = (
      await call('POST', '/v1/community/posts', { parent: asked.id, body: '答え' }, ren.token)
    ).body;

    await call('POST', `/v1/community/posts/${answer.id}/helpful`, undefined, aki.token);
    await call('PUT', '/v1/community/work', { book: '猫3', vol: '3', work: WORK }, aki.token);
    expect((await call('DELETE', '/v1/me', undefined, aki.token)).status).toBe(200);

    expect(db.prepare(`SELECT id, user, body FROM posts WHERE parent = ''`).all()).toEqual([
      { id: asked.id, user: '', body: '' }
    ]);
    expect(db.prepare('SELECT id FROM posts WHERE id = ?').get(lone.id)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM helpful').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM work_votes').get()).toEqual({ n: 0 });

    await call('DELETE', '/v1/me', undefined, ren.token);
    expect(db.prepare('SELECT COUNT(*) AS n FROM posts').get()).toEqual({ n: 0 });
  });

  it('shows authors without reading progress, and their level only from a public profile', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');

    db.prepare(
      `INSERT INTO status (user, slot, book_key, title, kind, pct, read_at) VALUES (?, 0, 'k', '猫', 'book', 0.4, 0)`
    ).run(aki.me.id);
    db.prepare(`INSERT INTO stats (user, data, at) VALUES (?, ?, 0)`).run(
      aki.me.id,
      JSON.stringify({ rank: 3, step: 2, wordsKnown: 4000, streak: 9 })
    );
    await post(aki.token);

    const [first] = (await thread(ren.token)).body.posts;

    expect(Object.keys(first.author).sort()).toEqual(
      ['avatar', 'id', 'level', 'name', 'picture', 'role', 'username'].sort()
    );
    expect(first.author.level).toEqual({ rank: 3, step: 2, wordsKnown: 4000 });
    expect(JSON.stringify(first)).not.toMatch(/pct|streak|0\.4/);
    db.prepare(`UPDATE users SET share = '{"public":false}' WHERE id = ?`).run(aki.me.id);
    expect((await thread(ren.token)).body.posts[0].author.level).toBeNull();
  });

  it('notifies a poster of replies, not of their own, saying which posts are line comments', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');
    const { id } = (await post(aki.token)).body;
    const comment = (await post(aki.token, { feed: false })).body;

    await call('POST', '/v1/community/posts', { parent: id, body: '自分で' }, aki.token);
    await call('POST', '/v1/community/posts', { parent: id, body: '答え' }, ren.token);
    await call('POST', '/v1/community/posts', { parent: comment.id, body: '行で' }, ren.token);

    const { body } = await call('GET', '/v1/community/notes', undefined, aki.token);

    expect(body.notes).toHaveLength(2);
    expect(body.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: '答え',
          parent: id,
          work: WORK,
          line: await lineHash(LINE),
          inFeed: true
        }),
        expect.objectContaining({ body: '行で', parent: comment.id, inFeed: false })
      ])
    );
  });

  it('pages a listing by prefix', async () => {
    const aki = await signUp('aki');
    const insert = db.prepare(
      `INSERT INTO posts (id, work, line, user, kind, body, at) VALUES (?, ?, ?, ?, 'post', 'x', 0)`
    );

    for (let n = 0; n < 1001; n++) {
      insert.run(
        n.toString(16).padStart(16, '0'),
        WORK,
        n.toString(16).padStart(32, '0'),
        aki.me.id
      );
    }

    const first = (await listing(aki.token)).body;

    expect(first.threads).toHaveLength(1000);
    expect(first.next).toBe((999).toString(16).padStart(32, '0'));
    // These share their first 8 hex: the cursor is the full line, so none is skipped.
    expect((await listing(aki.token, `&after=${first.next}`)).body).toEqual({
      threads: [{ prefix: '00000000', posts: 1, spoiler: false }],
      next: null
    });
    // Old clients' 8-hex cursors still work (past every line with that prefix).
    expect((await listing(aki.token, '&after=00000000')).body.threads).toEqual([]);
    expect((await listing(aki.token, '&after=zz')).status).toBe(400);
  });

  it('suggests the work most aged accounts confirmed; new accounts and wrong volumes don’t count', async () => {
    const [a, b, c] = [await signUp('aaa'), await signUp('bbb'), await signUp('ccc')];
    const puppets = [await signUp('ppp', 1), await signUp('qqq', 1), await signUp('rrr', 1)];
    const vote = (token: string, work: string, vol = '3') =>
      call('PUT', '/v1/community/work', { book: '猫3', vol, work }, token);
    const suggestion = async (token: string) =>
      (await call('GET', '/v1/community/work?book=猫3&vol=3', undefined, token)).body;

    expect(await suggestion(a.token)).toEqual({ work: null, votes: 0, mine: null });
    await vote(a.token, WORK);
    await vote(b.token, WORK);
    await vote(c.token, 'anilist:999/3');
    for (const puppet of puppets) await vote(puppet.token, 'anilist:999/3');
    expect(await suggestion(c.token)).toEqual({ work: WORK, votes: 2, mine: 'anilist:999/3' });
    expect((await vote(a.token, 'anilist:999/5')).status).toBe(400);
    expect((await vote(a.token, 'title:猫3')).status).toBe(400);
  });

  it('takes reports of posts and work keys; moderators remove them, others get 403', async () => {
    const dev = await signUp('blank');
    const aki = await signUp('aki');
    const ren = await signUp('ren');
    const { id } = (await post(aki.token)).body;

    db.prepare(`UPDATE users SET role = 'dev' WHERE id = ?`).run(dev.me.id);
    expect((await call('POST', '/v1/report', { what: 'post', id }, aki.token)).status).toBe(400);
    expect((await call('POST', '/v1/report', { what: 'post', id }, ren.token)).status).toBe(200);
    await call('PUT', '/v1/community/work', { book: '猫3', vol: '3', work: WORK }, aki.token);
    await call('POST', '/v1/report', { what: 'work', book: '猫3', vol: '3' }, ren.token);

    for (const [method, path] of [
      ['GET', '/v1/admin/community/reports'],
      ['DELETE', `/v1/admin/community/post/${id}`],
      ['DELETE', `/v1/admin/community/user/${aki.me.id}/posts`],
      ['DELETE', `/v1/admin/community/work?book=猫3&vol=3&work=${WORK}`]
    ]) {
      expect((await call(method, path, undefined, ren.token)).status).toBe(403);
    }

    const { body } = await call('GET', '/v1/admin/community/reports', undefined, dev.token);

    expect(body.posts).toEqual([
      expect.objectContaining({ id, count: 1, body: 'これは何？', quote: LINE })
    ]);
    expect(body.works).toEqual([
      expect.objectContaining({ target: '3|猫3', work: WORK, votes: 1 })
    ]);
    // The friends/pictures queue doesn't show them.
    expect((await call('GET', '/v1/admin/reports', undefined, dev.token)).body.reports).toEqual([]);
    expect((await call('GET', '/v1/admin/user/aki', undefined, dev.token)).body.posts).toHaveLength(
      1
    );

    await call('DELETE', `/v1/admin/community/post/${id}`, undefined, dev.token);
    await call(
      'DELETE',
      `/v1/admin/community/work?book=猫3&vol=3&work=${WORK}`,
      undefined,
      dev.token
    );
    expect(db.prepare('SELECT COUNT(*) AS n FROM posts').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM work_votes').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM reports').get()).toEqual({ n: 0 });
  });

  it('feeds top-level posts newest first, with the work, line and spoiler mark; reported ones wait', async () => {
    const aki = await signUp('aki');
    const readers = [await signUp('rrr'), await signUp('sss'), await signUp('ttt')];
    const ids: string[] = [];

    for (let n = 0; n < 32; n++) {
      // Two posters: one account keeps at most 30 posts on a work.
      const poster = n % 2 ? aki : readers[0];

      ids.push((await post(poster.token, { body: `投稿${n}`, spoiler: n === 31 })).body.id);
      vi.advanceTimersByTime(400_000);
    }

    const first = (await call('GET', '/v1/community/feed', undefined, readers[0].token)).body;

    expect(first.posts).toHaveLength(30);
    expect(first.posts[0]).toMatchObject({
      id: ids[31],
      body: '投稿31',
      spoiler: true,
      title: '吾輩は猫である',
      vol: '3',
      cover: null,
      quote: LINE,
      line: await lineHash(LINE),
      replies: 0
    });
    expect(first.posts[0]).not.toHaveProperty('context');

    const second = (
      await call('GET', `/v1/community/feed?before=${first.next}`, undefined, readers[0].token)
    ).body;

    expect(second.posts.map((one: { id: string }) => one.id)).toEqual([ids[1], ids[0]]);
    expect((await call('GET', '/v1/community/feed?before=x', undefined, aki.token)).status).toBe(
      400
    );

    for (const reader of readers) {
      await call('POST', '/v1/report', { what: 'post', id: ids[31] }, reader.token);
    }
    expect((await call('GET', '/v1/community/feed')).body.posts[0].id).toBe(ids[30]);
    expect((await thread(aki.token)).body.posts.map((one: { id: string }) => one.id)).not.toContain(
      ids[31]
    );
  });

  it('takes plain posts: in the feed with no work or line, their own thread, replies and notes', async () => {
    const aki = await signUp('aki');
    const ben = await signUp('ben');
    const plain = (body: object, token = aki.token) =>
      call('POST', '/v1/community/posts', { plain: true, ...body }, token);

    // An account's line posts on a work don't cap its plain posts, nor the other way round.
    for (let n = 0; n < ROOTS_PER_WORK; n++) {
      await post(aki.token, { body: `投稿${n}` });
      vi.advanceTimersByTime(400_000);
    }
    const made = await plain({ body: 'おすすめは？ @[狼と香辛料](anilist:30001)', spoiler: true });

    expect(made.status).toBe(200);
    expect(made.body).toMatchObject({ work: 'post', title: '', cover: null });
    expect(made.body.line).toMatch(/^[0-9a-f]{32}$/);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM works WHERE work = 'post'`).get()).toEqual({
      n: 0
    });

    const { id, line } = made.body;
    const top = (await call('GET', '/v1/community/feed')).body.posts[0];

    expect(top).toMatchObject({ id, work: 'post', line, quote: '', title: '', spoiler: true });
    vi.advanceTimersByTime(1000);
    const reply = await call(
      'POST',
      '/v1/community/posts',
      { parent: id, body: 'いいね' },
      ben.token
    );

    expect(reply.status).toBe(200);
    const opened = await call('GET', `/v1/community/thread?work=post&line=${line}`);

    expect(opened.status).toBe(200);
    expect(opened.body.posts.map((one: { id: string }) => one.id)).toEqual([id, reply.body.id]);
    expect(
      (await call('GET', '/v1/community/notes', undefined, aki.token)).body.notes[0]
    ).toMatchObject({ work: 'post', line, parent: id, inFeed: true });
    // The sentinel is no work: no listing, cover or line post takes it.
    expect(
      (await call('GET', '/v1/community/threads?work=post', undefined, aki.token)).status
    ).toBe(400);
    expect((await post(aki.token, { work: 'post' })).status).toBe(400);
    expect((await plain({ body: '' })).status).toBe(400);
    expect((await plain({ body: 'a\u202eb' })).status).toBe(400);
  });

  it('accepts only AniList and VNDB mentions, and not as links', async () => {
    const fresh = await signUp('new', 1);
    const plain = (body: string) =>
      call('POST', '/v1/community/posts', { plain: true, body }, fresh.token);

    expect((await plain('@[狼と香辛料](anilist:30001) と @[Ever17](vndb:v17)')).status).toBe(200);
    for (const bad of [
      '@[x](https://evil.example)',
      '@[x](anilist:0)',
      '@[x](vndb:17)',
      '@[x](mal:5)'
    ]) {
      expect((await plain(bad)).status).toBe(400);
    }
    // Brackets that aren't a mention stay plain text
    expect((await plain('[メモ](あとで) @名前')).status).toBe(200);
    const { id } = (await plain('前')).body;

    expect(
      (await call('PUT', `/v1/community/posts/${id}`, { body: '@[x](javascript:1)' }, fresh.token))
        .status
    ).toBe(400);
  });

  it('keeps "this line only" posts out of the feed, in their thread', async () => {
    const aki = await signUp('aki');
    const shared = (await post(aki.token)).body.id;
    const lineOnly = (await post(aki.token, { body: 'ここだけ', feed: false })).body.id;
    const reply = (
      await call('POST', '/v1/community/posts', { parent: lineOnly, body: 'うん' }, aki.token)
    ).body.id;

    expect(
      (await call('GET', '/v1/community/feed')).body.posts.map((one: { id: string }) => one.id)
    ).toEqual([shared]);
    expect(
      Object.fromEntries(
        (await thread(aki.token)).body.posts.map((one: { id: string; inFeed: boolean }) => [
          one.id,
          one.inFeed
        ])
      )
    ).toEqual({ [shared]: true, [lineOnly]: false, [reply]: true });
  });

  it('hides a post only on reports from accounts past their first days', async () => {
    const aki = await signUp('aki');
    const dev = await signUp('dev');
    const { id } = (await post(aki.token)).body;
    const feedIds = async () =>
      (await call('GET', '/v1/community/feed')).body.posts.map((one: { id: string }) => one.id);

    db.prepare(`UPDATE users SET role = 'dev' WHERE id = ?`).run(dev.me.id);
    for (const name of ['nnn', 'ooo', 'ppp']) {
      await call('POST', '/v1/report', { what: 'post', id }, (await signUp(name, 1)).token);
    }
    expect(await feedIds()).toEqual([id]);
    // Moderators still see every report.
    expect(
      (await call('GET', '/v1/admin/community/reports', undefined, dev.token)).body.posts
    ).toEqual([expect.objectContaining({ id, count: 3 })]);
  });

  it('keeps the line of a thread whose first post is hidden', async () => {
    const aki = await signUp('aki');
    const bea = await signUp('bea');
    const { id } = (await post(aki.token)).body;

    vi.advanceTimersByTime(1000);
    await call('POST', '/v1/community/posts', { parent: id, body: '答え' }, bea.token);
    for (const name of ['rrr', 'sss', 'ttt']) {
      await call('POST', '/v1/report', { what: 'post', id }, (await signUp(name)).token);
    }

    const { body } = await thread(bea.token);

    expect(body.posts.map((one: { parent: string }) => one.parent)).toEqual([id]);
    expect(body.quote).toBe(LINE);
    expect(body.context).toBe(CONTEXT);
  });

  it('moves the line to the next post when the one keeping it goes', async () => {
    const aki = await signUp('aki');
    const bea = await signUp('bea');
    const { id } = (await post(aki.token)).body;

    vi.advanceTimersByTime(1000);
    const second = (await post(bea.token, { body: '私も' })).body.id;

    await call('DELETE', `/v1/community/posts/${id}`, undefined, aki.token);

    const { body } = await thread(bea.token);

    expect(body.posts.map((one: { id: string }) => one.id)).toEqual([second]);
    expect(body.quote).toBe(LINE);
    expect(body.context).toBe(CONTEXT);
    expect((await call('GET', '/v1/community/feed')).body.posts[0].quote).toBe(LINE);
  });

  it('keeps the page of context only for a work’s first lines', async () => {
    const insert = db.prepare(
      `INSERT INTO posts (id, work, line, user, kind, body, context, at) VALUES (?, ?, ?, 'x', 'post', 'x', 'c', 0)`
    );

    for (let n = 0; n < CONTEXTS_PER_WORK; n++) {
      insert.run(n.toString(16).padStart(16, '0'), WORK, n.toString(16).padStart(32, '0'));
    }
    await post((await signUp('aki')).token);
    expect(db.prepare(`SELECT quote, context FROM posts WHERE user != 'x'`).get()).toEqual({
      quote: LINE,
      context: ''
    });
  });

  it('names a work by its first post until a moderator resets it', async () => {
    const dev = await signUp('blank');
    const aki = await signUp('aki');
    const ren = await signUp('ren');

    db.prepare(`UPDATE users SET role = 'dev' WHERE id = ?`).run(dev.me.id);
    await post(aki.token, { title: '悪い題名' });
    await post(ren.token, { title: '吾輩は猫である', context: `${LINE}。` });
    expect((await thread(ren.token)).body).toMatchObject({ title: '悪い題名', vol: '3' });
    expect(
      (await call('POST', '/v1/report', { what: 'workinfo', work: WORK }, ren.token)).status
    ).toBe(200);
    expect(
      (await call('GET', '/v1/admin/community/reports', undefined, dev.token)).body.infos
    ).toEqual([expect.objectContaining({ work: WORK, title: '悪い題名', count: 1 })]);
    await call('DELETE', `/v1/admin/community/workinfo?work=${WORK}`, undefined, dev.token);
    await post(ren.token, { title: '吾輩は猫である', quote: 'どこで生れたかとんと見当がつかぬ。' });
    expect((await thread(ren.token)).body.title).toBe('吾輩は猫である');
  });

  it('takes one cover per work from a poster past their first days; removal bans that uploader', async () => {
    const dev = await signUp('blank');
    const aki = await signUp('aki');
    const ren = await signUp('ren');
    const fresh = await signUp('fresh', 1);
    const upload = (token: string, bytes = webp(160, 230), type = 'image/webp') =>
      hub
        .fetch(
          new Request(`https://hub.example/v1/community/cover?work=${encodeURIComponent(WORK)}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': type },
            body: bytes
          }),
          env
        )
        .then(async (response) => ({ status: response.status, body: await response.json() }));

    db.prepare(`UPDATE users SET role = 'dev' WHERE id = ?`).run(dev.me.id);
    expect((await upload(aki.token)).status).toBe(404);
    await post(aki.token);
    await post(fresh.token, { context: `${LINE}。` });
    await post(ren.token, { context: `${LINE}！` });
    expect((await upload(fresh.token)).body).toEqual({ error: 'new' });
    expect((await upload(aki.token, webp(160, 230), 'image/png')).status).toBe(415);
    expect((await upload(aki.token, webp(160, 230, 30_000))).status).toBe(413);
    expect((await upload(aki.token, webp(1000, 230))).status).toBe(400);
    expect((await upload(aki.token, webp(160, 230, 200, 0x08))).status).toBe(415);

    const { body } = await upload(aki.token);

    expect(objects.has(`work/${body.cover}`)).toBe(true);
    expect((await upload(ren.token, webp(150, 220))).status).toBe(409);
    expect((await thread(ren.token)).body.cover).toBe(body.cover);

    const served = await hub.fetch(new Request(`https://hub.example/v1/work/${body.cover}`), env);

    expect(served.headers.get('Content-Type')).toBe('image/webp');

    await call('DELETE', `/v1/admin/community/workinfo?work=${WORK}`, undefined, dev.token);
    expect(objects.size).toBe(0);
    expect((await upload(aki.token)).body).toEqual({ error: 'removed' });
    expect((await upload(ren.token, webp(150, 220))).status).toBe(200);

    // The cron drops works without posts, with their covers.
    db.prepare('DELETE FROM posts').run();
    await cleanUp(env);
    expect(db.prepare('SELECT COUNT(*) AS n FROM works').get()).toEqual({ n: 0 });
    expect(objects.size).toBe(0);
  });
});
