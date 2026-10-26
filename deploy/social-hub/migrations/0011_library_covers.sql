-- Library covers: a dev's bulk upload of the library's thumbnails for the Discord status
-- (PUT /v1/admin/library-cover), kept by the cron. Apply to a running hub before deploying the
-- code that reads it, with
--   npx wrangler@4.147.0 d1 execute chimi-hub --remote --file migrations/0011_library_covers.sql
-- schema.sql has the same for new hubs. SQLite has no ADD COLUMN IF NOT EXISTS, so a second run
-- stops with "duplicate column name: library" having changed nothing.
ALTER TABLE covers ADD COLUMN library INTEGER NOT NULL DEFAULT 0;
