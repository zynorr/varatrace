import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTraceTree } from "../../../packages/core/src/index.js";
import {
  closeDataSourceConnection,
  fetchRawTrace,
  getDataSourceStatus,
  listRecentTraces,
  selectConnectedTraceMessages,
} from "./dataSource.js";

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  poolQuery: vi.fn(),
  poolEnd: vi.fn(),
  poolCtor: vi.fn(),
}));

vi.mock("pg", () => ({
  default: {
    Pool: mocks.poolCtor,
  },
}));

const A = "0x" + "a".repeat(64);
const B = "0x" + "b".repeat(64);
const C = "0x" + "c".repeat(64);
const D = "0x" + "d".repeat(64);
const E = "0x" + "e".repeat(64);
const F = "0x" + "f".repeat(64);
const USER = "0x" + "1".repeat(64);
const OTHER_USER = "0x" + "2".repeat(64);

function row(
  id: string,
  source: string,
  destination: string,
  blockNumber: number,
  index: number,
  extra: Partial<Record<string, unknown>> = {},
) {
  return {
    id,
    source,
    destination,
    payload: "0x",
    value: "0",
    block_number: blockNumber,
    index,
    timestamp: null,
    reply_to: null,
    from_user: false,
    ...extra,
  };
}

function statsRow(messages: number, extra: Record<string, unknown> = {}) {
  return {
    messages,
    dispatches: 0,
    metadata: 0,
    last_indexed_block: null,
    updated_at: null,
    last_error: null,
    ...extra,
  };
}

beforeEach(() => {
  vi.resetModules();
  process.env.DATABASE_URL = "postgresql://varatrace:varatrace@localhost:5432/varatrace";
  mocks.clientQuery.mockReset();
  mocks.clientRelease.mockReset();
  mocks.poolQuery.mockReset();
  mocks.poolEnd.mockReset();
  mocks.poolCtor.mockReset();
  mocks.poolCtor.mockImplementation(() => ({
    connect: async () => ({
      query: mocks.clientQuery,
      release: mocks.clientRelease,
    }),
    query: mocks.poolQuery,
    end: mocks.poolEnd,
  }));
});

afterEach(async () => {
  await closeDataSourceConnection();
  delete process.env.DATABASE_URL;
});

describe("selectConnectedTraceMessages", () => {
  it("keeps only the reconstructed component that contains the target", () => {
    const root = row("root", USER, A, 100, 0, { from_user: true });
    const child = row("child", A, B, 100, 1);
    const grandchild = row("grandchild", B, C, 101, 0);
    const unrelatedRoot = row("noise-root", OTHER_USER, D, 100, 2, { from_user: true });
    const unrelatedChild = row("noise-child", D, E, 100, 3);

    const selected = selectConnectedTraceMessages(
      [unrelatedChild, grandchild, root, unrelatedRoot, child].map((r) => ({
        id: r.id,
        source: r.source,
        destination: r.destination,
        payload: r.payload,
        value: r.value,
        blockNumber: r.block_number,
        index: r.index,
        timestamp: undefined,
        replyTo: r.reply_to as string | null,
        fromUser: r.from_user ? true : undefined,
      })),
      "child",
    );

    expect(selected.map((m) => m.id)).toEqual(["root", "child", "grandchild"]);
  });

  it("walks through linked reply edges when the target is a reply", () => {
    const root = row("root", USER, A, 200, 0, { from_user: true });
    const child = row("child", A, B, 200, 1);
    const reply = row("reply", B, A, 201, 0, { reply_to: "child" });

    const selected = selectConnectedTraceMessages(
      [reply, child, root].map((r) => ({
        id: r.id,
        source: r.source,
        destination: r.destination,
        payload: r.payload,
        value: r.value,
        blockNumber: r.block_number,
        index: r.index,
        timestamp: undefined,
        replyTo: r.reply_to as string | null,
        fromUser: r.from_user ? true : undefined,
      })),
      "reply",
    );

    expect(selected.map((m) => m.id)).toEqual(["root", "child", "reply"]);
  });

  it("does not connect adjacent user-originated messages", () => {
    const first = row("first", USER, A, 100, 0, { from_user: true });
    const firstReply = row("first-reply", A, USER, 100, 1, { reply_to: "first" });
    const second = row("second", USER, B, 101, 0, { from_user: true });
    const secondReply = row("second-reply", B, USER, 101, 1, { reply_to: "second" });

    const selected = selectConnectedTraceMessages(
      [first, firstReply, second, secondReply].map((r) => ({
        id: r.id,
        source: r.source,
        destination: r.destination,
        payload: r.payload,
        value: r.value,
        blockNumber: r.block_number,
        index: r.index,
        timestamp: undefined,
        replyTo: r.reply_to as string | null,
        fromUser: r.from_user ? true : undefined,
      })),
      "second",
    );

    expect(selected.map((m) => m.id)).toEqual(["second", "second-reply"]);
  });
});

describe("fetchRawTrace with Postgres", () => {
  it("filters unrelated candidate rows before fetching statuses", async () => {
    const root = row("root", USER, A, 100, 0, { from_user: true });
    const child = row("child", A, B, 100, 1);
    const noiseRoot = row("noise-root", OTHER_USER, D, 100, 2, { from_user: true });
    const noiseChild = row("noise-child", D, F, 100, 3);

    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [statsRow(1)] })
      .mockResolvedValueOnce({ rows: [{ id: "child" }] })
      .mockResolvedValueOnce({
        rows: [noiseChild, child, root, noiseRoot],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: "root", status: "Success", error: null },
          { id: "child", status: "Success", error: null },
        ],
      });

    const trace = await fetchRawTrace("child");

    expect(trace!.messages.map((m) => m.id)).toEqual(["root", "child"]);
    expect(mocks.poolQuery).toHaveBeenLastCalledWith(
      "SELECT * FROM dispatch_records WHERE id = ANY($1::text[])",
      [["root", "child"]],
    );

    const tree = buildTraceTree(trace!.messages, trace!.statuses);
    expect(tree.rootId).toBe("root");
    expect(tree.edges).toHaveLength(1);
  });

  it("repairs stale from_user flags when candidate rows show an inferred parent", async () => {
    const root = row("root", USER, A, 100, 0, { from_user: true });
    const child = row("child", A, B, 100, 1, { from_user: true });

    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [statsRow(2)] })
      .mockResolvedValueOnce({ rows: [{ id: "root" }] })
      .mockResolvedValueOnce({ rows: [root, child] })
      .mockResolvedValueOnce({
        rows: [
          { id: "root", status: "Success", error: null },
          { id: "child", status: "Success", error: null },
        ],
      });

    const trace = await fetchRawTrace("root");
    const tree = buildTraceTree(trace!.messages, trace!.statuses);

    expect(trace!.messages.find((m) => m.id === "child")!.fromUser).toBeUndefined();
    expect(tree.edges).toEqual([{ from: "root", to: "child", confidence: "inferred" }]);
  });

  it("falls back to fixtures when Postgres is empty", async () => {
    mocks.poolQuery.mockResolvedValueOnce({ rows: [statsRow(0)] });

    const trace = await fetchRawTrace("simple");

    expect(trace).toBeDefined();
    expect(trace!.messages).toHaveLength(2);
    expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
  });

  it("refreshes empty Postgres state so live data can become available", async () => {
    const root = row("root", USER, A, 100, 0, { from_user: true });
    const child = row("child", A, B, 100, 1);

    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [statsRow(0)] })
      .mockResolvedValueOnce({ rows: [statsRow(2, { last_indexed_block: 1234, updated_at: Date.now() })] })
      .mockResolvedValueOnce({ rows: [{ id: "child" }] })
      .mockResolvedValueOnce({ rows: [child, root] })
      .mockResolvedValueOnce({
        rows: [
          { id: "root", status: "Success", error: null },
          { id: "child", status: "Success", error: null },
        ],
      });

    const fixtureTrace = await fetchRawTrace("simple");
    const liveTrace = await fetchRawTrace("child");

    expect(fixtureTrace!.messages).toHaveLength(2);
    expect(liveTrace!.messages.map((m) => m.id)).toEqual(["root", "child"]);
  });

  it("resolves a transaction hash to the earliest indexed message in that extrinsic", async () => {
    const txHash = "0x" + "9".repeat(64);
    const root = row("root", USER, A, 100, 0, { from_user: true, tx_hash: txHash });
    const child = row("child", A, B, 100, 1, { tx_hash: txHash });

    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [statsRow(2)] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "root" }] })
      .mockResolvedValueOnce({ rows: [child, root] })
      .mockResolvedValueOnce({
        rows: [
          { id: "root", status: "Success", error: null },
          { id: "child", status: "Success", error: null },
        ],
      });

    const trace = await fetchRawTrace(txHash);

    expect(trace!.messages.map((m) => m.id)).toEqual(["root", "child"]);
    expect(mocks.poolQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("WHERE tx_hash = $1"),
      [txHash],
    );
  });

  it("reports data-source status", async () => {
    mocks.poolQuery.mockResolvedValueOnce({
      rows: [statsRow(3, {
        dispatches: 2,
        metadata: 1,
        last_indexed_block: 1234,
        updated_at: Date.now(),
      })],
    });

    const status = await getDataSourceStatus();

    expect(status).toMatchObject({
      mode: "live",
      postgres: "ready",
      liveMessages: 3,
      liveDispatches: 2,
      metadataPrograms: 1,
      lastIndexedBlock: 1234,
    });
  });

  it("lists recent non-reply live trace candidates", async () => {
    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [statsRow(2)] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "root",
            source: USER,
            destination: A,
            block_number: 123,
            index: 0,
            status: "Success",
            reply_count: 1,
          },
        ],
      });

    const recent = await listRecentTraces(5);

    expect(recent).toEqual([
      {
        id: "root",
        source: USER,
        destination: A,
        blockNumber: 123,
        index: 0,
        status: "Success",
        replyCount: 1,
      },
    ]);
    expect(mocks.poolQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("rm.reply_to IS NULL"),
      [5],
    );
  });

  it("returns no recent traces when live Postgres is unavailable", async () => {
    mocks.poolQuery.mockResolvedValueOnce({ rows: [statsRow(0)] });

    await expect(listRecentTraces()).resolves.toEqual([]);
  });
});
