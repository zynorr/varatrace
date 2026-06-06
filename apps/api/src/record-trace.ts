/**
 * Recording script: captures raw trace data from Postgres and saves it as a
 * JSON fixture file for regression testing.
 *
 * Usage:
 *   npx tsx src/record-trace.ts <trace-id> [output-name]
 *
 * Example:
 *   npx tsx src/record-trace.ts 0xedf90ee4d043992943366f0c3b00c9c1c6480e5d8b645093407c54b4e4c7aae9 trace-reply-chain-1
 *
 * The output is saved to ../../packages/core/src/recorded-traces/<output-name>.json
 * and contains { messages: RawMessage[], statuses: DispatchRecord[] }.
 */
import "dotenv/config";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { selectConnectedTraceMessages } from "./dataSource.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const traceId = process.argv[2];
if (!traceId) {
  console.error("Usage: npx tsx src/record-trace.ts <trace-id> [output-name]");
  process.exit(1);
}
const targetTraceId = traceId;

const outputName = process.argv[3] ?? `trace-${targetTraceId.slice(0, 16)}`;

async function main() {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: DATABASE_URL });

  // Same trace-neighborhood CTE as dataSource.ts / audit-live-traces.ts.
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
    [targetTraceId],
  );

  if (msgRes.rows.length === 0) {
    console.error("No messages found for ID:", targetTraceId);
    await pool.end();
    process.exit(1);
  }

  const candidateRows = msgRes.rows;
  const messages = selectConnectedTraceMessages(
    candidateRows.map((row: any) => normalizeMessage(row, candidateRows)),
    targetTraceId,
  );

  if (messages.length === 0) {
    console.error("No connected messages found for ID:", targetTraceId);
    await pool.end();
    process.exit(1);
  }

  const ids = messages.map((m) => m.id);
  const statusRes =
    ids.length > 0
      ? await pool.query(
          `SELECT * FROM dispatch_records WHERE id = ANY($1::text[])`,
          [ids],
        )
      : { rows: [] as any[] };

  const statuses = statusRes.rows.map((row: any) => ({
    id: row.id,
    status: row.status,
    error: row.error ?? undefined,
  }));

  const output = { messages, statuses };

  // Save to packages/core/src/recorded-traces/
  const outputDir = join(__dirname, "../../../packages/core/src/recorded-traces");
  const outputPath = join(outputDir, `${outputName}.json`);

  // Ensure directory exists
  const { mkdirSync, existsSync } = await import("fs");
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Recorded trace saved to: ${outputPath}`);
  console.log(`Messages: ${messages.length}, Statuses: ${statuses.length}`);

  // Show a summary for quick inspection
  const byId = new Map(messages.map((m: any) => [m.id, m]));
  const children = new Map<string, string[]>();
  for (const m of messages) {
    if (m.replyTo && byId.has(m.replyTo)) {
      const list = children.get(m.replyTo) ?? [];
      list.push(m.id);
      children.set(m.replyTo, list);
    }
  }
  const roots = messages.filter((m: any) => !m.replyTo || !byId.has(m.replyTo));
  console.log(`Roots: ${roots.length}`);
  for (const r of roots.slice(0, 3)) {
    console.log(`  ${r.id.slice(0, 20)}... → ${r.destination.slice(0, 16)}...`);
    const kids = children.get(r.id) ?? [];
    for (const k of kids) {
      const msg = byId.get(k)!;
      console.log(`    ↳ ${k.slice(0, 20)}... → ${msg.destination.slice(0, 16)}... (reply)`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});

function normalizeMessage(row: any, candidateRows: any[]) {
  return {
    id: row.id,
    source: row.source,
    destination: row.destination,
    payload: row.payload ?? "0x",
    value: row.value ?? "0",
    blockNumber: Number(row.block_number),
    index: Number(row["index"] ?? row.index ?? 0),
    timestamp: row.timestamp ? Number(row.timestamp) : undefined,
    replyTo: row.reply_to ?? null,
    fromUser:
      row.from_user && !hasInferredParentInRows(row, candidateRows)
        ? true
        : undefined,
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
