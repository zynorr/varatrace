// Mirror of @varatrace/core's TraceTree shape (kept local so the web app has no
// build-time dependency on the engine package; the API returns exactly this JSON).
export type DispatchStatus = "Success" | "Failed" | "NotExecuted";
export type EdgeConfidence = "linked" | "inferred";

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
  /** Human-readable program label from a registered Sails IDL, when known. */
  programName?: string;
  /** Decoded payload from on-chain program metadata (best-effort). */
  decodedPayload?: string;
}
export interface MessageEdge {
  from: string;
  to: string;
  confidence: EdgeConfidence;
}
export interface FailureInfo {
  messageId: string;
  program: string;
  reason: string;
  path: string[];
}
export interface TraceTree {
  rootId: string;
  nodes: MessageNode[];
  edges: MessageEdge[];
  failure?: FailureInfo;
}
