-- Sending a book to a friend (signaling for WebRTC). Apply to a running hub with
--   npx wrangler@4.147.0 d1 execute chimi-hub --remote --file migrations/0005_transfers.sql
-- Idempotent; schema.sql has the same table for new hubs.

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
