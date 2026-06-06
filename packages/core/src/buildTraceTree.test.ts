import { describe, it, expect } from "vitest";
import { buildTraceTree } from "./buildTraceTree.js";
import {
  fixtureSimpleCall,
  fixtureReply,
  fixtureFanOut,
  fixtureDeepFailure,
  fixtureReplyChainWithFailure,
  fixtureFanOutWithMixedOutcomes,
  ADDR,
} from "./fixtures.js";

describe("buildTraceTree", () => {
  it("throws on empty input", () => {
    expect(() => buildTraceTree([], [])).toThrow(/no messages/);
  });

  it("reconstructs a simple two-program call (inferred edge)", () => {
    const { messages, statuses } = fixtureSimpleCall();
    const tree = buildTraceTree(messages, statuses);

    // root is the user-originated message
    expect(tree.rootId).toBe(messages[0]!.id);
    expect(tree.nodes).toHaveLength(2);
    expect(tree.edges).toHaveLength(1);

    const [e] = tree.edges;
    expect(e!.from).toBe(messages[0]!.id); // user->A
    expect(e!.to).toBe(messages[1]!.id); // A->B
    expect(e!.confidence).toBe("inferred");
    expect(tree.failure).toBeUndefined();
  });

  it("links a reply via replyTo with 'linked' confidence", () => {
    const { messages, statuses } = fixtureReply();
    const tree = buildTraceTree(messages, statuses);

    const replyEdge = tree.edges.find((e) => e.to === messages[2]!.id);
    expect(replyEdge).toBeDefined();
    expect(replyEdge!.from).toBe(messages[1]!.id); // reply.to -> the A->B msg
    expect(replyEdge!.confidence).toBe("linked");

    const replyNode = tree.nodes.find((n) => n.id === messages[2]!.id);
    expect(replyNode!.isReply).toBe(true);
  });

  it("handles a three-level fan-out", () => {
    const { messages, statuses } = fixtureFanOut();
    const tree = buildTraceTree(messages, statuses);

    expect(tree.nodes).toHaveLength(4);
    expect(tree.edges).toHaveLength(3);

    // The user->A message should have two children: A->B and A->C.
    const rootChildren = tree.edges.filter((e) => e.from === messages[0]!.id);
    expect(rootChildren).toHaveLength(2);
    expect(rootChildren.map((e) => e.to).sort()).toEqual(
      [messages[1]!.id, messages[2]!.id].sort(),
    );

    // D hangs off the A->B message (B spawned B->D).
    const dEdge = tree.edges.find((e) => e.to === messages[3]!.id);
    expect(dEdge!.from).toBe(messages[1]!.id); // the A->B message spawned B->D
    expect(dEdge!.confidence).toBe("inferred");
  });

  it("detects a deep failure and reports the path root -> failed", () => {
    const { messages, statuses } = fixtureDeepFailure();
    const tree = buildTraceTree(messages, statuses);

    expect(tree.failure).toBeDefined();
    expect(tree.failure!.messageId).toBe(messages[2]!.id); // B->D failed
    expect(tree.failure!.program).toBe(ADDR.D);
    expect(tree.failure!.reason).toMatch(/insufficient balance/);

    // path goes root (user->A) -> A->B -> B->D
    expect(tree.failure!.path).toEqual([
      messages[0]!.id,
      messages[1]!.id,
      messages[2]!.id,
    ]);
  });

  it("detects failure in a reply chain with mixed linked/inferred edges", () => {
    const { messages, statuses } = fixtureReplyChainWithFailure();
    const tree = buildTraceTree(messages, statuses);

    expect(tree.failure).toBeDefined();
    // D (index 5) should be the first failed message
    expect(tree.failure!.messageId).toBe(messages[5]!.id);
    expect(tree.failure!.program).toBe(ADDR.D);
    expect(tree.failure!.reason).toMatch(/Gas limit exceeded/);

    // Path should trace root -> A->B -> B->A(reply) -> A->C -> C->A(reply) -> A->D
    expect(tree.failure!.path).toEqual([
      messages[0]!.id,  // user->A
      messages[1]!.id,  // A->B
      messages[2]!.id,  // B->A (reply)
      messages[3]!.id,  // A->C
      messages[4]!.id,  // C->A (reply)
      messages[5]!.id,  // A->D (failed)
    ]);

    // Verify edge types: inferred for spawned, linked for replies
    const edgeByChild = new Map(tree.edges.map((e) => [e.to, e]));
    expect(edgeByChild.get(messages[1]!.id)!.confidence).toBe("inferred"); // A->B
    expect(edgeByChild.get(messages[2]!.id)!.confidence).toBe("linked");   // reply
    expect(edgeByChild.get(messages[3]!.id)!.confidence).toBe("inferred"); // A->C
    expect(edgeByChild.get(messages[4]!.id)!.confidence).toBe("linked");   // reply
    expect(edgeByChild.get(messages[5]!.id)!.confidence).toBe("inferred"); // A->D
  });

  it("detects failure in a fan-out with mixed outcomes (one branch fails)", () => {
    const { messages, statuses } = fixtureFanOutWithMixedOutcomes();
    const tree = buildTraceTree(messages, statuses);

    expect(tree.failure).toBeDefined();
    // C (index 2) should be the first (and only) failed message
    expect(tree.failure!.messageId).toBe(messages[2]!.id);
    expect(tree.failure!.program).toBe(ADDR.C);
    expect(tree.failure!.reason).toMatch(/Contract trap/);

    // Path should go root -> A -> C (not through B or D)
    expect(tree.failure!.path).toEqual([
      messages[0]!.id,  // user->A
      messages[2]!.id,  // A->C (failed)
    ]);

    // B and D should NOT be on the failure path
    const failSet = new Set(tree.failure!.path);
    expect(failSet.has(messages[1]!.id)).toBe(false); // A->B not failed
    expect(failSet.has(messages[3]!.id)).toBe(false); // B->D not failed
    expect(failSet.has(messages[4]!.id)).toBe(false); // A->D not failed

    // Verify all edges are correctly typed
    const edgeByChild = new Map(tree.edges.map((e) => [e.to, e]));
    expect(edgeByChild.get(messages[1]!.id)!.confidence).toBe("inferred"); // A->B
    expect(edgeByChild.get(messages[2]!.id)!.confidence).toBe("inferred"); // A->C
    expect(edgeByChild.get(messages[3]!.id)!.confidence).toBe("inferred"); // B->D (from B)
    expect(edgeByChild.get(messages[4]!.id)!.confidence).toBe("inferred"); // A->D (from A)
  });

  it("is deterministic regardless of input ordering", () => {
    const { messages, statuses } = fixtureFanOut();
    const shuffled = [...messages].reverse();
    const a = buildTraceTree(messages, statuses);
    const b = buildTraceTree(shuffled, statuses);
    expect(b.rootId).toBe(a.rootId);
    expect(b.edges.length).toBe(a.edges.length);
  });

  it("does not infer an edge into a new user-originated message", () => {
    const user = "0x" + "8".repeat(64);
    const programA = "0x" + "a".repeat(64);
    const programB = "0x" + "b".repeat(64);
    const first = {
      id: "first",
      source: user,
      destination: programA,
      payload: "0x",
      value: "0",
      blockNumber: 100,
      index: 0,
      fromUser: true,
    };
    const firstReply = {
      id: "first-reply",
      source: programA,
      destination: user,
      payload: "0x",
      value: "0",
      blockNumber: 100,
      index: 1,
      replyTo: first.id,
    };
    const second = {
      id: "second",
      source: user,
      destination: programB,
      payload: "0x",
      value: "0",
      blockNumber: 101,
      index: 0,
      fromUser: true,
    };

    const tree = buildTraceTree([first, firstReply, second], []);

    expect(tree.edges).toEqual([
      { from: first.id, to: firstReply.id, confidence: "linked" },
    ]);
    expect(tree.rootId).toBe(first.id);
  });
});
