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

/** Workers Rate Limiting (wrangler.toml `[[ratelimits]]`) */
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** The parts of Cloudflare's R2 binding the hub uses (wrangler.toml `[[r2_buckets]]`) */
export interface R2Bucket {
  get(key: string): Promise<{ body: ReadableStream | ArrayBuffer | string } | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}

export interface Env {
  DB: D1Database;
  /** Cover thumbnails (cover/<content hash>) and pictures (avatar/<user id>/<version>) */
  MEDIA?: R2Bucket;
  /** Per address, before any D1 access; absent (tests, older configs) means allowed */
  EDGE_LIMIT?: RateLimit;
}

/** The parts of Cloudflare's edge cache (caches.default) the hub uses */
interface EdgeCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
  delete(key: string): Promise<boolean>;
}

interface Context {
  waitUntil(promise: Promise<unknown>): void;
}

const edgeCache = () => (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;

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
  /** The uploaded picture's version (pictures table), 0 for none */
  picture: number;
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
export const STATUS_GAP = MINUTE;
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
/** Events are kept this long */
export const EVENT_TTL = 90 * DAY;
const MAX_FINISHED = 50;
/** Streaks that make an event, in days */
const STREAKS = [7, 30, 100, 365, 1000];
/** A book that shows up at or past this share isn't announced as started */
const STARTED_BELOW = 0.25;
const PROFILE_TTL = 15 * MINUTE;
/** Cover thumbnails: ~160 px wide WebP, one per book key */
export const COVER_BYTES = 20_480;
export const COVER_UPLOADS = 50;
/** Pictures: a 256 px square WebP */
export const AVATAR_BYTES = 65_536;
export const AVATAR_UPLOADS = 5;
/** Image URLs carry a content hash or a version, so they never change */
const IMMUTABLE = 'public, max-age=31536000, immutable';

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

export async function sha256(text: string | Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    typeof text === 'string' ? new TextEncoder().encode(text) : text
  );

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

async function recordFailure(env: Env, subjects: string[]): Promise<never> {
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
    `SELECT u.*, s.last_used, COALESCE(p.version, 0) AS picture FROM sessions s
     JOIN users u ON u.id = s.user LEFT JOIN pictures p ON p.user = u.id WHERE s.hash = ?1`
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
    picture: user.picture,
    code: user.code,
    share: JSON.parse(user.share),
    created: user.created
  };
}

const userSql = (where: string) =>
  `SELECT u.*, COALESCE(p.version, 0) AS picture FROM users u
   LEFT JOIN pictures p ON p.user = u.id WHERE ${where}`;

async function userById(env: Env, id: string) {
  return env.DB.prepare(userSql('u.id = ?1')).bind(id).first<UserRow>();
}

async function userByName(env: Env, username: string) {
  return env.DB.prepare(userSql('u.username = ?1')).bind(username).first<UserRow>();
}

/** A book's thumbnail on the hub (its content hash), unless removed after a report */
const coverJoin = (alias: string) =>
  `LEFT JOIN covers c ON c.book_key = ${alias}.book_key AND c.removed = 0`;

/** The pair's row key: a < b */
const pair = (x: string, y: string) => (x < y ? [x, y] : [y, x]);

/** Friends with their current books, and requests both ways, in one query */
export async function friendsOf(env: Env, user: string) {
  const { results } = await env.DB.prepare(
    `SELECT l.state, l.by_user, l.code AS sent_code, l.created, u.id, u.username, u.name, u.avatar,
       COALESCE(p.version, 0) AS picture, s.book_key, s.title, s.author, s.kind, s.pct, s.read_at,
       c.file AS cover
     FROM links l JOIN users u ON u.id = CASE WHEN l.a = ?1 THEN l.b ELSE l.a END
     LEFT JOIN pictures p ON p.user = u.id
     LEFT JOIN status s ON s.user = u.id AND l.state = 'accepted'
     ${coverJoin('s')}
     WHERE (l.a = ?1 OR l.b = ?1) AND l.state != 'blocked'
     ORDER BY s.slot`
  )
    .bind(user)
    .all();
  const friends = new Map<string, Row & { books: Row[] }>();
  const incoming: Row[] = [];
  const outgoing: Row[] = [];

  for (const row of results) {
    const person = {
      id: row.id,
      username: row.username,
      name: row.name,
      avatar: row.avatar,
      picture: row.picture
    };

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
          readAt: row.read_at,
          cover: row.cover
        });
      }
    } else if (row.by_user === user) {
      // Who a code belongs to stays hidden until they accept.
      outgoing.push({ id: row.id, code: row.sent_code, at: row.created });
    } else {
      incoming.push({ ...person, at: row.created });
    }
  }

  // Their finished books (for the book page's Friends row) and stats, newest first.
  const ofFriends = (sql: string) =>
    env.DB.prepare(
      `${sql} JOIN links l ON l.state = 'accepted'
         AND ((l.a = ?1 AND l.b = t.user) OR (l.b = ?1 AND l.a = t.user))`
    )
      .bind(user)
      .all();
  const [finished, stats] = await Promise.all([
    ofFriends(
      `SELECT t.user, t.book_key, t.title, t.kind, t.month, t.at, c.file AS cover FROM finished t
       ${coverJoin('t')}`
    ),
    ofFriends('SELECT t.user, t.data FROM stats t')
  ]);

  friends.forEach((friend) => Object.assign(friend, { finished: [], stats: null }));
  finished.results
    .sort((x, y) => (y.at as number) - (x.at as number))
    .forEach((row) =>
      (friends.get(row.user as string)?.finished as Row[] | undefined)?.push({
        key: row.book_key,
        title: row.title,
        kind: row.kind,
        month: row.month,
        cover: row.cover
      })
    );
  stats.results.forEach((row) => {
    const friend = friends.get(row.user as string);

    if (friend) friend.stats = JSON.parse(row.data as string);
  });
  return { friends: [...friends.values()], incoming, outgoing };
}

/** Share settings with their defaults: on, except words known and the hide switches */
function sharing(user: UserRow) {
  const share = JSON.parse(user.share) as Record<string, boolean>;
  const on = (key: string, fallback = true) => share[key] ?? fallback;

  return {
    public: on('public'),
    current: on('current'),
    finished: on('finished'),
    activity: on('activity'),
    stats: on('stats'),
    wordsKnown: on('wordsKnown', false),
    hidden: (kind: string) =>
      (kind === 'manga' && on('hideManga', false)) || (kind === 'vn' && on('hideVn', false))
  };
}

/** Deletes at once what the reader no longer shares */
function dropUnshared(env: Env, user: UserRow) {
  const share = sharing(user);
  const sql: string[] = [];

  if (!share.current) sql.push('DELETE FROM status WHERE user = ?1');
  if (!share.finished) sql.push('DELETE FROM finished WHERE user = ?1');
  if (!share.activity) sql.push('DELETE FROM events WHERE user = ?1');
  if (!share.stats) sql.push('DELETE FROM stats WHERE user = ?1');
  if (!share.wordsKnown) {
    sql.push(`UPDATE stats SET data = json_remove(data, '$.wordsKnown') WHERE user = ?1`);
  }
  ['manga', 'vn']
    .filter(share.hidden)
    .forEach((kind) =>
      ['status', 'finished', 'events'].forEach((table) =>
        sql.push(`DELETE FROM ${table} WHERE user = ?1 AND kind = '${kind}'`)
      )
    );
  return sql.length
    ? env.DB.batch(sql.map((one) => env.DB.prepare(one).bind(user.id)))
    : Promise.resolve();
}

const profileKey = (request: Request, username: string) =>
  `${new URL(request.url).origin}/v1/profile/${username.toLowerCase()}`;

/** A changed profile shouldn't wait 15 minutes in this data centre's cache (others may). */
async function purgeProfile(request: Request, username: string) {
  await edgeCache()
    ?.delete(profileKey(request, username))
    .catch(() => false);
}

/**
 * A profile: public ones to anyone, private ones to friends (404 otherwise, and both ways
 * when blocked). Activity only for friends and oneself.
 */
async function profile(env: Env, username: string, viewer: UserRow | null) {
  const user = await userByName(env, username);

  if (!user) throw new HttpError(404, 'user');

  const share = sharing(user);
  let relation = 'visitor';
  let since: number | undefined;

  if (viewer?.id === user.id) {
    relation = 'self';
  } else if (viewer) {
    const [a, b] = pair(viewer.id, user.id);
    const link = await env.DB.prepare('SELECT state, created FROM links WHERE a = ?1 AND b = ?2')
      .bind(a, b)
      .first<{ state: string; created: number }>();

    if (link?.state === 'blocked') throw new HttpError(404, 'user');
    if (link?.state === 'accepted') {
      relation = 'friend';
      since = link.created;
    }
  }
  if (relation === 'visitor' && !share.public) throw new HttpError(404, 'user');

  const rows = (sql: string) => env.DB.prepare(sql).bind(user.id).all();
  const [books, finished, stats, events] = await Promise.all([
    rows(
      `SELECT s.book_key, s.title, s.author, s.kind, s.pct, s.read_at, c.file AS cover
       FROM status s ${coverJoin('s')} WHERE s.user = ?1 ORDER BY s.slot`
    ),
    rows(
      `SELECT f.book_key, f.title, f.kind, f.month, c.file AS cover
       FROM finished f ${coverJoin('f')} WHERE f.user = ?1 ORDER BY f.at DESC`
    ),
    env.DB.prepare('SELECT data FROM stats WHERE user = ?1')
      .bind(user.id)
      .first<{ data: string }>(),
    relation === 'visitor'
      ? Promise.resolve({ results: [] })
      : rows(
          'SELECT id, type, book_key, title, kind, value, at FROM events WHERE user = ?1 ORDER BY at DESC, id DESC LIMIT 30'
        )
  ]);

  return {
    profile: {
      id: user.id,
      username: user.username,
      name: user.name,
      avatar: user.avatar,
      picture: user.picture,
      created: user.created,
      public: share.public
    },
    relation,
    since,
    books: books.results.map((row) => ({
      key: row.book_key,
      title: row.title,
      author: row.author,
      kind: row.kind,
      pct: row.pct,
      readAt: row.read_at,
      cover: row.cover
    })),
    finished: finished.results.map((row) => ({
      key: row.book_key,
      title: row.title,
      kind: row.kind,
      month: row.month,
      cover: row.cover
    })),
    stats: stats ? JSON.parse(stats.data) : null,
    events: events.results.map(eventJson)
  };
}

function eventJson(row: Row) {
  return {
    id: row.id,
    type: row.type,
    key: row.book_key,
    title: row.title,
    kind: row.kind,
    value: row.value,
    at: row.at
  };
}

/** Friends' events after `since` (at most 90 days back), newest first */
async function feed(env: Env, user: string, since: number) {
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.type, e.book_key, e.title, e.kind, e.value, e.at,
       u.id AS uid, u.username, u.name, u.avatar, COALESCE(p.version, 0) AS picture
     FROM events e
     JOIN links l ON l.state = 'accepted' AND ((l.a = ?1 AND l.b = e.user) OR (l.b = ?1 AND l.a = e.user))
     JOIN users u ON u.id = e.user LEFT JOIN pictures p ON p.user = u.id
     WHERE e.at > ?2 ORDER BY e.at DESC, e.id DESC LIMIT 100`
  )
    .bind(user, Math.max(since, now() - EVENT_TTL))
    .all();

  return {
    events: results.map((row) => ({
      ...eventJson(row),
      user: {
        id: row.uid,
        username: row.username,
        name: row.name,
        avatar: row.avatar,
        picture: row.picture
      }
    }))
  };
}

/**
 * A report of someone's name or picture (`{username, what}`), or of a cover thumbnail
 * (`{what: 'cover', key}`: the target is the book key), once per reporter; acted on by hand
 * (README).
 */
async function report(request: Request, env: Env, viewer: UserRow | null) {
  const body = await readBody(request);
  const what = body.what === 'picture' || body.what === 'cover' ? body.what : 'name';
  const reporter = viewer?.id ?? (await ipSubject(request));
  let target: string;

  if (what === 'cover') {
    target = text(body.key, 200, 'key');
    await limit(env, reporter, 'report', DAY, 5);

    const cover = await env.DB.prepare('SELECT 1 FROM covers WHERE book_key = ?1 AND removed = 0')
      .bind(target)
      .first();

    if (!cover) throw new HttpError(404, 'cover');
  } else {
    const username = matching(body.username, USERNAME, 'username');

    await limit(env, reporter, 'report', DAY, 5);

    const user = await userByName(env, username);

    if (!user) throw new HttpError(404, 'user');
    if (user.id === viewer?.id) throw new HttpError(400, 'self');
    target = user.id;
  }
  await env.DB.prepare(
    'INSERT OR IGNORE INTO reports (target, reporter, what, at) VALUES (?1, ?2, ?3, ?4)'
  )
    .bind(target, reporter, what, now())
    .run();
  return json({ ok: true });
}

/** Width, height and whether EXIF or XMP is attached, from a WebP's header; null for anything else */
export function webpSize(bytes: Uint8Array) {
  const ascii = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n));
  const u24 = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
  const riff = (u24(4) | (bytes[7] << 24)) >>> 0;

  if (
    bytes.length < 30 ||
    ascii(0, 4) !== 'RIFF' ||
    ascii(8, 4) !== 'WEBP' ||
    riff + 8 !== bytes.length
  ) {
    return null;
  }
  switch (ascii(12, 4)) {
    case 'VP8 ':
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
      return {
        width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
        height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
        metadata: false
      };
    case 'VP8L': {
      if (bytes[20] !== 0x2f) return null;
      const bits = (u24(21) | (bytes[24] << 24)) >>> 0;

      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, metadata: false };
    }
    case 'VP8X':
      return { width: u24(24) + 1, height: u24(27) + 1, metadata: (bytes[20] & 0x0c) !== 0 };
  }
  return null;
}

function media(env: Env) {
  if (!env.MEDIA) throw new HttpError(503, 'media');
  return env.MEDIA;
}

/** A WebP upload: the type, at most `max` bytes, no EXIF or XMP, and sane dimensions */
async function readImage(
  request: Request,
  max: number,
  fits: (width: number, height: number) => boolean
) {
  if (request.headers.get('Content-Type') !== 'image/webp') throw new HttpError(415, 'type');
  if (Number(request.headers.get('Content-Length')) > max) throw new HttpError(413, 'size');

  const bytes = new Uint8Array(await request.arrayBuffer());

  if (bytes.length > max) throw new HttpError(413, 'size');

  const size = webpSize(bytes);

  if (!size || size.metadata) throw new HttpError(415, 'type');
  if (!fits(size.width, size.height)) throw new HttpError(400, 'dimensions');
  return bytes;
}

/**
 * PUT /v1/cover?key=: the first thumbnail of a book key, from a reader who shares the book (in
 * their current or finished books); any later one, or one for a removed cover, is 409.
 */
async function uploadCover(request: Request, env: Env, user: UserRow) {
  const key = text(new URL(request.url).searchParams.get('key'), 200, 'key');

  await limit(env, user.id, 'cover', DAY, COVER_UPLOADS);

  const bytes = await readImage(
    request,
    COVER_BYTES,
    (width, height) => width >= 32 && width <= 200 && height >= 32 && height <= 400
  );
  const shared = await env.DB.prepare(
    `SELECT 1 FROM status WHERE user = ?1 AND book_key = ?2
     UNION ALL SELECT 1 FROM finished WHERE user = ?1 AND book_key = ?2`
  )
    .bind(user.id, key)
    .first();

  if (!shared) throw new HttpError(404, 'book');

  const file = (await sha256(bytes)).slice(0, 16);
  const { meta } = await env.DB.prepare(
    'INSERT OR IGNORE INTO covers (book_key, file, user, at) VALUES (?1, ?2, ?3, ?4)'
  )
    .bind(key, file, user.id, now())
    .run();

  if (!meta.changes) throw new HttpError(409, 'exists');
  try {
    await media(env).put(`cover/${file}`, bytes.slice().buffer, {
      httpMetadata: { contentType: 'image/webp', cacheControl: IMMUTABLE }
    });
  } catch (error) {
    await env.DB.prepare('DELETE FROM covers WHERE book_key = ?1').bind(key).run();
    throw error;
  }
  return json({ cover: file });
}

/** PUT /v1/avatar: a new picture (a new version, so a new URL); the old object goes. */
async function uploadPicture(request: Request, env: Env, user: UserRow) {
  await limit(env, user.id, 'picture', DAY, AVATAR_UPLOADS);

  const bytes = await readImage(
    request,
    AVATAR_BYTES,
    (width, height) => width === height && width >= 64 && width <= 256
  );
  const version = Math.max(now(), user.picture + 1);

  await media(env).put(`avatar/${user.id}/${version}`, bytes.slice().buffer, {
    httpMetadata: { contentType: 'image/webp', cacheControl: IMMUTABLE }
  });
  await env.DB.prepare('INSERT OR REPLACE INTO pictures (user, version) VALUES (?1, ?2)')
    .bind(user.id, version)
    .run();
  if (user.picture) await media(env).delete(`avatar/${user.id}/${user.picture}`);
  await purgeProfile(request, user.username);
  return json(me((await userById(env, user.id))!));
}

/** DELETE /v1/avatar: back to the preset */
async function removePicture(request: Request, env: Env, user: UserRow) {
  if (user.picture) {
    await media(env).delete(`avatar/${user.id}/${user.picture}`);
    await env.DB.prepare('DELETE FROM pictures WHERE user = ?1').bind(user.id).run();
    await purgeProfile(request, user.username);
  }
  return json(me((await userById(env, user.id))!));
}

/**
 * GET /v1/cover/:file and /v1/avatar/:id/:version, from the edge cache, else R2. The URLs never
 * change, so browsers and the edge keep them for a year.
 */
async function serveImage(request: Request, env: Env, ctx: Context | undefined, path: string) {
  const cache = edgeCache();
  const hit = await cache?.match(request.url).catch(() => undefined);

  if (hit) return hit;

  const object = await env.MEDIA?.get(path);

  if (!object) return json({ error: 'image' }, 404);

  const response = new Response(object.body, {
    headers: {
      ...cors,
      'Content-Type': 'image/webp',
      'Cache-Control': IMMUTABLE,
      'X-Content-Type-Options': 'nosniff'
    }
  });

  if (cache) {
    const put = cache.put(request.url, response.clone()).catch(() => {});

    if (ctx) ctx.waitUntil(put);
    else await put;
  }
  return response;
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

  // By code, or by username from a public profile's Add friend.
  const byName = body.username !== undefined;
  const code = byName ? null : normalizeCode(text(body.code, 20, 'code'));
  const named = byName
    ? await userByName(env, matching(body.username, USERNAME, 'username'))
    : null;
  const target = byName
    ? named && sharing(named).public
      ? named
      : null
    : await env.DB.prepare('SELECT id FROM users WHERE code = ?1')
        .bind(code)
        .first<{ id: string }>();

  if (!target) throw new HttpError(404, byName ? 'user' : 'code');
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
      .bind(a, b, user.id, code ?? `@${named!.username}`, now())
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
    // "Reading something": a hidden book, only its share.
    const hidden = book.kind === 'hidden';

    if (!(pct >= 0 && pct <= 1)) throw new HttpError(400, 'pct');
    if (!hidden && !KINDS.includes(book.kind as string)) throw new HttpError(400, 'kind');
    return {
      key: hidden ? '' : text(book.key, 200, 'key'),
      title: hidden ? '' : text(book.title, 200, 'title'),
      author: hidden ? '' : text(book.author, 200, 'author', true),
      kind: book.kind as string,
      pct,
      readAt
    };
  });
}

function validFinished(value: unknown) {
  if (value === undefined || value === null) return null;

  const book = value as Row;

  if (typeof book !== 'object' || !KINDS.includes(book.kind as string)) {
    throw new HttpError(400, 'finished');
  }
  return {
    key: text(book.key, 200, 'key'),
    title: text(book.title, 200, 'title'),
    kind: book.kind as string
  };
}

function validStats(value: unknown, wordsKnown: boolean) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') throw new HttpError(400, 'stats');

  const stats = value as Row;
  const count = (field: unknown) => {
    const n = Number(field);

    if (!Number.isInteger(n) || n < 0 || n > 1e9) throw new HttpError(400, 'stats');
    return n;
  };

  if (typeof stats.heat !== 'string' || !/^[0-4]{84}$/.test(stats.heat)) {
    throw new HttpError(400, 'stats');
  }
  return {
    streak: count(stats.streak),
    weekChars: count(stats.weekChars),
    weekMinutes: count(stats.weekMinutes),
    finishedYear: count(stats.finishedYear),
    heat: stats.heat,
    ...(wordsKnown && stats.wordsKnown !== undefined && stats.wordsKnown !== null
      ? { wordsKnown: count(stats.wordsKnown) }
      : {})
  };
}

/**
 * Current books, a book just finished and the stats, kept only as far as the reader shares
 * them; writes started, finished and streak events (each once per 90 days).
 */
async function pushStatus(env: Env, user: UserRow, body: Row) {
  const share = sharing(user);
  const books = validBooks(body.books).filter((book) => share.current && !share.hidden(book.kind));
  const stats = share.stats ? validStats(body.stats, share.wordsKnown) : null;
  const finishedNow = validFinished(body.finished);
  const done = finishedNow && !share.hidden(finishedNow.kind) ? finishedNow : null;
  const time = now();
  const { meta } = await env.DB.prepare(
    'UPDATE users SET status_at = ?1 WHERE id = ?2 AND status_at <= ?1 - ?3'
  )
    .bind(time, user.id, STATUS_GAP)
    .run();

  if (!meta.changes && !(body.leaving === true && (await take(env, user.id, 'leave', DAY, 30)))) {
    throw new HttpError(429, 'soon');
  }

  const [before, oldStats] = await Promise.all([
    env.DB.prepare('SELECT book_key FROM status WHERE user = ?1').bind(user.id).all(),
    env.DB.prepare('SELECT data FROM stats WHERE user = ?1').bind(user.id).first<{ data: string }>()
  ]);
  const known = new Set(before.results.map((row) => row.book_key));
  const events: [string, string, string, string, number][] = [];

  if (share.activity) {
    books
      .filter((book) => book.kind !== 'hidden' && !known.has(book.key) && book.pct < STARTED_BELOW)
      .forEach((book) => events.push(['started', book.key, book.title, book.kind, 0]));
    if (done && share.finished) events.push(['finished', done.key, done.title, done.kind, 0]);
    if (stats) {
      const last = oldStats ? Number(JSON.parse(oldStats.data).streak) || 0 : 0;
      const reached = STREAKS.filter((days) => last < days && stats.streak >= days).pop();

      if (reached) events.push(['streak', '', '', 'book', reached]);
    }
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM status WHERE user = ?1').bind(user.id),
    ...books.map((book, slot) =>
      env.DB.prepare(
        `INSERT INTO status (user, slot, book_key, title, author, kind, pct, read_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
      ).bind(user.id, slot, book.key, book.title, book.author, book.kind, book.pct, book.readAt)
    ),
    ...(stats
      ? [
          env.DB.prepare('INSERT OR REPLACE INTO stats (user, data, at) VALUES (?1, ?2, ?3)').bind(
            user.id,
            JSON.stringify(stats),
            time
          )
        ]
      : []),
    ...(done && share.finished
      ? [
          env.DB.prepare(
            `INSERT OR REPLACE INTO finished (user, book_key, title, kind, month, at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
          ).bind(
            user.id,
            done.key,
            done.title,
            done.kind,
            new Date(time * 1000).toISOString().slice(0, 7),
            time
          ),
          env.DB.prepare(
            `DELETE FROM finished WHERE user = ?1 AND book_key NOT IN
               (SELECT book_key FROM finished WHERE user = ?1 ORDER BY at DESC LIMIT ${MAX_FINISHED})`
          ).bind(user.id)
        ]
      : []),
    ...events.map(([type, key, title, kind, value]) =>
      env.DB.prepare(
        `INSERT INTO events (user, type, book_key, title, kind, value, at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE NOT EXISTS (SELECT 1 FROM events
           WHERE user = ?1 AND type = ?2 AND book_key = ?3 AND value = ?6 AND at > ?8)`
      ).bind(user.id, type, key, title, kind, value, time, time - EVENT_TTL)
    )
  ]);

  // The shared books the hub has no thumbnail for: the app uploads the ones it has a cover of.
  const keys = [
    ...new Set([
      ...books.filter((book) => book.kind !== 'hidden').map((book) => book.key),
      ...(done && share.finished ? [done.key] : [])
    ])
  ];

  if (!keys.length) return [];

  const { results } = await env.DB.prepare(
    `SELECT book_key FROM covers WHERE book_key IN (${keys.map((_, i) => `?${i + 1}`).join(', ')})`
  )
    .bind(...keys)
    .all();
  const have = new Set(results.map((row) => row.book_key));

  return keys.filter((key) => !have.has(key));
}

async function updateMe(request: Request, env: Env, user: UserRow, body: Row) {
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

  const updated = (await userById(env, user.id))!;

  await dropUnshared(env, updated);
  await purgeProfile(request, user.username);
  return me(updated);
}

/** Every row of these users (accounts, sessions, friend links, status, counters) and their pictures */
async function deleteUsers(env: Env, where: string, ...values: unknown[]) {
  const users = `SELECT id FROM users WHERE ${where}`;
  const { results } = await env.DB.prepare(
    `SELECT user, version FROM pictures WHERE user IN (${users})`
  )
    .bind(...values)
    .all();
  const objects = results.map((row) => `avatar/${row.user}/${row.version}`);

  // R2 deletes at most 1,000 keys a call.
  for (let at = 0; at < objects.length; at += 1000) {
    await media(env).delete(objects.slice(at, at + 1000));
  }
  return env.DB.batch(
    [
      `DELETE FROM pictures WHERE user IN (${users})`,
      `DELETE FROM sessions WHERE user IN (${users})`,
      `DELETE FROM links WHERE a IN (${users}) OR b IN (${users})`,
      `DELETE FROM status WHERE user IN (${users})`,
      `DELETE FROM stats WHERE user IN (${users})`,
      `DELETE FROM finished WHERE user IN (${users})`,
      `DELETE FROM events WHERE user IN (${users})`,
      `DELETE FROM reports WHERE target IN (${users}) OR reporter IN (${users})`,
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
    env.DB.prepare('DELETE FROM events WHERE at < ?1').bind(time - EVENT_TTL),
    env.DB.prepare('DELETE FROM reports WHERE at < ?1').bind(time - EVENT_TTL),
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

/** Checks the current password (stretched with the account's salt) of a signed-in reader. */
async function checkPassword(request: Request, env: Env, user: UserRow, key: unknown) {
  const subjects = [`name:${user.username.toLowerCase()}`, await ipSubject(request)];

  await checkFailures(env, subjects);
  if ((await passHash(user.salt, matching(key, KEY, 'key'))) !== user.pass_hash) {
    await recordFailure(env, subjects);
  }
}

/** POST /v1/password {key, next}: a new password (same salt); other sessions end. */
async function changePassword(request: Request, env: Env, user: UserRow, hash: string) {
  const body = await readBody(request);
  const next = matching(body.next, KEY, 'key');

  await checkPassword(request, env, user, body.key);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pass_hash = ?1 WHERE id = ?2').bind(
      await passHash(user.salt, next),
      user.id
    ),
    env.DB.prepare('DELETE FROM sessions WHERE user = ?1 AND hash != ?2').bind(user.id, hash)
  ]);
  return json({ ok: true });
}

/** POST /v1/recovery {key}: a new recovery code, shown once; the old one stops working. */
async function newRecovery(request: Request, env: Env, user: UserRow) {
  await checkPassword(request, env, user, (await readBody(request)).key);

  const recovery = randomCode(20);

  await env.DB.prepare('UPDATE users SET recovery_hash = ?1 WHERE id = ?2')
    .bind(await sha256(recovery), user.id)
    .run();
  return json({ recovery });
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
plus the share settings you choose. As far as you share them: your last 50 finished books with
the month, reading stats (streak, this week, books finished this year, an 84-day activity strip,
words known only if you turn it on) and activity for friends (started, finished, streaks), kept
90 days. Turning a share off deletes that data at once. Reports of a name, picture or cover are
kept 90 days. Passwords are stretched in your browser and stored only as a salted hash; the
recovery code and session tokens are stored only as hashes.</p>
<p>Images: your picture, if you upload one (a 256 px square, re-encoded in your browser, which
drops EXIF and location data), and small cover thumbnails (about 160 px) of books readers share,
one per book, uploaded by the first reader who has its cover. Covers are shared by everyone who
reads the book and stay when an account is deleted; your picture does not.</p>
<p>No email, IP address log or book files. Rate limits keep hashed addresses for two days.</p>
<p>Deleting your account (Settings, Social) removes every row and your picture at once. Sessions unused for 90 days
and accounts unused for 12 months are deleted automatically.</p>`;

/**
 * GET /v1/profile/:username. Without a token: public profiles only, from the edge cache for
 * 15 minutes (30 misses a day per address); with one: friends see private profiles too.
 */
async function profileResponse(
  request: Request,
  env: Env,
  ctx: Context | undefined,
  username: string,
  viewer: UserRow | null
) {
  const cache = viewer ? undefined : edgeCache();
  const key = profileKey(request, username);
  const hit = await cache?.match(key).catch(() => undefined);

  if (hit) return hit;
  await limit(env, viewer?.id ?? (await ipSubject(request)), 'profile', DAY, 30);

  const response = json(await profile(env, username, viewer));

  if (cache) {
    const copy = new Response(response.clone().body, response);

    copy.headers.set('Cache-Control', `public, max-age=${PROFILE_TTL}`);
    const put = cache.put(key, copy).catch(() => {});

    if (ctx) ctx.waitUntil(put);
    else await put;
  }
  return response;
}

async function route(request: Request, env: Env, ctx?: Context): Promise<Response> {
  const { pathname } = new URL(request.url);
  const route = `${request.method} ${pathname}`;

  if (route === 'GET /privacy') {
    return new Response(privacy, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  if (route === 'POST /v1/salt') return salt(request, env);
  if (route === 'POST /v1/signup') return signup(request, env);
  if (route === 'POST /v1/login') return login(request, env);
  if (route === 'POST /v1/recover') return recover(request, env);

  // Profiles and reports also answer visitors without an account.
  const auth = request.headers.has('Authorization') ? await authenticate(request, env) : null;
  const profilePath = /^\/v1\/profile\/([A-Za-z0-9_]{3,20})$/.exec(pathname);

  if (request.method === 'GET' && profilePath) {
    return profileResponse(request, env, ctx, profilePath[1], auth?.user ?? null);
  }
  if (route === 'POST /v1/report') return report(request, env, auth?.user ?? null);
  if (!auth) throw new HttpError(401, 'session');

  const { user, hash } = auth;

  switch (route) {
    case 'GET /v1/feed': {
      await limit(env, user.id, 'feed', MINUTE, 1);
      const since = Number(new URL(request.url).searchParams.get('since')) || 0;

      return json(await feed(env, user.id, since));
    }
    case 'POST /v1/logout':
      await env.DB.prepare('DELETE FROM sessions WHERE hash = ?1').bind(hash).run();
      return json({ ok: true });
    case 'POST /v1/logout-all':
      await env.DB.prepare('DELETE FROM sessions WHERE user = ?1').bind(user.id).run();
      return json({ ok: true });
    case 'POST /v1/password':
      return changePassword(request, env, user, hash);
    case 'POST /v1/recovery':
      return newRecovery(request, env, user);
    case 'GET /v1/me':
      return json(me(user));
    case 'PUT /v1/me':
      return json(await updateMe(request, env, user, await readBody(request)));
    case 'DELETE /v1/me':
      await deleteUsers(env, 'id = ?1', user.id);
      await purgeProfile(request, user.username);
      return json({ ok: true });
    case 'POST /v1/code':
      await limit(env, user.id, 'code', DAY, 3);
      await env.DB.prepare('UPDATE users SET code = ?1 WHERE id = ?2')
        .bind(randomCode(8), user.id)
        .run();
      return json(me((await userById(env, user.id))!));
    case 'PUT /v1/status':
      return json({ ok: true, needCovers: await pushStatus(env, user, await readBody(request)) });
    case 'PUT /v1/cover':
      return uploadCover(request, env, user);
    case 'PUT /v1/avatar':
      return uploadPicture(request, env, user);
    case 'DELETE /v1/avatar':
      return removePicture(request, env, user);
    case 'GET /v1/friends':
      await limit(env, user.id, 'friends', MINUTE, 1);
      return json(await friendsOf(env, user.id));
    case 'POST /v1/friends/request':
      await sendRequest(env, user, await readBody(request));
      return json(await friendsOf(env, user.id));
  }

  const finished = /^\/v1\/finished\/([^/]+)$/.exec(pathname);

  if (request.method === 'DELETE' && finished) {
    // The reader deleted the book's statistics: its finished entry and its events go too.
    await limit(env, user.id, 'unfinish', DAY, 100);
    const key = text(decodeURIComponent(finished[1]), 200, 'key');

    await env.DB.batch([
      env.DB.prepare('DELETE FROM finished WHERE user = ?1 AND book_key = ?2').bind(user.id, key),
      env.DB.prepare('DELETE FROM events WHERE user = ?1 AND book_key = ?2').bind(user.id, key)
    ]);
    await purgeProfile(request, user.username);
    return json({ ok: true });
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
  async fetch(request: Request, env: Env, ctx?: Context) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const image = /^\/v1\/(cover\/[0-9a-f]{16}|avatar\/[0-9a-f]{16}\/\d{1,12})$/.exec(
        new URL(request.url).pathname
      );

      // Images skip the edge limit (a shelf shows a dozen at once); each URL is fetched about
      // once per device and edge location.
      if (request.method === 'GET' && image) return await serveImage(request, env, ctx, image[1]);

      const edge = await env.EDGE_LIMIT?.limit({
        key: request.headers.get('CF-Connecting-IP') ?? 'unknown'
      });

      if (edge && !edge.success) return json({ error: 'busy' }, 429);
      return await route(request, env, ctx);
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
