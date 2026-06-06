"use client";
import { Handle, Position, type NodeProps } from "reactflow";
import type { MessageNode } from "../lib/types";

const short = (hex: string) =>
  hex.startsWith("0x") && hex.length > 12 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex;

const STATUS_CONFIG: Record<MessageNode["status"], { color: string; bg: string; label: string }> = {
  Success: { color: "var(--color-green)", bg: "var(--bg-success)", label: "Success" },
  Failed: { color: "var(--color-red)", bg: "var(--bg-fail)", label: "Failed" },
  NotExecuted: { color: "var(--text-tertiary)", bg: "var(--bg-tertiary)", label: "No status" },
};

const invisibleHandleStyle = {
  width: 8,
  height: 8,
  minWidth: 8,
  minHeight: 8,
  opacity: 0,
  pointerEvents: "none" as const,
};

export function TraceNodeCard({ data }: NodeProps<{ node: MessageNode; onFailPath: boolean }>) {
  const { node, onFailPath } = data;
  const cfg = STATUS_CONFIG[node.status];
  const destinationLabel = node.programName ?? short(node.destination);
  return (
    <div
      style={{
        width: 240,
        background: "var(--bg-primary)",
        borderRadius: 10,
        border: onFailPath ? "2px solid var(--color-red)" : "1px solid var(--border-primary)",
        boxShadow: onFailPath ? "var(--node-shadow-fail)" : "var(--node-shadow)",
        overflow: "hidden",
        display: "flex",
        transition: "box-shadow 0.15s, border-color 0.15s",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        if (!onFailPath) e.currentTarget.style.boxShadow = "var(--node-shadow-hover)";
      }}
      onMouseLeave={(e) => {
        if (!onFailPath) e.currentTarget.style.boxShadow = "var(--node-shadow)";
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        style={invisibleHandleStyle}
      />
      <div style={{ width: 5, background: cfg.color, borderRadius: "10px 0 0 10px" }} />
      <div style={{ padding: "10px 12px", flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={{
            fontFamily: "ui-monospace, monospace",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}>
            {short(node.source)} → {destinationLabel}
          </span>
          <span style={{
            fontSize: 9,
            fontWeight: 700,
            color: cfg.color,
            background: cfg.bg,
            padding: "2px 6px",
            borderRadius: 999,
            whiteSpace: "nowrap",
            letterSpacing: 0.3,
            flexShrink: 0,
          }}>
            {cfg.label.toUpperCase()}
          </span>
        </div>
        <div style={{
          fontFamily: "ui-monospace, monospace",
          fontSize: 11,
          color: "var(--text-muted)",
          marginTop: 5,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}>
          <span>#{node.blockNumber}</span>
          {node.isReply && <span style={{ color: "var(--color-indigo)", fontWeight: 500 }}>reply</span>}
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        style={invisibleHandleStyle}
      />
    </div>
  );
}
