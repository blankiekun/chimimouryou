/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Discord status relay: a reader's other devices PUT their rendered activity, the Anki add-on on
 * their computer reads it back with a presence key (`pk_…`). Keys and pairing codes are stored as
 * sha256 only and found by that hash (no secret is compared in code). A presence key reads
 * GET presence/current and nothing else: keys live in their own table, never in sessions.
 */

import {
  HttpError,
  cors,
  displayName,
  ipSubject,
  json,
  normalizeCode,
  now,
  randomCode,
  randomHex,
  randomToken,
  readBody,
  sha256,
  type Env,
  type Row,
  type UserRow
} from './hub';
import { DAY, HOUR, MINUTE } from './time';

/** A status shows this long after its last update */
export const PRESENCE_TTL = 5 * MINUTE;
/** Seconds between two PUT presence */
export const PRESENCE_GAP = 20;
export const CODE_TTL = 10 * MINUTE;
const MAX_KEYS = 10;
const MAX_CODES = 5;
/** Wrong or expired pairing codes an hour per address */
export const MAX_PAIR_FAILURES = 10;
/** last_seen is a daily write at most (the add-on polls every 30 s) */
const SEEN_EVERY = DAY;
/** An unchanged PUT presence is written only once less than this is left of PRESENCE_TTL */
const REFRESH_LEFT = 2 * MINUTE;
/** Expired rows keep only their times for this long, so `next` can slow an idle add-on down */
const IDLE_KEPT = HOUR;
const ACTIVITY_BYTES = 4096;
const KINDS = ['book', 'manga', 'vn', 'idle'];
const ASSET_KEY = /^[A-Za-z0-9_-]{1,256}$/;
const MAX_TIMESTAMP = 2 ** 53;

/** What a password change, logout-all or deletion revokes (binds ?1 = the user id) */
export const revokePresenceSql = [
  'DELETE FROM presence_keys WHERE user = ?1',
  'DELETE FROM presence_codes WHERE user = ?1',
  'DELETE FROM presence WHERE user = ?1'
];

/** The add-on's wait hint: 30 s while a status was seen in the last 10 minutes, 2 min within the hour, else 5 */
export function nextPoll(updatedAt: number | undefined, time: number) {
  if (updatedAt === undefined) return 300;
  return updatedAt > time - 10 * MINUTE ? 30 : updatedAt > time - HOUR ? 120 : 300;
}

// The activity goes once expired; the row (times only) an hour later.
export const expirePresenceSql = (env: Env) => [
  env.DB.prepare(
    `UPDATE presence SET activity = '{}', kind = '' WHERE expires_at <= ?1 AND kind != ''`
  ).bind(now()),
  env.DB.prepare('DELETE FROM presence WHERE updated_at <= ?1').bind(now() - IDLE_KEPT),
  env.DB.prepare('DELETE FROM presence_codes WHERE expires_at <= ?1').bind(now())
];

const empty = (headers: Record<string, string> = {}) =>
  new Response(null, { status: 204, headers: { ...cors, ...headers } });

// The Anki add-on's activity.py clean(), field for field: the same limits, unknown fields dropped.
function clampText(value: unknown, max = 128, min = 2) {
  if (typeof value !== 'string') return undefined;

  let chars = [...value.split(/\s+/).filter(Boolean).join(' ')];

  if (chars.length > max) chars = [...chars.slice(0, max - 1), '…'];
  return chars.length >= min ? chars.join('') : undefined;
}

function clampUrl(value: unknown, max = 256) {
  if (typeof value !== 'string' || value.length > max) return undefined;

  const url = value.trim();

  return /^https:\/\/\S+$/i.test(url) ? url : undefined;
}

const clampImage = (value: unknown) =>
  typeof value === 'string' && ASSET_KEY.test(value) ? value : clampUrl(value);

function clampInt(value: unknown, low: number, high: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;

  const n = Math.trunc(value);

  return n >= low && n <= high ? n : undefined;
}

export function cleanActivity(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'activity');

  const input = raw as Row;
  const out: Row = {};
  const put = (target: Row, key: string, value: unknown) => {
    if (value !== undefined) target[key] = value;
  };

  ['name', 'details', 'state'].forEach((key) => put(out, key, clampText(input[key])));
  ['details_url', 'state_url'].forEach((key) => put(out, key, clampUrl(input[key])));

  if (input.assets && typeof input.assets === 'object') {
    const assets = input.assets as Row;
    const clean: Row = {};

    ['large', 'small'].forEach((size) => {
      const image = clampImage(assets[`${size}_image`]);

      if (image) {
        clean[`${size}_image`] = image;
        put(clean, `${size}_text`, clampText(assets[`${size}_text`]));
      }
    });
    if (Object.keys(clean).length) out.assets = clean;
  }
  if (input.timestamps && typeof input.timestamps === 'object') {
    const times = input.timestamps as Row;
    const clean: Record<string, number> = {};

    ['start', 'end'].forEach((key) => {
      const value = clampInt(times[key], 1, MAX_TIMESTAMP);

      if (value) clean[key] = value;
    });
    if (clean.start && clean.end && clean.end < clean.start) delete clean.end;
    if (Object.keys(clean).length) out.timestamps = clean;
  }

  const size = (input.party as Row | undefined)?.size;

  if (Array.isArray(size) && size.length === 2) {
    const [current, maximum] = size.map((n) => clampInt(n, 1, 2 ** 31));

    if (current && maximum && current <= maximum) out.party = { size: [current, maximum] };
  }
  if (Array.isArray(input.buttons)) {
    const buttons = input.buttons
      .slice(0, 2)
      .filter((button) => button && typeof button === 'object')
      .map((button: Row) => ({
        label: clampText(button.label, 32, 1),
        url: clampUrl(button.url, 512)
      }))
      .filter((button) => button.label && button.url);

    if (buttons.length) out.buttons = buttons;
  }
  if (!out.name && !out.details && !out.state) throw new HttpError(400, 'activity');
  return out;
}

/** A new key for this user (at most MAX_KEYS), shown once; only its hash is kept */
async function newKey(env: Env, user: string, name: string) {
  const id = randomHex(8);
  const key = `pk_${randomToken()}`;
  const time = now();
  const { meta } = await env.DB.prepare(
    `INSERT INTO presence_keys (id, user, key_hash, name, created_at, last_seen)
     SELECT ?1, ?2, ?3, ?4, ?5, 0 WHERE (SELECT COUNT(*) FROM presence_keys WHERE user = ?2) < ?6`
  )
    .bind(id, user, await sha256(key), name, time, MAX_KEYS)
    .run();

  if (!meta.changes) throw new HttpError(409, 'keys');
  return { id, key };
}

/**
 * POST /v1/presence/pair {code, name}, without a session (the add-on calls it). A wrong or expired
 * code counts towards MAX_PAIR_FAILURES per hashed address and hour; a code works once.
 */
export async function pairPresence(request: Request, env: Env) {
  const body = await readBody(request);
  const subject = await ipSubject(request);
  const win = Math.floor(now() / HOUR) * HOUR;
  const failed = await env.DB.prepare(
    `SELECT count FROM limits WHERE subject = ?1 AND action = 'pair-fail' AND win = ?2`
  )
    .bind(subject, win)
    .first<{ count: number }>();

  if ((failed?.count ?? 0) >= MAX_PAIR_FAILURES) throw new HttpError(429, 'locked');

  const name = displayName(body.name);
  const code = normalizeCode(typeof body.code === 'string' ? body.code.slice(0, 40) : '');
  const row = /^[0-9A-Z]{9}$/.test(code)
    ? await env.DB.prepare(
        'DELETE FROM presence_codes WHERE code_hash = ?1 RETURNING user, expires_at'
      )
        .bind(await sha256(code))
        .first<{ user: string; expires_at: number }>()
    : null;

  if (!row || row.expires_at <= now()) {
    await env.DB.prepare(
      `INSERT INTO limits (subject, action, win, count) VALUES (?1, 'pair-fail', ?2, 1)
       ON CONFLICT (subject, action, win) DO UPDATE SET count = count + 1`
    )
      .bind(subject, win)
      .run();
    throw new HttpError(404, 'code');
  }
  return json(await newKey(env, row.user, name));
}

/** GET /v1/presence/current with `Authorization: Bearer pk_…`: the key owner's live status */
export async function currentPresence(request: Request, env: Env) {
  const match = /^Bearer (pk_[A-Za-z0-9_-]{43})$/.exec(request.headers.get('Authorization') ?? '');

  const revoked = () =>
    new Response(JSON.stringify({ error: 'key' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Next': '300' }
    });

  if (!match) return revoked();

  const hash = await sha256(match[1]);
  const key = await env.DB.prepare('SELECT user, last_seen FROM presence_keys WHERE key_hash = ?1')
    .bind(hash)
    .first<{ user: string; last_seen: number }>();
  const time = now();

  if (!key) return revoked();
  if (key.last_seen < time - SEEN_EVERY) {
    await env.DB.prepare('UPDATE presence_keys SET last_seen = ?1 WHERE key_hash = ?2')
      .bind(time, hash)
      .run();
  }

  const row = await env.DB.prepare(
    'SELECT activity, kind, updated_at, expires_at FROM presence WHERE user = ?1'
  )
    .bind(key.user)
    .first<{ activity: string; kind: string; updated_at: number; expires_at: number }>();
  const next = nextPoll(row?.updated_at, time);

  if (!row || row.expires_at <= time || !row.kind) {
    return empty({ 'Cache-Control': 'no-store', 'X-Next': String(next) });
  }

  const response = json({
    activity: JSON.parse(row.activity),
    kind: row.kind,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    next
  });

  response.headers.set('Cache-Control', 'no-store');
  return response;
}

/** The status a profile shows its owner and friends, when they turned "Show on my profile" on */
export async function profilePresence(env: Env, user: UserRow) {
  if (!user.presence_profile) return null;

  const row = await env.DB.prepare(
    `SELECT activity, updated_at FROM presence WHERE user = ?1 AND expires_at > ?2 AND kind != ''`
  )
    .bind(user.id, now())
    .first<{ activity: string; updated_at: number }>();

  return row && { activity: JSON.parse(row.activity), updatedAt: row.updated_at };
}

/** /v1/presence[/keys[/:id]|/codes] with a session */
export async function presenceRoute(request: Request, env: Env, user: UserRow, path: string) {
  const route = `${request.method} ${path}`;

  if (route === 'PUT ') {
    const body = await readBody(request);
    const kind = body.kind as string;

    if (!KINDS.includes(kind)) throw new HttpError(400, 'kind');

    const activity = JSON.stringify(cleanActivity(body.activity));

    if (new TextEncoder().encode(activity).length > ACTIVITY_BYTES) {
      throw new HttpError(413, 'size');
    }

    const time = now();
    const old = await env.DB.prepare(
      'SELECT activity, kind, expires_at FROM presence WHERE user = ?1'
    )
      .bind(user.id)
      .first<{ activity: string; kind: string; expires_at: number }>();

    // A keep-alive with nothing new: no D1 write until the status is near its end.
    if (old?.activity === activity && old.kind === kind && old.expires_at > time + REFRESH_LEFT) {
      return empty();
    }

    const { meta } = await env.DB.prepare(
      `INSERT INTO presence (user, activity, kind, updated_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (user) DO UPDATE SET activity = ?2, kind = ?3, updated_at = ?4, expires_at = ?5
       WHERE presence.updated_at <= ?4 - ?6`
    )
      .bind(user.id, activity, kind, time, time + PRESENCE_TTL, PRESENCE_GAP)
      .run();

    if (!meta.changes) throw new HttpError(429, 'soon');
    return empty();
  }
  if (route === 'DELETE ') {
    // Ended now; its times stay (for the add-on's wait hint) until the cron drops the row.
    await env.DB.prepare(
      `UPDATE presence SET activity = '{}', kind = '', expires_at = ?2 WHERE user = ?1`
    )
      .bind(user.id, now())
      .run();
    return empty();
  }
  if (route === 'POST keys') {
    return json(await newKey(env, user.id, displayName((await readBody(request)).name)));
  }
  if (route === 'GET keys') {
    const { results } = await env.DB.prepare(
      'SELECT id, name, created_at, last_seen FROM presence_keys WHERE user = ?1 ORDER BY created_at'
    )
      .bind(user.id)
      .all();

    return json(
      results.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        lastSeen: row.last_seen
      }))
    );
  }

  const keyPath = /^keys\/([0-9a-f]{16})$/.exec(path);

  if (request.method === 'DELETE' && keyPath) {
    await env.DB.prepare('DELETE FROM presence_keys WHERE id = ?1 AND user = ?2')
      .bind(keyPath[1], user.id)
      .run();
    return empty();
  }
  if (route === 'POST codes') {
    const code = randomCode(9);
    const time = now();
    const { meta } = await env.DB.prepare(
      `INSERT INTO presence_codes (code_hash, user, expires_at)
       SELECT ?1, ?2, ?3 WHERE (SELECT COUNT(*) FROM presence_codes WHERE user = ?2 AND expires_at > ?4) < ?5`
    )
      .bind(await sha256(code), user.id, time + CODE_TTL, time, MAX_CODES)
      .run();

    if (!meta.changes) throw new HttpError(429, 'codes');
    return json({
      code: `${code.slice(0, 3)}-${code.slice(3, 6)}-${code.slice(6)}`,
      expiresAt: time + CODE_TTL
    });
  }
  throw new HttpError(404, 'route');
}
