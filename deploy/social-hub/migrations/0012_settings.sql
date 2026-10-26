-- Settings sync: one document per reader (the app's shared settings without API keys or tokens,
-- word test results included), GET|PUT /v1/settings. Apply to a running hub before deploying the
-- code that reads it, with
--   npx wrangler@4.147.0 d1 execute chimi-hub --remote --file migrations/0012_settings.sql
-- schema.sql has the same for new hubs. Safe to run again.
CREATE TABLE IF NOT EXISTS settings (
  user TEXT PRIMARY KEY,
  doc TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
