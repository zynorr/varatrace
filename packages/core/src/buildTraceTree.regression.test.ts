/**
 * Regression tests using recorded real testnet trace data.
 *
 * These tests lock in the current behavior of buildTraceTree against actual
 * Vara chain data. If a change to the reconstruction algorithm breaks these
 * tests, it means the output changed for real data — which may be intentional
 * (if the change is a known improvement) or a regression.
 *
 * To add a new recorded trace:
 *   1. Find a message ID on testnet (e.g. from VaraScan or the API samples)
 *   2. Run: npx tsx apps/api/src/record-trace.ts <message-id> <output-name>
 *   3. It will be saved as packages/core/src/recorded-traces/<output-name>.json
 *   4. Run `npx tsx -e "..."` to capture the expected output (see existing tests for the pattern)
 *   5. Add a new `it(...)` block below with assertions on the expected output
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { buildTraceTree } from "./buildTraceTree.js";
import type { TraceTree } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tracesDir = join(__dirname, "recorded-traces");

interface RecordedTrace {
  messages: import("./types.js").RawMessage[];
  statuses: import("./types.js").DispatchRecord[];
}

function loadTrace(name: string): RecordedTrace {
  return JSON.parse(
    readFileSync(join(tracesDir, `${name}.json`), "utf-8"),
  );
}

function countEdges(tree: TraceTree, confidence: "linked" | "inferred"): number {
  return tree.edges.filter((edge) => edge.confidence === confidence).length;
}

function delayedBlocks(tree: TraceTree): number {
  const blocks = tree.nodes.map((node) => node.blockNumber);
  return Math.max(...blocks) - Math.min(...blocks);
}

function expectValidEdges(tree: TraceTree): void {
  const nodeIds = new Set(tree.nodes.map((node) => node.id));
  for (const edge of tree.edges) {
    expect(nodeIds.has(edge.from)).toBe(true);
    expect(nodeIds.has(edge.to)).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// trace-reply-chain — 4 messages, serial linked→inferred→linked chain
// ---------------------------------------------------------------------------

describe("recorded trace: reply-chain (4 messages)", () => {
  const trace = loadTrace("trace-reply-chain");
  const tree = buildTraceTree(trace.messages, trace.statuses);

  it("has 4 nodes and 3 edges", () => {
    expect(tree.nodes).toHaveLength(4);
    expect(tree.edges).toHaveLength(3);
  });

  it("has no failures", () => {
    expect(tree.failure).toBeUndefined();
  });

  it("all nodes have NotExecuted status (no dispatch records recorded)", () => {
    for (const n of tree.nodes) {
      expect(n.status).toBe("NotExecuted");
    }
  });

  it("edges are linked → inferred → linked (serial chain)", () => {
    expect(tree.edges[0]!.confidence).toBe("linked");
    expect(tree.edges[1]!.confidence).toBe("inferred");
    expect(tree.edges[2]!.confidence).toBe("linked");
  });

  it("first edge is a reply (replyTo points back in chain)", () => {
    // First edge: root → first reply
    const firstEdge = tree.edges[0]!;
    const childNode = tree.nodes.find((n) => n.id === firstEdge.to)!;
    const parentMsg = trace.messages.find((m) => m.id === firstEdge.from)!;
    expect(childNode.isReply).toBe(true);
    expect(childNode.id).toBe(firstEdge.to);

    // The root message has no replyTo
    const rootNode = tree.nodes.find((n) => n.id === tree.rootId)!;
    expect(rootNode.isReply).toBe(false);
  });

  it("every edge's endpoints exist in the node set", () => {
    const nodeIds = new Set(tree.nodes.map((n) => n.id));
    for (const e of tree.edges) {
      expect(nodeIds.has(e.from)).toBe(true);
      expect(nodeIds.has(e.to)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// trace-fan-out — 2 messages, single linked edge
// ---------------------------------------------------------------------------

describe("recorded trace: fan-out (2 messages)", () => {
  const trace = loadTrace("trace-fan-out");
  const tree = buildTraceTree(trace.messages, trace.statuses);

  it("has 2 nodes and 1 edge", () => {
    expect(tree.nodes).toHaveLength(2);
    expect(tree.edges).toHaveLength(1);
  });

  it("root is the message without replyTo", () => {
    const rootMsg = trace.messages.find((m) => !m.replyTo)!;
    expect(tree.rootId).toBe(rootMsg.id);
  });

  it("the single edge is linked (reply)", () => {
    expect(tree.edges[0]!.confidence).toBe("linked");
    const childNode = tree.nodes.find((n) => n.id === tree.edges[0]!.to)!;
    expect(childNode.isReply).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// trace-simple-reply — 12 messages, multi-level tree with mixed edge types
// ---------------------------------------------------------------------------

describe("recorded trace: simple-reply (12 messages)", () => {
  const trace = loadTrace("trace-simple-reply");
  const tree = buildTraceTree(trace.messages, trace.statuses);

  it("has 12 nodes and 9 edges", () => {
    expect(tree.nodes).toHaveLength(12);
    expect(tree.edges).toHaveLength(9);
  });

  it("has no failures", () => {
    expect(tree.failure).toBeUndefined();
  });

  it("root is the earliest non-reply message from block 27934963 index 0", () => {
    const root = tree.nodes.find((n) => n.id === tree.rootId)!;
    expect(root.isReply).toBe(false);
    expect(root.blockNumber).toBe(27934963);
    expect(root.index).toBe(0);
  });

  it("has 6 linked edges and 3 inferred edges", () => {
    const linked = tree.edges.filter((e) => e.confidence === "linked");
    const inferred = tree.edges.filter((e) => e.confidence === "inferred");
    expect(linked).toHaveLength(6);
    expect(inferred).toHaveLength(3);
  });

  it("every reply message has a linked edge to its parent", () => {
    const replyNodes = tree.nodes.filter((n) => n.isReply);
    for (const rn of replyNodes) {
      const edge = tree.edges.find((e) => e.to === rn.id);
      expect(edge).toBeDefined();
      expect(edge!.confidence).toBe("linked");
    }
  });

  it("non-reply spawned messages that the heuristic can attribute have inferred edges", () => {
    // In this trace, 3 non-reply messages have inferred parents:
    //   - 0xdd203334c5b322... (block 27934967, index 0)
    //   - 0x55fa6c26460370... (block 27934967, index 1)
    //   - 0x1a22be5d796fe0... (block 27934967, index 2)
    // All 3 are attributed to the same parent via the heuristic.
    const inferred = tree.edges.filter((e) => e.confidence === "inferred");
    expect(inferred).toHaveLength(3);
    for (const e of inferred) {
      // All inferred children should be non-reply spawned messages
      const child = tree.nodes.find((n) => n.id === e.to)!;
      expect(child.isReply).toBe(false);
      // Their source should match the parent node's destination
      const parent = tree.nodes.find((n) => n.id === e.from)!;
      expect(child.source).toBe(parent.destination);
    }
  });

  it("all nodes have NotExecuted status", () => {
    for (const n of tree.nodes) {
      expect(n.status).toBe("NotExecuted");
    }
  });

  it("three inferred edges fan out from the same parent (program processing them)", () => {
    // The 3 inferred edges should share the same 'from' node
    const inferred = tree.edges.filter((e) => e.confidence === "inferred");
    const fromIds = inferred.map((e) => e.from);
    expect(new Set(fromIds).size).toBe(1); // all from the same source
  });

  it("all edge endpoints are valid nodes", () => {
    const nodeIds = new Set(tree.nodes.map((n) => n.id));
    for (const e of tree.edges) {
      expect(nodeIds.has(e.from)).toBe(true);
      expect(nodeIds.has(e.to)).toBe(true);
    }
  });

  it("each node appears at most once as an edge 'to' target", () => {
    const toCounts = new Map<string, number>();
    for (const e of tree.edges) {
      toCounts.set(e.to, (toCounts.get(e.to) ?? 0) + 1);
    }
    for (const [id, count] of toCounts) {
      expect(count).toBe(1); // no node should have multiple parents
    }
  });

  it("is deterministic regardless of input message order", () => {
    const shuffled = [...trace.messages].reverse();
    const tree2 = buildTraceTree(shuffled, trace.statuses);
    expect(tree2.rootId).toBe(tree.rootId);
    expect(tree2.nodes).toHaveLength(tree.nodes.length);
    expect(tree2.edges).toHaveLength(tree.edges.length);
    const edgeSet = (t: typeof tree) =>
      new Set(t.edges.map((e) => `${e.from}→${e.to}:${e.confidence}`));
    expect(edgeSet(tree2)).toEqual(edgeSet(tree));
  });
});

// ---------------------------------------------------------------------------
// Real MVP traces — recorded from Vara testnet after the live audit found
// rich, inferred, delayed, reply-chain, and failure-path cases.
// ---------------------------------------------------------------------------

describe("recorded real trace: rich inferred delayed", () => {
  const trace = loadTrace("real-rich-inferred-delayed");
  const tree = buildTraceTree(trace.messages, trace.statuses);

  it("reconstructs a 4-node chain with linked and inferred edges", () => {
    expect(tree.nodes).toHaveLength(4);
    expect(tree.edges).toHaveLength(3);
    expect(countEdges(tree, "linked")).toBe(2);
    expect(countEdges(tree, "inferred")).toBe(1);
    expect(delayedBlocks(tree)).toBe(1);
    expect(tree.failure).toBeUndefined();
    expectValidEdges(tree);
  });

  it("keeps the inferred edge between the first reply and the next root-like message", () => {
    const inferred = tree.edges.find((edge) => edge.confidence === "inferred")!;
    const parent = tree.nodes.find((node) => node.id === inferred.from)!;
    const child = tree.nodes.find((node) => node.id === inferred.to)!;

    expect(parent.isReply).toBe(true);
    expect(child.isReply).toBe(false);
    expect(child.blockNumber).toBeGreaterThan(parent.blockNumber);
    expect(child.source).toBe(parent.destination);
  });
});

describe("recorded real trace: long delayed", () => {
  const trace = loadTrace("real-long-delayed");
  const tree = buildTraceTree(trace.messages, trace.statuses);

  it("reconstructs a delayed cross-block chain spanning 7 blocks", () => {
    expect(tree.nodes).toHaveLength(4);
    expect(tree.edges).toHaveLength(3);
    expect(countEdges(tree, "linked")).toBe(2);
    expect(countEdges(tree, "inferred")).toBe(1);
    expect(delayedBlocks(tree)).toBe(7);
    expect(tree.failure).toBeUndefined();
  });

  it("orders the delayed inferred child after the reply that unlocks it", () => {
    const inferred = tree.edges.find((edge) => edge.confidence === "inferred")!;
    const parent = tree.nodes.find((node) => node.id === inferred.from)!;
    const child = tree.nodes.find((node) => node.id === inferred.to)!;

    expect(parent.isReply).toBe(true);
    expect(child.isReply).toBe(false);
    expect(child.blockNumber - parent.blockNumber).toBe(7);
  });
});

describe("recorded real trace: six-node reply chain", () => {
  const trace = loadTrace("real-six-node-reply-chain");
  const tree = buildTraceTree(trace.messages, trace.statuses);

  it("reconstructs a deeper alternating linked/inferred chain", () => {
    expect(tree.nodes).toHaveLength(6);
    expect(tree.edges).toHaveLength(5);
    expect(countEdges(tree, "linked")).toBe(3);
    expect(countEdges(tree, "inferred")).toBe(2);
    expect(delayedBlocks(tree)).toBe(2);
    expect(tree.failure).toBeUndefined();
    expectValidEdges(tree);
  });

  it("uses the known user-originated message as the root", () => {
    const rootMessage = trace.messages.find((message) => message.fromUser)!;
    expect(tree.rootId).toBe(rootMessage.id);
  });
});

describe("recorded real trace: triggered failure", () => {
  const trace = loadTrace("real-triggered-failure");
  const tree = buildTraceTree(trace.messages, trace.statuses);

  it("records the real failed testnet dispatch and reply", () => {
    expect(tree.nodes).toHaveLength(2);
    expect(tree.edges).toHaveLength(1);
    expect(countEdges(tree, "linked")).toBe(1);
    expect(countEdges(tree, "inferred")).toBe(0);
    expect(tree.nodes.filter((node) => node.status === "Failed")).toHaveLength(1);
  });

  it("reports the root failed message as the failure path", () => {
    expect(tree.failure).toEqual({
      messageId: "0x468d6bb9a464c22320f47ec4e88ed9d41503a3dae0e0db20cb33c2cf0f1cf0e3",
      program: "0x3190aa898d336f7ebc100b7fea201d1cf77339b557c0da51e0b32e5e286f6c18",
      reason: "Failed: 0x",
      path: ["0x468d6bb9a464c22320f47ec4e88ed9d41503a3dae0e0db20cb33c2cf0f1cf0e3"],
    });
  });
});
