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

JSON under `/v1`, `Authorization: Bearer <token>` except `salt`, `signup`, `login` and `recover`.
`POST salt`, `signup`, `login`, `logout`, `recover`; `GET|PUT|DELETE me`; `POST code`;
`PUT status` (one per 5 minutes, plus one when leaving a book); `GET friends` (once a minute);
`POST friends/request`; `POST friends/:id/accept`; `DELETE friends/:id` (decline, cancel, remove);
`POST block/:id`. `GET /privacy` is the privacy page. Limits are daily counters in D1 (`limits`).
