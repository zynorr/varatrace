import { describe, it, expect } from "vitest";
import {
  encodeFixturePayload,
  getFixtureMetadata,
  getFixtureSchema,
} from "./fixture-metadata.js";
import { ADDR } from "../../../packages/core/src/fixtures.js";

// ---------------------------------------------------------------------------
// Helper: encode → decodeViaMetadata → toHuman(), for round-trip testing
// through the public API.
// ---------------------------------------------------------------------------

function decodeViaMetadata(
  programId: string,
  payloadHex: string,
  method: "reply" | "payload" | "event" = "payload",
): object | null {
  const meta = getFixtureMetadata(programId);
  if (!meta) return null;
  const fn =
    method === "reply"
      ? meta.decodeReply
      : method === "event"
        ? meta.decodeEvent
        : meta.decodePayload;
  const result = fn(payloadHex);
  if (result == null) return null;
  return result.toHuman();
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

describe("encodeFixturePayload", () => {
  it("produces a valid 0x-prefixed hex string", () => {
    const hex = encodeFixturePayload("handle", [1, 2, 3]);
    expect(hex).toMatch(/^0x[0-9a-f]+$/);
    expect(hex.length).toBeGreaterThan(4);
  });

  it("encodes handle variant with selector 0x01", () => {
    const hex = encodeFixturePayload("handle", [42]);
    // Byte 1 is the selector — 0x01 for handle
    const selector = parseInt(hex.slice(4, 6), 16);
    expect(selector).toBe(0x01);
  });

  it("encodes reply variant with selector 0x02", () => {
    const hex = encodeFixturePayload("reply", [true]);
    const selector = parseInt(hex.slice(4, 6), 16);
    expect(selector).toBe(0x02);
  });

  it("encodes an empty params array", () => {
    const hex = encodeFixturePayload("handle", []);
    // Should still produce valid hex with version + selector + "[]"
    expect(hex).toMatch(/^0x[0-9a-f]+$/);
    // Decode through public API — should succeed with empty fields
    const human = decodeViaMetadata(ADDR.A, hex, "payload");
    expect(human).not.toBeNull();
    expect(human).toHaveProperty("name", "Route");
    expect(human).toHaveProperty("action", null);
    expect(human).toHaveProperty("target", null);
    expect(human).toHaveProperty("payload", null);
  });
});

// ---------------------------------------------------------------------------
// getFixtureMetadata
// ---------------------------------------------------------------------------

describe("getFixtureMetadata", () => {
  it("returns metadata with all three decode methods for program A", () => {
    const meta = getFixtureMetadata(ADDR.A);
    expect(meta).not.toBeNull();
    expect(typeof meta!.decodeReply).toBe("function");
    expect(typeof meta!.decodePayload).toBe("function");
    expect(typeof meta!.decodeEvent).toBe("function");
  });

  it("returns metadata for all four known programs", () => {
    for (const prog of [ADDR.A, ADDR.B, ADDR.C, ADDR.D]) {
      expect(getFixtureMetadata(prog)).not.toBeNull();
    }
  });

  it("is case-insensitive — uppercase address", () => {
    expect(getFixtureMetadata(ADDR.A.toUpperCase())).not.toBeNull();
  });

  it("is case-insensitive — mixed-case address", () => {
    // Flip some characters to uppercase
    const mixed = ADDR.A.slice(0, 10).toUpperCase() + ADDR.A.slice(10);
    expect(getFixtureMetadata(mixed)).not.toBeNull();
  });

  it("returns null for an unknown program", () => {
    expect(
      getFixtureMetadata(
        "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      ),
    ).toBeNull();
  });

  it("returns null for the user address", () => {
    expect(getFixtureMetadata(ADDR.user)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getFixtureMetadata("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getFixtureSchema
// ---------------------------------------------------------------------------

describe("getFixtureSchema", () => {
  it("returns correct schema names for each program", () => {
    const cases: [string, string, string][] = [
      [ADDR.A, "Route", "RouteReceipt"],
      [ADDR.B, "ProcessOrder", "OrderResult"],
      [ADDR.C, "Validate", "ValidationResult"],
      [ADDR.D, "RecordEvent", "EventRecorded"],
    ];
    for (const [addr, handleName, replyName] of cases) {
      const schema = getFixtureSchema(addr);
      expect(schema).not.toBeNull();
      expect(schema!.handle.name).toBe(handleName);
      expect(schema!.reply.name).toBe(replyName);
    }
  });

  it("returns null for unknown program", () => {
    expect(getFixtureSchema("0xunknown")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getFixtureSchema("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// decodeReply — variant matching
// ---------------------------------------------------------------------------

describe("decodeReply", () => {
  it("decodes a reply-encoded payload", () => {
    const hex = encodeFixturePayload("reply", [true, "fulfilled", 1000]);
    const human = decodeViaMetadata(ADDR.A, hex, "reply");
    expect(human).toEqual({
      name: "RouteReceipt",
      success: true,
      message: "fulfilled",
      gas_used: 1000,
    });
  });

  it("returns null for a handle-encoded payload", () => {
    const hex = encodeFixturePayload("handle", ["transfer", ADDR.B, "100"]);
    expect(decodeViaMetadata(ADDR.A, hex, "reply")).toBeNull();
  });

  it("returns null via decodeReply for an unknown program", () => {
    const hex = encodeFixturePayload("reply", [true, "done"]);
    const result = decodeViaMetadata(
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      hex,
      "reply",
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// decodePayload — variant matching
// ---------------------------------------------------------------------------

describe("decodePayload", () => {
  it("decodes a handle-encoded payload for program A (Route)", () => {
    const hex = encodeFixturePayload("handle", ["transfer", ADDR.B, "100"]);
    const human = decodeViaMetadata(ADDR.A, hex, "payload");
    expect(human).toEqual({
      name: "Route",
      action: "transfer",
      target: ADDR.B,
      payload: "100",
    });
  });

  it("decodes a handle-encoded payload for program B (ProcessOrder)", () => {
    const hex = encodeFixturePayload("handle", [42, 10, "GEAR-001"]);
    const human = decodeViaMetadata(ADDR.B, hex, "payload");
    expect(human).toEqual({
      name: "ProcessOrder",
      order_id: 42,
      quantity: 10,
      sku: "GEAR-001",
    });
  });

  it("decodes a handle-encoded payload for program C (Validate)", () => {
    const hex = encodeFixturePayload("handle", ["0xbeef", 5]);
    const human = decodeViaMetadata(ADDR.C, hex, "payload");
    expect(human).toEqual({
      name: "Validate",
      data_hash: "0xbeef",
      threshold: 5,
    });
  });

  it("decodes a handle-encoded payload for program D (RecordEvent)", () => {
    const hex = encodeFixturePayload("handle", ["payment", ADDR.B, "tx complete", 1000]);
    const human = decodeViaMetadata(ADDR.D, hex, "payload");
    expect(human).toEqual({
      name: "RecordEvent",
      event_type: "payment",
      source: ADDR.B,
      data: "tx complete",
      timestamp: 1000,
    });
  });

  it("returns null for a reply-encoded payload", () => {
    const hex = encodeFixturePayload("reply", [true, "fulfilled", 1000]);
    expect(decodeViaMetadata(ADDR.A, hex, "payload")).toBeNull();
  });

  it("returns null for empty '0x' payload", () => {
    const meta = getFixtureMetadata(ADDR.A);
    expect(meta!.decodePayload("0x")).toBeNull();
  });

  it("returns null for empty '0x00' payload", () => {
    const meta = getFixtureMetadata(ADDR.A);
    expect(meta!.decodePayload("0x00")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// decodeEvent — variant matching
// ---------------------------------------------------------------------------

describe("decodeEvent", () => {
  it("decodes a handle-encoded payload (uses handle schema as fallback)", () => {
    const hex = encodeFixturePayload("handle", ["query", ADDR.C, "check"]);
    const human = decodeViaMetadata(ADDR.A, hex, "event");
    expect(human).toHaveProperty("name", "Route");
    expect(human).toHaveProperty("action", "query");
  });

  it("returns null for a reply-encoded payload (variant mismatch)", () => {
    const hex = encodeFixturePayload("reply", [true, "fulfilled", 1000]);
    expect(decodeViaMetadata(ADDR.A, hex, "event")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toHuman() output shape
// ---------------------------------------------------------------------------

describe("toHuman() output format", () => {
  it("returns name + fields as a flat object", () => {
    const hex = encodeFixturePayload("handle", ["query", ADDR.C, "check"]);
    const human = decodeViaMetadata(ADDR.A, hex, "payload");
    expect(human).toEqual({
      name: "Route",
      action: "query",
      target: ADDR.C,
      payload: "check",
    });
  });

  it("maps params in schema field order", () => {
    const hex = encodeFixturePayload("handle", ["alert", ADDR.D, "critical", 999]);
    const human = decodeViaMetadata(ADDR.D, hex, "payload");
    expect(human).toEqual({
      name: "RecordEvent",
      event_type: "alert",
      source: ADDR.D,
      data: "critical",
      timestamp: 999,
    });
  });

  it("sets missing params to null", () => {
    // Only 2 of 4 fields for RecordEvent
    const hex = encodeFixturePayload("handle", ["alert", ADDR.D]);
    const human = decodeViaMetadata(ADDR.D, hex, "payload");
    expect(human).toMatchObject({
      event_type: "alert",
      source: ADDR.D,
      data: null,
      timestamp: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Round-trip consistency with fixture payload definitions
// ---------------------------------------------------------------------------

describe("fixture payload consistency", () => {
  it("reproduces fixtureSimpleCall's A→B payload", () => {
    const hex = encodeFixturePayload("handle", [42, 10, "GEAR-001"]);
    const human = decodeViaMetadata(ADDR.B, hex, "payload");
    expect(human).toEqual({
      name: "ProcessOrder",
      order_id: 42,
      quantity: 10,
      sku: "GEAR-001",
    });
  });

  it("reproduces fixtureReply's B→A reply payload", () => {
    const hex = encodeFixturePayload("reply", [true, "fulfilled", 1000]);
    const human = decodeViaMetadata(ADDR.A, hex, "reply");
    expect(human).toEqual({
      name: "RouteReceipt",
      success: true,
      message: "fulfilled",
      gas_used: 1000,
    });
  });

  it("reproduces fixtureDeepFailure's B→D payload", () => {
    const hex = encodeFixturePayload("handle", ["payment", ADDR.B, "insufficient balance", 400001]);
    const human = decodeViaMetadata(ADDR.D, hex, "payload");
    expect(human).toEqual({
      name: "RecordEvent",
      event_type: "payment",
      source: ADDR.B,
      data: "insufficient balance",
      timestamp: 400001,
    });
  });

  it("reproduces fixtureFanOut's A→C payload", () => {
    const hex = encodeFixturePayload("handle", ["0xabcd", 3]);
    const human = decodeViaMetadata(ADDR.C, hex, "payload");
    expect(human).toEqual({
      name: "Validate",
      data_hash: "0xabcd",
      threshold: 3,
    });
  });

  it("reproduces fixtureReplyChainWithFailure's B→A reply payload", () => {
    const hex = encodeFixturePayload("reply", [77, "approved", 2500]);
    const human = decodeViaMetadata(ADDR.A, hex, "reply");
    expect(human).toEqual({
      name: "RouteReceipt",
      success: 77,
      message: "approved",
      gas_used: 2500,
    });
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("invalid hex characters produce null via decodePayload", () => {
    const meta = getFixtureMetadata(ADDR.A);
    expect(meta!.decodePayload("0xzzzz")).toBeNull();
  });

  it("hex without 0x prefix produces null via decodePayload", () => {
    const meta = getFixtureMetadata(ADDR.A);
    expect(meta!.decodePayload("01020304")).toBeNull();
  });

  it("wrong version byte produces null via decodePayload", () => {
    // Manually craft a payload with version byte 0x02
    const bytes = Buffer.from([0x02, 0x01, 0x22]);
    const hex = "0x" + bytes.toString("hex");
    const meta = getFixtureMetadata(ADDR.A);
    expect(meta!.decodePayload(hex)).toBeNull();
  });

  it("truncated payload (no JSON body) produces null", () => {
    // Only version + selector, no JSON
    const bytes = Buffer.from([0x01, 0x01]);
    const hex = "0x" + bytes.toString("hex");
    const meta = getFixtureMetadata(ADDR.A);
    expect(meta!.decodePayload(hex)).toBeNull();
  });

  it("malformed JSON body produces null", () => {
    const bytes = Buffer.from([0x01, 0x01, ...Buffer.from("{invalid}", "utf8")]);
    const hex = "0x" + bytes.toString("hex");
    const meta = getFixtureMetadata(ADDR.A);
    expect(meta!.decodePayload(hex)).toBeNull();
  });

  it("boolean, number, and string mixed params round-trip", () => {
    const hex = encodeFixturePayload("reply", [true, 255, "hello"]);
    const human = decodeViaMetadata(ADDR.A, hex, "reply");
    expect(human).toHaveProperty("success", true);
    expect(human).toHaveProperty("message", 255);
    expect(human).toHaveProperty("gas_used", "hello");
  });

  it("empty string params round-trip", () => {
    const hex = encodeFixturePayload("handle", ["", "", ""]);
    const human = decodeViaMetadata(ADDR.A, hex, "payload");
    expect(human).toHaveProperty("action", "");
    expect(human).toHaveProperty("target", "");
    expect(human).toHaveProperty("payload", "");
  });
});
