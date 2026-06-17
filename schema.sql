-- ============================================================
--  TradelineIQ — reference data model (SQL)
--  NOTE: the starter ships with a zero-dependency JSON store (db.js), so this
--  file is for reference / when you migrate to SQLite or Postgres. Keep the
--  same table shapes and db.js's exported function names and server.js is
--  unchanged.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,      -- always stored lower-cased
  password_hash TEXT    NOT NULL,             -- bcrypt hash, never plaintext
  first_name    TEXT,
  last_name     TEXT,
  phone         TEXT,
  state         TEXT,
  zip_code      TEXT,
  plan          TEXT    DEFAULT 'Starter',
  verified      INTEGER NOT NULL DEFAULT 0,   -- 0 = email not yet confirmed
  created_at    INTEGER NOT NULL              -- epoch milliseconds
);

-- One-time tokens for email verification and password resets.
CREATE TABLE IF NOT EXISTS tokens (
  token      TEXT    PRIMARY KEY,
  email      TEXT    NOT NULL,
  kind       TEXT    NOT NULL,                -- 'verify' | 'reset'
  expires_at INTEGER NOT NULL,               -- epoch milliseconds
  used       INTEGER NOT NULL DEFAULT 0
);

-- Submitted applications, so a member can track them from any device.
CREATE TABLE IF NOT EXISTS applications (
  id           TEXT    PRIMARY KEY,           -- e.g. TLQ-AU-26-04231
  email        TEXT    NOT NULL,              -- owner (lower-cased)
  type_key     TEXT    NOT NULL,              -- tradeline|repair|monitoring|coaching|loan|businessfunding
  service      TEXT    NOT NULL,              -- human-readable service name
  details      TEXT,                          -- optional JSON blob of form data
  status       TEXT    NOT NULL DEFAULT 'received',
  submitted_at INTEGER NOT NULL,             -- epoch milliseconds
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_applications_email ON applications(email);
CREATE INDEX IF NOT EXISTS idx_tokens_email ON tokens(email);
