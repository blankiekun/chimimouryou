/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * chimimouryou's social hub: accounts, friend codes and what friends are reading. A Cloudflare
 * Worker over D1 (schema.sql); the entry is index.ts; the app's client is apps/web/src/lib/data/social*.ts. JSON in and
 * out under /v1, bearer tokens (the hub is another origin than every reader), limits in D1.
 */

/** The parts of Cloudflare's D1 binding the hub uses */
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Row>(): Promise<T | null>;
  all<T = Row>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

export interface Env {
  DB: D1Database;
}

type Row = Record<string, unknown>;

interface UserRow {
  id: string;
  username: string;
  salt: string;
  pass_hash: string;
  recovery_hash: string;
  name: string;
  avatar: number;
  code: string;
  share: string;
  created: number;
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const MAX_FRIENDS = 200;
const MAX_PENDING = 50;
const MAX_FAILURES = 10;
const SESSION_TTL = 90 * DAY;
const ACCOUNT_TTL = 365 * DAY;
/** Seconds between two status pushes (one more is allowed when leaving a book) */
export const STATUS_GAP = 5 * MINUTE;
const AVATARS = 24;
const SHARE_KEYS = [
  'public',
  'current',
  'finished',
  'activity',
  'stats',
  'wordsKnown',
  'hideManga',
  'hideVn'
];
const KINDS = ['book', 'manga', 'vn'];

const USERNAME = /^[A-Za-z0-9_]{3,20}$/;
const KEY = /^[0-9a-f]{64}$/;
const SALT = /^[0-9a-f]{32}$/;
const ID = /^[0-9a-f]{16}$/;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string
  ) {
    super(code);
  }
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}

const now = () => Math.floor(Date.now() / 1000);

export async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Crockford base32 (256 is a multiple of 32, so every character is equally likely) */
function randomCode(length: number) {
  return [...crypto.getRandomValues(new Uint8Array(length))]
    .map((byte) => CROCKFORD[byte & 31])
    .join('');
}

function randomHex(bytes: number) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Codes as people type them: any case, dashes and spaces, O for 0, I or L for 1. */
export function normalizeCode(text: string) {
  return text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

const passHash = (salt: string, key: string) => sha256(`${salt}:${key}`);

async function readBody(request: Request): Promise<Row> {
  const text = await request.text();

  if (text.length > 16_384) throw new HttpError(413, 'size');
  try {
    const value = JSON.parse(text || '{}');

    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch (_) {
    // answered below
  }
  throw new HttpError(400, 'json');
}

function matching(value: unknown, pattern: RegExp, code: string) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new HttpError(400, code);
  return value;
}

/** 1-40 characters, spaces collapsed, no control or direction-override characters */
function displayName(value: unknown) {
  const name = typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : '';

  // eslint-disable-next-line no-control-regex
  if (!name || [...name].length > 40 || /[\u0000-\u001f\u007f‪-‮⁦-⁩]/.test(name)) {
    throw new HttpError(400, 'name');
  }
  return name;
}

function text(value: unknown, max: number, code: string, optional = false) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max) {
    throw new HttpError(400, code);
  }
  return value;
}

async function ipSubject(request: Request) {
  return `ip:${await sha256(request.headers.get('CF-Connecting-IP') ?? '')}`;
}

/** Counts one use of `action` in the current window; false once `max` were used. */
async function take(env: Env, subject: string, action: string, window: number, max: number) {
  const win = Math.floor(now() / window) * window;
  const row = await env.DB.prepare(
    `INSERT INTO limits (subject, action, win, count) VALUES (?1, ?2, ?3, 1)
     ON CONFLICT (subject, action, win) DO UPDATE SET count = count + 1 WHERE count < ?4
     RETURNING count`
  )
    .bind(subject, action, win, max)
    .first();

  return !!row;
}

async function limit(env: Env, subject: string, action: string, window: number, max: number) {
  if (!(await take(env, subject, action, window, max))) throw new HttpError(429, 'limit');
}

// shortcut: a locked username or address waits until the hour's window ends (up to 60 minutes,
// not 15); move to a sliding window if readers trip over it.
async function checkFailures(env: Env, subjects: string[]) {
  const row = await env.DB.prepare(
    `SELECT MAX(count) AS n FROM limits WHERE action = 'fail' AND win = ?1 AND subject IN (?2, ?3)`
  )
    .bind(Math.floor(now() / HOUR) * HOUR, ...subjects)
    .first<{ n: number | null }>();

  if ((row?.n ?? 0) >= MAX_FAILURES) throw new HttpError(429, 'locked');
}

async function recordFailure(env: Env, subjects: string[]) {
  const win = Math.floor(now() / HOUR) * HOUR;

  await env.DB.batch(
    subjects.map((subject) =>
      env.DB.prepare(
        `INSERT INTO limits (subject, action, win, count) VALUES (?1, 'fail', ?2, 1)
         ON CONFLICT (subject, action, win) DO UPDATE SET count = count + 1`
      ).bind(subject, win)
    )
  );
  throw new HttpError(401, 'credentials');
}

async function newSession(env: Env, user: string) {
  const token = randomToken();

  await env.DB.prepare('INSERT INTO sessions (hash, user, last_used) VALUES (?1, ?2, ?3)')
    .bind(await sha256(token), user, now())
    .run();
  return token;
}

async function authenticate(request: Request, env: Env) {
  const match = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '');

  if (!match) throw new HttpError(401, 'session');

  const hash = await sha256(match[1]);
  const user = await env.DB.prepare(
    'SELECT u.*, s.last_used FROM sessions s JOIN users u ON u.id = s.user WHERE s.hash = ?1'
  )
    .bind(hash)
    .first<UserRow & { last_used: number }>();
  const time = now();

  if (!user || user.last_used < time - SESSION_TTL) throw new HttpError(401, 'session');
  if (user.last_used < time - HOUR) {
    await env.DB.batch([
      env.DB.prepare('UPDATE sessions SET last_used = ?1 WHERE hash = ?2').bind(time, hash),
      env.DB.prepare('UPDATE users SET last_seen = ?1 WHERE id = ?2').bind(time, user.id)
    ]);
  }
  return { user, hash };
}

function me(user: UserRow) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    avatar: user.avatar,
    code: user.code,
    share: JSON.parse(user.share),
    created: user.created
  };
}

async function userById(env: Env, id: string) {
  return env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first<UserRow>();
}

async function userByName(env: Env, username: string) {
  return env.DB.prepare('SELECT * FROM users WHERE username = ?1').bind(username).first<UserRow>();
}

/** The pair's row key: a < b */
const pair = (x: string, y: string) => (x < y ? [x, y] : [y, x]);

/** Friends with their current books, and requests both ways, in one query */
export async function friendsOf(env: Env, user: string) {
  const { results } = await env.DB.prepare(
    `SELECT l.state, l.by_user, l.code AS sent_code, l.created, u.id, u.username, u.name, u.avatar,
       s.book_key, s.title, s.author, s.kind, s.pct, s.read_at
     FROM links l JOIN users u ON u.id = CASE WHEN l.a = ?1 THEN l.b ELSE l.a END
     LEFT JOIN status s ON s.user = u.id AND l.state = 'accepted'
     WHERE (l.a = ?1 OR l.b = ?1) AND l.state != 'blocked'
     ORDER BY s.slot`
  )
    .bind(user)
    .all();
  const friends = new Map<string, Row & { books: Row[] }>();
  const incoming: Row[] = [];
  const outgoing: Row[] = [];

  for (const row of results) {
    const person = { id: row.id, username: row.username, name: row.name, avatar: row.avatar };

    if (row.state === 'accepted') {
      const friend = friends.get(row.id as string) ?? { ...person, since: row.created, books: [] };

      friends.set(row.id as string, friend);
      if (row.book_key !== null) {
        friend.books.push({
          key: row.book_key,
          title: row.title,
          author: row.author,
          kind: row.kind,
          pct: row.pct,
          readAt: row.read_at
        });
      }
    } else if (row.by_user === user) {
      // Who a code belongs to stays hidden until they accept.
      outgoing.push({ id: row.id, code: row.sent_code, at: row.created });
    } else {
      incoming.push({ ...person, at: row.created });
    }
  }
  return { friends: [...friends.values()], incoming, outgoing };
}

function linkCounts(env: Env, user: string, other: string) {
  return env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM links WHERE (a = ?1 OR b = ?1) AND state = 'accepted') AS friends,
       (SELECT COUNT(*) FROM links WHERE by_user = ?1 AND state = 'pending') AS sent,
       (SELECT COUNT(*) FROM links WHERE (a = ?2 OR b = ?2) AND state = 'pending' AND by_user != ?2)
         AS waiting`
  )
    .bind(user, other)
    .first<{ friends: number; sent: number; waiting: number }>();
}

async function acceptLink(env: Env, user: string, a: string, b: string) {
  const counts = await linkCounts(env, user, user);

  if ((counts?.friends ?? 0) >= MAX_FRIENDS) throw new HttpError(409, 'friends');

  const { meta } = await env.DB.prepare(
    `UPDATE links SET state = 'accepted', code = NULL
     WHERE a = ?1 AND b = ?2 AND state = 'pending' AND by_user != ?3`
  )
    .bind(a, b, user)
    .run();

  if (!meta.changes) throw new HttpError(404, 'request');
}

async function sendRequest(env: Env, user: UserRow, body: Row) {
  // Counted before the lookup: the daily limit also bounds guessing codes.
  await limit(env, user.id, 'request', DAY, 20);

  const code = normalizeCode(text(body.code, 20, 'code'));
  const target = await env.DB.prepare('SELECT id FROM users WHERE code = ?1')
    .bind(code)
    .first<{ id: string }>();

  if (!target) throw new HttpError(404, 'code');
  if (target.id === user.id) throw new HttpError(400, 'self');

  const [a, b] = pair(user.id, target.id);
  const link = await env.DB.prepare('SELECT state, by_user FROM links WHERE a = ?1 AND b = ?2')
    .bind(a, b)
    .first<{ state: string; by_user: string }>();

  if (link?.state === 'pending' && link.by_user !== user.id) {
    // Both entered each other's code.
    await acceptLink(env, user.id, a, b);
  } else if (!link || (link.state === 'blocked' && link.by_user === user.id)) {
    const counts = await linkCounts(env, user.id, target.id);

    if ((counts?.friends ?? 0) >= MAX_FRIENDS) throw new HttpError(409, 'friends');
    if ((counts?.sent ?? 0) >= MAX_PENDING || (counts?.waiting ?? 0) >= MAX_PENDING) {
      throw new HttpError(429, 'pending');
    }
    await env.DB.prepare(
      `INSERT INTO links (a, b, state, by_user, code, created) VALUES (?1, ?2, 'pending', ?3, ?4, ?5)
       ON CONFLICT (a, b) DO UPDATE SET state = 'pending', by_user = ?3, code = ?4, created = ?5`
    )
      .bind(a, b, user.id, code, now())
      .run();
  }
  // Already friends or pending, or blocked by them: nothing changes and nothing tells them.
}

function validBooks(value: unknown) {
  if (!Array.isArray(value) || value.length > 3) throw new HttpError(400, 'books');

  const time = now();

  return value.map((book: Row) => {
    if (!book || typeof book !== 'object') throw new HttpError(400, 'books');

    const pct = Number(book.pct);
    const readAt = Math.min(time, Math.max(0, Math.floor(Number(book.readAt) || time)));

    if (!(pct >= 0 && pct <= 1)) throw new HttpError(400, 'pct');
    if (!KINDS.includes(book.kind as string)) throw new HttpError(400, 'kind');
    return {
      key: text(book.key, 200, 'key'),
      title: text(book.title, 200, 'title'),
      author: text(book.author, 200, 'author', true),
      kind: book.kind as string,
      pct,
      readAt
    };
  });
}

async function pushStatus(env: Env, user: UserRow, body: Row) {
  const books = validBooks(body.books);
  const time = now();
  const { meta } = await env.DB.prepare(
    'UPDATE users SET status_at = ?1 WHERE id = ?2 AND status_at <= ?1 - ?3'
  )
    .bind(time, user.id, STATUS_GAP)
    .run();

  if (!meta.changes && !(body.leaving === true && (await take(env, user.id, 'leave', DAY, 30)))) {
    throw new HttpError(429, 'soon');
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM status WHERE user = ?1').bind(user.id),
    ...books.map((book, slot) =>
      env.DB.prepare(
        `INSERT INTO status (user, slot, book_key, title, author, kind, pct, read_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
      ).bind(user.id, slot, book.key, book.title, book.author, book.kind, book.pct, book.readAt)
    )
  ]);
}

async function updateMe(env: Env, user: UserRow, body: Row) {
  await limit(env, user.id, 'me', DAY, 10);

  const name = body.name === undefined ? user.name : displayName(body.name);
  const avatar = body.avatar === undefined ? user.avatar : Number(body.avatar);
  const share = { ...JSON.parse(user.share) };

  if (!Number.isInteger(avatar) || avatar < 0 || avatar >= AVATARS) {
    throw new HttpError(400, 'avatar');
  }
  if (body.share !== undefined) {
    if (!body.share || typeof body.share !== 'object') throw new HttpError(400, 'share');
    Object.entries(body.share).forEach(([key, value]) => {
      if (!SHARE_KEYS.includes(key) || typeof value !== 'boolean') {
        throw new HttpError(400, 'share');
      }
      share[key] = value;
    });
  }
  await env.DB.prepare('UPDATE users SET name = ?1, avatar = ?2, share = ?3 WHERE id = ?4')
    .bind(name, avatar, JSON.stringify(share), user.id)
    .run();
  return me((await userById(env, user.id))!);
}

/** Every row of these users: accounts, sessions, friend links, status and counters */
function deleteUsers(env: Env, where: string, ...values: unknown[]) {
  const users = `SELECT id FROM users WHERE ${where}`;

  return env.DB.batch(
    [
      `DELETE FROM sessions WHERE user IN (${users})`,
      `DELETE FROM links WHERE a IN (${users}) OR b IN (${users})`,
      `DELETE FROM status WHERE user IN (${users})`,
      `DELETE FROM limits WHERE subject IN (${users})`,
      `DELETE FROM users WHERE ${where}`
    ].map((sql) => env.DB.prepare(sql).bind(...values))
  );
}

/** The daily cron: retention */
export async function cleanUp(env: Env) {
  const time = now();

  await deleteUsers(env, 'last_seen < ?1', time - ACCOUNT_TTL);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE last_used < ?1').bind(time - SESSION_TTL),
    env.DB.prepare('DELETE FROM limits WHERE win < ?1').bind(time - 2 * DAY)
  ]);
}

async function signup(request: Request, env: Env) {
  const body = await readBody(request);
  const username = matching(body.username, USERNAME, 'username');
  const name = displayName(body.name);
  const salt = matching(body.salt, SALT, 'salt');
  const key = matching(body.key, KEY, 'key');

  await limit(env, await ipSubject(request), 'signup', DAY, 3);
  if (await userByName(env, username)) throw new HttpError(409, 'taken');

  const id = randomHex(8);
  const recovery = randomCode(20);
  const time = now();

  try {
    await env.DB.prepare(
      `INSERT INTO users (id, username, salt, pass_hash, recovery_hash, name, avatar, code, share,
         created, last_seen)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, '{}', ?9, ?9)`
    )
      .bind(
        id,
        username,
        salt,
        await passHash(salt, key),
        await sha256(recovery),
        name,
        Math.floor(Math.random() * AVATARS),
        randomCode(8),
        time
      )
      .run();
  } catch (_) {
    // The same username signed up a moment ago (or, once in a trillion, the same code).
    throw new HttpError(409, 'taken');
  }
  return json({
    token: await newSession(env, id),
    recovery,
    me: me((await userById(env, id))!)
  });
}

async function login(request: Request, env: Env) {
  const body = await readBody(request);
  const username = matching(body.username, USERNAME, 'username');
  const key = matching(body.key, KEY, 'key');
  const subjects = [`name:${username.toLowerCase()}`, await ipSubject(request)];

  await checkFailures(env, subjects);

  const user = await userByName(env, username);

  if (!user || (await passHash(user.salt, key)) !== user.pass_hash) {
    return recordFailure(env, subjects);
  }
  return json({ token: await newSession(env, user.id), me: me(user) });
}

/** A new password with the recovery code: then a new code, and every other session ends. */
async function recover(request: Request, env: Env) {
  const body = await readBody(request);
  const username = matching(body.username, USERNAME, 'username');
  const key = matching(body.key, KEY, 'key');
  const subjects = [`name:${username.toLowerCase()}`, await ipSubject(request)];

  await checkFailures(env, subjects);

  const user = await userByName(env, username);
  const code = normalizeCode(text(body.recovery, 40, 'recovery'));

  if (!user || (await sha256(code)) !== user.recovery_hash) return recordFailure(env, subjects);

  const recovery = randomCode(20);

  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pass_hash = ?1, recovery_hash = ?2 WHERE id = ?3').bind(
      await passHash(user.salt, key),
      await sha256(recovery),
      user.id
    ),
    env.DB.prepare('DELETE FROM sessions WHERE user = ?1').bind(user.id)
  ]);
  return json({ token: await newSession(env, user.id), recovery, me: me(user) });
}

/** The scrypt salt for a username; unknown names get a made-up one that stays the same. */
async function salt(request: Request, env: Env) {
  const body = await readBody(request);
  const username = matching(body.username, USERNAME, 'username');
  const user = await userByName(env, username);

  return json({
    salt: user?.salt ?? (await sha256(`salt:${username.toLowerCase()}`)).slice(0, 32)
  });
}

const privacy = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>chimimouryou hub: privacy</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem}</style>
<h1>What the hub stores</h1>
<p>The hub keeps your username, display name, avatar choice, friend code, your friends and
requests, and up to three books you are reading (title, author, kind and how far along you are),
plus the share settings you choose. Passwords are stretched in your browser and stored only as a
salted hash; the recovery code and session tokens are stored only as hashes.</p>
<p>No email, IP address log, book files or covers. Rate limits keep hashed addresses for two days.</p>
<p>Deleting your account (Settings, Social) removes every row at once. Sessions unused for 90 days
and accounts unused for 12 months are deleted automatically.</p>`;

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const route = `${request.method} ${pathname}`;

  if (route === 'GET /privacy') {
    return new Response(privacy, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  if (route === 'POST /v1/salt') return salt(request, env);
  if (route === 'POST /v1/signup') return signup(request, env);
  if (route === 'POST /v1/login') return login(request, env);
  if (route === 'POST /v1/recover') return recover(request, env);

  const { user, hash } = await authenticate(request, env);

  switch (route) {
    case 'POST /v1/logout':
      await env.DB.prepare('DELETE FROM sessions WHERE hash = ?1').bind(hash).run();
      return json({ ok: true });
    case 'GET /v1/me':
      return json(me(user));
    case 'PUT /v1/me':
      return json(await updateMe(env, user, await readBody(request)));
    case 'DELETE /v1/me':
      await deleteUsers(env, 'id = ?1', user.id);
      return json({ ok: true });
    case 'POST /v1/code':
      await limit(env, user.id, 'code', DAY, 3);
      await env.DB.prepare('UPDATE users SET code = ?1 WHERE id = ?2')
        .bind(randomCode(8), user.id)
        .run();
      return json(me((await userById(env, user.id))!));
    case 'PUT /v1/status':
      await pushStatus(env, user, await readBody(request));
      return json({ ok: true });
    case 'GET /v1/friends':
      await limit(env, user.id, 'friends', MINUTE, 1);
      return json(await friendsOf(env, user.id));
    case 'POST /v1/friends/request':
      await sendRequest(env, user, await readBody(request));
      return json(await friendsOf(env, user.id));
  }

  const friend = /^\/v1\/(friends|block)\/([^/]+)(\/accept)?$/.exec(pathname);

  if (friend && ID.test(friend[2])) {
    const [a, b] = pair(user.id, friend[2]);

    if (request.method === 'POST' && friend[1] === 'friends' && friend[3]) {
      await limit(env, user.id, 'link', DAY, 50);
      await acceptLink(env, user.id, a, b);
      return json(await friendsOf(env, user.id));
    }
    if (request.method === 'DELETE' && friend[1] === 'friends' && !friend[3]) {
      // Decline, cancel, remove, or lift one's own block.
      await limit(env, user.id, 'link', DAY, 50);
      await env.DB.prepare(
        `DELETE FROM links WHERE a = ?1 AND b = ?2 AND (state != 'blocked' OR by_user = ?3)`
      )
        .bind(a, b, user.id)
        .run();
      return json(await friendsOf(env, user.id));
    }
    if (request.method === 'POST' && friend[1] === 'block' && !friend[3]) {
      await limit(env, user.id, 'block', DAY, 20);
      if (!(await userById(env, friend[2]))) throw new HttpError(404, 'user');
      await env.DB.prepare(
        `INSERT INTO links (a, b, state, by_user, code, created) VALUES (?1, ?2, 'blocked', ?3, NULL, ?4)
         ON CONFLICT (a, b) DO UPDATE SET state = 'blocked', by_user = ?3, code = NULL
         WHERE state != 'blocked'`
      )
        .bind(a, b, user.id, now())
        .run();
      return json(await friendsOf(env, user.id));
    }
  }
  throw new HttpError(404, 'route');
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.code }, error.status);
      console.error(error);
      return json({ error: 'server' }, 500);
    }
  },
  async scheduled(_event: unknown, env: Env) {
    await cleanUp(env);
  }
};
