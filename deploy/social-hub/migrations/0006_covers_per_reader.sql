-- Covers per reader: each status/finished row shows the thumbnail its own reader uploaded, not
-- the first one anyone uploaded for the book key. Apply to a running hub with
--   npx wrangler@4.147.0 d1 execute chimi-hub --remote --file migrations/0006_covers_per_reader.sql
-- Idempotent; schema.sql has the same table for new hubs. Cover URLs (cover/<hash>) don't change.

-- Cover reports name the upload: "<uploader id>:<book key>" (older ones held the key alone).
DELETE FROM reports WHERE what = 'cover'
  AND target NOT GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]:*'
  AND target NOT IN (SELECT book_key FROM covers);
UPDATE reports SET target = (SELECT user FROM covers WHERE book_key = reports.target LIMIT 1) || ':' || target
  WHERE what = 'cover'
  AND target NOT GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]:*';

-- The key becomes (user, book_key): SQLite can't change a primary key, so the table is rebuilt.
CREATE TABLE IF NOT EXISTS covers_next (
  user TEXT NOT NULL,
  book_key TEXT NOT NULL,
  file TEXT NOT NULL,
  at INTEGER NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user, book_key)
);
INSERT OR IGNORE INTO covers_next (user, book_key, file, at, removed)
  SELECT user, book_key, file, at, removed FROM covers;
DROP TABLE covers;
ALTER TABLE covers_next RENAME TO covers;
CREATE INDEX IF NOT EXISTS covers_file ON covers (file);
