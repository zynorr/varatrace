import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchRecentTraces, fetchTrace, fetchSamples, fetchStatus, resolveApiUrlForTest } from "./api";

const MOCK_TREE = {
  rootId: "0xabc",
  nodes: [{ id: "0xabc", source: "0xa", destination: "0xb", payload: "0x", value: "0", blockNumber: 1, index: 0, status: "Success", isReply: false }],
  edges: [],
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("fetchTrace", () => {
  it("returns the trace tree on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_TREE), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const result = await fetchTrace("0xabc");
    expect(result.rootId).toBe("0xabc");
    expect(result.nodes.length).toBe(1);
  });

  it("throws on 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 404 }),
    );
    await expect(fetchTrace("0xunknown")).rejects.toThrow("No trace found for that message id or transaction hash.");
  });

  it("throws a clear validation error on 400", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_trace_id" }), { status: 400 }),
    );
    await expect(fetchTrace("0xshort")).rejects.toThrow("Enter a sample name");
  });

  it("throws on non-ok status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 500 }),
    );
    await expect(fetchTrace("0xbad")).rejects.toThrow("Request failed (500)");
  });

  it("encodes the id in the URL", async () => {
    const mock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_TREE), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    await fetchTrace("0xspecial/?"); // chars that need encoding
    expect(mock).toHaveBeenCalledWith(
      expect.stringContaining("/trace/0xspecial%2F%3F"),
    );
  });

  it("uses the configured API URL when present", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://configured.example");
    const mock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_TREE), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    await fetchTrace("simple");

    expect(mock).toHaveBeenCalledWith("https://configured.example/trace/simple");
  });

  it("resolves the public API URL on Vercel when no env is bundled", () => {
    expect(resolveApiUrlForTest("varatrace-web.vercel.app")).toBe("https://varatrace-api.vercel.app");
  });
});

describe("fetchSamples", () => {
  it("returns samples on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ samples: [{ alias: "simple", rootMessageId: "0xa", description: "test" }] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const samples = await fetchSamples();
    expect(samples.length).toBe(1);
    expect(samples[0]!.alias).toBe("simple");
  });

  it("returns empty array on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 500 }),
    );
    const samples = await fetchSamples();
    expect(samples).toEqual([]);
  });
});

describe("fetchStatus", () => {
  it("returns data-source status on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          dataSource: {
            mode: "live",
            postgres: "ready",
            liveMessages: 42,
            liveDispatches: 40,
            metadataPrograms: 3,
            lastIndexedBlock: 1234,
            indexedAt: Date.now(),
            indexerRunning: true,
            fixtures: 6,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const status = await fetchStatus();

    expect(status).toMatchObject({ mode: "live", liveMessages: 42, lastIndexedBlock: 1234 });
  });

  it("returns null on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 500 }),
    );

    await expect(fetchStatus()).resolves.toBeNull();
  });
});

describe("fetchRecentTraces", () => {
  it("returns recent traces on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          traces: [
            {
              id: "0xrecent",
              source: "0xsource",
              destination: "0xdest",
              blockNumber: 10,
              index: 0,
              status: "Success",
              replyCount: 1,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const traces = await fetchRecentTraces(3);

    expect(traces).toHaveLength(1);
    expect(traces[0]!.id).toBe("0xrecent");
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("/recent?limit=3"));
  });

  it("returns an empty array on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 500 }),
    );

    await expect(fetchRecentTraces()).resolves.toEqual([]);
  });
});
