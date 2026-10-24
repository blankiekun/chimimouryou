# Social hub

The one hub every chimimouryou build uses for friends: a Cloudflare Worker over D1 (free tier).
Accounts are a username and a password (stretched with scrypt in the browser, stored as a salted
SHA-256), friend codes, requests, blocks and up to three current books per reader, and in R2 the
readers' pictures and small cover thumbnails of the books they share. No email, IP log or books. The app's client is `apps/web/src/lib/data/social*.ts`.

## Deploy

With a Cloudflare account, from this folder:

1. `npx wrangler@4.147.0 login`
2. `npx wrangler@4.147.0 d1 create chimi-hub`, and put the printed `database_id` in `wrangler.toml`.
3. `npx wrangler@4.147.0 d1 execute chimi-hub --remote --file schema.sql`, and
   `npx wrangler@4.147.0 r2 bucket create chimi-hub-media` (pictures and cover thumbnails,
   binding `MEDIA` in `wrangler.toml`; R2's free tier is 10 GB with no egress fees).
4. `npx wrangler@4.147.0 deploy`. It prints the address, e.g. `https://chimi-hub.<you>.workers.dev`
   (or add a custom domain in the dashboard). The daily cron (retention) and the edge rate limit
   are set by `wrangler.toml`.
5. Set `socialHubDefault` in `apps/web/src/lib/data/social-account.ts` to that address and release.

Edge limit: a workers.dev address can't have dashboard WAF rules, so the Worker checks the
Workers Rate Limiting binding `EDGE_LIMIT` (`[[ratelimits]]` in `wrangler.toml`: 5 requests per
10 seconds per address, IPv6 by its /64 like every per-address limit) first, before any D1 access, and answers `429 {"error":"busy"}`
(preflights skip it). The counters are per Cloudflare location and approximate; the daily
limits in D1 stay the real bounds.

`schema.sql` uses `CREATE TABLE IF NOT EXISTS`, so step 3 can be rerun after a schema change
that only adds tables. A hub that is already running gets each change from `migrations/` (all
idempotent), in order, then `npx wrangler@4.147.0 deploy`:

- `npx wrangler@4.147.0 d1 execute chimi-hub --remote --file migrations/0002_profiles.sql`
  (profiles and activity: stats, finished books, events, reports)
- `npx wrangler@4.147.0 r2 bucket create chimi-hub-media`, then
  `npx wrangler@4.147.0 d1 execute chimi-hub --remote --file migrations/0003_images.sql`
  (pictures and cover thumbnails)
- `npx wrangler@4.147.0 d1 execute chimi-hub --remote --file migrations/0004_roles.sql`
  (`users.role`: moderators; a second run only fails with "duplicate column name")
- `npx wrangler@4.147.0 d1 execute chimi-hub --remote --file migrations/0005_transfers.sql`
  (sending a book to a friend; the deploy also adds the 10-minute cron and `SIGNAL_LIMIT`)
- `npx wrangler@4.147.0 d1 execute chimi-hub --remote --file migrations/0006_covers_per_reader.sql`
  (covers one per reader and book; deploy right after it)
- `npx wrangler@4.147.0 d1 execute chimi-hub --remote --file migrations/0007_community.sql`
  (Community: posts on a line, works and their covers, helpful marks, work-key confirmations)

## Develop

- `pnpm test` (Vitest; D1 is stood in for by Node's built-in SQLite, `test/d1.ts`).
- `npx wrangler@4.147.0 d1 execute chimi-hub --local --file schema.sql`, then
  `npx wrangler@4.147.0 dev` serves it at `http://127.0.0.1:8787` (R2 emulated locally). Pictures
  and covers from a local hub are blocked by the app's CSP `img-src`, which lists only the default hub. A standalone build accepts an
  `http://127.0.0.1` hub in Settings → Social → Hub address.

## API

JSON under `/v1`, `Authorization: Bearer <token>` except `salt`, `signup`, `login`, `recover`,
and (token optional) `profile/:username`.
`POST salt`, `signup`, `login`, `logout`, `recover`; `POST logout-all` (every session of the account);
`POST password` (`{key, next}`: the current and new stretched password, same salt; other sessions end);
`POST recovery` (`{key}`: a new recovery code, the old one stops working); `GET|PUT|DELETE me` (turning a share off
in `PUT me` deletes that data at once); `POST code`;
`PUT status` (current books, `finished`, `stats`; one a minute, plus one when leaving a
book; writes started, finished and streak events; a reading rank in `stats` (`rank`, `chars`) is capped by
`capRank`: characters grow at most 300,000 a day since the last stats or the account's creation, the rank is at most
what they support and rises one tier a week, `rankAt`); `DELETE finished/:key` (the reader's finished
book and its events, when its statistics are deleted); `GET friends` (with their finished books and
stats; once a minute); `GET feed?since=` (friends' events, 90 days; once a minute);
`GET profile/:username` (public profiles to anyone, edge-cached 15 minutes; private ones to
friends; 404 when blocked; 30 a day); `POST report` (`{username, what: name|picture}` or
`{what: cover, key, username}`: the cover that reader uploaded, 5 a day; signed-in readers only, 401 otherwise);
`PUT status` answers `needCovers`: the shared book keys this reader gave no thumbnail for. `PUT cover?key=`
(raw `image/webp`, at most 20 KB, 32-200 px wide, no EXIF/XMP; only for a book in the reader's
current or finished books; one per reader and key, shown only on that reader's own rows, a second
one is 409; 50 a day; the daily cron deletes covers whose book the reader no longer shares);
`PUT avatar` (raw `image/webp`, a square of 64-256 px, at most 64 KB; 5 a day; a new version
each time) and `DELETE avatar` (back to the preset). Books carry `cover` (a content hash) and
people `picture` (a version, 0 for none); `GET cover/:hash` and `GET avatar/:id/:version` serve
them from the edge cache, else R2, with `Cache-Control: public, max-age=31536000, immutable`, and
skip the edge limit (a shelf shows a dozen at once; each device fetches each URL once).
`POST friends/request` (`{code}`, or `{username}` of a public profile); `POST friends/:id/accept`;
`DELETE friends/:id` (decline, cancel, remove); `POST block/:id`. `GET /privacy` is the privacy
page. Limits are counters in D1 (`limits`).
People carry `role` (`'dev'` or `''`).

Sending a book to a friend (WebRTC; the book goes browser to browser, never through the hub or
R2, and there is no TURN relay): the hub only passes the SDP, between two accounts with an
accepted link, checked on every call. `POST transfers` (`{to, title, kind: book|manga, size}`,
at most 300 MB; 20 a day; one live transfer per pair, either way round); `GET transfers` (books
offered to this reader); `POST transfers/:id/accept` (`{offer}`, the receiver, with all its ICE
candidates); `POST transfers/:id/answer` (`{answer}`, the sender); `GET transfers/:id` (the state
and what the other side sent); `DELETE transfers/:id` (the receiver declining while pending, kept
until the sender has seen it; otherwise removed: the sender does it once connected). A transfer
lives 10 minutes; a 10-minute cron deletes expired ones. `/v1/transfers*` take the
`SIGNAL_LIMIT` binding (30 per 10 s per address) instead of `EDGE_LIMIT`: the app polls about
once a second only while one is being set up. A typical transfer costs 10-20 Worker requests,
plus one per 3 s while the friend hasn't answered yet (at most ~200 for one left waiting).

Moderation, role `dev` only (403 for everyone else): `GET admin/reports` (open reports grouped
by kind and target, with the name, picture or cover reported); `DELETE admin/reports?what=&target=`
(dismiss); `DELETE admin/cover?target=<uploader id>:<key>` (that upload only: `removed = 1`, the R2
object goes unless another upload uses the same image); `GET admin/user/:username`
(account, current and finished books, events); `POST admin/user/:id/name` (name back to the
username); `DELETE admin/user/:id/picture`; `DELETE admin/user/:id/status/:slot`,
`…/finished/:key`, `…/events/:id` (one row). Resolving a report deletes its reports.

## Community

Posts on a line of a book (`src/community.ts`; the app's client is `apps/web/src/lib/data/community.ts`).
A work key is `anilist:<id>[/<volume>]`, `vndb:v<id>` or `title:<book key>`; a line is the first
32 hex of sha256 of the normalised line (`normalizeLine`; `test/line-hashes.json` keeps the app's
copy in step). Bodies, titles and quotes are plain text: NFC, no control, direction-override or
stacked combining characters, capped in characters and bytes. Under `/v1/community/`:

- Public (token optional; without one, edge-cached and counted per address, no blocks applied):
  `GET threads?work=&after=` (8-hex line prefixes with post counts and a spoiler flag, 1,000 a
  page; a prefix isn't enough to open a thread), `GET thread?work=&line=` (work title, volume and
  cover, the line, its context and the posts), `GET feed?before=<at>:<id>` (top-level posts of
  every work, newest first, 30 a page, with the line, title, cover, reply count and spoiler flag).
  Posts with 3 open reports are left out until a moderator decides. `GET /v1/work/:hash` serves a
  work's cover like the other images.
- Signed in: `POST posts` (`{work, title, vol, quote, context, body, spoiler}`: the hub hashes the
  quote and the context (<= 600) must contain it; or `{parent, body, spoiler}` for a reply);
  `PUT|DELETE posts/:id` (own only; a post with replies stays as an empty tombstone);
  `POST|DELETE posts/:id/helpful` (replies only, not one's own; counted from accounts 7+ days
  old); `GET notes?since=` (replies to one's posts, once a minute); `GET work?book=&vol=` (the work
  most accounts 7+ days old confirmed, a suggestion the app still asks the reader to confirm) and
  `PUT work` (`{book, vol, work}`, one confirmation per account; AniList volumes must match);
  `PUT cover?work=` (the work's one cover: raw WebP, <= 20 KB, 32-200 px wide, no EXIF/XMP, from
  an account past its first 3 days with a post on the work; 409 once there is one).
- Limits: posts 10 an hour and 50 a day per account (3 and 10, and no URLs, in its first 3 days),
  100 a day per address, 10,000 a day hub-wide; one account keeps at most 30 top-level posts per
  work, a thread at most 200 posts; a line's first post keeps the quote, and only a work's first
  10 lines keep their context. Covers share the 50-a-day cover limit and the hub-wide image
  ceilings. Blocks hide posts both ways (threads, listings, feed, notes, replies, helpful).
- Reports: `POST report` with `{what: post, id}`, `{what: work, book, vol}` (a wrong mapping) or
  `{what: workinfo, work}` (title or cover). Moderators: `GET admin/community/reports`,
  `DELETE admin/community/post/:id`, `DELETE admin/community/user/:id/posts`,
  `DELETE admin/community/work?book=&vol=&work=` (drops those confirmations),
  `DELETE admin/community/workinfo?work=` (title and cover reset; the next post names the work
  again, and the removed cover's uploader can't give another). `GET admin/user/:username`
  includes the reader's latest 50 posts.
- Deleting an account deletes its posts (answered ones become tombstones), helpful marks and
  confirmations; a cover it gave stays with the work. The daily cron deletes works without posts
  and their covers.

## Moderation

Readers with the role `dev` get a Dev badge beside their name and the app's Moderation page
(Settings → Social → Moderation, `/moderation`): the reports queue and a look-up of any reader by
username, with buttons for everything below. There is no UI to grant the role; from this folder:

```sh
npx wrangler@4.147.0 d1 execute chimi-hub --remote --command \
  "UPDATE users SET role = 'dev' WHERE username = 'NAME'"
```

(`role = ''` takes it away.) The app picks it up the next time Settings → Social opens.

## Reports

Reports of a name, picture or cover are kept 90 days and handled on the Moderation page. By hand,
to review them and reset a name:

```sh
npx wrangler@4.147.0 d1 execute chimi-hub --remote --command \
  "SELECT u.username, u.name, r.what, COUNT(*) AS n FROM reports r JOIN users u ON u.id = r.target
   GROUP BY r.target, r.what ORDER BY n DESC"
npx wrangler@4.147.0 d1 execute chimi-hub --remote --command \
  "UPDATE users SET name = username WHERE username = 'NAME';
   DELETE FROM reports WHERE target = (SELECT id FROM users WHERE username = 'NAME')"
```

The edge cache keeps a public profile up to 15 minutes, so a reset name can show that long.

A reported picture goes back to the preset: find its object, delete it and the row.

```sh
npx wrangler@4.147.0 d1 execute chimi-hub --remote --command \
  "SELECT 'avatar/' || p.user || '/' || p.version AS object FROM pictures p
   JOIN users u ON u.id = p.user WHERE u.username = 'NAME'"
npx wrangler@4.147.0 r2 object delete --remote chimi-hub-media/OBJECT
npx wrangler@4.147.0 d1 execute chimi-hub --remote --command \
  "DELETE FROM pictures WHERE user = (SELECT id FROM users WHERE username = 'NAME');
   DELETE FROM reports WHERE what = 'picture' AND target = (SELECT id FROM users WHERE username = 'NAME')"
```

Reported covers (the target is `<uploader id>:<book key>`) go back to the title card; `removed = 1`
keeps that reader from uploading another for the key:

```sh
npx wrangler@4.147.0 d1 execute chimi-hub --remote --command \
  "SELECT r.target, 'cover/' || c.file AS object, COUNT(*) AS n FROM reports r
   JOIN covers c ON c.user = substr(r.target, 1, 16) AND c.book_key = substr(r.target, 18)
   WHERE r.what = 'cover' GROUP BY r.target ORDER BY n DESC"
npx wrangler@4.147.0 r2 object delete --remote chimi-hub-media/OBJECT
npx wrangler@4.147.0 d1 execute chimi-hub --remote --command \
  "UPDATE covers SET removed = 1 WHERE user = 'USER' AND book_key = 'KEY';
   DELETE FROM reports WHERE what = 'cover' AND target = 'USER:KEY'"
```

(Skip the R2 delete while another upload shows the same object: `SELECT COUNT(*) FROM covers WHERE file = 'FILE' AND removed = 0`.)

Browsers that already showed the image keep it in their cache; friends' lists stop pointing at it.
