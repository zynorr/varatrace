import "dotenv/config";
import pg from "pg";
import {
  buildTraceTree,
  type DispatchRecord,
  type RawMessage,
  type TraceTree,
} from "../../../packages/core/src/index.js";
import { selectConnectedTraceMessages } from "./dataSource.js";

type AuditSource = "api" | "db";

interface AuditResult {
  candidates: AuditCandidate[];
  rootCount: number;
  diagnostics?: FailureDiagnostics;
}

interface AuditCandidate {
  id: string;
  blockNumber: number;
  nodes: number;
  edges: number;
  linked: number;
  inferred: number;
  failures: number;
  delayedBlocks: number;
  hasFailurePath: boolean;
}

interface FailureDiagnostics {
  failedDispatches: number;
  failedWithRawMessage: number;
  failedWithoutRawMessage: number;
}

function parseLimit(): number {
  const arg = process.argv.find((value) => value.startsWith("--limit="));
  const parsed = Number(arg?.split("=")[1] ?? 100);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(500, Math.floor(parsed))) : 100;
}

function parseSource(): AuditSource {
  const arg = process.argv.find((value) => value.startsWith("--source="));
  const source = (arg?.split("=")[1] ?? process.env.VARATRACE_AUDIT_SOURCE ?? "api").toLowerCase();
  return source === "db" ? "db" : "api";
}

function parseApiUrl(): string {
  const arg = process.argv.find((value) => value.startsWith("--api-url="));
  return (arg?.split("=")[1] ?? process.env.VARATRACE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
}

function formatId(id: string): string {
  return id.startsWith("0x") && id.length > 12 ? `${id.slice(0, 10)}...${id.slice(-6)}` : id;
}

function candidateFromTree(id: string, blockNumber: number, tree: TraceTree): AuditCandidate {
  const linked = tree.edges.filter((edge) => edge.confidence === "linked").length;
  const inferred = tree.edges.filter((edge) => edge.confidence === "inferred").length;
  const failures = tree.nodes.filter((node) => node.status === "Failed").length;
  const minBlock = Math.min(...tree.nodes.map((node) => node.blockNumber));
  const maxBlock = Math.max(...tree.nodes.map((node) => node.blockNumber));

  return {
    id,
    blockNumber,
    nodes: tree.nodes.length,
    edges: tree.edges.length,
    linked,
    inferred,
    failures,
    delayedBlocks: maxBlock - minBlock,
    hasFailurePath: Boolean(tree.failure),
  };
}

function printTable(title: string, rows: AuditCandidate[]): void {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log("  none found in the current indexed sample");
    return;
  }

  for (const row of rows) {
    const flags = [
      row.inferred > 0 ? `${row.inferred} inferred` : null,
      row.failures > 0 ? `${row.failures} failed` : null,
      row.delayedBlocks > 0 ? `+${row.delayedBlocks} blocks` : null,
    ].filter(Boolean).join(", ");
    console.log(
      `  #${row.blockNumber} ${formatId(row.id)} ` +
      `nodes=${row.nodes} edges=${row.edges} linked=${row.linked} ` +
      `inferred=${row.inferred} failures=${row.failures}` +
      (flags ? ` (${flags})` : ""),
    );
  }
}

async function auditFromApi(
  limit: number,
  apiUrl: string,
): Promise<AuditResult> {
  const recentRes = await fetch(`${apiUrl}/recent?limit=${encodeURIComponent(String(limit))}`);
  if (!recentRes.ok) {
    throw new Error(`Failed to fetch recent traces from ${apiUrl} (${recentRes.status})`);
  }

  const recent = (await recentRes.json()) as {
    traces?: { id: string; blockNumber: number }[];
  };
  const roots = recent.traces ?? [];
  const candidates: AuditCandidate[] = [];

  for (const root of roots) {
    const traceRes = await fetch(`${apiUrl}/trace/${encodeURIComponent(root.id)}`);
    if (!traceRes.ok) continue;
    const tree = (await traceRes.json()) as TraceTree;
    candidates.push(candidateFromTree(root.id, root.blockNumber, tree));
  }

  return { candidates, rootCount: roots.length };
}

async function auditFromDb(limit: number): Promise<AuditResult> {
  const connectionString = process.env.DATABASE_URL ?? "postgresql://varatrace:varatrace@localhost:5432/varatrace";
  const pool = new pg.Pool({ connectionString, max: 2 });
  try {
    const rootRes = await pool.query(
      `SELECT id, block_number
       FROM raw_messages
       WHERE reply_to IS NULL
         AND destination != '0x0000000000000000000000000000000000000000000000000000000000000000'
       ORDER BY block_number DESC, "index" DESC
       LIMIT $1`,
      [limit],
    );

    const diagnostics = await fetchFailureDiagnostics(pool);
    const roots = rootRes.rows.map((row) => ({
      id: String(row.id),
      blockNumber: Number(row.block_number),
    }));
    const candidates: AuditCandidate[] = [];

    for (const root of roots) {
      const raw = await fetchRawTraceFromPool(pool, root.id);
      if (!raw) continue;
      const tree = buildTraceTree(raw.messages, raw.statuses);
      candidates.push(candidateFromTree(root.id, root.blockNumber, tree));
    }

    return { candidates, rootCount: roots.length, diagnostics };
  } finally {
    await pool.end();
  }
}

async function fetchFailureDiagnostics(pool: pg.Pool): Promise<FailureDiagnostics> {
  const res = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE dr.status = 'Failed')::int AS failed,
       COUNT(*) FILTER (WHERE dr.status = 'Failed' AND rm.id IS NOT NULL)::int AS with_message
     FROM dispatch_records dr
     LEFT JOIN raw_messages rm ON rm.id = dr.id`,
  );
  const row = res.rows[0] ?? {};
  const failedDispatches = Number(row.failed ?? 0);
  const failedWithRawMessage = Number(row.with_message ?? 0);
  return {
    failedDispatches,
    failedWithRawMessage,
    failedWithoutRawMessage: Math.max(0, failedDispatches - failedWithRawMessage),
  };
}

async function fetchRawTraceFromPool(
  pool: pg.Pool,
  id: string,
): Promise<{ messages: RawMessage[]; statuses: DispatchRecord[] } | undefined> {
  const msgRes = await pool.query(
    `WITH RECURSIVE
    target AS (
      SELECT * FROM raw_messages WHERE id = $1
    ),
    related_programs AS (
      SELECT destination AS addr FROM target
      UNION
      SELECT source AS addr FROM target
      UNION
      SELECT source AS addr FROM raw_messages WHERE reply_to = $1
      UNION
      SELECT destination AS addr FROM raw_messages WHERE reply_to = $1
    ),
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
    WHERE combined.destination != '0x0000000000000000000000000000000000000000000000000000000000000000'
    LIMIT 500`,
    [id],
  );

  if (msgRes.rows.length === 0) return undefined;

  const candidateRows = msgRes.rows;
  const messages = selectConnectedTraceMessages(
    candidateRows.map((row: any) => normalizeMessage(row, candidateRows)),
    id,
  );
  if (messages.length === 0) return undefined;

  const ids = messages.map((message) => message.id);
  const statusRes = await pool.query(
    `SELECT * FROM dispatch_records WHERE id = ANY($1::text[])`,
    [ids],
  );

  return {
    messages,
    statuses: statusRes.rows.map(normalizeDispatch),
  };
}

function normalizeMessage(row: any, candidateRows: any[]): RawMessage {
  const idx = Number(row["index"] ?? row.index ?? 0);
  return {
    id: row.id,
    source: row.source,
    destination: row.destination,
    payload: row.payload ?? "0x",
    value: row.value ?? "0",
    blockNumber: Number(row.block_number),
    index: idx,
    timestamp: row.timestamp ? Number(row.timestamp) : undefined,
    replyTo: row.reply_to ?? null,
    fromUser:
      row.from_user && !hasInferredParentInRows(row, candidateRows)
        ? true
        : undefined,
  };
}

function normalizeDispatch(row: any): DispatchRecord {
  return {
    id: row.id,
    status: row.status,
    error: row.error ?? undefined,
  };
}

function hasInferredParentInRows(row: any, candidateRows: any[]): boolean {
  if (row.reply_to) return false;
  const blockNumber = Number(row.block_number);
  const index = Number(row["index"] ?? row.index ?? 0);

  for (const other of candidateRows) {
    if (other.id === row.id) continue;
    const otherBlock = Number(other.block_number);
    const otherIndex = Number(other["index"] ?? other.index ?? 0);
    const isBefore =
      otherBlock < blockNumber ||
      (otherBlock === blockNumber && otherIndex < index);
    if (isBefore && other.destination === row.source) {
      return true;
    }
  }

  return false;
}

async function main(): Promise<void> {
  const limit = parseLimit();
  const source = parseSource();
  const apiUrl = parseApiUrl();
  const { candidates, rootCount, diagnostics } =
    source === "api" ? await auditFromApi(limit, apiUrl) : await auditFromDb(limit);

  console.log(`VaraTrace live trace audit`);
  console.log(`  source: ${source === "api" ? apiUrl : "Postgres"}`);
  console.log(`  scanned roots: ${candidates.length}/${rootCount}`);
  if (diagnostics) {
    console.log(
      `  failed dispatches: ${diagnostics.failedDispatches} ` +
      `(${diagnostics.failedWithRawMessage} with raw message, ` +
      `${diagnostics.failedWithoutRawMessage} dispatch-only)`,
    );
  }

  printTable(
    "Rich traces (3+ nodes)",
    candidates.filter((candidate) => candidate.nodes >= 3),
  );
  printTable(
    "Inferred-edge traces",
    candidates.filter((candidate) => candidate.inferred > 0),
  );
  printTable(
    "Failure-path traces",
    candidates.filter((candidate) => candidate.failures > 0 || candidate.hasFailurePath),
  );
  printTable(
    "Cross-block / delayed traces",
    candidates.filter((candidate) => candidate.delayedBlocks > 0),
  );

  const ready =
    candidates.filter((candidate) => candidate.nodes >= 3).length >= 5 &&
    candidates.some((candidate) => candidate.inferred > 0) &&
    candidates.some((candidate) => candidate.failures > 0 || candidate.hasFailurePath) &&
    candidates.some((candidate) => candidate.delayedBlocks > 0);

  console.log(`\nMVP validation readiness: ${ready ? "ready" : "needs richer indexed traces"}`);
  if (
    diagnostics &&
    !candidates.some((candidate) => candidate.failures > 0 || candidate.hasFailurePath) &&
    diagnostics.failedDispatches > 0 &&
    diagnostics.failedWithRawMessage === 0
  ) {
    console.log(
      "Failure note: indexed failures are dispatch-only records; a failure path needs the failed message in raw_messages.",
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
