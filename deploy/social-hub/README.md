# Social hub

The one hub every chimimouryou build uses for friends: a Cloudflare Worker over D1 (free tier).
Accounts are a username and a password (stretched with scrypt in the browser, stored as a salted
SHA-256), friend codes, requests, blocks and up to three current books per reader. No email,
IP log, books or covers. The app's client is `apps/web/src/lib/data/social*.ts`.

## Deploy

With a Cloudflare account, from this folder:

1. `npx wrangler@4.147.0 login`
2. `npx wrangler@4.147.0 d1 create chimi-hub`, and put the printed `database_id` in `wrangler.toml`.
3. `npx wrangler@4.147.0 d1 execute chimi-hub --remote --file schema.sql`
4. `npx wrangler@4.147.0 deploy`. It prints the address, e.g. `https://chimi-hub.<you>.workers.dev`
   (or add a custom domain in the dashboard). The daily cron (retention) is set by `wrangler.toml`.
5. Set `socialHubDefault` in `apps/web/src/lib/data/social-account.ts` to that address and release.
6. In the dashboard: Security → WAF → Rate limiting rules, one rule for the hub's hostname:
   5 requests per 10 seconds per IP, block for 10 seconds.

`schema.sql` uses `CREATE TABLE IF NOT EXISTS`, so step 3 can be rerun after a schema change
that only adds tables.

## Develop

- `pnpm test` (Vitest; D1 is stood in for by Node's built-in SQLite, `test/d1.ts`).
- `npx wrangler@4.147.0 d1 execute chimi-hub --local --file schema.sql`, then
  `npx wrangler@4.147.0 dev` serves it at `http://127.0.0.1:8787`. A standalone build accepts an
  `http://127.0.0.1` hub in Settings → Social → Hub address.

## API

JSON under `/v1`, `Authorization: Bearer <token>` except `salt`, `signup`, `login`, `recover`,
and (token optional) `profile/:username` and `report`.
`POST salt`, `signup`, `login`, `logout`, `recover`; `GET|PUT|DELETE me` (turning a share off
in `PUT me` deletes that data at once); `POST code`;
`PUT status` (current books, `finished`, `stats`; one per 5 minutes, plus one when leaving a
book; writes started, finished and streak events); `GET friends` (with their finished books and
stats; once a minute); `GET feed?since=` (friends' events, 90 days; once a minute);
`GET profile/:username` (public profiles to anyone, edge-cached 15 minutes; private ones to
friends; 404 when blocked; 30 a day); `POST report` (`{username, what: name|picture}`, 5 a day);
`POST friends/request` (`{code}`, or `{username}` of a public profile); `POST friends/:id/accept`;
`DELETE friends/:id` (decline, cancel, remove); `POST block/:id`. `GET /privacy` is the privacy
page. Limits are counters in D1 (`limits`).

## Reports

Reports of a name or picture are kept 90 days. To review them and reset a name:

```sh
npx wrangler@4.147.0 d1 execute chimi-hub --remote --command \
  "SELECT u.username, u.name, r.what, COUNT(*) AS n FROM reports r JOIN users u ON u.id = r.target
   GROUP BY r.target, r.what ORDER BY n DESC"
npx wrangler@4.147.0 d1 execute chimi-hub --remote --command \
  "UPDATE users SET name = username WHERE username = 'NAME';
   DELETE FROM reports WHERE target = (SELECT id FROM users WHERE username = 'NAME')"
```

The edge cache keeps a public profile up to 15 minutes, so a reset name can show that long.
