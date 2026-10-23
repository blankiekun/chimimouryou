-- Phase 5 (pictures and cover thumbnails, stored in R2). Idempotent; apply to a hub created
-- from an older schema.sql with
--   npx wrangler@4.147.0 d1 execute chimi-hub --remote --file migrations/0003_images.sql
-- schema.sql holds the same tables for new hubs.

-- A reader's uploaded picture: R2 object avatar/<user>/<version>, a new version per upload.
CREATE TABLE IF NOT EXISTS pictures (
  user TEXT PRIMARY KEY,
  version INTEGER NOT NULL
);

-- One cover thumbnail per book key: R2 object cover/<file> (16 hex of the WebP's sha256),
-- uploaded by the first reader who shared the book with a cover. removed = 1 after a report:
-- the title card shows instead and no new one is taken.
CREATE TABLE IF NOT EXISTS covers (
  book_key TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  user TEXT NOT NULL,
  at INTEGER NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0
);
