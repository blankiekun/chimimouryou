-- Community: threads on a line of a book. Apply to a running hub with
--   npx wrangler@4.147.0 d1 execute chimi-hub --remote --file migrations/0007_community.sql
-- Idempotent; schema.sql has the same tables for new hubs.

-- Community (src/community.ts): posts on a line of a work. work is the work key (anilist:<id>[/<vol>],
-- vndb:v<id> or title:<book key>), line the first 32 hex of sha256(normalizeLine(line)). A top-level
-- post has parent '' and kind 'post'; replies have the top-level post's id and kind 'reply'; spoiler
-- is the poster's mark. Only a line's first post keeps the quote (the line) and context (<= 600
-- characters around it; the work's first 100 lines only). user '' and body '' mark a deleted
-- top-level post that still has replies.
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
  edited INTEGER NOT NULL DEFAULT 0
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
