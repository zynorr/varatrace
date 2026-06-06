import Fastify from "fastify";
import cors from "@fastify/cors";
import { buildTraceTree, TraceTooLargeError } from "../../../packages/core/src/index.js";
import { closeDataSourceConnection, fetchRawTrace, getDataSourceStatus, listRecentTraces, listSamples } from "./dataSource.js";
import { decodeTracePayloads, closeMetadataConnection, registerProgramIdl } from "./metadata.js";
import { getCachedTrace, setCachedTrace, clearCache, getCacheStats } from "./trace-cache.js";

const PORT = Number(process.env.PORT ?? 3001);

export function buildServer() {
  const app = Fastify({ logger: false });
  app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true, service: "varatrace-api" }));

  app.get("/status", async () => ({
    ok: true,
    service: "varatrace-api",
    dataSource: await getDataSourceStatus(),
  }));

  // Cache stats for monitoring
  app.get("/cache", async () => getCacheStats());

  app.post<{
    Body: { programId?: string; idl?: string | object; programName?: string };
  }>("/idl", async (req, reply) => {
    const { programId, idl, programName } = req.body ?? {};
    if (typeof programId !== "string") {
      return reply.code(400).send({ error: "invalid_program_id" });
    }
    if (typeof idl !== "string" && (typeof idl !== "object" || idl === null)) {
      return reply.code(400).send({ error: "invalid_idl" });
    }

    try {
      const registered = await registerProgramIdl({
        programId,
        programName,
        idl: typeof idl === "string" ? idl : JSON.stringify(idl),
      });
      clearCache();
      return {
        ok: true,
        programId: registered.programId,
        programName: registered.programName ?? null,
        registeredAt: registered.registeredAt,
      };
    } catch (err) {
      return reply.code(400).send({
        error: "invalid_idl",
        message: (err as Error).message,
      });
    }
  });

  // List sample entry points (handy for the UI and for trying the API).
  app.get("/samples", async () => ({ samples: listSamples() }));

  app.get<{ Querystring: { limit?: string } }>("/recent", async (req) => {
    const parsedLimit = Number(req.query.limit ?? 8);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 8;
    return { traces: await listRecentTraces(limit) };
  });

  // The core endpoint: reconstruct and return a trace tree for an id.
  app.get<{ Params: { id: string } }>("/trace/:id", async (req, reply) => {
    const { id } = req.params;
    const normalizedId = id.trim();

    if (!isSupportedTraceInput(normalizedId)) {
      return reply.code(400).send({
        error: "invalid_trace_id",
        message: "Enter a sample name, 32-byte message id, or 32-byte transaction hash.",
      });
    }

    // Check cache first
    const cached = getCachedTrace(normalizedId);
    if (cached) {
      return cached;
    }

    const raw = await fetchRawTrace(normalizedId);
    if (!raw) {
      return reply.code(404).send({ error: "trace_not_found", id: normalizedId });
    }

    try {
      const tree = buildTraceTree(raw.messages, raw.statuses);

      // Decode payloads using on-chain program metadata (best-effort)
      await decodeTracePayloads(tree).catch(() => {});

      // Cache the result before returning
      setCachedTrace(normalizedId, tree);

      return tree;
    } catch (err: unknown) {
      if (err instanceof TraceTooLargeError) {
        return reply.code(413).send({
          error: "trace_too_large",
          message: err.message,
          nodeCount: err.nodeCount,
          limit: err.limit,
        });
      }
      req.log.error(err);
      return reply.code(500).send({ error: "reconstruction_failed" });
    }
  });

  return app;
}

function isSupportedTraceInput(value: string): boolean {
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return true;
  return /^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/.test(value);
}

// Start only when run directly.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = buildServer();
  app
    .listen({ port: PORT, host: "0.0.0.0" })
    .then(() => console.log(`varatrace-api listening on http://localhost:${PORT}`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });

  // Clean up chain connection and clear cache on shutdown
  process.on("SIGINT", async () => {
    await closeMetadataConnection();
    await closeDataSourceConnection();
    clearCache();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await closeMetadataConnection();
    await closeDataSourceConnection();
    clearCache();
    process.exit(0);
  });
}
