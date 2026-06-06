/**
 * Postgres-backed storage for the VaraTrace indexer.
 *
 * Uses `pg` (node-postgres). Requires DATABASE_URL env var.
 */
import pg from "pg";
import "dotenv/config";

// pg module imported for Pool type; not re-exported

const DEFAULT_DB_URL = "postgresql://varatrace:varatrace@localhost:5432/varatrace";

// ---------------------------------------------------------------------------
// Connection management (lazy pool — recreated after close())
// ---------------------------------------------------------------------------

let _pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!_pool) {
    const url = process.env.DATABASE_URL ?? DEFAULT_DB_URL;
    _pool = new pg.Pool({
      connectionString: normalizeConnectionString(url),
      max: 5,
      connectionTimeoutMillis: 20_000,
    });
  }
  return _pool;
}

function normalizeConnectionString(url: string): string {
  if (!url.includes("sslmode=require") || url.includes("uselibpqcompat=true")) {
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}uselibpqcompat=true`;
}

// ---------------------------------------------------------------------------
// Types (mirror packages/core RawMessage / DispatchRecord)
// ---------------------------------------------------------------------------

export interface MessageRow {
  id: string;
  source: string;
  destination: string;
  payload: string;
  value: string;
  block_number: number;
  index: number;
  timestamp: number | null;
  reply_to: string | null;
  from_user: boolean;
  tx_hash: string | null;
}

export interface DispatchRow {
  id: string;
  status: string;
  error: string | null;
  block_number: number;
}

export interface IndexerStats {
  messages: number;
  dispatches: number;
  metadata: number;
  lastIndexedBlock: number | null;
  updatedAt: number | null;
  lastError: string | null;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS raw_messages (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  destination TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '0x',
  value       TEXT NOT NULL DEFAULT '0',
  block_number INTEGER NOT NULL,
  "index"     INTEGER NOT NULL,
  timestamp   BIGINT,
  reply_to    TEXT,
  from_user   BOOLEAN NOT NULL DEFAULT false,
  tx_hash     TEXT
);

ALTER TABLE raw_messages
  ADD COLUMN IF NOT EXISTS tx_hash TEXT;

CREATE TABLE IF NOT EXISTS dispatch_records (
  id          TEXT PRIMARY KEY,
  status      TEXT NOT NULL,
  error       TEXT,
  block_number INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS program_metadata (
  program_id  TEXT PRIMARY KEY,
  meta_hex    TEXT NOT NULL,
  fetched_at  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS program_idls (
  program_id    TEXT PRIMARY KEY,
  program_name  TEXT,
  idl           TEXT NOT NULL,
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
`;

/** Ensure the schema exists. Idempotent. */
export async function ensureSchema(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query(SCHEMA_SQL);
    console.log("Postgres schema ready.");
  } finally {
    client.release();
  }
}

/** Path to the database (for diagnostics). */
export const dbPath = (): string => redactConnectionString(process.env.DATABASE_URL ?? DEFAULT_DB_URL);

function redactConnectionString(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return url.replace(/:[^:@/]+@/, ":***@");
  }
}

// ---------------------------------------------------------------------------
// Batch insert helpers
// ---------------------------------------------------------------------------

interface MessageRowInsert {
  id: string;
  source: string;
  destination: string;
  payload: string;
  value: string;
  block_number: number;
  index: number;
  timestamp: number;
  reply_to: string | null;
  from_user: boolean;
  tx_hash?: string | null;
}

interface DispatchRowInsert {
  id: string;
  status: string;
  error: string | null;
  block_number: number;
}

/** Insert a batch of messages (upsert). */
export async function insertMessages(rows: MessageRowInsert[]): Promise<void> {
  if (rows.length === 0) return;
  const client = await getPool().connect();
  try {
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const r of rows) {
      placeholders.push(
        `($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`,
      );
      values.push(
        r.id, r.source, r.destination, r.payload, r.value,
        r.block_number, r.index, r.timestamp, r.reply_to, r.from_user, r.tx_hash ?? null,
      );
    }
    await client.query(
      `INSERT INTO raw_messages (id, source, destination, payload, value, block_number, "index", timestamp, reply_to, from_user, tx_hash)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (id) DO UPDATE SET
         tx_hash = COALESCE(raw_messages.tx_hash, EXCLUDED.tx_hash)`,
      values,
    );
  } finally {
    client.release();
  }
}

/** Insert a batch of dispatch statuses (upsert). */
export async function insertDispatchStatuses(rows: DispatchRowInsert[]): Promise<void> {
  if (rows.length === 0) return;
  // Deduplicate by id — Postgres forbids multiple rows with the same
  // constraint value in a single ON CONFLICT DO UPDATE batch.
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  if (deduped.length === 0) return;
  const client = await getPool().connect();
  try {
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const r of deduped) {
      placeholders.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
      values.push(r.id, r.status, r.error, r.block_number);
    }
    await client.query(
      `INSERT INTO dispatch_records (id, status, error, block_number)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (id) DO NOTHING`,
      values,
    );
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** Fetch all messages and dispatch records for a given message id. */
export async function fetchTrace(
  rootId: string,
): Promise<{ messages: any[]; statuses: any[] } | null> {
  const client = await getPool().connect();
  try {
    const rootCheck = await client.query(
      "SELECT id FROM raw_messages WHERE id = $1", [rootId],
    );
    if (rootCheck.rows.length === 0) return null;

    const msgRes = await client.query(
      `SELECT * FROM raw_messages WHERE id = $1
       UNION
       SELECT * FROM raw_messages WHERE reply_to = $1
       UNION
       SELECT * FROM raw_messages
        WHERE block_number >= (
          SELECT COALESCE(MAX(block_number) - 10, 0) FROM raw_messages WHERE id = $1
        )
          AND block_number <= (SELECT block_number + 5 FROM raw_messages WHERE id = $1)
        LIMIT 500`,
      [rootId],
    );

    if (msgRes.rows.length === 0) return null;
    const ids = msgRes.rows.map((r: any) => r.id);

    const statusRes =
      ids.length > 0
        ? await client.query(
            "SELECT * FROM dispatch_records WHERE id = ANY($1::text[])",
            [ids],
          )
        : { rows: [] as any[] };

    return { messages: msgRes.rows, statuses: statusRes.rows };
  } finally {
    client.release();
  }
}

/** Check if the database has any data. */
export async function hasData(): Promise<boolean> {
  const res = await getPool().query("SELECT COUNT(*)::int AS cnt FROM raw_messages");
  return (res.rows[0] as any)!.cnt > 0;
}

/** Persist indexer progress for API/UI readiness checks. */
export async function updateIndexerState(
  blockNumber: number,
  lastError: string | null = null,
): Promise<void> {
  await getPool().query(
    `INSERT INTO indexer_state (id, last_indexed_block, updated_at, last_error)
     VALUES ('default', $1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       last_indexed_block = GREATEST(indexer_state.last_indexed_block, EXCLUDED.last_indexed_block),
       updated_at = EXCLUDED.updated_at,
       last_error = EXCLUDED.last_error`,
    [blockNumber, Date.now(), lastError],
  );
}

/** Aggregate live/indexer readiness stats for API status. */
export async function getIndexerStats(): Promise<IndexerStats> {
  const res = await getPool().query(
    `SELECT
       (SELECT COUNT(*)::int FROM raw_messages) AS messages,
       (SELECT COUNT(*)::int FROM dispatch_records) AS dispatches,
       (SELECT COUNT(*)::int FROM program_metadata) AS metadata,
       state.last_indexed_block,
       state.updated_at,
       state.last_error
     FROM (SELECT 1) one
     LEFT JOIN indexer_state state ON state.id = 'default'`,
  );
  const row = res.rows[0] ?? {};
  return {
    messages: Number(row.messages ?? 0),
    dispatches: Number(row.dispatches ?? 0),
    metadata: Number(row.metadata ?? 0),
    lastIndexedBlock: row.last_indexed_block == null ? null : Number(row.last_indexed_block),
    updatedAt: row.updated_at == null ? null : Number(row.updated_at),
    lastError: row.last_error ?? null,
  };
}

// ---------------------------------------------------------------------------
// Program metadata store
// ---------------------------------------------------------------------------

/** Check if we already have metadata for a given program. */
export async function hasMetadata(programId: string): Promise<boolean> {
  const res = await getPool().query(
    "SELECT 1 FROM program_metadata WHERE program_id = $1",
    [programId.toLowerCase()],
  );
  return res.rows.length > 0;
}

/** Get metadata hex for a program (or null if not cached). */
export async function getMetadata(programId: string): Promise<string | null> {
  const res = await getPool().query(
    "SELECT meta_hex FROM program_metadata WHERE program_id = $1",
    [programId.toLowerCase()],
  );
  return res.rows.length > 0 ? res.rows[0]!.meta_hex : null;
}

/** Store a batch of program metadata entries (upsert). */
export async function insertProgramMetadata(
  rows: { programId: string; metaHex: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  const client = await getPool().connect();
  try {
    const now = Date.now();
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const r of rows) {
      placeholders.push(`($${i++}, $${i++}, $${i++})`);
      values.push(r.programId.toLowerCase(), r.metaHex, now);
    }
    await client.query(
      `INSERT INTO program_metadata (program_id, meta_hex, fetched_at)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (program_id) DO NOTHING`,
      values,
    );
  } finally {
    client.release();
  }
}

/** Close the pool. */
export async function close(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
