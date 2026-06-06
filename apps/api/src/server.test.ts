import { afterAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { closeMetadataConnection } from "./metadata.js";

const app = buildServer();

afterAll(async () => {
  await app.close();
  await closeMetadataConnection();
});

describe("API routes", () => {
  it("reports health", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, service: "varatrace-api" });
  });

  it("reports data source status", async () => {
    const res = await app.inject({ method: "GET", url: "/status" });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.dataSource.mode).toBe("fixture");
    expect(body.dataSource.fixtures).toBeGreaterThan(0);
  });

  it("lists sample traces", async () => {
    const res = await app.inject({ method: "GET", url: "/samples" });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.samples.map((s: any) => s.alias)).toContain("simple");
    expect(body.samples.map((s: any) => s.alias)).toContain("failure");
  });

  it("lists recent live traces", async () => {
    const res = await app.inject({ method: "GET", url: "/recent?limit=3" });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.traces).toEqual([]);
  });

  it("returns a fixture-backed trace tree", async () => {
    const res = await app.inject({ method: "GET", url: "/trace/simple" });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.rootId).toBeDefined();
    expect(body.nodes).toHaveLength(2);
    expect(body.edges).toHaveLength(1);
    expect(body.edges[0].confidence).toBe("inferred");
  });

  it("registers a program IDL", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/idl",
      payload: {
        programId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        programName: "Ping",
        idl: {
          program: {
            name: "Ping",
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
        },
      },
    });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.programId).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(body.programName).toBe("Ping");
    expect(body.registeredAt).toEqual(expect.any(Number));
  });

  it("returns 404 for unknown traces", async () => {
    const res = await app.inject({ method: "GET", url: "/trace/not-a-trace" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "trace_not_found", id: "not-a-trace" });
  });

  it("returns 400 for malformed trace ids", async () => {
    const res = await app.inject({ method: "GET", url: "/trace/0xshort" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_trace_id" });
  });
});
