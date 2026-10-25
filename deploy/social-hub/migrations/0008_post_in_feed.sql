-- Where a post on a line goes: in_feed 1 (the default, every older post) shows in GET feed and its
-- line's thread; 0 ("This line only") only in the thread. Apply to a running hub before deploying
-- the code that reads it, with
--   npx wrangler@4.147.0 d1 execute chimi-hub --remote --file migrations/0008_post_in_feed.sql
-- schema.sql has the column for new hubs. SQLite has no ADD COLUMN IF NOT EXISTS: a second run
-- fails with "duplicate column name: in_feed" and changes nothing.
ALTER TABLE posts ADD COLUMN in_feed INTEGER NOT NULL DEFAULT 1;
