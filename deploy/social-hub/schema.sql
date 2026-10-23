-- chimimouryou social hub (Cloudflare D1). Apply with:
--   npx wrangler d1 execute chimi-hub --remote --file schema.sql
-- Times are Unix seconds.

-- One row per reader. salt is per user: the browser stretches the password with scrypt
-- over it, the hub keeps sha256(salt:key). recovery_hash is sha256 of the recovery code.
-- status_at is the 5-minute guard of PUT /v1/status.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar INTEGER NOT NULL DEFAULT 0,
  code TEXT NOT NULL UNIQUE,
  share TEXT NOT NULL DEFAULT '{}',
  created INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  status_at INTEGER NOT NULL DEFAULT 0
);

-- Session tokens, by their sha256 only.
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  last_used INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user);

-- One row per pair (a < b): pending, accepted or blocked; by_user sent the request or blocked.
-- code is the friend code the request was sent to, shown to the sender while it waits.
CREATE TABLE IF NOT EXISTS links (
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  state TEXT NOT NULL,
  by_user TEXT NOT NULL,
  code TEXT,
  created INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);
CREATE INDEX IF NOT EXISTS links_b ON links (b);

-- Up to 3 current books per reader.
CREATE TABLE IF NOT EXISTS status (
  user TEXT NOT NULL,
  slot INTEGER NOT NULL,
  book_key TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'book',
  pct REAL NOT NULL,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (user, slot)
);

-- Rate-limit counters: subject is a user id, "ip:<sha256 of the address>" or "name:<username>";
-- win is the start of the window (a day, an hour or a minute).
CREATE TABLE IF NOT EXISTS limits (
  subject TEXT NOT NULL,
  action TEXT NOT NULL,
  win INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (subject, action, win)
);
