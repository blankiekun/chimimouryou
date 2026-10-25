-- chimimouryou social hub (Cloudflare D1). Apply with:
--   npx wrangler d1 execute chimi-hub --remote --file schema.sql
-- Times are Unix seconds.

-- One row per reader. salt is per user: the browser stretches the password with scrypt
-- over it, the hub keeps sha256(salt:key). recovery_hash is sha256 of the recovery code.
-- status_at is the 1-minute guard of PUT /v1/status. role is 'dev' for moderators (granted by
-- hand, README), else ''. presence_profile 1: the Discord status shows on the profile (friends, self).
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
  status_at INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT '',
  presence_profile INTEGER NOT NULL DEFAULT 0
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

-- Reports of a display name, picture (target: a user id) or cover (target: "<uploader id>:<book key>");
-- a community post (target: its id), work key ("<vol>|<book key>") or work title and cover
-- ("workinfo", target: the work key); reporter is a user id. Kept 90 days.
CREATE TABLE IF NOT EXISTS reports (
  target TEXT NOT NULL,
  reporter TEXT NOT NULL,
  what TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (target, reporter, what)
);

-- A reader's uploaded picture: R2 object avatar/<user>/<version>, a new version per upload.
CREATE TABLE IF NOT EXISTS pictures (
  user TEXT PRIMARY KEY,
  version INTEGER NOT NULL
);

-- Cover thumbnails, one per reader and book key, shown only on that reader's own status and
-- finished rows: R2 object cover/<file> (16 hex of the WebP's sha256, shared by identical
-- uploads). removed = 1 after a report: the title card shows instead and that reader can't upload
-- another for the key. The daily cron deletes shown covers whose book the reader no longer shares.
CREATE TABLE IF NOT EXISTS covers (
  user TEXT NOT NULL,
  book_key TEXT NOT NULL,
  file TEXT NOT NULL,
  at INTEGER NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user, book_key)
);
CREATE INDEX IF NOT EXISTS covers_file ON covers (file);
-- Signaling only, the book goes browser to browser over WebRTC.
-- pending (sender asked) -> accepted (the receiver's SDP offer) -> answered (the sender's answer),
-- or declined. Deleted by the sender once connected, else after 10 minutes (TRANSFER_TTL, cron).
CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,
  sender TEXT NOT NULL,
  receiver TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  size INTEGER NOT NULL,
  state TEXT NOT NULL,
  offer TEXT,
  answer TEXT,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS transfers_receiver ON transfers (receiver, created);
CREATE INDEX IF NOT EXISTS transfers_sender ON transfers (sender, created);
CREATE INDEX IF NOT EXISTS transfers_created ON transfers (created);
-- Community (src/community.ts): posts on a line of a work. work is the work key (anilist:<id>[/<vol>],
-- vndb:v<id> or title:<book key>), line the first 32 hex of sha256(normalizeLine(line)). A top-level
-- post has parent '' and kind 'post'; replies have the top-level post's id and kind 'reply'; spoiler
-- is the poster's mark. Only a line's first post keeps the quote (the line) and context (<= 600
-- characters around it; the work's first 10 lines only). user '' and body '' mark a deleted
-- top-level post that still has replies. in_feed 0: posted for the line's thread only, not GET feed.
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  work TEXT NOT NULL,
  line TEXT NOT NULL,
  parent TEXT NOT NULL DEFAULT '',
  user TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  spoiler INTEGER NOT NULL DEFAULT 0,
  quote TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL,
  edited INTEGER NOT NULL DEFAULT 0,
  in_feed INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS posts_line ON posts (work, line);
CREATE INDEX IF NOT EXISTS posts_user ON posts (user, work);
CREATE INDEX IF NOT EXISTS posts_parent ON posts (parent, at);

-- A work's title and volume (named by its first post; moderators reset them) and its one cover
-- thumbnail: R2 object work/<file> (16 hex of the WebP's sha256), given by cover_user. cover_ban is
-- the reader whose cover a moderator removed: they can't give another for the work. The daily cron
-- deletes works no post is on.
CREATE TABLE IF NOT EXISTS works (
  work TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  vol TEXT NOT NULL DEFAULT '',
  cover TEXT NOT NULL DEFAULT '',
  cover_user TEXT NOT NULL DEFAULT '',
  cover_ban TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS works_cover ON works (cover);

-- "Helpful" marks, one per account and post (never one's own); counted only from aged accounts.
CREATE TABLE IF NOT EXISTS helpful (
  post TEXT NOT NULL,
  user TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (post, user)
);
CREATE INDEX IF NOT EXISTS helpful_user ON helpful (user);

-- Which work a book key and volume ('' for none) are: one confirmation per account; the work most
-- aged accounts confirmed is the hub's suggestion.
CREATE TABLE IF NOT EXISTS work_votes (
  book TEXT NOT NULL,
  vol TEXT NOT NULL,
  user TEXT NOT NULL,
  work TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (book, vol, user)
);
CREATE INDEX IF NOT EXISTS work_votes_user ON work_votes (user);

-- Discord status relay (src/presence.ts). presence: the reader's rendered activity (JSON, <= 4 KB),
-- shown until expires_at (5 minutes after the last update). presence_keys: what a paired Anki
-- add-on reads it with, by the key's sha256 only. presence_codes: pairing codes by their sha256,
-- 10 minutes, used once. Expired rows go with the 10-minute cron.
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
