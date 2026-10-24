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
  /** Per address for /v1/transfers (polled while a transfer is set up), instead of EDGE_LIMIT */
  SIGNAL_LIMIT?: RateLimit;
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
  last_seen: number;
  /** The uploaded picture's version (pictures table), 0 for none */
  picture: number;
  /** 'dev' for the hub's moderators (granted by hand, README), else '' */
  role: string;
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const MAX_FRIENDS = 200;
const MAX_PENDING = 50;
/** Failed sign-ins an hour per address; per username (from anywhere) only past MAX_NAME_FAILURES */
const MAX_FAILURES = 10;
const MAX_NAME_FAILURES = 50;
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
/** A reader's newest events kept (each push may add a few) */
const MAX_EVENTS = 100;
/** Streaks that make an event, in days */
const STREAKS = [7, 30, 100, 365, 1000];
/** Characters each reading rank needs (the app's reading-rank.ts): a shared rank is capped by them */
const RANK_CHARS = [0, 100_000, 250_000, 600_000, 1_500_000, 4_000_000, 10_000_000];
/** Characters a day the hub believes at most, from the account's creation or the last push */
const RANK_DAILY_CAP = 300_000;
/** A shared rank rises one tier at most this often */
const RANK_RISE = 7 * DAY;
/** A book that shows up at or past this share isn't announced as started */
const STARTED_BELOW = 0.25;
const PROFILE_TTL = 15 * MINUTE;
/** Cover thumbnails: ~160 px wide WebP, one per book key and uploader */
export const COVER_BYTES = 20_480;
export const COVER_UPLOADS = 50;
/** Pictures: a 256 px square WebP */
export const AVATAR_BYTES = 65_536;
export const AVATAR_UPLOADS = 5;
/**
 * Hub-wide ceilings so the R2 bill can't grow past the free tier: uploads a day from everyone, and
 * stored images counted at their size limits (an overestimate, so no byte bookkeeping).
 */
export const UPLOADS_PER_DAY = 2_000;
export const MEDIA_BYTES = 8 * 1024 ** 3;
/** Image URLs carry a content hash or a version, so they never change */
const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Sending a book: signaling only (the book goes browser to browser over WebRTC) */
export const TRANSFER_TTL = 10 * MINUTE;
export const TRANSFERS_PER_DAY = 20;
/** wrangler.toml's second cron: expired transfers only */
export const TRANSFER_CRON = '*/10 * * * *';
export const TRANSFER_BYTES = 300 * 1024 ** 2;
const SDP_LENGTH = 12_000;

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

/** The client's address; IPv6 by its /64 (one reader gets a whole /64 to rotate through) */
export function clientAddress(request: Request) {
  const ip = request.headers.get('CF-Connecting-IP') ?? '';

  if (!ip.includes(':')) return ip;

  const [head, tail] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail === undefined ? [] : tail ? tail.split(':') : [];
  const groups = [
    ...left,
    ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'),
    ...right
  ];

  return `${groups
    .slice(0, 4)
    .map((group) => (parseInt(group, 16) || 0).toString(16))
    .join(':')}::/64`;
}

async function ipSubject(request: Request) {
  return `ip:${await sha256(clientAddress(request))}`;
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
// subjects: [name, address]. The address's lock also bounds name + address at 10; the name's
// own is higher, so one address can't lock someone else's account.
async function checkFailures(env: Env, subjects: string[]) {
  const row = await env.DB.prepare(
    `SELECT 1 FROM limits WHERE action = 'fail' AND win = ?1
       AND ((subject = ?2 AND count >= ?4) OR (subject = ?3 AND count >= ?5))`
  )
    .bind(Math.floor(now() / HOUR) * HOUR, ...subjects, MAX_NAME_FAILURES, MAX_FAILURES)
    .first();

  if (row) throw new HttpError(429, 'locked');
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
    role: user.role,
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

/** The thumbnail this row's own reader uploaded for the book (its content hash), unless removed */
const coverJoin = (alias: string) =>
  `LEFT JOIN covers c ON c.user = ${alias}.user AND c.book_key = ${alias}.book_key AND c.removed = 0`;

/** A cover report's target: the uploader's id and the book key */
const coverTarget = (user: string, key: string) => `${user}:${key}`;

function parseCoverTarget(target: string) {
  if (!/^[0-9a-f]{16}:./.test(target)) throw new HttpError(400, 'target');
  return { user: target.slice(0, 16), key: target.slice(17) };
}

/** Deletes the R2 objects of these cover files that no shown (removed = 0) cover still uses */
async function dropCoverFiles(env: Env, files: string[]) {
  const unique = [...new Set(files)];
  const gone: string[] = [];

  for (let at = 0; at < unique.length; at += 90) {
    const chunk = unique.slice(at, at + 90);
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT file FROM covers WHERE removed = 0 AND file IN (${chunk.map((_, i) => `?${i + 1}`).join(', ')})`
    )
      .bind(...chunk)
      .all<{ file: string }>();
    const used = new Set(results.map((row) => row.file));

    gone.push(...chunk.filter((file) => !used.has(file)).map((file) => `cover/${file}`));
  }
  // R2 deletes at most 1,000 keys a call.
  for (let at = 0; at < gone.length; at += 1000) {
    await media(env).delete(gone.slice(at, at + 1000));
  }
}

/** The pair's row key: a < b */
const pair = (x: string, y: string) => (x < y ? [x, y] : [y, x]);

/** Friends with their current books, and requests both ways, in one query */
export async function friendsOf(env: Env, user: string) {
  const { results } = await env.DB.prepare(
    `SELECT l.state, l.by_user, l.code AS sent_code, l.created, u.id, u.username, u.name, u.avatar,
       u.role, COALESCE(p.version, 0) AS picture, s.book_key, s.title, s.author, s.kind, s.pct, s.read_at,
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
      picture: row.picture,
      role: row.role
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
      role: user.role,
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
       u.id AS uid, u.username, u.name, u.avatar, u.role, COALESCE(p.version, 0) AS picture
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
        picture: row.picture,
        role: row.role
      }
    }))
  };
}

/**
 * A report of someone's name or picture (`{username, what}`), or of a cover thumbnail
 * (`{what: 'cover', key}`: the target is the book key), once per reporter; acted on in the app
 * (/moderation, role dev). Signed-in readers only, so reports can't be made in bulk by address.
 */
async function report(request: Request, env: Env, viewer: UserRow) {
  const body = await readBody(request);
  const what = body.what === 'picture' || body.what === 'cover' ? body.what : 'name';
  const reporter = viewer.id;
  let target: string;

  if (what === 'cover') {
    // The cover shown on this reader's profile: their own upload.
    const key = text(body.key, 200, 'key');
    const username = matching(body.username, USERNAME, 'username');

    await limit(env, reporter, 'report', DAY, 5);

    const cover = await env.DB.prepare(
      `SELECT c.user FROM covers c JOIN users u ON u.id = c.user
       WHERE u.username = ?1 AND c.book_key = ?2 AND c.removed = 0`
    )
      .bind(username, key)
      .first<{ user: string }>();

    if (!cover) throw new HttpError(404, 'cover');
    target = coverTarget(cover.user, key);
  } else {
    const username = matching(body.username, USERNAME, 'username');

    await limit(env, reporter, 'report', DAY, 5);

    const user = await userByName(env, username);

    if (!user) throw new HttpError(404, 'user');
    if (user.id === viewer.id) throw new HttpError(400, 'self');
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

/** 503 `paused` once the stored images reach the hub-wide ceiling */
async function mediaRoom(env: Env) {
  const stored = await env.DB.prepare(
    'SELECT (SELECT COUNT(*) FROM covers WHERE removed = 0) * ?1 + (SELECT COUNT(*) FROM pictures) * ?2 AS n'
  )
    .bind(COVER_BYTES, AVATAR_BYTES)
    .first<{ n: number }>();

  if ((stored?.n ?? 0) + AVATAR_BYTES > MEDIA_BYTES) throw new HttpError(503, 'paused');
}

/** Counts one upload towards today's hub-wide ceiling; false once it is reached */
const takeUpload = (env: Env) => take(env, '*', 'upload', DAY, UPLOADS_PER_DAY);

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
 * PUT /v1/cover?key=: this reader's thumbnail of a book they share (in their current or finished
 * books), shown on their own rows only; a second one, or one after a removal, is 409.
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
  await mediaRoom(env);

  const file = (await sha256(bytes)).slice(0, 16);
  const { meta } = await env.DB.prepare(
    'INSERT OR IGNORE INTO covers (book_key, file, user, at) VALUES (?1, ?2, ?3, ?4)'
  )
    .bind(key, file, user.id, now())
    .run();
  const undo = () =>
    env.DB.prepare('DELETE FROM covers WHERE user = ?1 AND book_key = ?2').bind(user.id, key).run();

  if (!meta.changes) throw new HttpError(409, 'exists');
  // Counted only once the row is in: refused uploads don't use up everyone's daily ceiling.
  if (!(await takeUpload(env))) {
    await undo();
    throw new HttpError(503, 'paused');
  }
  try {
    await media(env).put(`cover/${file}`, bytes.slice().buffer, {
      httpMetadata: { contentType: 'image/webp', cacheControl: IMMUTABLE }
    });
  } catch (error) {
    await undo();
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
  await mediaRoom(env);
  if (!(await takeUpload(env))) throw new HttpError(503, 'paused');
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
  // Without the query string: ?n=1, 2… would each miss and read R2.
  const url = new URL(request.url);
  const key = `${url.origin}${url.pathname}`;
  const hit = await cache?.match(key).catch(() => undefined);

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
    const put = cache.put(key, response.clone()).catch(() => {});

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
  const other = a === user ? b : a;
  const counts = await Promise.all([linkCounts(env, user, user), linkCounts(env, other, other)]);

  if (counts.some((one) => (one?.friends ?? 0) >= MAX_FRIENDS)) throw new HttpError(409, 'friends');

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
      : {}),
    ...(stats.rank !== undefined && stats.rank !== null
      ? {
          rank: Math.min(Math.max(count(stats.rank), 1), RANK_CHARS.length),
          chars: count(stats.chars)
        }
      : {})
  };
}

/**
 * Caps a shared reading rank by what the hub saw: characters grow at most RANK_DAILY_CAP a day
 * since the last stats (or the account's creation), the rank is at most what those characters
 * support, and it rises one tier per RANK_RISE (`rankAt`: when it last rose).
 */
export function capRank<T extends { rank?: number; chars?: number }>(
  stats: T,
  old: Row | null,
  oldAt: number,
  created: number,
  time: number
) {
  if (stats.rank === undefined || stats.chars === undefined) return stats;

  const hadChars = typeof old?.chars === 'number';
  const since = hadChars ? oldAt : created;
  const chars = Math.min(
    stats.chars,
    Math.floor((hadChars ? (old!.chars as number) : 0) + ((time - since) / DAY) * RANK_DAILY_CAP)
  );
  let rank = Math.min(stats.rank, RANK_CHARS.filter((need) => need <= chars).length);
  let rankAt = time;

  if (typeof old?.rank === 'number') {
    const lastRose = Number(old.rankAt) || 0;

    rank = Math.min(rank, time - lastRose >= RANK_RISE ? old.rank + 1 : old.rank);
    if (rank <= old.rank) rankAt = lastRose;
  }
  return { ...stats, chars, rank, rankAt };
}

/**
 * Current books, a book just finished and the stats, kept only as far as the reader shares
 * them; writes started, finished and streak events (each once per 90 days).
 */
async function pushStatus(env: Env, user: UserRow, body: Row) {
  const share = sharing(user);
  const books = validBooks(body.books).filter((book) => share.current && !share.hidden(book.kind));
  const sent = share.stats ? validStats(body.stats, share.wordsKnown) : null;
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
    env.DB.prepare('SELECT data, at FROM stats WHERE user = ?1')
      .bind(user.id)
      .first<{ data: string; at: number }>()
  ]);
  const stats =
    sent &&
    capRank(
      sent,
      oldStats ? JSON.parse(oldStats.data) : null,
      oldStats?.at ?? 0,
      user.created,
      time
    );
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
    ),
    ...(events.length
      ? [
          env.DB.prepare(
            `DELETE FROM events WHERE user = ?1 AND id NOT IN
               (SELECT id FROM events WHERE user = ?1 ORDER BY at DESC, id DESC LIMIT ${MAX_EVENTS})`
          ).bind(user.id)
        ]
      : [])
  ]);

  // The shared books this reader gave no thumbnail for: the app uploads the ones it has a cover of.
  const keys = [
    ...new Set([
      ...books.filter((book) => book.kind !== 'hidden').map((book) => book.key),
      ...(done && share.finished ? [done.key] : [])
    ])
  ];

  if (!keys.length) return [];

  const { results } = await env.DB.prepare(
    `SELECT book_key FROM covers WHERE user = ?1 AND book_key IN (${keys.map((_, i) => `?${i + 2}`).join(', ')})`
  )
    .bind(user.id, ...keys)
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

/** Every row of these users (accounts, sessions, friend links, status, counters), their pictures and covers */
async function deleteUsers(env: Env, where: string, ...values: unknown[]) {
  const users = `SELECT id FROM users WHERE ${where}`;
  const covers = await env.DB.prepare(`DELETE FROM covers WHERE user IN (${users}) RETURNING file`)
    .bind(...values)
    .all<{ file: string }>();

  await dropCoverFiles(
    env,
    covers.results.map((row) => row.file)
  );
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
      `DELETE FROM transfers WHERE sender IN (${users}) OR receiver IN (${users})`,
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
    env.DB.prepare('DELETE FROM limits WHERE win < ?1').bind(time - 2 * DAY),
    expireTransfers(env)
  ]);

  // Covers no current or finished book of their uploader shows any more (removed ones stay, so
  // the uploader can't put the same one back).
  const orphans = await env.DB.prepare(
    `DELETE FROM covers WHERE removed = 0
       AND NOT EXISTS (SELECT 1 FROM status s WHERE s.user = covers.user AND s.book_key = covers.book_key)
       AND NOT EXISTS (SELECT 1 FROM finished f WHERE f.user = covers.user AND f.book_key = covers.book_key)
     RETURNING file`
  ).all<{ file: string }>();

  await dropCoverFiles(
    env,
    orphans.results.map((row) => row.file)
  );
}

/** Transfers (and the network addresses in their SDP) last minutes: also run every 10 minutes. */
const expireTransfers = (env: Env) =>
  env.DB.prepare('DELETE FROM transfers WHERE created <= ?1').bind(now() - TRANSFER_TTL);

/**
 * A transfer this user is part of, while it lives and the two are still friends (checked on
 * every signaling call: removing or blocking a friend ends it). Else 404.
 */
async function transferFor(env: Env, user: string, id: string) {
  const row = await env.DB.prepare(
    `SELECT t.* FROM transfers t JOIN links l ON l.state = 'accepted'
       AND l.a = MIN(t.sender, t.receiver) AND l.b = MAX(t.sender, t.receiver)
     WHERE t.id = ?1 AND ?2 IN (t.sender, t.receiver) AND t.created > ?3`
  )
    .bind(matching(id, ID, 'transfer'), user, now() - TRANSFER_TTL)
    .first<{ id: string; sender: string; receiver: string; state: string } & Row>();

  if (!row) throw new HttpError(404, 'transfer');
  return row;
}

function sdp(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('v=0') || value.length > SDP_LENGTH) {
    throw new HttpError(400, 'sdp');
  }
  return value;
}

/** POST /v1/transfers: {to, title, kind, size}; one live transfer per pair, 20 a day. */
async function createTransfer(env: Env, user: UserRow, body: Row) {
  const to = matching(body.to, ID, 'to');
  const title = text(body.title, 200, 'title');
  const kind = body.kind === 'book' || body.kind === 'manga' ? body.kind : null;
  const size = Number(body.size);

  if (!kind) throw new HttpError(400, 'kind');
  if (!Number.isInteger(size) || size <= 0) throw new HttpError(400, 'size');
  if (size > TRANSFER_BYTES) throw new HttpError(413, 'too-big');

  const [a, b] = pair(user.id, to);
  const link = await env.DB.prepare('SELECT state FROM links WHERE a = ?1 AND b = ?2')
    .bind(a, b)
    .first<{ state: string }>();

  if (link?.state !== 'accepted') throw new HttpError(403, 'friend');
  await limit(env, user.id, 'transfer', DAY, TRANSFERS_PER_DAY);

  const id = randomHex(8);
  const time = now();
  const { meta } = await env.DB.prepare(
    `INSERT INTO transfers (id, sender, receiver, title, kind, size, state, created)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7 WHERE NOT EXISTS (
       SELECT 1 FROM transfers WHERE created > ?8
         AND ((sender = ?2 AND receiver = ?3) OR (sender = ?3 AND receiver = ?2)))`
  )
    .bind(id, user.id, to, title, kind, size, time, time - TRANSFER_TTL)
    .run();

  if (!meta.changes) throw new HttpError(409, 'busy-pair');
  await expireTransfers(env).run();
  return { id, expires: time + TRANSFER_TTL };
}

/** GET /v1/transfers: books friends are offering this reader right now */
async function incomingTransfers(env: Env, user: string) {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.title, t.kind, t.size, t.created, u.id AS uid, u.username, u.name, u.avatar,
       u.role, COALESCE(p.version, 0) AS picture
     FROM transfers t JOIN users u ON u.id = t.sender LEFT JOIN pictures p ON p.user = u.id
     JOIN links l ON l.state = 'accepted'
       AND l.a = MIN(t.sender, t.receiver) AND l.b = MAX(t.sender, t.receiver)
     WHERE t.receiver = ?1 AND t.state = 'pending' AND t.created > ?2
     ORDER BY t.created`
  )
    .bind(user, now() - TRANSFER_TTL)
    .all();

  return {
    incoming: results.map((row) => ({
      id: row.id,
      title: row.title,
      kind: row.kind,
      size: row.size,
      expires: (row.created as number) + TRANSFER_TTL,
      from: {
        id: row.uid,
        username: row.username,
        name: row.name,
        avatar: row.avatar,
        picture: row.picture,
        role: row.role
      }
    }))
  };
}

/**
 * /v1/transfers/:id[/accept|/answer]. The receiver accepts with its offer, the sender answers;
 * GET shows each side what the other sent. The sender deletes it once connected; a receiver's
 * DELETE while pending declines (kept so the sender can tell), any other DELETE removes it.
 */
async function transferRoute(request: Request, env: Env, user: UserRow, id: string, step = '') {
  const row = await transferFor(env, user.id, id);
  const sending = row.sender === user.id;
  const update = async (sql: string, ...values: unknown[]) => {
    const { meta } = await env.DB.prepare(sql)
      .bind(row.id, ...values)
      .run();

    if (!meta.changes) throw new HttpError(409, 'state');
    return json({ ok: true });
  };

  if (request.method === 'GET' && !step) {
    if (sending && row.state === 'declined') {
      await env.DB.prepare('DELETE FROM transfers WHERE id = ?1').bind(row.id).run();
    }
    return json({
      state: row.state,
      ...(sending ? { offer: row.offer ?? null } : { answer: row.answer ?? null })
    });
  }
  if (request.method === 'POST' && step === 'accept' && !sending) {
    const offer = sdp((await readBody(request)).offer);

    return update(
      `UPDATE transfers SET state = 'accepted', offer = ?2 WHERE id = ?1 AND state = 'pending'`,
      offer
    );
  }
  if (request.method === 'POST' && step === 'answer' && sending) {
    const answer = sdp((await readBody(request)).answer);

    return update(
      `UPDATE transfers SET state = 'answered', answer = ?2 WHERE id = ?1 AND state = 'accepted'`,
      answer
    );
  }
  if (request.method === 'DELETE' && !step) {
    if (!sending && row.state === 'pending') {
      return update(`UPDATE transfers SET state = 'declined' WHERE id = ?1`);
    }
    await env.DB.prepare('DELETE FROM transfers WHERE id = ?1').bind(row.id).run();
    return json({ ok: true });
  }
  throw new HttpError(404, 'route');
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

/** Drops an image from this data centre's edge cache (others keep it until it ages out). */
async function purgeImage(request: Request, path: string) {
  await edgeCache()
    ?.delete(`${new URL(request.url).origin}/v1/${path}`)
    .catch(() => false);
}

/** Open reports, one row per target and kind, with what was reported */
async function openReports(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT r.what, r.target, COUNT(*) AS n, MIN(r.at) AS first, MAX(r.at) AS last,
       u.id, u.username, u.name, u.avatar, u.role, COALESCE(p.version, 0) AS picture,
       c.file AS cover, c.removed, cu.username AS uploader,
       (SELECT title FROM finished WHERE user = c.user AND book_key = c.book_key
        UNION ALL SELECT title FROM status WHERE user = c.user AND book_key = c.book_key LIMIT 1) AS title
     FROM reports r
     LEFT JOIN users u ON r.what != 'cover' AND u.id = r.target
     LEFT JOIN pictures p ON p.user = u.id
     LEFT JOIN covers c ON r.what = 'cover' AND c.user = substr(r.target, 1, 16)
       AND c.book_key = substr(r.target, 18)
     LEFT JOIN users cu ON cu.id = c.user
     GROUP BY r.what, r.target ORDER BY n DESC, last DESC, r.what LIMIT 200`
  ).all();

  return {
    reports: results.map((row) => ({
      what: row.what,
      target: row.target,
      count: row.n,
      first: row.first,
      last: row.last,
      user: row.id
        ? {
            id: row.id,
            username: row.username,
            name: row.name,
            avatar: row.avatar,
            picture: row.picture,
            role: row.role
          }
        : null,
      cover: row.cover ?? null,
      removed: !!row.removed,
      title: row.title ?? '',
      uploader: row.uploader ?? ''
    }))
  };
}

/** Everything a moderator may need about one reader: account, current and finished books, events */
async function lookUp(env: Env, username: string) {
  const user = await userByName(env, username);

  if (!user) throw new HttpError(404, 'user');

  const rows = (sql: string) => env.DB.prepare(sql).bind(user.id).all();
  const [books, finished, events] = await Promise.all([
    rows(
      'SELECT slot, book_key, title, author, kind, pct, read_at FROM status WHERE user = ?1 ORDER BY slot'
    ),
    rows('SELECT book_key, title, kind, month, at FROM finished WHERE user = ?1 ORDER BY at DESC'),
    rows(
      'SELECT id, type, book_key, title, kind, value, at FROM events WHERE user = ?1 ORDER BY at DESC, id DESC LIMIT 100'
    )
  ]);

  return {
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      avatar: user.avatar,
      picture: user.picture,
      role: user.role,
      created: user.created,
      lastSeen: user.last_seen,
      public: sharing(user).public
    },
    books: books.results.map((row) => ({
      slot: row.slot,
      key: row.book_key,
      title: row.title,
      author: row.author,
      kind: row.kind,
      pct: row.pct,
      readAt: row.read_at
    })),
    finished: finished.results.map((row) => ({
      key: row.book_key,
      title: row.title,
      kind: row.kind,
      month: row.month,
      at: row.at
    })),
    events: events.results.map(eventJson)
  };
}

const dismiss = (env: Env, what: string, target: string) =>
  env.DB.prepare('DELETE FROM reports WHERE what = ?1 AND target = ?2').bind(what, target);

/** A user's single rows a moderator can delete: the table and the column the last path part names */
const ROWS: Record<string, [string, string]> = {
  status: ['status', 'slot'],
  finished: ['finished', 'book_key'],
  events: ['events', 'id']
};

/**
 * /v1/admin/*: moderation, for role 'dev' only (403 for everyone else). Reports, reset name,
 * remove picture or cover, dismiss, and one reader's rows.
 */
async function admin(request: Request, env: Env, viewer: UserRow, path: string) {
  if (viewer.role !== 'dev') throw new HttpError(403, 'role');

  const route = `${request.method} ${path}`;
  const query = new URL(request.url).searchParams;

  if (route === 'GET reports') return json(await openReports(env));
  if (route === 'DELETE reports') {
    const what = query.get('what');

    if (what !== 'name' && what !== 'picture' && what !== 'cover') throw new HttpError(400, 'what');
    await dismiss(env, what, text(query.get('target'), 200, 'target')).run();
    return json({ ok: true });
  }
  if (route === 'DELETE cover') {
    // One reader's upload (the report's target: uploader id and book key).
    const target = text(query.get('target'), 220, 'target');
    const { user, key } = parseCoverTarget(target);
    const cover = await env.DB.prepare('SELECT file FROM covers WHERE user = ?1 AND book_key = ?2')
      .bind(user, key)
      .first<{ file: string }>();

    if (!cover) throw new HttpError(404, 'cover');
    await env.DB.batch([
      env.DB.prepare('UPDATE covers SET removed = 1 WHERE user = ?1 AND book_key = ?2').bind(
        user,
        key
      ),
      dismiss(env, 'cover', target)
    ]);
    // Identical images share one object: kept while another upload still shows it.
    await dropCoverFiles(env, [cover.file]);
    await purgeImage(request, `cover/${cover.file}`);
    return json({ ok: true });
  }

  const lookup = /^user\/([A-Za-z0-9_]{3,20})$/.exec(path);

  if (request.method === 'GET' && lookup) return json(await lookUp(env, lookup[1]));

  const action = /^user\/([0-9a-f]{16})\/(name|picture|status|finished|events)(?:\/([^/]+))?$/.exec(
    path
  );
  const user = action && (await userById(env, action[1]));

  if (!action || !user) throw new HttpError(404, action ? 'user' : 'route');

  const [, , part, rest] = action;

  if (request.method === 'POST' && part === 'name' && !rest) {
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET name = username WHERE id = ?1').bind(user.id),
      dismiss(env, 'name', user.id)
    ]);
  } else if (request.method === 'DELETE' && part === 'picture' && !rest) {
    if (user.picture) {
      await media(env).delete(`avatar/${user.id}/${user.picture}`);
      await purgeImage(request, `avatar/${user.id}/${user.picture}`);
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM pictures WHERE user = ?1').bind(user.id),
      dismiss(env, 'picture', user.id)
    ]);
  } else if (
    request.method === 'DELETE' &&
    ROWS[part] &&
    rest &&
    (part === 'finished' || /^\d{1,12}$/.test(rest))
  ) {
    const [table, column] = ROWS[part];
    const { meta } = await env.DB.prepare(`DELETE FROM ${table} WHERE user = ?1 AND ${column} = ?2`)
      .bind(user.id, part === 'finished' ? decodeURIComponent(rest) : Number(rest))
      .run();

    if (!meta.changes) throw new HttpError(404, 'row');
  } else {
    throw new HttpError(404, 'route');
  }
  await purgeProfile(request, user.username);
  return json({ ok: true });
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
<p>Sending a book to a friend: the book goes directly from one browser to the other. The hub
only passes the connection details between the two of you (including network addresses), with the
title, kind and size, and deletes them once connected or after 10 minutes.</p>
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

  // Profiles also answer visitors without an account.
  const auth = request.headers.has('Authorization') ? await authenticate(request, env) : null;
  const profilePath = /^\/v1\/profile\/([A-Za-z0-9_]{3,20})$/.exec(pathname);

  if (request.method === 'GET' && profilePath) {
    return profileResponse(request, env, ctx, profilePath[1], auth?.user ?? null);
  }
  if (!auth) throw new HttpError(401, 'session');
  if (route === 'POST /v1/report') return report(request, env, auth.user);

  const { user, hash } = auth;
  const adminPath = /^\/v1\/admin\/(.+)$/.exec(pathname);

  if (adminPath) return admin(request, env, user, adminPath[1]);

  const transfer = /^\/v1\/transfers(?:\/([^/]+)(?:\/(accept|answer))?)?$/.exec(pathname);

  if (transfer?.[1]) return transferRoute(request, env, user, transfer[1], transfer[2]);
  if (route === 'POST /v1/transfers') {
    return json(await createTransfer(env, user, await readBody(request)));
  }
  if (route === 'GET /v1/transfers') return json(await incomingTransfers(env, user.id));

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

      // Transfers poll about once a second while one is being set up: their own, looser limit.
      const signaling = new URL(request.url).pathname.startsWith('/v1/transfers');
      const edge = await (signaling ? env.SIGNAL_LIMIT : env.EDGE_LIMIT)?.limit({
        key: clientAddress(request) || 'unknown'
      });

      if (edge && !edge.success) return json({ error: 'busy' }, 429);
      return await route(request, env, ctx);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.code }, error.status);
      console.error(error);
      return json({ error: 'server' }, 500);
    }
  },
  async scheduled(event: { cron?: string }, env: Env) {
    if (event?.cron === TRANSFER_CRON) {
      await expireTransfers(env).run();
      return;
    }
    await cleanUp(env);
  }
};
