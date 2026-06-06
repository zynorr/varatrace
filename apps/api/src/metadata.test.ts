import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADDR } from "../../../packages/core/src/fixtures.js";
import { encodeFixturePayload } from "./fixture-metadata.js";
import {
  closeMetadataConnection,
  decodePayload,
  decodeTracePayloads,
  getProgramLabel,
  registerProgramIdl,
} from "./metadata.js";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  poolEnd: vi.fn(),
  poolCtor: vi.fn(),
  gearCreate: vi.fn(),
  programMetadataFrom: vi.fn(),
}));

vi.mock("pg", () => ({
  default: {
    Pool: mocks.poolCtor,
  },
}));

vi.mock("@gear-js/api", () => ({
  GearApi: {
    create: mocks.gearCreate,
  },
  ProgramMetadata: {
    from: mocks.programMetadataFrom,
  },
}));

const UNKNOWN_PROGRAM =
  "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

const IDL_PROGRAM =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const SAILS_V2_IDL = {
  program: {
    name: "PingProgram",
    ctors: [],
    services: [{ name: "Ping", interface_id: 1, route_idx: 1 }],
    types: [],
  },
  services: [
    {
      name: "Ping",
      interface_id: 1,
      funcs: [
        {
          name: "Send",
          kind: "command",
          entry_id: 7,
          params: [{ name: "count", type: "u32" }],
          output: "String",
        },
      ],
      events: [],
      types: [],
    },
  ],
};

function mockProgramMetadata() {
  return {
    types: {
      handle: { input: 7 },
      reply: 8,
      others: { input: 9 },
    },
    createType: vi.fn((typeIndex: number, payloadHex: string) => ({
      toHuman: () => ({ typeIndex, payloadHex }),
    })),
  };
}

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://varatrace:varatrace@localhost:5432/varatrace";
  mocks.poolQuery.mockReset();
  mocks.poolEnd.mockReset();
  mocks.gearCreate.mockReset();
  mocks.programMetadataFrom.mockReset();
  mocks.poolCtor.mockReset();
  mocks.poolCtor.mockImplementation(() => ({
    query: mocks.poolQuery,
    end: mocks.poolEnd,
  }));
});

afterEach(async () => {
  await closeMetadataConnection();
  delete process.env.DATABASE_URL;
});

describe("metadata decoder", () => {
  it("decodes unknown program payloads from indexed Postgres metadata before using the chain", async () => {
    const meta = mockProgramMetadata();
    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ meta_hex: "0x1234" }] });
    mocks.programMetadataFrom.mockReturnValueOnce(meta);

    const decoded = await decodePayload(UNKNOWN_PROGRAM, "0xfeed");

    expect(JSON.parse(decoded!)).toEqual({ typeIndex: 7, payloadHex: "0xfeed" });
    expect(mocks.poolQuery).toHaveBeenCalledWith(
      "SELECT meta_hex FROM program_metadata WHERE program_id = $1",
      [UNKNOWN_PROGRAM],
    );
    expect(mocks.programMetadataFrom).toHaveBeenCalledWith("0x1234");
    expect(mocks.gearCreate).not.toHaveBeenCalled();
  });

  it("uses reply metadata when batch-decoding reply nodes", async () => {
    const meta = mockProgramMetadata();
    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ meta_hex: "0x5678" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mocks.programMetadataFrom.mockReturnValueOnce(meta);

    const trace: { nodes: any[] } = {
      nodes: [
        {
          destination: UNKNOWN_PROGRAM,
          payload: "0xbeef",
          isReply: true,
        },
      ],
    };

    await decodeTracePayloads(trace);

    expect(JSON.parse(trace.nodes[0]!.decodedPayload)).toEqual({
      typeIndex: 8,
      payloadHex: "0xbeef",
    });
  });

  it("registers a Sails IDL and decodes matching payloads before metadata lookup", async () => {
    delete process.env.DATABASE_URL;
    const { SailsProgram } = await import("sails-js");
    const { normalizeIdl } = await import("sails-js/parser");
    const program = new SailsProgram(normalizeIdl(SAILS_V2_IDL));
    const payload = program.services.Ping!.functions.Send!.encodePayload(42);

    await registerProgramIdl({
      programId: IDL_PROGRAM,
      idl: JSON.stringify(SAILS_V2_IDL),
    });

    const decoded = await decodePayload(IDL_PROGRAM, payload);

    expect(JSON.parse(decoded!)).toMatchObject({
      kind: "call",
      entry: {
        kind: "command",
        service: "Ping",
        fn: "Send",
      },
      args: { count: 42 },
    });
    expect(await getProgramLabel(IDL_PROGRAM)).toBe("PingProgram");
    expect(mocks.poolCtor).not.toHaveBeenCalled();
    expect(mocks.gearCreate).not.toHaveBeenCalled();
  });

  it("still decodes fixture metadata without a database connection", async () => {
    delete process.env.DATABASE_URL;

    const decoded = await decodePayload(
      ADDR.B,
      encodeFixturePayload("handle", [42, 10, "GEAR-001"]),
    );

    expect(JSON.parse(decoded!)).toMatchObject({
      name: "ProcessOrder",
      order_id: 42,
      quantity: 10,
      sku: "GEAR-001",
    });
    expect(mocks.poolCtor).not.toHaveBeenCalled();
    expect(mocks.gearCreate).not.toHaveBeenCalled();
  });
});
