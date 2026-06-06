import type {
  RawMessage,
  DispatchRecord,
  MessageNode,
  MessageEdge,
  TraceTree,
  FailureInfo,
} from "./types.js";

// ---------------------------------------------------------------------------
// Safety limits — prevent pathological traces from consuming too much memory
// ---------------------------------------------------------------------------

/** Maximum number of nodes in a single trace tree. */
export const MAX_TRACE_NODES = 2000;

/** Maximum tree depth (root-to-leaf) before we stop building edges. */
export const MAX_TRACE_DEPTH = 100;

/**
 * Error thrown when a trace exceeds safety limits.
 * The caller can catch this and return an appropriate response.
 */
export class TraceTooLargeError extends Error {
  constructor(
    public readonly nodeCount: number,
    public readonly limit: number,
  ) {
    super(`Trace tree exceeds maximum node count: ${nodeCount} > ${limit}`);
    this.name = "TraceTooLargeError";
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Reconstruct the async message tree for a Vara interaction.
 *
 * THE ALGORITHM
 * -------------
 * Vara's actor model means one user action fans out into a tree of asynchronous
 * messages between programs, across blocks, with replies and spawned messages.
 * We reconstruct that tree from two raw inputs:
 *   - rawMessages:      normalized MessageQueued + UserMessageSent records.
 *   - dispatchStatuses: MessagesDispatched outcomes, keyed by message id.
 *
 * Steps:
 *   1. Build a node per message, attaching its dispatch status (default
 *      "NotExecuted" when no dispatch record exists).
 *   2. Build edges parent -> child:
 *        a. RELIABLE ("linked"): a reply links to its parent via replyTo.
 *        b. HEURISTIC ("inferred"): a spawned (non-reply) message M sourced from
 *           program P was produced while P processed an earlier message whose
 *           destination was P. We attribute M to the most recent such message
 *           (by block, then index) that precedes M. Gear does not always expose
 *           explicit ancestry off-chain, so this attribution is marked
 *           "inferred" rather than presented as certain.
 *   3. Determine the root: the message with no parent. If several qualify
 *      (defensive), choose the earliest by (block, index). A message flagged
 *      fromUser is preferred as the root tie-breaker.
 *   4. Detect failure: if any node failed, walk root -> first failed node along
 *      the edges and report the reason.
 *
 * The function is pure and deterministic: same inputs -> same tree.
 *
 * @throws {TraceTooLargeError} if rawMessages.length exceeds MAX_TRACE_NODES.
 */
export function buildTraceTree(
  rawMessages: RawMessage[],
  dispatchStatuses: DispatchRecord[],
): TraceTree {
  if (rawMessages.length === 0) {
    throw new Error("buildTraceTree: no messages provided");
  }

  // Guard against pathologically large traces
  if (rawMessages.length > MAX_TRACE_NODES) {
    throw new TraceTooLargeError(rawMessages.length, MAX_TRACE_NODES);
  }

  const statusById = new Map(dispatchStatuses.map((d) => [d.id, d]));

  // 1. Nodes
  const nodes: MessageNode[] = rawMessages.map((m) => {
    const dispatch = statusById.get(m.id);
    return {
      id: m.id,
      source: m.source,
      destination: m.destination,
      payload: m.payload,
      value: m.value,
      blockNumber: m.blockNumber,
      index: m.index,
      timestamp: m.timestamp,
      status: dispatch?.status ?? "NotExecuted",
      error: dispatch?.error,
      isReply: Boolean(m.replyTo),
    };
  });

  const byId = new Map(rawMessages.map((m) => [m.id, m]));
  const childIds = new Set<string>();
  const edges: MessageEdge[] = [];

  // Deterministic causal ordering within and across blocks.
  const ordered = [...rawMessages].sort(
    (a, b) => a.blockNumber - b.blockNumber || a.index - b.index,
  );

  // Track depth from root for each node
  const depthOf = new Map<string, number>();

  for (const msg of ordered) {
    // 2a. Reliable reply edge.
    if (msg.replyTo && byId.has(msg.replyTo)) {
      const parentDepth = depthOf.get(msg.replyTo) ?? 0;
      if (parentDepth >= MAX_TRACE_DEPTH) {
        // Don't add edges beyond max depth, but still include the node
        childIds.add(msg.id);
        depthOf.set(msg.id, parentDepth + 1);
        continue;
      }
      edges.push({ from: msg.replyTo, to: msg.id, confidence: "linked" });
      childIds.add(msg.id);
      depthOf.set(msg.id, parentDepth + 1);
      continue;
    }
    if (msg.replyTo && !byId.has(msg.replyTo)) {
      // Parent reply target not in our set; treat as an orphan root candidate.
      continue;
    }

    if (msg.fromUser) {
      // User-originated messages begin independent interactions. Even if the
      // same account/program appears in the prior block, do not infer ancestry.
      continue;
    }

    // 2b. Heuristic spawned-message attribution.
    // Find the most recent message (strictly before msg) whose destination is
    // msg.source — i.e. the message that program `msg.source` was processing
    // when it emitted `msg`.
    const parent = findInferredParent(msg, ordered);
    if (parent) {
      const parentDepth = depthOf.get(parent.id) ?? 0;
      if (parentDepth >= MAX_TRACE_DEPTH) {
        // Don't add edges beyond max depth
        childIds.add(msg.id);
        depthOf.set(msg.id, parentDepth + 1);
        continue;
      }
      edges.push({ from: parent.id, to: msg.id, confidence: "inferred" });
      childIds.add(msg.id);
      depthOf.set(msg.id, parentDepth + 1);
    }
  }

  // 3. Root selection.
  const roots = ordered.filter((m) => !childIds.has(m.id));
  const root =
    roots.find((m) => m.fromUser) ??
    roots[0] ??
    ordered[0]!; // defensive: ordered is non-empty

  // 4. Failure detection.
  const failure = detectFailure(root.id, nodes, edges, statusById);

  return { rootId: root.id, nodes, edges, failure };
}

/**
 * Heuristic: the parent of a spawned message is the most recent preceding
 * message addressed to the spawning program (destination === msg.source).
 */
function findInferredParent(
  msg: RawMessage,
  ordered: RawMessage[],
): RawMessage | undefined {
  let candidate: RawMessage | undefined;
  for (const other of ordered) {
    if (other.id === msg.id) break; // ordered, so we've reached msg itself
    const isBefore =
      other.blockNumber < msg.blockNumber ||
      (other.blockNumber === msg.blockNumber && other.index < msg.index);
    if (isBefore && other.destination === msg.source) {
      candidate = other; // keep the latest such message
    }
  }
  return candidate;
}

/** Walk root -> first failed node and summarize the failure. */
function detectFailure(
  rootId: string,
  nodes: MessageNode[],
  edges: MessageEdge[],
  statusById: Map<string, DispatchRecord>,
): FailureInfo | undefined {
  const firstFailed = nodes.find((n) => n.status === "Failed");
  if (!firstFailed) return undefined;

  const parentOf = new Map(edges.map((e) => [e.to, e.from]));
  const path: string[] = [];
  let cursor: string | undefined = firstFailed.id;
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    path.unshift(cursor);
    if (cursor === rootId) break;
    cursor = parentOf.get(cursor);
  }

  return {
    messageId: firstFailed.id,
    program: firstFailed.destination,
    reason: statusById.get(firstFailed.id)?.error ?? "Message dispatch failed",
    path,
  };
}
