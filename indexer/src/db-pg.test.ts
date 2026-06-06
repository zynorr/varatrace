/**
 * Integration tests for the Postgres-backed storage adapter (db-pg.ts).
 *
 * Requires a running Postgres instance with a `varatrace_test` database.
 * Set DATABASE_URL to override the test connection string.
 *
 * Usage:
 *   cd indexer && npx vitest run src/db-pg.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as db from "./db-pg.js";

const TEST_DB_URL =
  process.env.DATABASE_URL ??
  "postgresql://varatrace:varatrace@localhost:5432/varatrace_test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanDb() {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: TEST_DB_URL });
    try {
      await pool.query("DROP TABLE IF EXISTS raw_messages CASCADE");
      await pool.query("DROP TABLE IF EXISTS dispatch_records CASCADE");
      await pool.query("DROP TABLE IF EXISTS program_metadata CASCADE");
      await pool.query("DROP TABLE IF EXISTS program_idls CASCADE");
      await pool.query("DROP TABLE IF EXISTS indexer_state CASCADE");
    } finally {
      await pool.end();
    }
}

const SAMPLE_MESSAGE = {
  id: "0x1111111111111111111111111111111111111111111111111111111111111111",
  source: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  destination: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  payload: "0xdeadbeef",
  value: "100",
  block_number: 1000,
  index: 0,
  timestamp: 1_700_000_000_000,
  reply_to: null,
  from_user: false,
  tx_hash: "0xtx111111111111111111111111111111111111111111111111111111111111",
};

const SAMPLE_MESSAGE_2 = {
  id: "0x2222222222222222222222222222222222222222222222222222222222222222",
  source: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  destination: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  payload: "0xcafe",
  value: "200",
  block_number: 1001,
  index: 0,
  timestamp: 1_700_000_000_001,
  reply_to: null,
  from_user: true,
  tx_hash: "0xtx222222222222222222222222222222222222222222222222222222222222",
};

const SAMPLE_STATUS = {
  id: "0x1111111111111111111111111111111111111111111111111111111111111111",
  status: "Success",
  error: null,
  block_number: 1000,
};

const SAMPLE_STATUS_2 = {
  id: "0x2222222222222222222222222222222222222222222222222222222222222222",
  status: "Failed",
  error: "Some error",
  block_number: 1001,
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let origDbUrl: string | undefined;

beforeAll(async () => {
  // Override DATABASE_URL so db-pg.ts uses the test database
  origDbUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = TEST_DB_URL;

  // Reset the module-level pool by closing any existing one, then clean
  await db.close().catch(() => {});
  await cleanDb();
});

afterAll(async () => {
  await db.close().catch(() => {});
  await cleanDb();
  if (origDbUrl) {
    process.env.DATABASE_URL = origDbUrl;
  } else {
    delete process.env.DATABASE_URL;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("db-pg", () => {
  describe("ensureSchema", () => {
    it("creates tables and indexes", async () => {
      await db.ensureSchema();

      // Verify tables exist by querying information_schema
      const { default: pg } = await import("pg");
      const pool = new pg.Pool({ connectionString: TEST_DB_URL });
      try {
        const tables = await pool.query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public'
           ORDER BY table_name`,
        );
        const names = tables.rows.map((r: any) => r.table_name).sort();
        expect(names).toContain("raw_messages");
        expect(names).toContain("dispatch_records");
        expect(names).toContain("program_metadata");
        expect(names).toContain("program_idls");
        expect(names).toContain("indexer_state");

        // Verify indexes exist
        const indexes = await pool.query(
          `SELECT indexname FROM pg_indexes
           WHERE tablename IN ('raw_messages', 'dispatch_records')
           ORDER BY indexname`,
        );
        const idxNames = indexes.rows.map((r: any) => r.indexname);
        expect(idxNames).toContain("idx_messages_block");
        expect(idxNames).toContain("idx_messages_source");
        expect(idxNames).toContain("idx_messages_dest");
        expect(idxNames).toContain("idx_messages_tx_hash");
        expect(idxNames).toContain("idx_dispatches_block");
      } finally {
        await pool.end();
      }
    });

    it("is idempotent (safe to call multiple times)", async () => {
      await db.ensureSchema(); // second call should not throw
      await db.ensureSchema(); // third call should not throw
    });
  });

  describe("insertMessages", () => {
    it("inserts a batch of messages", async () => {
      await db.insertMessages([SAMPLE_MESSAGE]);
      const { default: pg } = await import("pg");
      const pool = new pg.Pool({ connectionString: TEST_DB_URL });
      try {
        const res = await pool.query("SELECT * FROM raw_messages WHERE id = $1", [SAMPLE_MESSAGE.id]);
        expect(res.rows.length).toBe(1);
        expect(res.rows[0]!.id).toBe(SAMPLE_MESSAGE.id);
        expect(res.rows[0]!.source).toBe(SAMPLE_MESSAGE.source);
        expect(res.rows[0]!.destination).toBe(SAMPLE_MESSAGE.destination);
        expect(res.rows[0]!.payload).toBe(SAMPLE_MESSAGE.payload);
        expect(res.rows[0]!.value).toBe(SAMPLE_MESSAGE.value);
        expect(res.rows[0]!.block_number).toBe(SAMPLE_MESSAGE.block_number);
        expect(res.rows[0]!["index"]).toBe(SAMPLE_MESSAGE.index);
        expect(res.rows[0]!.timestamp).toBe(String(SAMPLE_MESSAGE.timestamp));
        expect(res.rows[0]!.reply_to).toBeNull();
        expect(res.rows[0]!.from_user).toBe(false);
        expect(res.rows[0]!.tx_hash).toBe(SAMPLE_MESSAGE.tx_hash);
      } finally {
        await pool.end();
      }
    });

    it("can enrich an existing message row with a tx hash", async () => {
      const id = "0x5555555555555555555555555555555555555555555555555555555555555555";
      await db.insertMessages([{ ...SAMPLE_MESSAGE, id, tx_hash: null }]);
      await db.insertMessages([{ ...SAMPLE_MESSAGE, id, tx_hash: "0x" + "5".repeat(64) }]);

      const { default: pg } = await import("pg");
      const pool = new pg.Pool({ connectionString: TEST_DB_URL });
      try {
        const res = await pool.query("SELECT tx_hash FROM raw_messages WHERE id = $1", [id]);
        expect(res.rows[0]!.tx_hash).toBe("0x" + "5".repeat(64));
      } finally {
        await pool.end();
      }
    });

    it("handles duplicate IDs with ON CONFLICT DO NOTHING", async () => {
      // Insert the same message again — should not throw
      await db.insertMessages([SAMPLE_MESSAGE]);
      // Verify still only one copy
      const { default: pg } = await import("pg");
      const pool = new pg.Pool({ connectionString: TEST_DB_URL });
      try {
        const res = await pool.query("SELECT COUNT(*)::int AS cnt FROM raw_messages WHERE id = $1", [SAMPLE_MESSAGE.id]);
        expect(res.rows[0]!.cnt).toBe(1);
      } finally {
        await pool.end();
      }
    });

    it("handles empty batch (no-op)", async () => {
      await expect(db.insertMessages([])).resolves.toBeUndefined();
    });

    it("inserts multiple messages in one batch", async () => {
      const msg3 = { ...SAMPLE_MESSAGE, id: "0x3333333333333333333333333333333333333333333333333333333333333333", block_number: 1002 };
      const msg4 = { ...SAMPLE_MESSAGE, id: "0x4444444444444444444444444444444444444444444444444444444444444444", block_number: 1002 };
      await db.insertMessages([msg3, msg4]);

      const { default: pg } = await import("pg");
      const pool = new pg.Pool({ connectionString: TEST_DB_URL });
      try {
        const res = await pool.query("SELECT COUNT(*)::int AS cnt FROM raw_messages WHERE block_number = 1002");
        expect(res.rows[0]!.cnt).toBe(2);
      } finally {
        await pool.end();
      }
    });
  });

  describe("insertDispatchStatuses", () => {
    it("inserts a dispatch status", async () => {
      await db.insertDispatchStatuses([SAMPLE_STATUS]);
      const { default: pg } = await import("pg");
      const pool = new pg.Pool({ connectionString: TEST_DB_URL });
      try {
        const res = await pool.query("SELECT * FROM dispatch_records WHERE id = $1", [SAMPLE_STATUS.id]);
        expect(res.rows.length).toBe(1);
        expect(res.rows[0]!.id).toBe(SAMPLE_STATUS.id);
        expect(res.rows[0]!.status).toBe(SAMPLE_STATUS.status);
        expect(res.rows[0]!.error).toBeNull();
        expect(res.rows[0]!.block_number).toBe(SAMPLE_STATUS.block_number);
      } finally {
        await pool.end();
      }
    });

    it("handles duplicate IDs in same batch (deduplicates before insert)", async () => {
      // Insert with duplicate IDs in the same batch — should not throw
      const dup = { ...SAMPLE_STATUS, id: "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddead" };
      await db.insertDispatchStatuses([dup, dup, dup]);
      // Should have only one copy
      const { default: pg } = await import("pg");
      const pool = new pg.Pool({ connectionString: TEST_DB_URL });
      try {
        const res = await pool.query("SELECT COUNT(*)::int AS cnt FROM dispatch_records WHERE id = $1", [dup.id]);
        expect(res.rows[0]!.cnt).toBe(1);
      } finally {
        await pool.end();
      }
    });

    it("handles duplicate IDs across batches with ON CONFLICT DO NOTHING", async () => {
      // Already inserted SAMPLE_STATUS — re-inserting should not throw
      await db.insertDispatchStatuses([SAMPLE_STATUS]);
      const { default: pg } = await import("pg");
      const pool = new pg.Pool({ connectionString: TEST_DB_URL });
      try {
        const res = await pool.query("SELECT COUNT(*)::int AS cnt FROM dispatch_records WHERE id = $1", [SAMPLE_STATUS.id]);
        expect(res.rows[0]!.cnt).toBe(1);
      } finally {
        await pool.end();
      }
    });

    it("handles empty batch (no-op)", async () => {
      await expect(db.insertDispatchStatuses([])).resolves.toBeUndefined();
    });

    it("inserts multiple statuses in one batch", async () => {
      const s3 = { ...SAMPLE_STATUS, id: "0x3333333333333333333333333333333333333333333333333333333333333333" };
      await db.insertDispatchStatuses([SAMPLE_STATUS_2, s3]);
      const { default: pg } = await import("pg");
      const pool = new pg.Pool({ connectionString: TEST_DB_URL });
      try {
        // Check specific IDs rather than total count (which depends on test order)
        const ids = (await pool.query(
          "SELECT id FROM dispatch_records WHERE id = ANY($1::text[])",
          [[SAMPLE_STATUS_2.id, s3.id]],
        )).rows.map((r: any) => r.id);
        expect(ids).toContain(SAMPLE_STATUS_2.id);
        expect(ids).toContain(s3.id);
      } finally {
        await pool.end();
      }
    });
  });

  describe("hasData", () => {
    it("returns true when data exists", async () => {
      const result = await db.hasData();
      expect(result).toBe(true);
    });

    it("returns false after cleaning up", async () => {
      await cleanDb();
      await db.ensureSchema();
      const result = await db.hasData();
      expect(result).toBe(false);
    });
  });

  describe("indexer state", () => {
    it("records indexer progress and reports aggregate stats", async () => {
      await db.insertMessages([SAMPLE_MESSAGE]);
      await db.insertDispatchStatuses([SAMPLE_STATUS]);
      await db.insertProgramMetadata([{ programId: SAMPLE_MESSAGE.destination, metaHex: "0x1234" }]);
      await db.updateIndexerState(1234);

      const stats = await db.getIndexerStats();

      expect(stats.messages).toBeGreaterThanOrEqual(1);
      expect(stats.dispatches).toBeGreaterThanOrEqual(1);
      expect(stats.metadata).toBeGreaterThanOrEqual(1);
      expect(stats.lastIndexedBlock).toBe(1234);
      expect(stats.updatedAt).toBeGreaterThan(0);
      expect(stats.lastError).toBeNull();
    });

    it("does not move last indexed block backwards", async () => {
      await db.updateIndexerState(1200);

      const stats = await db.getIndexerStats();

      expect(stats.lastIndexedBlock).toBe(1234);
    });
  });

  describe("fetchTrace", () => {
    beforeAll(async () => {
      // Ensure schema and seed data for trace tests
      await cleanDb();
      await db.ensureSchema();

      // Seed messages forming a small trace:
      //   root (from_user) → reply (reply_to = root.id)
      const root = {
        ...SAMPLE_MESSAGE,
        id: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        block_number: 2000,
        index: 0,
        from_user: true,
      };
      const reply = {
        ...SAMPLE_MESSAGE_2,
        id: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        source: root.destination,
        destination: root.source,
        block_number: 2001,
        index: 0,
        reply_to: root.id,
      };
      const unrelated = {
        ...SAMPLE_MESSAGE,
        id: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        block_number: 3000,
        index: 0,
      };

      await db.insertMessages([root, reply, unrelated]);

      // Seed a dispatch status for the root
      await db.insertDispatchStatuses([
        { id: root.id, status: "Success", error: null, block_number: 2000 },
        { id: reply.id, status: "Failed", error: "Nested failure", block_number: 2001 },
      ]);
    });

    it("returns messages and statuses for a known root id", async () => {
      const trace = await db.fetchTrace("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(trace).not.toBeNull();

      // Should find the root message and its reply (in the same block range)
      expect(trace!.messages.length).toBeGreaterThanOrEqual(2);
      const ids = trace!.messages.map((m) => m.id);
      expect(ids).toContain("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(ids).toContain("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

      // Should include statuses for both messages
      expect(trace!.statuses.length).toBeGreaterThanOrEqual(2);
    });

    it("returns null for an unknown id", async () => {
      const trace = await db.fetchTrace("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
      expect(trace).toBeNull();
    });
  });

  describe("dbPath", () => {
    it("returns a redacted DATABASE_URL", () => {
      const path = db.dbPath();
      expect(path).toBe("postgresql://varatrace:***@localhost:5432/varatrace_test");
    });
  });

  describe("close", () => {
    it("closes the pool without throwing", async () => {
      await expect(db.close()).resolves.toBeUndefined();
    });

    it("is idempotent (safe to call multiple times)", async () => {
      await db.close(); // second close should not throw
      await db.close(); // third close should not throw
    });
  });
});
