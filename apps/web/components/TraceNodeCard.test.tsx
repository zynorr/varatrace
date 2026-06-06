import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TraceNodeCard } from "./TraceNodeCard";
import { ReactFlowProvider } from "reactflow";

// Helper to wrap in ReactFlow provider since TraceNodeCard uses Handle components
function renderInFlow(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

const BASE_PROPS = {
  id: "test",
  type: "trace" as const,
  position: { x: 0, y: 0 },
  selected: false,
  isConnectable: false,
  xPos: 0,
  yPos: 0,
  data: {
    node: {
      id: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      source: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      destination: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      payload: "0xdeadbeef",
      value: "100",
      blockNumber: 1000,
      index: 0,
      status: "Success" as const,
      isReply: false,
    },
    onFailPath: false,
  },
  dragging: false,
  zIndex: 0,
};

describe("TraceNodeCard", () => {
  it("renders the source and destination addresses (shortened)", () => {
    renderInFlow(<TraceNodeCard {...BASE_PROPS} />);
    // short() slices 0-6 and last 4 chars: 0xaaaa…aaaa → 0xbbbb…bbbb
    expect(screen.getByText(/0xaaaa…aaaa/)).toBeTruthy();
  });

  it("renders success status in green", () => {
    renderInFlow(<TraceNodeCard {...BASE_PROPS} />);
    const status = screen.getByText("SUCCESS");
    expect(status).toBeTruthy();
    expect(status.style.color).toBe("var(--color-green)");
  });

  it("renders failed status in red", () => {
    const failedProps = {
      ...BASE_PROPS,
      data: {
        ...BASE_PROPS.data,
        node: { ...BASE_PROPS.data.node, status: "Failed" as const },
      },
    };
    renderInFlow(<TraceNodeCard {...failedProps} />);
    const status = screen.getByText("FAILED");
    expect(status).toBeTruthy();
    expect(status.style.color).toBe("var(--color-red)");
  });

  it("renders not executed status in gray", () => {
    const notExecProps = {
      ...BASE_PROPS,
      data: {
        ...BASE_PROPS.data,
        node: { ...BASE_PROPS.data.node, status: "NotExecuted" as const },
      },
    };
    renderInFlow(<TraceNodeCard {...notExecProps} />);
    const status = screen.getByText("NO STATUS");
    expect(status).toBeTruthy();
    expect(status.style.color).toBe("var(--text-tertiary)");
  });

  it("shows reply indicator when isReply is true", () => {
    const replyProps = {
      ...BASE_PROPS,
      data: {
        ...BASE_PROPS.data,
        node: { ...BASE_PROPS.data.node, isReply: true },
      },
    };
    renderInFlow(<TraceNodeCard {...replyProps} />);
    expect(screen.getByText("reply")).toBeTruthy();
  });

  it("applies red border on failure path", () => {
    const failProps = {
      ...BASE_PROPS,
      data: { ...BASE_PROPS.data, onFailPath: true },
    };
    const { container } = renderInFlow(<TraceNodeCard {...failProps} />);
    const card = container.querySelector('[style*="border"]') as HTMLElement;
    expect(card).toBeTruthy();
  });
});
