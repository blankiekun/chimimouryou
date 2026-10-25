-- Discord status relay: the presence tables and users.presence_profile. Apply to a running hub
-- before deploying the code that reads them, with
--   npx wrangler@4.147.0 d1 execute chimi-hub --remote --file migrations/0009_presence.sql
-- schema.sql has the same for new hubs. The tables are created only if missing; SQLite has no
-- ADD COLUMN IF NOT EXISTS, so a second run stops at the last line ("duplicate column name:
-- presence_profile") having changed nothing.
CREATE TABLE IF NOT EXISTS presence (
  user TEXT PRIMARY KEY,
  activity TEXT NOT NULL,
  kind TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS presence_keys (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS presence_keys_user ON presence_keys (user);
CREATE TABLE IF NOT EXISTS presence_codes (
  code_hash TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS presence_codes_user ON presence_codes (user);

ALTER TABLE users ADD COLUMN presence_profile INTEGER NOT NULL DEFAULT 0;
