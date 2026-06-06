/**
 * Core domain types for VaraTrace.
 *
 * These model the raw chain data we ingest (from the Gear indexer or live
 * @gear-js/api subscriptions) and the reconstructed async message tree we
 * produce for the UI.
 */

/** Dispatch outcome for a single message, derived from the MessagesDispatched event. */
export type DispatchStatus = "Success" | "Failed" | "NotExecuted";

/**
 * How confident we are in a parent -> child edge.
 * - "linked":   derived from a reliable on-chain signal (a reply's reply.to).
 * - "inferred": derived from a documented heuristic (spawned-message attribution).
 */
export type EdgeConfidence = "linked" | "inferred";

/**
 * A raw message as seen on chain (normalized from MessageQueued / UserMessageSent).
 * `replyTo` corresponds to UserMessageSent's `reply.to` field and, when present,
 * is the id of the message this message is a reply to.
 */
export interface RawMessage {
  id: string;
  source: string;
  destination: string;
  payload: string; // hex
  value: string; // stringified u128
  blockNumber: number;
  /** Position within the block; used to order causally within the same block. */
  index: number;
  timestamp?: number;
  /** Present only for replies (UserMessageSent.reply.to). */
  replyTo?: string | null;
  /** True if source is a user/account rather than a program (when known). */
  fromUser?: boolean;
}

/** A dispatch status record keyed by message id (from MessagesDispatched). */
export interface DispatchRecord {
  id: string;
  status: DispatchStatus;
  /** Human-readable failure reason, when status is "Failed". */
  error?: string;
}

/** A node in the reconstructed trace tree. */
export interface MessageNode {
  id: string;
  source: string;
  destination: string;
  payload: string;
  value: string;
  blockNumber: number;
  index: number;
  timestamp?: number;
  status: DispatchStatus;
  error?: string;
  isReply: boolean;
}

/** A directed edge (parent message -> child message). */
export interface MessageEdge {
  from: string;
  to: string;
  confidence: EdgeConfidence;
}

/** Failure summary, when at least one message failed. */
export interface FailureInfo {
  messageId: string;
  program: string;
  reason: string;
  /** Path of message ids from root to the first failed message. */
  path: string[];
}

/** The full reconstructed trace returned to the API/UI. */
export interface TraceTree {
  rootId: string;
  nodes: MessageNode[];
  edges: MessageEdge[];
  failure?: FailureInfo;
}
