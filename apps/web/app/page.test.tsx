import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Home from "./page";

const RECENT_ID = "0x" + "a".repeat(64);
const LOADED_ID = "0x" + "b".repeat(64);
const AGED_OUT_ID = "0x" + "c".repeat(64);

// Mock fetch globally
const MOCK_SAMPLES = {
  samples: [
    { alias: "simple", rootMessageId: "0xa", description: "Two-program call" },
    { alias: "failure", rootMessageId: "0xb", description: "Failed call" },
  ],
};

const MOCK_STATUS = {
  ok: true,
  service: "varatrace-api",
  dataSource: {
    mode: "fixture",
    postgres: "empty",
    liveMessages: 0,
    fixtures: 6,
  },
};

const MOCK_LIVE_STATUS = {
  ok: true,
  service: "varatrace-api",
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
};

const MOCK_RECENT = {
  traces: [
    {
      id: RECENT_ID,
      source: "0xsource",
      destination: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      blockNumber: 1234,
      index: 0,
      status: "Success",
      replyCount: 1,
    },
    {
      id: LOADED_ID,
      source: "0xsource",
      destination: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      blockNumber: 1233,
      index: 0,
      status: "Success",
      replyCount: 2,
    },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/status")) {
      return new Response(JSON.stringify(MOCK_STATUS), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/recent")) {
      return new Response(JSON.stringify({ traces: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(MOCK_SAMPLES), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
});

describe("Home page", () => {
  it("renders the VaraTrace heading", () => {
    render(<Home />);
    expect(screen.getByText("VaraTrace")).toBeTruthy();
  });

  it("links the VaraTrace brand to the home page", () => {
    render(<Home />);
    const homeLink = screen.getByRole("link", { name: "VaraTrace home" });
    expect(homeLink).toHaveAttribute("href", "/");
  });

  it("renders a wrapping responsive header", () => {
    render(<Home />);
    const header = screen.getByTestId("app-header");
    expect(header).toHaveStyle({ flexWrap: "wrap" });
  });

  it("renders sample buttons", async () => {
    render(<Home />);
    // Samples load async — wait for them
    const simpleBtn = await screen.findByText("simple");
    expect(simpleBtn).toBeTruthy();
    const failureBtn = await screen.findByText("failure");
    expect(failureBtn).toBeTruthy();
  });

  it("renders fixture mode badge", async () => {
    render(<Home />);
    expect(await screen.findByText("fixture mode")).toBeTruthy();
  });

  it("renders live indexed block badge", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/status")) {
        return new Response(JSON.stringify(MOCK_LIVE_STATUS), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/recent")) {
        return new Response(JSON.stringify(MOCK_RECENT), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(MOCK_SAMPLES), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    render(<Home />);

    expect(await screen.findByText("indexed #1,234")).toBeTruthy();
  });

  it("renders recent live traces when live data is available", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/status")) {
        return new Response(JSON.stringify(MOCK_LIVE_STATUS), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/recent")) {
        return new Response(JSON.stringify(MOCK_RECENT), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(MOCK_SAMPLES), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    render(<Home />);

    const picker = await screen.findByLabelText("Recent live traces");
    expect(picker).toBeTruthy();
    expect(picker).toHaveStyle({ maxWidth: "100%" });
    expect(screen.getByRole("option", { name: /0xaaaa…aaaa/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /to 0xaaaa…aaaa/ })).toBeTruthy();
  });

  it("keeps the recent picker on a viewing label after selecting a live trace", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/status")) {
        return new Response(JSON.stringify(MOCK_LIVE_STATUS), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/recent")) {
        return new Response(JSON.stringify(MOCK_RECENT), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes(`/trace/${LOADED_ID}`)) {
        return new Response(JSON.stringify({
          rootId: LOADED_ID,
          nodes: [
            {
              id: LOADED_ID,
              source: "0xsource",
              destination: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              payload: "0x",
              value: "0",
              blockNumber: 1233,
              index: 0,
              status: "Success",
              isReply: false,
            },
          ],
          edges: [],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(MOCK_SAMPLES), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    render(<Home />);

    const picker = await screen.findByLabelText("Recent live traces") as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: LOADED_ID } });

    expect(await screen.findByText(/Viewing #1,233 · 0xbbbb…bbbb/)).toBeTruthy();
  });

  it("shows the loaded id when the current trace is not in recent results", async () => {
    window.history.replaceState({}, "", `/?id=${AGED_OUT_ID}`);
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/status")) {
        return new Response(JSON.stringify(MOCK_LIVE_STATUS), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/recent")) {
        return new Response(JSON.stringify(MOCK_RECENT), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes(`/trace/${AGED_OUT_ID}`)) {
        return new Response(JSON.stringify({
          rootId: AGED_OUT_ID,
          nodes: [
            {
              id: AGED_OUT_ID,
              source: "0xsource",
              destination: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              payload: "0x",
              value: "0",
              blockNumber: 1200,
              index: 0,
              status: "Success",
              isReply: false,
            },
          ],
          edges: [],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(MOCK_SAMPLES), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    render(<Home />);

    expect(await screen.findByText("Viewing 0xcccc…cccc")).toBeTruthy();
  });

  it("renders the input field and trace button", () => {
    render(<Home />);
    expect(screen.getByPlaceholderText(/message id/)).toBeTruthy();
    expect(screen.getByText("Trace")).toBeTruthy();
  });

  it("shows a clear error for malformed hex input without requesting a trace", async () => {
    render(<Home />);
    const input = screen.getByPlaceholderText(/message id/);
    fireEvent.change(input, { target: { value: "0xshort" } });
    fireEvent.click(screen.getByText("Trace"));

    expect(await screen.findByText(/Hex ids must be exactly 32 bytes/)).toBeTruthy();
    expect(globalThis.fetch).not.toHaveBeenCalledWith(expect.stringContaining("/trace/0xshort"));
  });

  it("does not label malformed input as the viewed trace", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/status")) {
        return new Response(JSON.stringify(MOCK_LIVE_STATUS), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/recent")) {
        return new Response(JSON.stringify(MOCK_RECENT), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(MOCK_SAMPLES), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    render(<Home />);

    await screen.findByLabelText("Recent live traces");
    fireEvent.change(screen.getByPlaceholderText(/message id/), { target: { value: "0xshort" } });
    fireEvent.click(screen.getByText("Trace"));

    expect(await screen.findByText(/Hex ids must be exactly 32 bytes/)).toBeTruthy();
    expect(screen.queryByText("Viewing 0xshort")).toBeNull();
  });

  it("shows empty state message when no trace loaded", () => {
    render(<Home />);
    expect(screen.getByText(/Paste a message id/)).toBeTruthy();
  });
});
