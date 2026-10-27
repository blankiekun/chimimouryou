-- Settings sync is gone: the hub keeps only public-facing data (status, stats, finished,
-- Community, covers, presence); settings sync through Drive/OneDrive/folder or the server.
-- Apply to a running hub AFTER deploying the code that no longer reads or deletes from it, with
--   npx wrangler@4.147.0 d1 execute chimi-hub --remote --file migrations/0013_drop_settings.sql
-- Safe to run again.
DROP TABLE IF EXISTS settings;
