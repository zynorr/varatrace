import type { RawMessage, DispatchRecord } from "./types.js";

/**
 * Hand-built fixtures that emulate real Gear chain data shapes.
 * Addresses are fake but well-formed-looking. These let us unit-test and demo
 * the reconstruction engine with zero network access.
 *
 * Actors:
 *   USER  = an account that originates the interaction
 *   A,B,C,D = programs
 *
 * Payloads use a simple encoding scheme (defined in apps/api/src/fixture-metadata.ts)
 * so the web UI can demonstrate IDL payload decoding without a chain connection:
 *   byte 0-1: version + selector
 *   bytes 2+: UTF-8 JSON array of parameter values
 */
const acct = (tag: string) => "0x" + tag.repeat(32).slice(0, 64).padEnd(64, "0");

/** Encode param values as a fixture payload hex string. */
function enc(variant: "handle" | "reply", values: unknown[]): string {
  // Mirrors encodeFixturePayload in fixture-metadata.ts
  const selector = variant === "handle" ? 0x01 : 0x02;
  const json = JSON.stringify(values);
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(json);
  const bytes = new Uint8Array(2 + jsonBytes.length);
  bytes[0] = 1; // version
  bytes[1] = selector;
  bytes.set(jsonBytes, 2);
  // Convert to hex manually (avoid Buffer dependency in this package)
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export const ADDR = {
  user: acct("ace"),
  A: acct("a1"),
  B: acct("b2"),
  C: acct("c3"),
  D: acct("d4"),
};

const msg = (
  id: string,
  source: string,
  destination: string,
  block: number,
  index: number,
  extra: Partial<RawMessage> = {},
): RawMessage => ({
  id: "0x" + id.repeat(8).slice(0, 64).padEnd(64, "0"),
  source,
  destination,
  payload: "0x01020304",
  value: "0",
  blockNumber: block,
  index,
  ...extra,
});

/** 1) Simple two-program call: user -> A, then A -> B. All succeed. */
export function fixtureSimpleCall(): {
  messages: RawMessage[];
  statuses: DispatchRecord[];
} {
  const m1 = msg("11", ADDR.user, ADDR.A, 100, 0, {
    fromUser: true,
    payload: enc("handle", ["transfer", ADDR.B, "100"]),
  });
  const m2 = msg("22", ADDR.A, ADDR.B, 100, 1, {
    payload: enc("handle", [42, 10, "GEAR-001"]),
  });
  return {
    messages: [m1, m2],
    statuses: [
      { id: m1.id, status: "Success" },
      { id: m2.id, status: "Success" },
    ],
  };
}

/** 2) Reply: user -> A -> B, then B replies to the A->B message. */
export function fixtureReply(): {
  messages: RawMessage[];
  statuses: DispatchRecord[];
} {
  const m1 = msg("11", ADDR.user, ADDR.A, 200, 0, {
    fromUser: true,
    payload: enc("handle", ["query", ADDR.B, "status"]),
  });
  const m2 = msg("22", ADDR.A, ADDR.B, 200, 1, {
    payload: enc("handle", [7, 1, "GEAR-002"]),
  });
  const m3 = msg("33", ADDR.B, ADDR.A, 201, 0, {
    replyTo: m2.id,
    payload: enc("reply", [true, "fulfilled", 1000]),
  });
  return {
    messages: [m1, m2, m3],
    statuses: [
      { id: m1.id, status: "Success" },
      { id: m2.id, status: "Success" },
      { id: m3.id, status: "Success" },
    ],
  };
}

/** 3) Three-level fan-out: user -> A; A -> B, A -> C; B -> D. */
export function fixtureFanOut(): {
  messages: RawMessage[];
  statuses: DispatchRecord[];
} {
  const m1 = msg("11", ADDR.user, ADDR.A, 300, 0, {
    fromUser: true,
    payload: enc("handle", ["batch", "*", "multi"]),
  });
  const m2 = msg("22", ADDR.A, ADDR.B, 300, 1, {
    payload: enc("handle", [100, 5, "GEAR-003"]),
  });
  const m3 = msg("33", ADDR.A, ADDR.C, 300, 2, {
    payload: enc("handle", ["0xabcd", 3]),
  });
  const m4 = msg("44", ADDR.B, ADDR.D, 301, 0, {
    payload: enc("handle", ["order_fulfilled", ADDR.B, "batch complete", 300001]),
  });
  return {
    messages: [m1, m2, m3, m4],
    statuses: [
      { id: m1.id, status: "Success" },
      { id: m2.id, status: "Success" },
      { id: m3.id, status: "Success" },
      { id: m4.id, status: "Success" },
    ],
  };
}

/** 4) Deep failure: user -> A -> B -> D, where D's dispatch fails. */
export function fixtureDeepFailure(): {
  messages: RawMessage[];
  statuses: DispatchRecord[];
} {
  const m1 = msg("11", ADDR.user, ADDR.A, 400, 0, {
    fromUser: true,
    payload: enc("handle", ["withdraw", ADDR.D, "500"]),
  });
  const m2 = msg("22", ADDR.A, ADDR.B, 400, 1, {
    payload: enc("handle", [42, 1, "GEAR-004"]),
  });
  const m3 = msg("33", ADDR.B, ADDR.D, 401, 0, {
    payload: enc("handle", ["payment", ADDR.B, "insufficient balance", 400001]),
  });
  return {
    messages: [m1, m2, m3],
    statuses: [
      { id: m1.id, status: "Success" },
      { id: m2.id, status: "Success" },
      { id: m3.id, status: "Failed", error: "Panic: 'insufficient balance'" },
    ],
  };
}

/** 5) Reply chain with failure at depth — mirrors the real testnet pattern from candidate B.
 *  A -> B -> A (reply) -> C -> A (reply) -> D, where D fails.
 *  Tests failure detection with both linked and inferred edges. */
export function fixtureReplyChainWithFailure(): {
  messages: RawMessage[];
  statuses: DispatchRecord[];
} {
  const m1 = msg("11", ADDR.user, ADDR.A, 500, 0, {
    fromUser: true,
    payload: enc("handle", ["delegate", ADDR.B, "approve"]),
  });
  const m2 = msg("22", ADDR.A, ADDR.B, 500, 1, {
    payload: enc("handle", [77, 3, "GEAR-005"]),
  });
  const m3 = msg("33", ADDR.B, ADDR.A, 501, 0, {
    replyTo: m2.id,
    payload: enc("reply", [77, "approved", 2500]),
  });
  const m4 = msg("44", ADDR.A, ADDR.C, 501, 1, {
    payload: enc("handle", ["0xbeef", 5]),
  });
  const m5 = msg("55", ADDR.C, ADDR.A, 502, 0, {
    replyTo: m4.id,
    payload: enc("reply", [true, "validated", 9]),
  });
  const m6 = msg("66", ADDR.A, ADDR.D, 502, 1, {
    payload: enc("handle", ["execute", ADDR.C, "delegated_call", 500002]),
  });
  return {
    messages: [m1, m2, m3, m4, m5, m6],
    statuses: [
      { id: m1.id, status: "Success" },
      { id: m2.id, status: "Success" },
      { id: m3.id, status: "Success" },
      { id: m4.id, status: "Success" },
      { id: m5.id, status: "Success" },
      { id: m6.id, status: "Failed", error: "Gas limit exceeded" },
    ],
  };
}

/** 6) Fan-out with mixed outcomes: user -> A fans out to B, C, D. C fails, B and D succeed.
 *  Tests that failure path correctly identifies C (not B or D) as the unique failure,
 *  and that sibling branches are unaffacted. */
export function fixtureFanOutWithMixedOutcomes(): {
  messages: RawMessage[];
  statuses: DispatchRecord[];
} {
  const m1 = msg("11", ADDR.user, ADDR.A, 600, 0, {
    fromUser: true,
    payload: enc("handle", ["distribute", "*", "all"]),
  });
  const m2 = msg("22", ADDR.A, ADDR.B, 600, 1, {
    payload: enc("handle", [200, 50, "GEAR-006"]),
  });
  const m3 = msg("33", ADDR.A, ADDR.C, 600, 2, {
    payload: enc("handle", ["0xcafe", 1]),
  });
  const m4 = msg("44", ADDR.B, ADDR.D, 601, 0, {
    payload: enc("handle", ["fulfillment", ADDR.B, "order 200 complete", 600001]),
  });
  const m5 = msg("55", ADDR.A, ADDR.D, 601, 1, {
    payload: enc("handle", ["settlement", ADDR.A, "distribution finished", 600002]),
  });
  return {
    messages: [m1, m2, m3, m4, m5],
    statuses: [
      { id: m1.id, status: "Success" },
      { id: m2.id, status: "Success" },
      { id: m3.id, status: "Failed", error: "Contract trap" },
      { id: m4.id, status: "Success" },
      { id: m5.id, status: "Success" },
    ],
  };
}
