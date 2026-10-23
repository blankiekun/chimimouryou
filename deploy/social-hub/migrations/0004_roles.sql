-- Roles: 'dev' marks the hub's moderators (a Dev badge beside their name, and /v1/admin/*).
-- Apply to a hub created from an older schema.sql with
--   npx wrangler@4.147.0 d1 execute chimi-hub --remote --file migrations/0004_roles.sql
-- schema.sql has the column for new hubs. SQLite has no ADD COLUMN IF NOT EXISTS: a second run
-- fails with "duplicate column name: role" and changes nothing.
-- Granted by hand (README "Moderation"), e.g.
--   UPDATE users SET role = 'dev' WHERE username = 'NAME';
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT '';
