import { describe, it, expect, beforeAll } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TraceView } from "./TraceView";
import type { TraceTree } from "../lib/types";

// Mock window.matchMedia for JSDOM (used by useMediaQuery)
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

const SUCCESS_TREE: TraceTree = {
  rootId: "0xroot",
  nodes: [
    {
      id: "0xroot",
      source: "0xuser",
      destination: "0xprog",
      payload: "0x",
      value: "0",
      blockNumber: 100,
      index: 0,
      status: "Success",
      isReply: false,
    },
  ],
  edges: [],
};

const FAILURE_TREE: TraceTree = {
  rootId: "0xroot",
  nodes: [
    {
      id: "0xroot",
      source: "0xuser",
      destination: "0xprog",
      payload: "0x",
      value: "0",
      blockNumber: 100,
      index: 0,
      status: "Failed",
      error: "Execution trapped",
      isReply: false,
    },
  ],
  edges: [],
  failure: {
    messageId: "0xroot",
    program: "0xbadprogram",
    reason: "Execution trapped",
    path: ["0xroot"],
  },
};

const ROOT_ID = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REPLY_ID = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const USER_ID = "0x1111111111111111111111111111111111111111111111111111111111111111";
const PROGRAM_ID = "0x2222222222222222222222222222222222222222222222222222222222222222";

const INSPECTOR_TREE: TraceTree = {
  rootId: ROOT_ID,
  nodes: [
    {
      id: ROOT_ID,
      source: USER_ID,
      destination: PROGRAM_ID,
      programName: "PingProgram",
      payload: "0xdeadbeef",
      decodedPayload: JSON.stringify({ action: "ping", amount: 7 }),
      value: "42",
      blockNumber: 123456,
      index: 0,
      status: "Success",
      isReply: false,
    },
    {
      id: REPLY_ID,
      source: PROGRAM_ID,
      destination: USER_ID,
      payload: "0xcafe",
      value: "0",
      blockNumber: 123457,
      index: 1,
      status: "NotExecuted",
      isReply: true,
    },
  ],
  edges: [{ from: ROOT_ID, to: REPLY_ID, confidence: "linked" }],
};

describe("TraceView", () => {
  it("renders the ReactFlow canvas", () => {
    const { container } = render(<TraceView tree={SUCCESS_TREE} />);
    // ReactFlow renders a div with the viewport
    expect(container.querySelector(".react-flow")).toBeTruthy();
  });

  it("does not show failure banner for successful traces", () => {
    render(<TraceView tree={SUCCESS_TREE} />);
    expect(screen.queryByText(/Failure/)).toBeNull();
  });

  it("shows failure banner when trace has a failure", () => {
    render(<TraceView tree={FAILURE_TREE} />);
    expect(screen.getByText(/Execution trapped/)).toBeTruthy();
    expect(screen.getByText("0xbadprogr…")).toBeTruthy();
  });

  it("surfaces root, reply, program, and payload details in the inspector", () => {
    const { container } = render(<TraceView tree={INSPECTOR_TREE} />);
    const flowNodes = container.querySelectorAll(".react-flow__node");

    fireEvent.click(flowNodes[0]!);

    expect(screen.getByText("Message inspector")).toBeTruthy();
    expect(screen.getByText("Root ID")).toBeTruthy();
    expect(screen.getByText("Message ID")).toBeTruthy();
    expect(screen.getByText("Reply ID")).toBeTruthy();
    expect(screen.getAllByText("0xaaaaaa…aaaaaa").length).toBeGreaterThan(0);
    expect(screen.getByText("0xbbbbbb…bbbbbb")).toBeTruthy();
    expect(screen.getByText("Source")).toBeTruthy();
    expect(screen.getByText("Destination")).toBeTruthy();
    expect(screen.getByText("Program name")).toBeTruthy();
    expect(screen.getAllByText("PingProgram").length).toBeGreaterThan(0);
    expect(screen.getByText("Decoded payload")).toBeTruthy();
    expect(screen.getByText(/"action": "ping"/)).toBeTruthy();
    expect(screen.getByText("Raw payload")).toBeTruthy();
    expect(screen.getByText("0xdeadbeef")).toBeTruthy();
    expect(screen.getAllByText("Copy").length).toBeGreaterThanOrEqual(5);
  });

  it("opens the inspector from the node card tap target", () => {
    render(<TraceView tree={INSPECTOR_TREE} />);

    fireEvent.click(screen.getAllByTestId("trace-node-card")[0]!);

    expect(screen.getByText("Message inspector")).toBeTruthy();
    expect(screen.getByText("Root ID")).toBeTruthy();
  });

  it("shows the linked parent when inspecting a reply", () => {
    const { container } = render(<TraceView tree={INSPECTOR_TREE} />);
    const flowNodes = container.querySelectorAll(".react-flow__node");

    fireEvent.click(flowNodes[1]!);

    expect(screen.getByText("Reply ID")).toBeTruthy();
    expect(screen.getByText("Reply to")).toBeTruthy();
    expect(screen.getByText("0xaaaaaa…aaaaaa (linked)")).toBeTruthy();
    expect(screen.getByText("Reply")).toBeTruthy();
    expect(screen.getByText("Raw hex only")).toBeTruthy();
    expect(screen.getByText(/Register this program's Sails IDL/)).toBeTruthy();
    expect(screen.getByText("0xcafe")).toBeTruthy();
  });
});
