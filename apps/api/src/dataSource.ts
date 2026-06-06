import "dotenv/config";
import type { RawMessage, DispatchRecord } from "../../../packages/core/src/index.js";
import {
  fixtureSimpleCall,
  fixtureReply,
  fixtureFanOut,
  fixtureDeepFailure,
  fixtureReplyChainWithFailure,
  fixtureFanOutWithMixedOutcomes,
} from "../../../packages/core/src/fixtures.js";

/**
 * Data source abstraction.
 *
 * Two-layer resolution:
 *   1. Postgres (if DATABASE_URL is configured and has data)
 *   2. Fall back to offline fixtures (always available for demo/dev)
 */
export interface RawTrace {
  messages: RawMessage[];
  statuses: DispatchRecord[];
}

export interface RecentTrace {
  id: string;
  source: string;
  destination: string;
  blockNumber: number;
  index: number;
  status: string;
  replyCount: number;
}

// --------------------------------------------------------------------------
// Fixture backing (always available)
// --------------------------------------------------------------------------

const fixtures: Record<string, () => RawTrace> = {
  simple: fixtureSimpleCall,
  reply: fixtureReply,
  fanout: fixtureFanOut,
  failure: fixtureDeepFailure,
  replychain: fixtureReplyChainWithFailure,
  mixed: fixtureFanOutWithMixedOutcomes,
};

const byMessageId = new Map<string, RawTrace>();
const aliases = new Map<string, RawTrace>();

for (const [alias, make] of Object.entries(fixtures)) {
  const trace = make();
  aliases.set(alias, trace);
  for (const m of trace.messages) byMessageId.set(m.id, trace);
}

// --------------------------------------------------------------------------
// Postgres backing (live data from the indexer)
// --------------------------------------------------------------------------

let pgPool: any = null;
let pgAvailable = false;
let pgStatus: DataSourceStatus = {
  mode: "fixture",
  postgres: "unconfigured",
  liveMessages: 0,
  fixtures: Object.keys(fixtures).length,
};

export interface DataSourceStatus {
  mode: "fixture" | "live";
  postgres: "unconfigured" | "empty" | "ready" | "unavailable";
  liveMessages: number;
  liveDispatches?: number;
  metadataPrograms?: number;
  lastIndexedBlock?: number | null;
  indexedAt?: number | null;
  indexerRunning?: boolean;
  fixtures: number;
  message?: string;
}

async function getPgPool(): Promise<any> {
  if (pgPool) return pgPool;
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    pgAvailable = false;
    pgStatus = {
      mode: "fixture",
      postgres: "unconfigured",
      liveMessages: 0,
      fixtures: Object.keys(fixtures).length,
    };
    return null;
  }

  try {
    const { default: pg } = await import("pg");
    pgPool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });
    return pgPool;
  } catch (err) {
    const message = (err as Error).message;
    pgAvailable = false;
    pgStatus = {
      mode: "fixture",
      postgres: "unavailable",
      liveMessages: 0,
      fixtures: Object.keys(fixtures).length,
      message,
    };
    console.warn("DataSource: Postgres unavailable (", message, ") — using fixtures.");
    pgPool = null;
    return null;
  }
}

async function refreshPgStatus(): Promise<DataSourceStatus> {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    pgAvailable = false;
    pgStatus = {
      mode: "fixture",
      postgres: "unconfigured",
      liveMessages: 0,
      fixtures: Object.keys(fixtures).length,
    };
    return pgStatus;
  }

  const pool = await getPgPool();
  if (!pool) return pgStatus;

  try {
    const res = await pool.query(
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
    const liveMessages = Number(row.messages ?? 0);
    const indexedAt = row.updated_at == null ? null : Number(row.updated_at);
    pgAvailable = liveMessages > 0;
    pgStatus = {
      mode: pgAvailable ? "live" : "fixture",
      postgres: pgAvailable ? "ready" : "empty",
      liveMessages,
      liveDispatches: Number(row.dispatches ?? 0),
      metadataPrograms: Number(row.metadata ?? 0),
      lastIndexedBlock: row.last_indexed_block == null ? null : Number(row.last_indexed_block),
      indexedAt,
      indexerRunning: indexedAt == null ? false : Date.now() - indexedAt < 120_000,
      fixtures: Object.keys(fixtures).length,
      message: row.last_error ?? undefined,
    };
    return pgStatus;
  } catch (err) {
    const message = (err as Error).message;
    pgAvailable = false;
    pgStatus = {
      mode: "fixture",
      postgres: "unavailable",
      liveMessages: 0,
      fixtures: Object.keys(fixtures).length,
      message,
    };
    return pgStatus;
  }
}

async function fetchFromPg(id: string): Promise<RawTrace | undefined> {
  const pool = await getPgPool();
  if (pool) await refreshPgStatus();
  if (!pool || !pgAvailable) return undefined;

  try {
    const targetId = await resolveTraceTargetId(pool, id);
    if (!targetId) return undefined;

    // Smarter query: get the target, its direct replies, and nearby messages
    // that share program addresses with the target (to capture spawned children).
    // The block-range filter without program restriction pulls in unrelated
    // messages from busy blocks, causing buildTraceTree to merge independent
    // interactions and pick the wrong root.
    const msgRes = await pool.query(
      `WITH RECURSIVE
      target AS (
        SELECT * FROM raw_messages WHERE id = $1
      ),
      -- Programs involved with the target or its direct replies
      related_programs AS (
        SELECT destination AS addr FROM target
        UNION
        SELECT source AS addr FROM target
        UNION
        SELECT source AS addr FROM raw_messages WHERE reply_to = $1
        UNION
        SELECT destination AS addr FROM raw_messages WHERE reply_to = $1
      ),
      -- Recursively follow reply chains deeper than 1 level
      reply_chain AS (
        SELECT id, reply_to, 1 AS depth
        FROM raw_messages
        WHERE reply_to = $1
        UNION ALL
        SELECT rm.id, rm.reply_to, rc.depth + 1
        FROM raw_messages rm
        JOIN reply_chain rc ON rm.reply_to = rc.id
        WHERE rc.depth < 10
      )
      SELECT * FROM (
        SELECT * FROM target
        UNION
        SELECT rm.* FROM raw_messages rm, reply_chain rc WHERE rm.id = rc.id
        UNION
        SELECT r.* FROM raw_messages r, target t
        WHERE r.block_number >= t.block_number - 10
          AND r.block_number <= t.block_number + 5
          AND (r.source IN (SELECT addr FROM related_programs)
               OR r.destination IN (SELECT addr FROM related_programs))
          AND r.id != $1
      ) combined
      -- Exclude messages to the zero address (system/gas noise, not cross-program calls)
      WHERE combined.destination != '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 500`,
      [targetId],
    );

    if (msgRes.rows.length === 0) return undefined;
    const candidateRows = msgRes.rows;
    const messages = selectConnectedTraceMessages(
      candidateRows.map((row: any) => normalizeMessage({ ...row, __candidateRows: candidateRows })),
      targetId,
    );
    if (messages.length === 0) return undefined;
    const ids = messages.map((m) => m.id);

    const statusRes =
      ids.length > 0
        ? await pool.query(
            `SELECT * FROM dispatch_records WHERE id = ANY($1::text[])`,
            [ids],
          )
        : { rows: [] as any[] };

    return {
      messages,
      statuses: statusRes.rows.map(normalizeDispatch),
    };
  } catch (err) {
    console.warn("DataSource: Postgres query error (", (err as Error).message, ") — falling back.");
    return undefined;
  }
}

async function resolveTraceTargetId(pool: any, idOrTxHash: string): Promise<string | null> {
  const byMessage = await pool.query(
    "SELECT id FROM raw_messages WHERE id = $1 LIMIT 1",
    [idOrTxHash],
  );
  if (byMessage.rows[0]?.id) return byMessage.rows[0].id;

  const byTx = await pool.query(
    `SELECT id
     FROM raw_messages
     WHERE tx_hash = $1
     ORDER BY from_user DESC, block_number ASC, "index" ASC
     LIMIT 1`,
    [idOrTxHash.toLowerCase()],
  );
  return byTx.rows[0]?.id ?? null;
}

function normalizeMessage(row: any): RawMessage {
  const idx = row["index"] ?? row.index ?? 0;
  const fromUser =
    row.from_user && !hasInferredParentInRows(row, row.__candidateRows)
      ? true
      : undefined;
  return {
    id: row.id,
    source: row.source,
    destination: row.destination,
    payload: row.payload ?? "0x",
    value: row.value ?? "0",
    blockNumber: row.block_number,
    index: Number(idx),
    timestamp: row.timestamp ? new Date(row.timestamp).getTime() : undefined,
    replyTo: row.reply_to ?? null,
    fromUser,
  };
}

function normalizeDispatch(row: any): DispatchRecord {
  return {
    id: row.id,
    status: row.status,
    error: row.error ?? undefined,
  };
}

function normalizeRecentTrace(row: any): RecentTrace {
  const idx = row["index"] ?? row.index ?? 0;
  return {
    id: row.id,
    source: row.source,
    destination: row.destination,
    blockNumber: Number(row.block_number),
    index: Number(idx),
    status: row.status ?? "NotExecuted",
    replyCount: Number(row.reply_count ?? 0),
  };
}

/**
 * Keep only the reconstructed component that contains the requested message.
 *
 * The SQL query intentionally fetches a small neighborhood around the target so
 * spawned children can be discovered. Busy blocks can still contain unrelated
 * traffic involving the same programs, so this pass removes disconnected roots
 * before the core tree builder sees them.
 */
export function selectConnectedTraceMessages(
  rawMessages: RawMessage[],
  targetId: string,
): RawMessage[] {
  if (rawMessages.length === 0) return [];

  const ordered = [...rawMessages].sort(
    (a, b) => a.blockNumber - b.blockNumber || a.index - b.index,
  );
  const byId = new Map(ordered.map((m) => [m.id, m]));
  if (!byId.has(targetId)) return [];

  const parentOf = new Map<string, string>();

  for (const msg of ordered) {
    if (msg.replyTo && byId.has(msg.replyTo)) {
      parentOf.set(msg.id, msg.replyTo);
      continue;
    }
    if (msg.replyTo || msg.fromUser) continue;

    const parent = findInferredParent(msg, ordered);
    if (parent) {
      parentOf.set(msg.id, parent.id);
    }
  }

  let rootId = targetId;
  const guard = new Set<string>();
  while (parentOf.has(rootId) && !guard.has(rootId)) {
    guard.add(rootId);
    rootId = parentOf.get(rootId)!;
  }

  const childrenOf = new Map<string, string[]>();
  for (const [child, parent] of parentOf) {
    const children = childrenOf.get(parent) ?? [];
    children.push(child);
    childrenOf.set(parent, children);
  }

  const connected = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const cursor = queue.shift()!;
    if (connected.has(cursor)) continue;
    connected.add(cursor);
    for (const child of childrenOf.get(cursor) ?? []) {
      queue.push(child);
    }
  }

  return ordered.filter((m) => connected.has(m.id));
}

function hasInferredParentInRows(row: any, candidateRows: any[] | undefined): boolean {
  if (!candidateRows || row.reply_to) return false;
  const msg = {
    id: row.id,
    source: row.source,
    destination: row.destination,
    blockNumber: row.block_number,
    index: Number(row["index"] ?? row.index ?? 0),
  };
  for (const other of candidateRows) {
    if (other.id === msg.id) continue;
    const otherIndex = Number(other["index"] ?? other.index ?? 0);
    const isBefore =
      Number(other.block_number) < msg.blockNumber ||
      (Number(other.block_number) === msg.blockNumber && otherIndex < msg.index);
    if (isBefore && other.destination === msg.source) {
      return true;
    }
  }
  return false;
}

function findInferredParent(
  msg: RawMessage,
  ordered: RawMessage[],
): RawMessage | undefined {
  let candidate: RawMessage | undefined;
  for (const other of ordered) {
    if (other.id === msg.id) break;
    const isBefore =
      other.blockNumber < msg.blockNumber ||
      (other.blockNumber === msg.blockNumber && other.index < msg.index);
    if (isBefore && other.destination === msg.source) {
      candidate = other;
    }
  }
  return candidate;
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Resolve a user-provided id to a raw trace.
 *
 * Resolution order:
 *   1. Postgres (if DATABASE_URL is configured and has data)
 *   2. Fixture by message id (exact match)
 *   3. Fixture by alias (case-insensitive, e.g. "simple", "failure")
 */
export async function fetchRawTrace(id: string): Promise<RawTrace | undefined> {
  // Try Postgres first (live data from the indexer)
  const pgTrace = await fetchFromPg(id);
  if (pgTrace) return pgTrace;

  // Fall back to fixtures
  return byMessageId.get(id) ?? aliases.get(id.toLowerCase());
}

export async function closeDataSourceConnection(): Promise<void> {
  if (pgPool) {
    try {
      await pgPool.end?.();
    } catch {
      // ignore
    }
    pgPool = null;
  }
  pgAvailable = false;
  pgStatus = {
    mode: "fixture",
    postgres: process.env.DATABASE_URL ? "empty" : "unconfigured",
    liveMessages: 0,
    fixtures: Object.keys(fixtures).length,
  };
}

/** List sample entry points so the UI/devs have something to try. */
export function listSamples(): { alias: string; rootMessageId: string; description: string }[] {
  const describe: Record<string, string> = {
    simple: "Two-program call (user → A → B)",
    reply: "Reply linked via reply.to",
    fanout: "Three-level fan-out",
    failure: "Failed cross-program call (failure path)",
    replychain: "Reply chain with failure at depth 4",
    mixed: "Fan-out with one failing branch",
  };
  return Object.entries(fixtures).map(([alias, make]) => {
    const t = make();
    return { alias, rootMessageId: t.messages[0]!.id, description: describe[alias]! };
  });
}

export async function getDataSourceStatus(): Promise<DataSourceStatus> {
  await refreshPgStatus();
  return pgStatus;
}

export async function listRecentTraces(limit = 8): Promise<RecentTrace[]> {
  const pool = await getPgPool();
  if (pool) await refreshPgStatus();
  if (!pool || !pgAvailable) return [];

  const safeLimit = Math.max(1, Math.min(25, Math.floor(limit)));

  try {
    const res = await pool.query(
      `SELECT
         rm.id,
         rm.source,
         rm.destination,
         rm.block_number,
         rm."index",
         COALESCE(dr.status, 'NotExecuted') AS status,
         COUNT(reply.id)::int AS reply_count
       FROM raw_messages rm
       LEFT JOIN dispatch_records dr ON dr.id = rm.id
       LEFT JOIN raw_messages reply ON reply.reply_to = rm.id
       WHERE rm.reply_to IS NULL
         AND rm.destination != '0x0000000000000000000000000000000000000000000000000000000000000000'
       GROUP BY rm.id, rm.source, rm.destination, rm.block_number, rm."index", dr.status
       ORDER BY rm.block_number DESC, rm."index" DESC
       LIMIT $1`,
      [safeLimit],
    );

    return res.rows.map(normalizeRecentTrace);
  } catch (err) {
    console.warn("DataSource: recent traces query error (", (err as Error).message, ")");
    return [];
  }
}
