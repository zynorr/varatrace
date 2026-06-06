import { describe, it, expect } from "vitest";
import { traceToFlow } from "./layout";
import type { TraceTree } from "./types";

const SIMPLE_TREE: TraceTree = {
  rootId: "0xroot",
  nodes: [
    {
      id: "0xroot",
      source: "0xuser",
      destination: "0xprog_a",
      payload: "0x",
      value: "0",
      blockNumber: 100,
      index: 0,
      status: "Success",
      isReply: false,
    },
    {
      id: "0xreply",
      source: "0xprog_a",
      destination: "0xuser",
      payload: "0xcafe",
      value: "0",
      blockNumber: 101,
      index: 0,
      status: "Success",
      isReply: true,
    },
  ],
  edges: [
    { from: "0xroot", to: "0xreply", confidence: "linked" },
  ],
};

const TREE_WITH_FAILURE: TraceTree = {
  rootId: "0xroot",
  nodes: [
    {
      id: "0xroot",
      source: "0xuser",
      destination: "0xprog_a",
      payload: "0x",
      value: "0",
      blockNumber: 100,
      index: 0,
      status: "Failed",
      error: "Execution trapped",
      isReply: false,
    },
    {
      id: "0xfail",
      source: "0xprog_a",
      destination: "0xprog_b",
      payload: "0x",
      value: "0",
      blockNumber: 101,
      index: 0,
      status: "NotExecuted",
      isReply: false,
    },
  ],
  edges: [
    { from: "0xroot", to: "0xfail", confidence: "inferred" },
  ],
  failure: {
    messageId: "0xfail",
    program: "0xprog_b",
    reason: "Execution trapped",
    path: ["0xroot", "0xfail"],
  },
};

describe("traceToFlow", () => {
  it("returns nodes and edges for a simple trace", () => {
    const { nodes, edges } = traceToFlow(SIMPLE_TREE);
    expect(nodes.length).toBe(2);
    expect(edges.length).toBe(1);

    // Nodes should have positions from dagre layout
    expect(nodes[0]!.position).toBeDefined();
    expect(typeof nodes[0]!.position.x).toBe("number");
    expect(typeof nodes[0]!.position.y).toBe("number");
  });

  it("marks nodes on the failure path", () => {
    const { nodes } = traceToFlow(TREE_WITH_FAILURE);
    for (const n of nodes) {
      if (n.id === "0xroot" || n.id === "0xfail") {
        expect(n.data.onFailPath).toBe(true);
      }
    }
  });

  it("styles failure-path edges with red color and animation", () => {
    const { edges } = traceToFlow(TREE_WITH_FAILURE);
    expect(edges.length).toBe(1);
    expect(edges[0]!.style?.stroke).toBe("var(--edge-fail)"); // red
    expect(edges[0]!.animated).toBe(true);
  });

  it("styles inferred edges with dashed lines", () => {
    const { edges } = traceToFlow(TREE_WITH_FAILURE);
    expect(edges[0]!.style?.strokeDasharray).toBe("6 4");
  });

  it("adds label for inferred edges", () => {
    const { edges } = traceToFlow(TREE_WITH_FAILURE);
    expect(edges[0]!.label).toBe("inferred");
  });
});
