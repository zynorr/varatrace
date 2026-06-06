import { describe, expect, it, vi } from "vitest";
import {
  backfillBlocks,
  getExtrinsicHash,
  getExtrinsicIndex,
  normalizeDispatchError,
  parseMessageQueued,
  parseMessagesDispatched,
  parseUserMessageSent,
} from "./indexer.js";

const hex = (value: string) => ({ toHex: () => value, toString: () => value });
const text = (value: string) => ({ toHuman: () => value, toString: () => value });
const num = (value: string) => ({ toString: () => value });

describe("parseMessageQueued", () => {
  it("marks Init entries as user-originated root candidates", () => {
    const parsed = parseMessageQueued(
      [hex("0x01"), hex("0xuser"), hex("0xprogram"), text("Init")],
      100,
      2,
    );

    expect(parsed).toEqual({
      id: "0x01",
      source: "0xuser",
      destination: "0xprogram",
      entry: "Init",
      fromUser: true,
      blockNumber: 100,
      index: 2,
    });
  });

  it("does not mark Handle, Reply, or Signal entries as user-originated", () => {
    const handle = parseMessageQueued(
      [hex("0x00"), hex("0xprogram"), hex("0xchild"), text("Handle")],
      100,
      0,
    );
    const reply = parseMessageQueued(
      [hex("0x01"), hex("0xprogram"), hex("0xuser"), text("Reply")],
      100,
      1,
    );
    const signal = parseMessageQueued(
      [hex("0x02"), hex("0xprogram"), hex("0xuser"), { type: "Signal" }],
      100,
      2,
    );

    expect(handle.fromUser).toBe(false);
    expect(reply.fromUser).toBe(false);
    expect(signal.fromUser).toBe(false);
  });
});

describe("extrinsic hash helpers", () => {
  it("extracts the transaction hash for ApplyExtrinsic events", () => {
    const record = {
      phase: {
        isApplyExtrinsic: true,
        asApplyExtrinsic: { toString: () => "2" },
      },
    };
    const block = {
      block: {
        extrinsics: [
          { hash: hex("0xaaa") },
          { hash: hex("0xbbb") },
          { hash: hex("0xccc") },
        ],
      },
    };

    expect(getExtrinsicIndex(record)).toBe(2);
    expect(getExtrinsicHash(block, getExtrinsicIndex(record))).toBe("0xccc");
  });

  it("returns null for non-extrinsic phases", () => {
    expect(getExtrinsicIndex({ phase: { isApplyExtrinsic: false } })).toBeNull();
    expect(getExtrinsicHash({ block: { extrinsics: [] } }, null)).toBeNull();
  });
});

describe("parseUserMessageSent", () => {
  it("extracts reply target when details is an Option-like value", () => {
    const parsed = parseUserMessageSent(
      [
        {
          id: hex("0xmessage"),
          source: hex("0xprogram"),
          destination: hex("0xuser"),
          payload: hex("0xdeadbeef"),
          value: num("25"),
          details: {
            isSome: true,
            unwrap: () => ({ to: hex("0xparent") }),
          },
        },
      ],
      200,
      3,
    );

    expect(parsed.replyTo).toBe("0xparent");
    expect(parsed.payload).toBe("0xdeadbeef");
    expect(parsed.value).toBe("25");
  });
});

describe("parseMessagesDispatched", () => {
  it("parses iterable status maps", () => {
    const parsed = parseMessagesDispatched(
      [
        num("2"),
        [
          [hex("0xsuccess"), text("Success")],
          [hex("0xnot-executed"), text("NotExecuted")],
        ],
      ],
      300,
    );

    expect(parsed).toEqual([
      { id: "0xsuccess", status: "Success", error: null },
      { id: "0xnot-executed", status: "NotExecuted", error: null },
    ]);
  });

  it("normalizes failed dispatch details into readable text", () => {
    const parsed = parseMessagesDispatched(
      [
        num("1"),
        [
          [
            hex("0xfail"),
            {
              type: "Failed",
              asFailed: { type: "RanOutOfGas" },
              toHuman: () => "Failed",
            },
          ],
        ],
      ],
      301,
    );

    expect(parsed).toEqual([
      { id: "0xfail", status: "Failed", error: "Failed: RanOutOfGas" },
    ]);
  });
});

describe("normalizeDispatchError", () => {
  it("prefers nested enum labels over raw hex", () => {
    expect(
      normalizeDispatchError({
        type: "Failed",
        value: { type: "UserspacePanic" },
        toHex: () => "0x00",
      }),
    ).toBe("Failed: UserspacePanic");
  });

  it("falls back to raw hex when no readable label exists", () => {
    expect(
      normalizeDispatchError({
        type: "Failed",
        value: { toHex: () => "0xbeef", toString: () => "[object Object]" },
      }),
    ).toBe("Failed: 0xbeef");
  });
});

describe("backfillBlocks", () => {
  it("runs even when the database already has live data", async () => {
    const api = {
      rpc: {
        chain: {
          getFinalizedHead: async () => "head-hash",
          getHeader: async () => ({ number: { toNumber: () => 102 } }),
          getBlockHash: async (blockNumber: number) => `hash-${blockNumber}`,
        },
      },
      query: {
        system: {
          events: {
            at: async () => [],
          },
        },
      },
    } as any;
    const db = {
      hasData: async () => true,
      insertMessages: vi.fn(async () => {}),
      insertDispatchStatuses: vi.fn(async () => {}),
      updateIndexerState: vi.fn(async () => {}),
    } as any;

    await backfillBlocks(api, db, 101);

    expect(db.updateIndexerState).toHaveBeenCalledWith(102);
  });

  it("respects an inclusive toBlock for targeted historical scans", async () => {
    const processed: number[] = [];
    const api = {
      rpc: {
        chain: {
          getFinalizedHead: async () => "head-hash",
          getHeader: async () => ({ number: { toNumber: () => 500 } }),
          getBlockHash: async (blockNumber: number) => `hash-${blockNumber}`,
        },
      },
      query: {
        system: {
          events: {
            at: async (_hash: string) => [],
          },
        },
      },
    } as any;
    api.rpc.chain.getBlockHash = vi.fn(async (blockNumber: number) => {
      processed.push(blockNumber);
      return `hash-${blockNumber}`;
    });
    const db = {
      hasData: async () => true,
      insertMessages: vi.fn(async () => {}),
      insertDispatchStatuses: vi.fn(async () => {}),
      updateIndexerState: vi.fn(async () => {}),
    } as any;

    await backfillBlocks(api, db, 101, 103);

    expect(processed).toEqual([101, 102, 103]);
    expect(db.updateIndexerState).toHaveBeenCalledWith(103);
  });
});
