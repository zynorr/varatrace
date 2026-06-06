CREATE TABLE IF NOT EXISTS raw_messages (
  id           TEXT PRIMARY KEY,
  source       TEXT NOT NULL,
  destination  TEXT NOT NULL,
  payload      TEXT NOT NULL DEFAULT '0x',
  value        TEXT NOT NULL DEFAULT '0',
  block_number INTEGER NOT NULL,
  "index"      INTEGER NOT NULL,
  timestamp    BIGINT,
  reply_to     TEXT,
  from_user    BOOLEAN NOT NULL DEFAULT false,
  tx_hash      TEXT
);

ALTER TABLE raw_messages
  ADD COLUMN IF NOT EXISTS tx_hash TEXT;

CREATE TABLE IF NOT EXISTS dispatch_records (
  id           TEXT PRIMARY KEY,
  status       TEXT NOT NULL,
  error        TEXT,
  block_number INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS program_metadata (
  program_id TEXT PRIMARY KEY,
  meta_hex   TEXT NOT NULL,
  fetched_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS program_idls (
  program_id   TEXT PRIMARY KEY,
  program_name TEXT,
  idl          TEXT NOT NULL,
  registered_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS indexer_state (
  id                 TEXT PRIMARY KEY DEFAULT 'default',
  last_indexed_block INTEGER NOT NULL DEFAULT 0,
  updated_at         BIGINT NOT NULL,
  last_error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_block
  ON raw_messages(block_number DESC, "index" ASC);

CREATE INDEX IF NOT EXISTS idx_messages_source
  ON raw_messages(source);

CREATE INDEX IF NOT EXISTS idx_messages_dest
  ON raw_messages(destination);

CREATE INDEX IF NOT EXISTS idx_messages_tx_hash
  ON raw_messages(tx_hash);

CREATE INDEX IF NOT EXISTS idx_dispatches_block
  ON dispatch_records(block_number DESC);
