/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Community: posts on a line of a book (/v1/community/*, README → Community). A thread is the
 * posts on one line of one work: the work key (an AniList id and volume, a VNDB id, or the book's
 * own title key) and the line's hash (sha256 of `normalizeLine`, `#n` added for a repeated line's
 * copy n, 32 hex; the client hashes the same way, test/line-hashes.json). A post is anything about the line (a question, a comment, a
 * quote worth sharing), optionally marked as a spoiler; replies answer it. Works carry a title,
 * volume and one cover thumbnail. Everything here needs a session. The client is
 * apps/web/src/lib/data/community.ts.
 *
 * Book text the hub keeps: each line's first post stores the line (<= 300 characters, shown in
 * the feed) and, for the first CONTEXTS_PER_WORK lines of a work, its page (<= 600 characters,
 * shown only in the thread, which needs the line's full hash). One account keeps at most
 * ROOTS_PER_WORK posts on a work.
 */

import {
  COVER_BYTES,
  HttpError,
  ID,
  IMMUTABLE,
  edgeCache,
  ipSubject,
  json,
  limit,
  matching,
  media,
  mediaRoom,
  now,
  purgeImage,
  randomHex,
  readBody,
  readImage,
  sha256,
  take,
  takeUpload,
  type Context,
  type Env,
  type Row,
  type UserRow
} from './hub';
import { DAY, HOUR, MINUTE } from './time';

/** Accounts younger than this post less, upload no covers and post no URLs */
export const NEW_ACCOUNT = 3 * DAY;
/** Helpful marks and work-key confirmations count only from accounts at least this old */
export const AGED = 7 * DAY;
/** A line needs this many characters once normalised (shorter lines repeat all over a book) */
export const MIN_LINE = 6;
export const QUOTE_LENGTH = 300;
export const CONTEXT_LENGTH = 600;
export const BODY_LENGTH = 1000;
export const TITLE_LENGTH = 200;
const BODY_LINES = 20;
/** Top-level posts one account may keep on one work: bounds the book text it can store */
export const ROOTS_PER_WORK = 30;
/** Lines of one work that keep their page of context (6,000 characters at most, under a chapter: the owner allows no whole chapter) */
export const CONTEXTS_PER_WORK = 10;
export const THREAD_POSTS = 200;
/** Posts an hour and a day per account (new accounts apart), a day per address and hub-wide */
export const POST_LIMITS = { hour: 10, day: 50, newHour: 3, newDay: 10, address: 100, hub: 10_000 };
/** Open reports from this many readers take a post out of the feed until a moderator decides */
export const FEED_REPORTS = 3;
const PAGE = 1000;
const FEED_PAGE = 30;

const WORK =
  /^(?:anilist:[1-9]\d{0,8}(?:\/\d{1,4}(?:\.\d{1,2})?)?|vndb:v[1-9]\d{0,8}|title:[\p{L}\p{N}]{1,100})$/u;
const BOOK = /^[\p{L}\p{N}]{1,100}$/u;
const VOL = /^(?:\d{1,4}(?:\.\d{1,2})?)?$/;
const LINE = /^[0-9a-f]{32}$/;
const AFTER = /^(?:[0-9a-f]{8}|[0-9a-f]{32})$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;
/** Direction overrides, isolates and marks: they reorder what readers see */
const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
/** Zalgo: three or more combining marks in a row */
const STACKED = /\p{M}{3,}/u;
const INVISIBLE = /[\u00ad\u200b\u2060\ufeff]/g;

/**
 * The line as two editions of a book share it: ruby (Aozora 《》 and ｜) dropped, NFKC (width,
 * compatibility forms), lower case, and every whitespace, punctuation, symbol and format character
 * removed. The app's copy (community.ts) must stay identical.
 */
export function normalizeLine(line: string) {
  return line
    .replace(/《[^》]*》|｜/g, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}\p{Cf}]/gu, '');
}

/** A line the book repeats has a thread per copy: copy n > 1 hashes the line with `#n` after it */
export async function lineHash(line: string, occurrence = 1) {
  const normal = normalizeLine(line);

  return (await sha256(occurrence > 1 ? `${normal}#${occurrence}` : normal)).slice(0, 32);
}

/**
 * Plain text from a reader: NFC, line breaks only as \n (none when `single`), at most 2 in a row
 * and BODY_LINES in all; no control, direction or stacked combining characters; at most `max`
 * characters and 3 bytes a character on average.
 */
export function plain(value: unknown, max: number, code: string, single = false) {
  if (typeof value !== 'string') throw new HttpError(400, code);

  let text = value
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(INVISIBLE, '')
    .normalize('NFC');

  text = single
    ? text.replace(/\s+/g, ' ')
    : text.replace(/[ \u3000]+$/gm, '').replace(/\n{3,}/g, '\n\n');
  text = text.trim();
  if (
    !text ||
    [...text].length > max ||
    new TextEncoder().encode(text).length > max * 3 ||
    text.split('\n').length > BODY_LINES ||
    CONTROL.test(text) ||
    BIDI.test(text) ||
    STACKED.test(text)
  ) {
    throw new HttpError(400, code);
  }
  return text;
}

/** Hides rows of `column`'s author from `viewer` (a bound parameter) when either blocked the other */
const unblocked = (column: string, viewer: string) =>
  `NOT EXISTS (SELECT 1 FROM links l WHERE l.state = 'blocked'
     AND l.a = min(${column}, ${viewer}) AND l.b = max(${column}, ${viewer}))`;

/** Posts FEED_REPORTS readers past their first days reported wait for a moderator */
const unreported = () => `(SELECT COUNT(*) FROM reports r JOIN users ru ON ru.id = r.reporter
  WHERE r.what = 'post' AND r.target = p.id AND ru.created <= ${now() - NEW_ACCOUNT}) < ${FEED_REPORTS}`;

const authorColumns = `u.id AS uid, u.username, u.name, u.avatar, u.role, u.share,
  COALESCE(pi.version, 0) AS picture, st.data AS stats`;
const authorJoins = (column: string) => `LEFT JOIN users u ON u.id = ${column}
  LEFT JOIN pictures pi ON pi.user = u.id LEFT JOIN stats st ON st.user = u.id`;

/** The line of a thread as its first post keeps it (later posts on the line keep none) */
const threadQuote = (alias: string) =>
  `COALESCE(NULLIF(${alias}.quote, ''), (SELECT q.quote FROM posts q WHERE q.work = ${alias}.work
     AND q.line = ${alias}.line AND q.quote != '' LIMIT 1), '')`;

/**
 * The author as people show everywhere, plus their level (reading rank, words known) when they
 * share stats on a public profile: a post never says how far its author has read.
 */
function author(row: Row) {
  if (!row.uid) return null;

  const share = JSON.parse((row.share as string) || '{}') as Record<string, boolean>;
  const stats = row.stats && share.public !== false ? JSON.parse(row.stats as string) : null;

  return {
    id: row.uid,
    username: row.username,
    name: row.name,
    avatar: row.avatar,
    picture: row.picture,
    role: row.role,
    level: stats ? { rank: stats.rank ?? null, wordsKnown: stats.wordsKnown ?? null } : null
  };
}

function postJson(row: Row, viewer: string) {
  return {
    id: row.id,
    parent: row.parent || null,
    body: row.body,
    spoiler: !!row.spoiler,
    at: row.at,
    edited: row.edited || null,
    helpful: row.helpful ?? 0,
    voted: !!row.voted,
    mine: row.uid === viewer,
    author: author(row)
  };
}

const workJson = (row: Row | null) => ({
  title: row?.title ?? '',
  vol: row?.vol ?? '',
  cover: row?.cover || null
});

/** A post the viewer may see (not by someone either side blocked), else 404 */
async function visiblePost(env: Env, id: unknown, viewer: string) {
  const row = await env.DB.prepare(
    `SELECT p.* FROM posts p WHERE p.id = ?1 AND ${unblocked('p.user', '?2')}`
  )
    .bind(matching(id, ID, 'post'), viewer)
    .first<{ id: string; work: string; line: string; parent: string; user: string }>();

  if (!row) throw new HttpError(404, 'post');
  return row;
}

/**
 * Deletes the posts `where` selects, with their helpful marks and reports. A top-level post with
 * replies stays as an empty tombstone (user '', body '') so the answers keep their post;
 * tombstones go once their last reply does.
 */
export function deletePostsSql(where: string) {
  const posts = `SELECT id FROM posts WHERE ${where}`;

  // Each statement uses `where`'s parameters (D1 refuses unused bindings).
  return [
    // A line's quote and context move to its oldest remaining post when their post goes for good
    `UPDATE posts SET
       quote = (SELECT d.quote FROM posts d WHERE d.work = posts.work AND d.line = posts.line
         AND d.quote != '' AND d.id IN (${posts})),
       context = (SELECT d.context FROM posts d WHERE d.work = posts.work AND d.line = posts.line
         AND d.quote != '' AND d.id IN (${posts}))
     WHERE quote = '' AND id = (SELECT o.id FROM posts o WHERE o.work = posts.work
         AND o.line = posts.line AND o.user != '' AND o.id NOT IN (${posts}) ORDER BY o.at, o.id LIMIT 1)
       AND EXISTS (SELECT 1 FROM posts d WHERE d.work = posts.work AND d.line = posts.line
         AND d.quote != '' AND d.id IN (${posts})
         AND NOT EXISTS (SELECT 1 FROM posts k WHERE k.parent = d.id AND k.id NOT IN (${posts})))`,
    `DELETE FROM helpful WHERE post IN (${posts})`,
    `DELETE FROM reports WHERE what = 'post' AND target IN (${posts})`,
    // Tombstones whose remaining replies all go now
    `DELETE FROM posts WHERE user = '' AND id IN (SELECT parent FROM posts WHERE ${where})
       AND NOT EXISTS (SELECT 1 FROM posts r WHERE r.parent = posts.id AND r.id NOT IN (${posts}))`,
    `DELETE FROM posts WHERE parent != '' AND id IN (${posts})`,
    `DELETE FROM posts WHERE id IN (${posts})
       AND NOT EXISTS (SELECT 1 FROM posts r WHERE r.parent = posts.id)`,
    `UPDATE posts SET user = '', body = '', edited = 0, spoiler = 0 WHERE id IN (${posts})`
  ];
}

const deletePosts = (env: Env, where: string, ...values: unknown[]) =>
  env.DB.batch(deletePostsSql(where).map((sql) => env.DB.prepare(sql).bind(...values)));

/** Account deletion: their posts (as above), helpful marks and confirmations; covers they gave stay */
export const deleteUserCommunitySql = (users: string) => [
  `DELETE FROM helpful WHERE user IN (${users})`,
  `DELETE FROM work_votes WHERE user IN (${users})`,
  `UPDATE works SET cover_user = '' WHERE cover_user IN (${users})`,
  `UPDATE works SET cover_ban = '' WHERE cover_ban IN (${users})`,
  ...deletePostsSql(`user IN (${users})`)
];

/** Deletes R2 objects of these work covers that no work uses any more */
async function dropWorkFiles(env: Env, files: string[]) {
  for (const file of new Set(files.filter(Boolean))) {
    const used = await env.DB.prepare('SELECT 1 FROM works WHERE cover = ?1').bind(file).first();

    if (!used) await media(env).delete(`work/${file}`);
  }
}

/** The daily cron: works no post is on any more go, with their covers */
export async function dropUnusedWorks(env: Env) {
  const { results } = await env.DB.prepare(
    `DELETE FROM works WHERE NOT EXISTS (SELECT 1 FROM posts p WHERE p.work = works.work)
     RETURNING cover`
  ).all<{ cover: string }>();

  if (results.some((row) => row.cover)) {
    await dropWorkFiles(
      env,
      results.map((row) => row.cover)
    );
  }
}

/**
 * GET threads?work=&after=: the lines of a work with posts, as 8-hex prefixes of their hash, with
 * post counts and whether any is a spoiler, 1,000 a page; `next` is the last line's full hash
 * (an 8-hex `after` from older clients still works). Positions are the client's to check.
 */
async function threads(request: Request, env: Env, user: UserRow | null, query: URLSearchParams) {
  const viewer = user?.id ?? '';

  const work = matching(query.get('work'), WORK, 'work');
  const after = query.get('after');

  if (after !== null) matching(after, AFTER, 'after');
  await limit(env, user?.id ?? (await ipSubject(request)), 'threads', DAY, 300);

  const { results } = await env.DB.prepare(
    `SELECT p.line, substr(p.line, 1, 8) AS p, COUNT(*) AS n, MAX(p.spoiler) AS s FROM posts p
     WHERE p.work = ?1 AND p.line > ?2 AND p.user != '' AND ${unblocked('p.user', '?3')}
     GROUP BY p.line ORDER BY p.line LIMIT ${PAGE}`
  )
    // An old 8-hex cursor: past every line that starts with it ('g' sorts after the hex digits).
    .bind(work, after?.length === 8 ? `${after}g` : (after ?? ''), viewer)
    .all<{ line: string; p: string; n: number; s: number }>();

  return {
    threads: results.map((row) => ({ prefix: row.p, posts: row.n, spoiler: !!row.s })),
    next: results.length === PAGE ? results[PAGE - 1].line : null
  };
}

/** GET thread?work=&line=<32 hex>: the work, the line, its context and its posts, oldest first */
async function thread(request: Request, env: Env, user: UserRow | null, query: URLSearchParams) {
  const viewer = user?.id ?? '';

  const work = matching(query.get('work'), WORK, 'work');
  const line = matching(query.get('line'), LINE, 'line');

  await limit(env, user?.id ?? (await ipSubject(request)), 'thread', DAY, 1000);

  const [{ results }, info, first] = await Promise.all([
    env.DB.prepare(
      `SELECT p.id, p.parent, p.body, p.spoiler, p.quote, p.context, p.at, p.edited, p.in_feed,
         (SELECT COUNT(*) FROM helpful h JOIN users hu ON hu.id = h.user
          WHERE h.post = p.id AND hu.created <= ?4) AS helpful,
         EXISTS (SELECT 1 FROM helpful h WHERE h.post = p.id AND h.user = ?3) AS voted,
         ${authorColumns}
       FROM posts p ${authorJoins('p.user')}
       WHERE p.work = ?1 AND p.line = ?2 AND ${unblocked('p.user', '?3')} AND ${unreported()}
       ORDER BY p.at, p.id LIMIT ${THREAD_POSTS}`
    )
      .bind(work, line, viewer, now() - AGED)
      .all(),
    env.DB.prepare('SELECT title, vol, cover FROM works WHERE work = ?1').bind(work).first(),
    // The line even when the post that keeps it is hidden
    env.DB.prepare(
      `SELECT quote, context FROM posts WHERE work = ?1 AND line = ?2 AND quote != '' LIMIT 1`
    )
      .bind(work, line)
      .first<{ quote: string; context: string }>()
  ]);

  return {
    work,
    ...workJson(info),
    line,
    quote: first?.quote ?? '',
    context: first?.context ?? '',
    // inFeed: false for "This line only" posts (the app lists them apart from feed posts)
    posts: results.map((row) => ({ ...postJson(row, viewer), inFeed: !!row.in_feed }))
  };
}

/**
 * GET feed?before=<at>:<id>: top-level posts of every work, newest first, 30 a page, with the
 * work's title, volume and cover, the line and the spoiler mark (the app blurs those until the
 * reader is past the line). Posts FEED_REPORTS readers reported wait for a moderator; posts made
 * for their line only (`in_feed` 0) stay out.
 */
async function feed(request: Request, env: Env, user: UserRow | null, query: URLSearchParams) {
  const viewer = user?.id ?? '';

  const before = /^(\d{1,12}):([0-9a-f]{16})$/.exec(query.get('before') ?? '');

  if (query.has('before') && !before) throw new HttpError(400, 'before');
  await limit(env, user?.id ?? (await ipSubject(request)), 'feed', DAY, 500);

  const { results } = await env.DB.prepare(
    `SELECT p.id, p.work, p.line, p.body, p.spoiler, p.at, p.edited, ${threadQuote('p')} AS quote,
       (SELECT COUNT(*) FROM posts r WHERE r.parent = p.id) AS replies,
       w.title, w.vol, w.cover, ${authorColumns}
     FROM posts p LEFT JOIN works w ON w.work = p.work ${authorJoins('p.user')}
     WHERE p.parent = '' AND p.user != '' AND p.in_feed = 1 AND (p.at < ?2 OR (p.at = ?2 AND p.id < ?3))
       AND ${unblocked('p.user', '?1')}
       AND ${unreported()}
     ORDER BY p.at DESC, p.id DESC LIMIT ${FEED_PAGE}`
  )
    .bind(viewer, before ? Number(before[1]) : 2 ** 40, before ? before[2] : 'g')
    .all();
  const last = results[results.length - 1];

  return {
    posts: results.map((row) => ({
      ...postJson(row, viewer),
      work: row.work,
      line: row.line,
      quote: row.quote,
      replies: row.replies,
      ...workJson(row)
    })),
    next: results.length === FEED_PAGE ? `${last.at}:${last.id}` : null
  };
}

/** Links in posts from accounts still in their first days: the usual spam */
function checkLinks(user: UserRow, body: string) {
  if (now() - user.created < NEW_ACCOUNT && /:\/\/|www\.|\.(?:com|net|org|io|gg)\b/i.test(body)) {
    throw new HttpError(403, 'links');
  }
}

/** The volume a work key names (AniList), else the one the poster gave (title keys) */
function workVolume(work: string, given: unknown) {
  if (work.startsWith('anilist:')) return work.split('/')[1] ?? '';
  return work.startsWith('title:') ? matching(given ?? '', VOL, 'vol') : '';
}

/**
 * POST posts: `{work, title, vol, quote, context, body, spoiler, feed?, occurrence?}` posts on a
 * line (`feed: false`: in the line's thread only, not the feed; `occurrence`: which copy of a line
 * the book repeats, 1 by default) (the hub hashes
 * the quote, and the context must contain it; the first post on a work names it: title first
 * wins, moderators reset it); `{parent, body, spoiler}` replies to a top-level post. Only a line's
 * first post keeps its quote and context, and only on the work's first CONTEXTS_PER_WORK lines.
 */
async function createPost(request: Request, env: Env, user: UserRow) {
  const body = await readBody(request);
  const text = plain(body.body, BODY_LENGTH, 'body');
  const spoiler = body.spoiler === true ? 1 : 0;
  const reply = body.parent !== undefined;
  // "This line only": the post stays in its line's thread, out of the feed (replies never show there)
  const inFeed = reply || body.feed !== false ? 1 : 0;
  let work: string;
  let line: string;
  let parent = '';
  let quote = '';
  let context = '';
  let title = '';
  let vol = '';

  checkLinks(user, text);
  if (reply) {
    const root = await visiblePost(env, body.parent, user.id);

    if (root.parent) throw new HttpError(400, 'parent');
    ({ work, line } = root);
    parent = root.id;
  } else {
    work = matching(body.work, WORK, 'work');
    title = plain(body.title, TITLE_LENGTH, 'title', true);
    vol = workVolume(work, body.vol);
    quote = plain(body.quote, QUOTE_LENGTH, 'quote', true);
    context = plain(body.context, CONTEXT_LENGTH, 'context');

    const normal = normalizeLine(quote);

    if ([...normal].length < MIN_LINE) throw new HttpError(400, 'line');
    if (!normalizeLine(context).includes(normal)) throw new HttpError(400, 'context');
    const occurrence = body.occurrence ?? 1;

    if (
      typeof occurrence !== 'number' ||
      !Number.isInteger(occurrence) ||
      occurrence < 1 ||
      occurrence > 9999
    ) {
      throw new HttpError(400, 'occurrence');
    }
    line = await lineHash(quote, occurrence);
  }

  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM posts WHERE work = ?1 AND line = ?2) AS thread,
       (SELECT COUNT(*) FROM posts WHERE user = ?3 AND work = ?1 AND parent = '') AS roots,
       EXISTS (SELECT 1 FROM posts WHERE work = ?1 AND line = ?2 AND quote != '') AS quoted,
       (SELECT COUNT(*) FROM posts WHERE work = ?1 AND context != '') AS contexts`
  )
    .bind(work, line, user.id)
    .first<{ thread: number; roots: number; quoted: number; contexts: number }>();

  if ((counts?.thread ?? 0) >= THREAD_POSTS) throw new HttpError(409, 'full');
  if (!reply && (counts?.roots ?? 0) >= ROOTS_PER_WORK) throw new HttpError(429, 'work');

  const fresh = now() - user.created < NEW_ACCOUNT;

  await limit(env, user.id, 'post', HOUR, fresh ? POST_LIMITS.newHour : POST_LIMITS.hour);
  await limit(env, user.id, 'post-day', DAY, fresh ? POST_LIMITS.newDay : POST_LIMITS.day);
  await limit(env, await ipSubject(request), 'post', DAY, POST_LIMITS.address);
  if (!(await take(env, '*', 'post', DAY, POST_LIMITS.hub))) throw new HttpError(503, 'paused');
  if (counts?.quoted) quote = context = '';
  if ((counts?.contexts ?? 0) >= CONTEXTS_PER_WORK) context = '';

  const id = randomHex(8);
  const time = now();

  await env.DB.batch([
    ...(reply
      ? []
      : [
          env.DB.prepare(
            `INSERT INTO works (work, title, vol, at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (work) DO UPDATE SET title = ?2 WHERE works.title = ''`
          ).bind(work, title, vol, time)
        ]),
    env.DB.prepare(
      `INSERT INTO posts (id, work, line, parent, user, kind, body, spoiler, quote, context, at, in_feed)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
    ).bind(
      id,
      work,
      line,
      parent,
      user.id,
      reply ? 'reply' : 'post',
      text,
      spoiler,
      quote,
      context,
      time,
      inFeed
    )
  ]);

  const info = await env.DB.prepare('SELECT title, vol, cover FROM works WHERE work = ?1')
    .bind(work)
    .first();

  return json({
    id,
    work,
    line,
    parent: parent || null,
    body: text,
    spoiler: !!spoiler,
    at: time,
    ...workJson(info)
  });
}

/** /v1/community/posts/:id[/helpful]: edit or delete one's own post, mark replies helpful */
async function postRoute(request: Request, env: Env, user: UserRow, id: string, step?: string) {
  if (step === 'helpful') {
    const post = await visiblePost(env, id, user.id);

    if (!post.user) throw new HttpError(404, 'post');
    if (!post.parent) throw new HttpError(400, 'reply');
    if (post.user === user.id) throw new HttpError(400, 'own');
    if (request.method === 'POST') {
      await limit(env, user.id, 'helpful', DAY, 100);
      await env.DB.prepare('INSERT OR IGNORE INTO helpful (post, user, at) VALUES (?1, ?2, ?3)')
        .bind(post.id, user.id, now())
        .run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM helpful WHERE post = ?1 AND user = ?2')
        .bind(post.id, user.id)
        .run();
      return json({ ok: true });
    }
    throw new HttpError(404, 'route');
  }
  if (step) throw new HttpError(404, 'route');

  matching(id, ID, 'post');
  if (request.method === 'PUT') {
    const body = await readBody(request);
    const text = plain(body.body, BODY_LENGTH, 'body');

    checkLinks(user, text);
    await limit(env, user.id, 'edit', DAY, 30);

    const { meta } = await env.DB.prepare(
      'UPDATE posts SET body = ?1, spoiler = ?2, edited = ?3 WHERE id = ?4 AND user = ?5'
    )
      .bind(text, body.spoiler === true ? 1 : 0, now(), id, user.id)
      .run();

    if (!meta.changes) throw new HttpError(404, 'post');
    return json({ ok: true });
  }
  if (request.method === 'DELETE') {
    const own = await env.DB.prepare('SELECT 1 FROM posts WHERE id = ?1 AND user = ?2')
      .bind(id, user.id)
      .first();

    if (!own) throw new HttpError(404, 'post');
    await deletePosts(env, 'id = ?1', id);
    return json({ ok: true });
  }
  throw new HttpError(404, 'route');
}

/**
 * PUT cover?work=: the work's one cover thumbnail (raw WebP like the book covers: at most 20 KB,
 * 32-200 px wide, no EXIF/XMP), from a reader with a post on the work and an account past its
 * first days, not the one whose cover for it a moderator removed; a second one is 409. Counted
 * in the reader's daily cover uploads and the hub-wide ceilings.
 */
async function uploadWorkCover(request: Request, env: Env, user: UserRow) {
  const work = matching(new URL(request.url).searchParams.get('work'), WORK, 'work');

  if (now() - user.created < NEW_ACCOUNT) throw new HttpError(403, 'new');
  await limit(env, user.id, 'cover', DAY, 50);

  const bytes = await readImage(
    request,
    COVER_BYTES,
    (width, height) => width >= 32 && width <= 200 && height >= 32 && height <= 400
  );
  const row = await env.DB.prepare(
    `SELECT w.cover, w.cover_ban, EXISTS (SELECT 1 FROM posts p WHERE p.work = w.work AND p.user = ?2) AS posted
     FROM works w WHERE w.work = ?1`
  )
    .bind(work, user.id)
    .first<{ cover: string; cover_ban: string; posted: number }>();

  if (!row?.posted) throw new HttpError(404, 'work');
  if (row.cover) throw new HttpError(409, 'exists');
  if (row.cover_ban === user.id) throw new HttpError(403, 'removed');
  await mediaRoom(env);

  const file = (await sha256(bytes)).slice(0, 16);
  const { meta } = await env.DB.prepare(
    `UPDATE works SET cover = ?1, cover_user = ?2 WHERE work = ?3 AND cover = ''`
  )
    .bind(file, user.id, work)
    .run();
  const undo = () =>
    env.DB.prepare(`UPDATE works SET cover = '', cover_user = '' WHERE work = ?1 AND cover = ?2`)
      .bind(work, file)
      .run();

  if (!meta.changes) throw new HttpError(409, 'exists');
  if (!(await takeUpload(env))) {
    await undo();
    throw new HttpError(503, 'paused');
  }
  try {
    await media(env).put(`work/${file}`, bytes.slice().buffer, {
      httpMetadata: { contentType: 'image/webp', cacheControl: IMMUTABLE }
    });
  } catch (error) {
    await undo();
    throw error;
  }
  return json({ cover: file });
}

/** GET notes?since=: replies to this reader's posts, newest first (90 days, 50) */
async function notes(env: Env, user: UserRow, query: URLSearchParams) {
  await limit(env, user.id, 'notes', MINUTE, 1);

  const since = Math.max(Number(query.get('since')) || 0, now() - 90 * DAY);
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.work, r.line, r.parent, r.body, r.spoiler, r.at, r.edited, w.title, w.vol, w.cover,
       ${authorColumns}
     FROM posts p JOIN posts r ON r.parent = p.id LEFT JOIN works w ON w.work = r.work
     ${authorJoins('r.user')}
     WHERE p.user = ?1 AND r.user != ?1 AND r.user != '' AND r.at > ?2 AND ${unblocked('r.user', '?1')}
     ORDER BY r.at DESC LIMIT 50`
  )
    .bind(user.id, since)
    .all();

  return {
    notes: results.map((row) => ({
      ...postJson(row, user.id),
      work: row.work,
      line: row.line,
      ...workJson(row)
    }))
  };
}

function workParams(value: { book?: unknown; vol?: unknown }) {
  return {
    book: matching(value.book, BOOK, 'book'),
    vol: matching(value.vol ?? '', VOL, 'vol')
  };
}

/** The work a book and volume map to: the one most aged accounts confirmed (ties: the first) */
async function mappedWork(env: Env, book: string, vol: string) {
  return env.DB.prepare(
    `SELECT v.work, COUNT(*) AS votes FROM work_votes v JOIN users u ON u.id = v.user
     WHERE v.book = ?1 AND v.vol = ?2 AND u.created <= ?3
     GROUP BY v.work ORDER BY votes DESC, MIN(v.at) LIMIT 1`
  )
    .bind(book, vol, now() - AGED)
    .first<{ work: string; votes: number }>();
}

/**
 * GET work?book=&vol=: the hub's suggestion (the app still asks the reader to confirm it) and the
 * reader's own confirmation. PUT work {book, vol, work}: a confirmation, one per account and book;
 * it counts once the account is AGED. Title keys are the app's own fallback and never stored.
 */
async function workRoute(request: Request, env: Env, user: UserRow, query: URLSearchParams) {
  if (request.method === 'GET') {
    const { book, vol } = workParams({ book: query.get('book'), vol: query.get('vol') });

    await limit(env, user.id, 'work', DAY, 300);

    const [top, mine] = await Promise.all([
      mappedWork(env, book, vol),
      env.DB.prepare('SELECT work FROM work_votes WHERE book = ?1 AND vol = ?2 AND user = ?3')
        .bind(book, vol, user.id)
        .first<{ work: string }>()
    ]);

    return json({ work: top?.work ?? null, votes: top?.votes ?? 0, mine: mine?.work ?? null });
  }
  if (request.method === 'PUT') {
    const body = await readBody(request);
    const { book, vol } = workParams(body);
    const work = matching(body.work, WORK, 'work');
    const anilist = /^anilist:\d+(?:\/(.+))?$/.exec(work);

    // The work's volume is the book's: no pointing volume 1 at volume 5.
    if (work.startsWith('title:') || (anilist && (anilist[1] ?? '') !== vol)) {
      throw new HttpError(400, 'work');
    }
    await limit(env, user.id, 'vote', DAY, 30);
    await env.DB.prepare(
      'INSERT OR REPLACE INTO work_votes (book, vol, user, work, at) VALUES (?1, ?2, ?3, ?4, ?5)'
    )
      .bind(book, vol, user.id, work, now())
      .run();
    return json({ ok: true });
  }
  throw new HttpError(404, 'route');
}

/**
 * A report's target for `what: post` (`{id}`), `what: work` (a wrong mapping, `{book, vol}`:
 * "<vol>|<book>") or `what: workinfo` (a bad title or cover, `{work}`)
 */
export async function communityTarget(env: Env, viewer: UserRow, body: Row) {
  if (body.what === 'work') {
    const { book, vol } = workParams(body);

    return `${vol}|${book}`;
  }
  if (body.what === 'workinfo') {
    const work = matching(body.work, WORK, 'work');

    if (!(await env.DB.prepare('SELECT 1 FROM works WHERE work = ?1').bind(work).first())) {
      throw new HttpError(404, 'work');
    }
    return work;
  }

  const post = await visiblePost(env, body.id, viewer.id);

  if (!post.user) throw new HttpError(404, 'post');
  if (post.user === viewer.id) throw new HttpError(400, 'self');
  return post.id;
}

/** How long the edge keeps an anonymous read */
const PUBLIC_TTL: Record<string, number> = {
  feed: MINUTE,
  threads: 5 * MINUTE,
  thread: 5 * MINUTE
};

/**
 * GET feed, threads and thread, with or without a token. Without one: the same public posts
 * (blocks can't apply, spoilers stay marked: the reader's position is unknown), from the edge
 * cache, counted per address on a miss; no cookie and no reader id.
 */
export async function communityRead(
  request: Request,
  env: Env,
  ctx: Context | undefined,
  user: UserRow | null,
  path: string
) {
  const query = new URL(request.url).searchParams;
  const read = { feed, threads, thread }[path as 'feed' | 'threads' | 'thread'];

  if (user) return json(await read(request, env, user, query));

  const cache = edgeCache();
  const key = request.url;
  const hit = await cache?.match(key).catch(() => undefined);

  if (hit) return hit;

  const response = json(await read(request, env, null, query));

  if (cache) {
    const copy = new Response(response.clone().body, response);

    copy.headers.set('Cache-Control', `public, max-age=${PUBLIC_TTL[path]}`);
    const put = cache.put(key, copy).catch(() => {});

    if (ctx) ctx.waitUntil(put);
    else await put;
  }
  return response;
}

/** /v1/community/*, signed in */
export async function communityRoute(request: Request, env: Env, user: UserRow, path: string) {
  const query = new URL(request.url).searchParams;
  const route = `${request.method} ${path}`;

  if (route === 'POST posts') return createPost(request, env, user);
  if (route === 'PUT cover') return uploadWorkCover(request, env, user);
  if (route === 'GET notes') return json(await notes(env, user, query));
  if (path === 'work') return workRoute(request, env, user, query);

  const post = /^posts\/([^/]+)(?:\/(helpful))?$/.exec(path);

  if (post) return postRoute(request, env, user, post[1], post[2]);
  throw new HttpError(404, 'route');
}

/** The latest posts of one reader, for the moderators' look-up */
export async function postsOf(env: Env, user: string) {
  const { results } = await env.DB.prepare(
    `SELECT id, work, line, parent, body, spoiler, quote, at FROM posts WHERE user = ?1
     ORDER BY at DESC LIMIT 50`
  )
    .bind(user)
    .all();

  return results.map((row) => ({ ...row, parent: row.parent || null, spoiler: !!row.spoiler }));
}

/**
 * /v1/admin/community/* (the caller checked the role): reported posts, work keys and work
 * titles/covers; removing a post (or all of one reader's), dropping the confirmations of a wrong
 * work key, and resetting a work's title and cover (the next post names it again; whoever gave
 * the removed cover can't give another for the work).
 */
export async function communityAdmin(request: Request, env: Env, path: string) {
  const route = `${request.method} ${path}`;
  const query = new URL(request.url).searchParams;
  const dismiss = (what: string, target: string) =>
    env.DB.prepare('DELETE FROM reports WHERE what = ?1 AND target = ?2').bind(what, target);

  if (route === 'GET reports') {
    const grouped = (what: string) =>
      `SELECT target, COUNT(*) AS n, MAX(at) AS last FROM reports WHERE what = '${what}'
       GROUP BY target ORDER BY n DESC, last DESC LIMIT 100`;
    const [posts, works, infos] = await Promise.all([
      env.DB.prepare(
        `SELECT r.target, r.n, r.last, p.work, p.line, p.body, p.spoiler, p.at,
           ${threadQuote('p')} AS quote, ${authorColumns}
         FROM (${grouped('post')}) r JOIN posts p ON p.id = r.target ${authorJoins('p.user')}
         ORDER BY r.n DESC, r.last DESC`
      ).all(),
      env.DB.prepare(
        `SELECT r.target, r.n, r.last, v.work, COUNT(v.user) AS votes FROM (${grouped('work')}) r
         LEFT JOIN work_votes v ON v.vol = substr(r.target, 1, instr(r.target, '|') - 1)
           AND v.book = substr(r.target, instr(r.target, '|') + 1)
         GROUP BY r.target, v.work ORDER BY r.n DESC, r.last DESC, votes DESC`
      ).all(),
      env.DB.prepare(
        `SELECT r.target, r.n, r.last, w.title, w.vol, w.cover, u.username AS uploader
         FROM (${grouped('workinfo')}) r JOIN works w ON w.work = r.target
         LEFT JOIN users u ON u.id = w.cover_user ORDER BY r.n DESC, r.last DESC`
      ).all()
    ]);

    return json({
      posts: posts.results.map((row) => ({
        id: row.target,
        count: row.n,
        last: row.last,
        work: row.work,
        line: row.line,
        body: row.body,
        spoiler: !!row.spoiler,
        quote: row.quote,
        at: row.at,
        author: author(row)
      })),
      works: works.results.map((row) => ({
        target: row.target,
        count: row.n,
        last: row.last,
        work: row.work,
        votes: row.votes
      })),
      infos: infos.results.map((row) => ({
        work: row.target,
        count: row.n,
        last: row.last,
        ...workJson(row),
        uploader: row.uploader ?? ''
      }))
    });
  }

  const post = /^post\/([0-9a-f]{16})$/.exec(path);

  if (request.method === 'DELETE' && post) {
    await deletePosts(env, 'id = ?1', post[1]);
    return json({ ok: true });
  }

  const posts = /^user\/([0-9a-f]{16})\/posts$/.exec(path);

  if (request.method === 'DELETE' && posts) {
    await deletePosts(env, 'user = ?1', posts[1]);
    return json({ ok: true });
  }
  if (route === 'DELETE work') {
    const { book, vol } = workParams({ book: query.get('book'), vol: query.get('vol') });
    const work = matching(query.get('work'), WORK, 'work');

    await env.DB.batch([
      env.DB.prepare('DELETE FROM work_votes WHERE book = ?1 AND vol = ?2 AND work = ?3').bind(
        book,
        vol,
        work
      ),
      dismiss('work', `${vol}|${book}`)
    ]);
    return json({ ok: true });
  }
  if (route === 'DELETE workinfo') {
    const work = matching(query.get('work'), WORK, 'work');
    const row = await env.DB.prepare('SELECT cover, cover_user FROM works WHERE work = ?1')
      .bind(work)
      .first<{ cover: string; cover_user: string }>();

    if (!row) throw new HttpError(404, 'work');
    // The title comes back from the next post on the work.
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE works SET title = '', cover = '', cover_user = '',
           cover_ban = CASE WHEN ?2 != '' THEN ?3 ELSE cover_ban END WHERE work = ?1`
      ).bind(work, row.cover, row.cover_user),
      dismiss('workinfo', work)
    ]);
    if (row.cover) {
      await dropWorkFiles(env, [row.cover]);
      await purgeImage(request, `work/${row.cover}`);
    }
    return json({ ok: true });
  }
  throw new HttpError(404, 'route');
}
