-- Phase 2 (profiles and activity): stats, finished books, events, reports. Idempotent; apply
-- to a hub created from an older schema.sql with
--   npx wrangler@4.147.0 d1 execute chimi-hub --remote --file migrations/0002_profiles.sql
-- schema.sql holds the same tables for new hubs.

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
