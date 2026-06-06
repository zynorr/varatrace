/**
 * Fixture metadata decoder — provides ProgramMetadata-like decoding for known
 * fixture programs so the decoded payload feature can be demonstrated without
 * a live chain connection.
 *
 * Each fixture program has a set of known message types defined by a synthetic
 * IDL. The actual fixture payloads are hex-encoded JSON strings (prefixed with
 * a version byte), and this decoder reverses the encoding to produce structured
 * JSON resembling what real ProgramMetadata.decodeReply() would return.
 *
 * Wire order: fixture metadata checked FIRST, then chain metadata (so demo
 * works offline and chain overrides when available).
 */

import { ADDR } from "../../../packages/core/src/fixtures.js";

// ---------------------------------------------------------------------------
// Schema definitions for each fixture program
// ---------------------------------------------------------------------------

interface FieldDef {
  name: string;
  type: string;
}

interface MessageSchema {
  name: string;
  fields: FieldDef[];
}

interface ProgramSchema {
  programId: string;
  handle: MessageSchema;
  reply: MessageSchema;
}

const FIXTURE_SCHEMAS: Record<string, ProgramSchema> = {
  [ADDR.A.toLowerCase()]: {
    programId: ADDR.A,
    handle: {
      name: "Route",
      fields: [
        { name: "action", type: "String" },
        { name: "target", type: "ActorId" },
        { name: "payload", type: "String" },
      ],
    },
    reply: {
      name: "RouteReceipt",
      fields: [
        { name: "success", type: "bool" },
        { name: "message", type: "String" },
        { name: "gas_used", type: "u64" },
      ],
    },
  },
  [ADDR.B.toLowerCase()]: {
    programId: ADDR.B,
    handle: {
      name: "ProcessOrder",
      fields: [
        { name: "order_id", type: "u64" },
        { name: "quantity", type: "u32" },
        { name: "sku", type: "String" },
      ],
    },
    reply: {
      name: "OrderResult",
      fields: [
        { name: "order_id", type: "u64" },
        { name: "status", type: "String" },
        { name: "total", type: "u128" },
      ],
    },
  },
  [ADDR.C.toLowerCase()]: {
    programId: ADDR.C,
    handle: {
      name: "Validate",
      fields: [
        { name: "data_hash", type: "H256" },
        { name: "threshold", type: "u8" },
      ],
    },
    reply: {
      name: "ValidationResult",
      fields: [
        { name: "is_valid", type: "bool" },
        { name: "score", type: "u8" },
        { name: "reason", type: "String" },
      ],
    },
  },
  [ADDR.D.toLowerCase()]: {
    programId: ADDR.D,
    handle: {
      name: "RecordEvent",
      fields: [
        { name: "event_type", type: "String" },
        { name: "source", type: "ActorId" },
        { name: "data", type: "String" },
        { name: "timestamp", type: "u64" },
      ],
    },
    reply: {
      name: "EventRecorded",
      fields: [
        { name: "entry_id", type: "u64" },
        { name: "block", type: "u32" },
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// Payload encoding/decoding
//
// Fixture payloads are hex-encoded JSON with a 1-byte selector prefix:
//   byte 0: 0x01 = handle, 0x02 = reply
//   bytes 1+: UTF-8 JSON of the field values as a flattened array
// ---------------------------------------------------------------------------

const PAYLOAD_ENCODING_VERSION = 1;

/** Encode fixture payload bytes into a hex string. */
export function encodeFixturePayload(
  variant: "handle" | "reply",
  paramValues: unknown[],
): string {
  const selector = variant === "handle" ? 0x01 : 0x02;
  const json = JSON.stringify(paramValues);
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(json);
  const bytes = new Uint8Array(2 + jsonBytes.length);
  bytes[0] = PAYLOAD_ENCODING_VERSION;
  bytes[1] = selector;
  bytes.set(jsonBytes, 2);
  return "0x" + Buffer.from(bytes).toString("hex");
}

/** Decode a fixture payload hex back into structured JSON. */
function decodeFixturePayload(
  payloadHex: string,
): { variant: "handle" | "reply"; params: unknown[] } | null {
  if (!payloadHex.startsWith("0x") || payloadHex.length < 6) return null;
  const bytes = Buffer.from(payloadHex.slice(2), "hex");
  if (bytes.length < 2) return null;

  const version = bytes[0]!;
  if (version !== PAYLOAD_ENCODING_VERSION) return null;

  const selector = bytes[1]!;
  const variant = selector === 0x02 ? "reply" : "handle";

  const json = new TextDecoder().decode(bytes.slice(2));
  try {
    const params = JSON.parse(json);
    return { variant, params: Array.isArray(params) ? params : [params] };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ProgramMetadata-like mock decoder
// ---------------------------------------------------------------------------

/**
 * Create a mock metadata decoder object that mimics the ProgramMetadata
 * interface (decodeReply/decodePayload returning Codec-like objects with
 * toHuman()).
 *
 * Each method only succeeds if the payload's encoded variant matches
 * (handle vs reply), so the API's decodeReply → decodePayload fallback
 * works correctly.
 */
function createMockMetadata(schema: ProgramSchema) {
  return {
    schema,
    decodeReply(payloadHex: string): any {
      return decodeAndAnnotate(payloadHex, schema.reply, "reply");
    },
    decodePayload(payloadHex: string): any {
      return decodeAndAnnotate(payloadHex, schema.handle, "handle");
    },
    decodeEvent(payloadHex: string): any {
      return decodeAndAnnotate(payloadHex, schema.handle, "handle");
    },
  };
}

function decodeAndAnnotate(
  payloadHex: string,
  msgSchema: MessageSchema,
  expectedVariant: "handle" | "reply",
): MockCodec | null {
  const decoded = decodeFixturePayload(payloadHex);
  if (!decoded) return null;

  // Only decode if the payload's variant matches what was requested
  if (decoded.variant !== expectedVariant) return null;

  // Map the decoded params array onto the schema field definitions
  const fields: Record<string, any> = {};
  for (let i = 0; i < msgSchema.fields.length; i++) {
    const field = msgSchema.fields[i]!;
    fields[field.name] = decoded.params[i] ?? null;
  }

  return new MockCodec({
    name: msgSchema.name,
    fields,
    fieldDefs: msgSchema.fields,
  });
}

// ---------------------------------------------------------------------------
// Mock Codec object (mimics the toHuman() behavior of @polkadot Codec types)
// ---------------------------------------------------------------------------

class MockCodec {
  private data: Record<string, any>;

  constructor(data: { name: string; fields: Record<string, any>; fieldDefs: FieldDef[] }) {
    this.data = data;
  }

  toHuman(): any {
    const fn: any = { name: this.data.name };
    for (const [key, value] of Object.entries(this.data.fields)) {
      fn[key] = value;
    }
    return fn;
  }

  toJSON(): any {
    return this.toHuman();
  }

  toString(): string {
    return JSON.stringify(this.toHuman());
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get fixture metadata for a program, if it has a known schema.
 * Returns a ProgramMetadata-like object with decodeReply/decodePayload methods,
 * or null if the program is not a known fixture program.
 */
export function getFixtureMetadata(
  programId: string,
): { decodeReply(hex: string): any; decodePayload(hex: string): any; decodeEvent(hex: string): any } | null {
  const key = programId.toLowerCase();
  const schema = FIXTURE_SCHEMAS[key];
  if (!schema) return null;
  return createMockMetadata(schema);
}

/**
 * Get the schema definition for a fixture program (for debugging / display).
 */
export function getFixtureSchema(
  programId: string,
): ProgramSchema | null {
  const key = programId.toLowerCase();
  return FIXTURE_SCHEMAS[key] ?? null;
}
