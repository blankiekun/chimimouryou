-- chimimouryou social hub (Cloudflare D1). Apply with:
--   npx wrangler d1 execute chimi-hub --remote --file schema.sql
-- Times are Unix seconds.

-- One row per reader. salt is per user: the browser stretches the password with scrypt
-- over it, the hub keeps sha256(salt:key). recovery_hash is sha256 of the recovery code.
-- status_at is the 1-minute guard of PUT /v1/status.
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

-- The stats a reader shares (streak, this week, books finished this year, words known if
-- shared, an 84-day heat string), as JSON, replaced by each status push.
CREATE TABLE IF NOT EXISTS stats (
  user TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  at INTEGER NOT NULL
);

-- Finished books, the last 50 per reader; month is YYYY-MM.
CREATE TABLE IF NOT EXISTS finished (
  user TEXT NOT NULL,
  book_key TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'book',
  month TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user, book_key)
);

-- Activity for friends, kept 90 days: started, finished, streak (value = the milestone in days).
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL,
  type TEXT NOT NULL,
  book_key TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'book',
  value INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_user ON events (user, at);

-- Reports of a display name or picture; reporter is a user id or "ip:<sha256>". Kept 90 days.
CREATE TABLE IF NOT EXISTS reports (
  target TEXT NOT NULL,
  reporter TEXT NOT NULL,
  what TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (target, reporter, what)
);
