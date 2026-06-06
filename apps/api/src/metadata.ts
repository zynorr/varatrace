/**
 * Program metadata fetcher and payload decoder.
 *
 * Resolution order (per program):
 *   1. Fixture metadata (known fixture programs — works offline)
 *   2. In-memory cache (previously fetched from chain or Postgres)
 *   3. Postgres cache (metadata stored by the indexer)
 *   4. Chain (live fetch via GearApi — fallback for unknown programs)
 *
 * Metadata is cached per program for the lifetime of the API server.
 */
import "dotenv/config";
import { getFixtureMetadata } from "./fixture-metadata.js";

const VARA_WSS = process.env.VARA_WSS ?? "wss://testnet.vara.network";

type DecodeKind = "payload" | "reply" | "event";

interface RegisteredIdlRecord {
  programId: string;
  programName?: string;
  idl: string;
  registeredAt: number;
}

interface RegisteredDecoder {
  programName?: string;
  decode(kind: DecodeKind, payloadHex: string): any | null;
}

// ---------------------------------------------------------------------------
// Lazy GearApi connection (shared across requests)
// ---------------------------------------------------------------------------

let _api: any = null;
let _connecting: Promise<any> | null = null;

async function getApi(): Promise<any> {
  if (_api) return _api;
  if (_connecting) {
    // If a connection attempt is in progress, wait for it
    try {
      return await _connecting;
    } catch {
      // Previous attempt failed — retry
      _connecting = null;
    }
  }

  _connecting = (async () => {
    try {
      const { GearApi } = await import("@gear-js/api");
      const api = await GearApi.create({ providerAddress: VARA_WSS });
      _api = api;
      console.log(`Metadata: connected to ${VARA_WSS}`);

      // Reconnect on disconnect
      api.on("disconnected", () => {
        console.warn("Metadata: disconnected — will reconnect on next request.");
        _api = null;
        _connecting = null;
      });

      return api;
    } catch (err) {
      console.warn(
        `Metadata: failed to connect to ${VARA_WSS}:`,
        (err as Error).message,
      );
      // Reset so next call retries
      _connecting = null;
      throw err;
    }
  })();

  return _connecting;
}

// ---------------------------------------------------------------------------
// Metadata cache (programId -> decoded types or null)
// ---------------------------------------------------------------------------

const metaCache = new Map<string, any>();
const idlCache = new Map<string, RegisteredDecoder | null>();
let pgPool: any = null;
let pgUnavailable = false;

function getCacheKey(programId: string): string {
  return programId.toLowerCase();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decode a hex payload for a given program, using on-chain metadata.
 *
 * @param programId - The program's address (32-byte hex).
 * @param payloadHex - The raw hex payload to decode (e.g. "0x01020304").
 * @returns The decoded JSON string, or null if decoding is not possible.
 */
export async function decodePayload(
  programId: string,
  payloadHex: string,
  preferredKind: DecodeKind = "payload",
): Promise<string | null> {
  // Nothing to decode
  if (!payloadHex || payloadHex === "0x" || payloadHex === "0x00") {
    return null;
  }

  try {
    const idlDecoder = await getRegisteredIdlDecoder(programId);
    if (idlDecoder) {
      const decoded = idlDecoder.decode(preferredKind, payloadHex);
      if (decoded !== undefined && decoded !== null) {
        return JSON.stringify(toPlainJson(decoded), null, 2);
      }
    }
  } catch {
    // Registered IDL decoding is best-effort; fall through to metadata.
  }

  const key = getCacheKey(programId);

  // Check cache
  let metadata = metaCache.get(key);
  if (metadata === undefined) {
    metadata = await fetchMetadata(programId);
    metaCache.set(key, metadata);
  }

  if (!metadata) return null;

  try {
    const decoded = tryDecodeMetadata(metadata, payloadHex, preferredKind);

    if (decoded === undefined || decoded === null) return null;

    // Convert to a readable JSON string
    const json = toPlainJson(decoded);
    return JSON.stringify(json, null, 2);
  } catch {
    return null;
  }
}

export async function registerProgramIdl(input: {
  programId: string;
  idl: string;
  programName?: string;
}): Promise<RegisteredIdlRecord> {
  const programId = normalizeProgramId(input.programId);
  const idl = normalizeIdlText(input.idl);
  const programName = normalizeProgramName(input.programName) ?? extractProgramName(idl);
  const decoder = await createSailsDecoder(programId, idl, programName);
  const registeredAt = Date.now();

  const pool = await getPgPool();
  if (pool) {
    await ensureProgramIdlTable(pool);
    await pool.query(
      `INSERT INTO program_idls (program_id, program_name, idl, registered_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (program_id) DO UPDATE SET
         program_name = EXCLUDED.program_name,
         idl = EXCLUDED.idl,
         registered_at = EXCLUDED.registered_at`,
      [programId, programName ?? null, idl, registeredAt],
    );
  }

  idlCache.set(getCacheKey(programId), decoder);
  return { programId, idl, programName, registeredAt };
}

export async function getProgramLabel(programId: string): Promise<string | null> {
  const decoder = await getRegisteredIdlDecoder(programId);
  return decoder?.programName ?? null;
}

/**
 * Fetch metadata for a program, checked in order:
 *   1. Fixture metadata (known fixture programs — works offline)
 *   2. Postgres cache (metadata stored by the indexer)
 *   3. Chain (live fetch via GearApi)
 *
 * Returns null if no metadata is found.
 */
async function fetchMetadata(programId: string): Promise<any | null> {
  // Step 1: Check fixture metadata first (works offline, no chain needed)
  const fixtureMeta = getFixtureMetadata(programId);
  if (fixtureMeta) {
    return fixtureMeta;
  }

  // Step 2: Check metadata cached by the indexer in Postgres.
  const cachedMeta = await fetchMetadataFromPg(programId);
  if (cachedMeta) {
    return cachedMeta;
  }

  // Step 3: Fall back to chain metadata.
  try {
    const api = await getApi();

    // Try multiple API paths — the metadata accessor varies across versions
    const metadata =
      // api.gear.metadata.get (v0.45+)
      (await api.gear?.metadata?.get?.(programId)) ??
      // api.gear.getMetadata (older v0.4x)
      (await api.gear?.getMetadata?.(programId)) ??
      // api.programMetadata.get (alternative path)
      (await api.programMetadata?.get?.(programId)) ??
      null;

    if (!metadata) {
      return null;
    }

    return metadata;
  } catch (err) {
    console.warn(
      `Metadata: failed to fetch for ${programId.slice(0, 10)}...:`,
      (err as Error).message,
    );
    return null;
  }
}

async function getRegisteredIdlDecoder(programId: string): Promise<RegisteredDecoder | null> {
  const key = getCacheKey(programId);
  if (idlCache.has(key)) return idlCache.get(key) ?? null;

  const row = await fetchProgramIdlFromPg(programId);
  if (!row) {
    idlCache.set(key, null);
    return null;
  }

  try {
    const decoder = await createSailsDecoder(row.programId, row.idl, row.programName);
    idlCache.set(key, decoder);
    return decoder;
  } catch (err) {
    console.warn(
      `Metadata: failed to parse registered IDL for ${programId.slice(0, 10)}...:`,
      (err as Error).message,
    );
    idlCache.set(key, null);
    return null;
  }
}

async function createSailsDecoder(
  programId: string,
  idl: string,
  programName?: string,
): Promise<RegisteredDecoder> {
  const parsedJson = tryParseJson(idl);
  if (parsedJson && (parsedJson.program || parsedJson.services)) {
    const { SailsProgram } = await import("sails-js");
    const { normalizeIdl } = await import("sails-js/parser");
    const program = new SailsProgram(normalizeIdl(parsedJson));
    program.setProgramId(programId as `0x${string}`);
    return {
      programName: programName ?? normalizeProgramName(parsedJson.program?.name),
      decode: (kind, payloadHex) => decodeWithSailsProgram(program, kind, payloadHex),
    };
  }

  const { Sails } = await import("sails-js");
  const { SailsIdlParser } = await import("sails-js/parser");
  const parser = new SailsIdlParser();
  await parser.init();
  const sails = new Sails(parser);
  sails.parseIdl(idl);
  sails.setProgramId(programId as `0x${string}`);
  return {
    programName: programName ?? extractLegacyProgramName(sails),
    decode: (kind, payloadHex) => decodeWithLegacySails(sails, kind, payloadHex),
  };
}

function decodeWithSailsProgram(
  program: any,
  kind: DecodeKind,
  payloadHex: string,
): any | null {
  const attempts =
    kind === "reply"
      ? [() => program.decodeReply(payloadHex), () => program.decodeError(payloadHex)]
      : kind === "event"
        ? [() => program.decodeEvent(payloadHex)]
        : [() => program.decodeCall(payloadHex), () => program.decodeCtor(payloadHex)];

  for (const attempt of attempts) {
    try {
      const decoded = attempt();
      if (decoded && decoded.kind !== "unknown") return decoded;
    } catch {
      // Try the next v2 decode strategy.
    }
  }
  return null;
}

function decodeWithLegacySails(sails: any, kind: DecodeKind, payloadHex: string): any | null {
  const services = sails.services ?? {};
  for (const [serviceName, service] of Object.entries<any>(services)) {
    const collections =
      kind === "event"
        ? [service.events ?? {}]
        : [service.functions ?? {}, service.queries ?? {}];

    for (const collection of collections) {
      for (const [entryName, entry] of Object.entries<any>(collection)) {
        try {
          const decoded =
            kind === "event"
              ? entry.decode?.(payloadHex)
              : kind === "reply"
                ? entry.decodeResult?.(payloadHex)
                : entry.decodePayload?.(payloadHex);
          if (decoded !== undefined && decoded !== null) {
            return { service: serviceName, entry: entryName, kind, value: decoded };
          }
        } catch {
          // Prefix or SCALE mismatch for this candidate.
        }
      }
    }
  }
  return null;
}

function tryDecodeMetadata(
  metadata: any,
  payloadHex: string,
  preferredKind: DecodeKind,
): any | null {
  const order = preferredKind === "reply"
    ? ["reply", "payload", "event"] as DecodeKind[]
    : preferredKind === "event"
      ? ["event", "payload", "reply"] as DecodeKind[]
      : ["payload", "reply", "event"] as DecodeKind[];

  for (const kind of order) {
    const decoded = decodeWithKind(metadata, payloadHex, kind);
    if (decoded !== undefined && decoded !== null) return decoded;
  }

  return null;
}

function decodeWithKind(metadata: any, payloadHex: string, kind: DecodeKind): any | null {
  try {
    if (kind === "reply") {
      if (typeof metadata.decodeReply === "function") {
        return metadata.decodeReply(payloadHex);
      }
      const typeIndex = metadata.types?.reply;
      return typeIndex === null || typeIndex === undefined
        ? null
        : metadata.createType?.(typeIndex, payloadHex) ?? null;
    }

    if (kind === "payload") {
      if (typeof metadata.decodePayload === "function") {
        return metadata.decodePayload(payloadHex);
      }
      const typeIndex = metadata.types?.handle?.input;
      return typeIndex === null || typeIndex === undefined
        ? null
        : metadata.createType?.(typeIndex, payloadHex) ?? null;
    }

    if (typeof metadata.decodeEvent === "function") {
      return metadata.decodeEvent(payloadHex);
    }
    const typeIndex = metadata.types?.others?.input;
    return typeIndex === null || typeIndex === undefined
      ? null
      : metadata.createType?.(typeIndex, payloadHex) ?? null;
  } catch {
    return null;
  }
}

async function getPgPool(): Promise<any | null> {
  if (pgPool) return pgPool;
  if (pgUnavailable) return null;

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) return null;

  try {
    const { default: pg } = await import("pg");
    pgPool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
    return pgPool;
  } catch (err) {
    pgUnavailable = true;
    console.warn(
      "Metadata: Postgres unavailable (",
      (err as Error).message,
      ") — skipping metadata cache.",
    );
    return null;
  }
}

async function fetchMetadataFromPg(programId: string): Promise<any | null> {
  const pool = await getPgPool();
  if (!pool) return null;

  try {
    await ensureProgramMetadataTable(pool);
    const res = await pool.query(
      "SELECT meta_hex FROM program_metadata WHERE program_id = $1",
      [programId.toLowerCase()],
    );
    const metaHex = res.rows[0]?.meta_hex;
    if (!metaHex) return null;

    const gearApiModule: any = await import("@gear-js/api");
    return gearApiModule.ProgramMetadata?.from?.(metaHex) ?? null;
  } catch (err) {
    console.warn(
      `Metadata: failed to read cached metadata for ${programId.slice(0, 10)}...:`,
      (err as Error).message,
    );
    return null;
  }
}

async function fetchProgramIdlFromPg(programId: string): Promise<RegisteredIdlRecord | null> {
  const pool = await getPgPool();
  if (!pool) return null;

  try {
    await ensureProgramIdlTable(pool);
    const res = await pool.query(
      "SELECT program_id, program_name, idl, registered_at FROM program_idls WHERE program_id = $1",
      [programId.toLowerCase()],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      programId: row.program_id,
      programName: row.program_name ?? undefined,
      idl: row.idl,
      registeredAt: Number(row.registered_at),
    };
  } catch (err) {
    console.warn(
      `Metadata: failed to read registered IDL for ${programId.slice(0, 10)}...:`,
      (err as Error).message,
    );
    return null;
  }
}

async function ensureProgramMetadataTable(pool: any): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS program_metadata (
       program_id TEXT PRIMARY KEY,
       meta_hex TEXT NOT NULL,
       fetched_at BIGINT NOT NULL
     )`,
  );
}

async function ensureProgramIdlTable(pool: any): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS program_idls (
       program_id TEXT PRIMARY KEY,
       program_name TEXT,
       idl TEXT NOT NULL,
       registered_at BIGINT NOT NULL
     )`,
  );
}

/**
 * Batch-decode all messages in a trace, adding decodedPayload to each node.
 * Mutates the tree nodes in-place.
 */
export async function decodeTracePayloads(trace: { nodes: any[] }): Promise<void> {
  const uniquePrograms = new Set<string>();
  for (const node of trace.nodes) {
    if (node.destination && !node.fromUser) {
      uniquePrograms.add(node.destination);
    }
  }

  if (uniquePrograms.size === 0) return;

  // Pre-fetch metadata for all unique programs in parallel
  const fetchPromises: Promise<void>[] = [];
  for (const progId of uniquePrograms) {
    const key = getCacheKey(progId);
    if (!metaCache.has(key)) {
      fetchPromises.push(
        fetchMetadata(progId).then((m) => {
          metaCache.set(key, m);
        }),
      );
    }
  }
  await Promise.all(fetchPromises);

  // Decode all nodes' payloads in parallel
  const decodePromises = trace.nodes.map(async (node) => {
    if (node.destination) {
      const programName = await getProgramLabel(node.destination);
      if (programName) node.programName = programName;
    }
    if (!node.payload || node.payload === "0x" || node.fromUser) return;
    const decoded = await decodePayload(
      node.destination,
      node.payload,
      node.isReply ? "reply" : "payload",
    );
    if (decoded) {
      node.decodedPayload = decoded;
    }
  });
  await Promise.all(decodePromises);
}

/**
 * Disconnect from the chain (for graceful shutdown).
 */
export async function closeMetadataConnection(): Promise<void> {
  if (_api) {
    try {
      await _api.disconnect();
    } catch {
      // ignore
    }
    _api = null;
  }
  if (pgPool) {
    try {
      await pgPool.end();
    } catch {
      // ignore
    }
    pgPool = null;
  }
  pgUnavailable = false;
  metaCache.clear();
  idlCache.clear();
}

function normalizeProgramId(programId: string): string {
  const normalized = programId.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("programId must be a 32-byte hex string");
  }
  return normalized;
}

function normalizeIdlText(idl: string): string {
  const normalized = idl.trim();
  if (normalized.length === 0) {
    throw new Error("idl must not be empty");
  }
  return normalized;
}

function normalizeProgramName(programName?: string): string | undefined {
  const normalized = programName?.trim();
  return normalized ? normalized.slice(0, 120) : undefined;
}

function tryParseJson(idl: string): any | null {
  try {
    return JSON.parse(idl);
  } catch {
    return null;
  }
}

function extractProgramName(idl: string): string | undefined {
  const parsed = tryParseJson(idl);
  if (parsed?.program?.name && typeof parsed.program.name === "string") {
    return normalizeProgramName(parsed.program.name);
  }
  const match = idl.match(/\bprogram\s+([A-Za-z_][A-Za-z0-9_]*)/);
  return match?.[1];
}

function extractLegacyProgramName(sails: any): string | undefined {
  const services = Object.keys(sails.services ?? {});
  return services.length === 1 ? services[0] : undefined;
}

function toPlainJson(decoded: any): any {
  if (decoded && typeof decoded.toHuman === "function") return decoded.toHuman();
  if (decoded && typeof decoded.toJSON === "function") return decoded.toJSON();
  return decoded;
}
