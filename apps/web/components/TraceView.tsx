"use client";
import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import ReactFlow, { Background, Controls, useViewport, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import type { TraceTree, MessageNode, EdgeConfidence } from "../lib/types";
import { TRACE_NODE_HEIGHT, TRACE_NODE_WIDTH, traceToFlow } from "../lib/layout";
import { TraceNodeCard } from "./TraceNodeCard";

const nodeTypes = { trace: TraceNodeCard };
const edgeTypes = {};
const reactFlowProOptions = { hideAttribution: true };
const controlsStyle = {
  borderRadius: 8,
  overflow: "hidden",
  boxShadow: "var(--controls-shadow)",
  background: "var(--bg-controls)",
};
const handleReactFlowError = (code: string, message: string) => {
  if (code !== "002") console.warn(`[React Flow]: ${message}`);
};

// ── Media query hook ────────────────────────────────────────────────────
function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatch(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatch(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);
  return match;
}

// ── Constants ───────────────────────────────────────────────────────────
const PANEL_MIN = 280;
const PANEL_MAX = 600;
const PANEL_DEFAULT = 340;

export function TraceView({ tree }: { tree: TraceTree }) {
  const { nodes, edges } = useMemo(() => traceToFlow(tree), [tree]);
  const [selected, setSelected] = useState<MessageNode | null>(null);
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const selectedParentEdge = useMemo(
    () => selected ? tree.edges.find((edge) => edge.to === selected.id) : undefined,
    [selected, tree.edges],
  );
  const selectedReplyEdges = useMemo(
    () => selected ? tree.edges.filter((edge) => edge.from === selected.id && edge.confidence === "linked") : [],
    [selected, tree.edges],
  );

  const handleNodeClick = useCallback((_: any, n: Node) => {
    setSelected((n.data as { node: MessageNode }).node);
  }, []);

  const closePanel = useCallback(() => setSelected(null), []);

  // ── Resize drag logic ──────────────────────────────────────────────
  const onResizeStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const clientX = "touches" in e ? e.touches[0]!.clientX : e.clientX;
      dragRef.current = { startX: clientX, startW: panelWidth };
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
    },
    [panelWidth],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragRef.current) return;
      const clientX = "touches" in e ? e.touches[0]!.clientX : e.clientX;
      const delta = dragRef.current.startX - clientX;
      const next = Math.min(PANEL_MAX, Math.max(PANEL_MIN, dragRef.current.startW + delta));
      setPanelWidth(next);
    };

    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
    window.addEventListener("touchmove", onMove, { capture: true, passive: true });
    window.addEventListener("touchend", onUp, true);

    return () => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", onUp, true);
      window.removeEventListener("touchmove", onMove, true);
      window.removeEventListener("touchend", onUp, true);
    };
  }, []);

  return (
    <div style={{ display: "flex", height: "100%", width: "100%", position: "relative" }}>
      <style>{`
        @keyframes slideIn { from { opacity: 0; transform: translateX(8px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes slideInMobile { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes fadeBg { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      {/* Flow canvas */}
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        {tree.failure && (
          <div
            style={{
              position: "absolute",
              zIndex: 10,
              top: 12,
              left: 12,
              right: 12,
              background: "var(--fail-banner-bg)",
              border: "1px solid var(--color-red-border)",
              color: "var(--color-red-text)",
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 13,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 8,
              boxShadow: "var(--fail-banner-shadow)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{tree.failure.reason}</span>
            <span style={{ color: "var(--color-red-text)", fontWeight: 400 }}>— at program</span>
            <code style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, background: "var(--color-red-bg)", padding: "1px 6px", borderRadius: 4 }}>
              {tree.failure.program.slice(0, 10)}…
            </code>
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          onNodeClick={handleNodeClick}
          onError={handleReactFlowError}
          proOptions={reactFlowProOptions}
        >
          <TraceEdgeOverlay nodes={nodes} edges={edges} />
          <Background color="var(--border-primary)" gap={20} />
          <Controls showInteractive={false} style={controlsStyle} />
        </ReactFlow>
      </div>

      {selected && isMobile && (
        /* ── Mobile overlay backdrop ── */
        <div
          onClick={closePanel}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 30,
            background: "rgba(0,0,0,0.3)",
            animation: "fadeBg 0.2s ease",
          }}
        />
      )}
      {selected && (
        <aside
          style={{
            width: isMobile ? "calc(100vw - 32px)" : panelWidth,
            maxWidth: isMobile ? "100vw" : PANEL_MAX,
            borderLeft: "1px solid var(--border-primary)",
            background: "var(--bg-primary)",
            overflowY: "auto",
            fontSize: 13,
            display: "flex",
            flexDirection: "column",
            position: isMobile ? "fixed" : "relative",
            top: isMobile ? 0 : undefined,
            right: isMobile ? 0 : undefined,
            bottom: isMobile ? 0 : undefined,
            zIndex: isMobile ? 31 : undefined,
            animation: isMobile ? "slideInMobile 0.25s ease" : "slideIn 0.2s ease",
            boxShadow: isMobile ? "-4px 0 16px rgba(0,0,0,0.15)" : undefined,
          }}
        >
          {/* ── Resize handle (desktop only) ── */}
          {!isMobile && (
            <div
              onMouseDown={onResizeStart}
              onTouchStart={onResizeStart}
              style={{
                position: "absolute",
                left: -4,
                top: 0,
                bottom: 0,
                width: 8,
                cursor: "ew-resize",
                zIndex: 5,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  width: 3,
                  height: 28,
                  borderRadius: 2,
                  background: "var(--border-primary)",
                  transition: "background 0.15s",
                }}
              />
            </div>
          )}

          {/* Header */}
          <div style={{
            padding: "12px 14px",
            borderBottom: "1px solid var(--border-secondary)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <div>
                <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>Message inspector</strong>
                <div style={{ marginTop: 2, fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--text-muted)" }}>
                  {shortId(selected.id)}
                </div>
              </div>
            </div>
            <button
              onClick={closePanel}
              style={{
                border: "none",
                background: "var(--bg-tertiary)",
                cursor: "pointer",
                color: "var(--text-tertiary)",
                borderRadius: 6,
                width: 28,
                height: 28,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "var(--bg-tertiary)"}
            >
              ✕
            </button>
          </div>

          {/* Status badge */}
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-secondary)" }}>
            <StatusBadge status={selected.status} error={selected.error} />
          </div>

          {/* Fields */}
          <div style={{ padding: "6px 14px 14px" }}>
            <Section title="Trace">
              <CopyableField label="Root ID" value={tree.rootId} displayValue={shortId(tree.rootId)} mono compact />
              <CopyableField
                label={selected.isReply ? "Reply ID" : "Message ID"}
                value={selected.id}
                displayValue={shortId(selected.id)}
                mono
                compact
              />
              {selectedParentEdge && (
                <CopyableField
                  label={selected.isReply ? "Reply to" : "Parent ID"}
                  value={selectedParentEdge.from}
                  displayValue={`${shortId(selectedParentEdge.from)} (${selectedParentEdge.confidence})`}
                  mono
                  compact
                />
              )}
              {selectedReplyEdges.map((edge, index) => (
                <CopyableField
                  key={edge.to}
                  label={selectedReplyEdges.length === 1 ? "Reply ID" : `Reply ${index + 1}`}
                  value={edge.to}
                  displayValue={shortId(edge.to)}
                  mono
                  compact
                />
              ))}
            </Section>

            <Section title="Programs">
              <CopyableField label="Source" value={selected.source} displayValue={shortId(selected.source)} mono compact />
              {selected.programName && (
                <StaticField label="Program name" value={selected.programName} />
              )}
              <CopyableField
                label="Destination"
                value={selected.destination}
                displayValue={selected.programName ? `${selected.programName} (${shortId(selected.destination)})` : shortId(selected.destination)}
                mono={!selected.programName}
                compact
              />
            </Section>

            <Section title="Execution">
              <InlineStats
                items={[
                  ["Block", `#${selected.blockNumber.toLocaleString()}`],
                  ["Index", String(selected.index)],
                  ["Value", selected.value],
                  ["Kind", selected.isReply ? "Reply" : selected.id === tree.rootId ? "Root" : "Message"],
                ]}
              />
            </Section>

            <Section title="Payload">
              {selected.decodedPayload ? (
                <CopyableField
                  label="Decoded payload"
                  value={selected.decodedPayload}
                  displayValue={formatDecodedPayload(selected.decodedPayload)}
                  mono
                  code
                />
              ) : (
                <DecodeHint programId={selected.destination} />
              )}
              <CopyableField
                label="Raw payload"
                value={selected.payload}
                displayValue={formatRawPayload(selected.payload)}
                mono
                code
              />
            </Section>
          </div>
        </aside>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TraceEdgeOverlay({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) {
  if (edges.length === 0) return null;

  const viewport = useViewport();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  return (
    <svg
      data-testid="trace-edge-overlay"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      <defs>
        <marker
          id="trace-edge-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge-color)" />
        </marker>
        <marker
          id="trace-edge-arrow-inferred"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge-inferred)" />
        </marker>
        <marker
          id="trace-edge-arrow-fail"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="9"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge-fail)" />
        </marker>
      </defs>
      {edges.map((edge) => {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) return null;

        const confidence = edge.label === "inferred" ? "inferred" : "linked";
        const onFailEdge = Boolean(edge.animated);
        return (
          <TraceConnector
            key={edge.id}
            confidence={confidence}
            onFailEdge={onFailEdge}
            sourceX={(source.position.x + TRACE_NODE_WIDTH / 2) * viewport.zoom + viewport.x}
            sourceY={(source.position.y + TRACE_NODE_HEIGHT) * viewport.zoom + viewport.y}
            targetX={(target.position.x + TRACE_NODE_WIDTH / 2) * viewport.zoom + viewport.x}
            targetY={target.position.y * viewport.zoom + viewport.y}
          />
        );
      })}
    </svg>
  );
}

function TraceConnector({
  confidence,
  onFailEdge,
  sourceX,
  sourceY,
  targetX,
  targetY,
}: {
  confidence: EdgeConfidence;
  onFailEdge: boolean;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}) {
  const midY = sourceY + Math.max(24, (targetY - sourceY) / 2);
  const d = `M ${sourceX} ${sourceY} C ${sourceX} ${midY}, ${targetX} ${midY}, ${targetX} ${targetY}`;
  const inferred = confidence === "inferred";
  const stroke = onFailEdge ? "var(--edge-fail)" : inferred ? "var(--edge-inferred)" : "var(--edge-color)";
  const marker = onFailEdge ? "url(#trace-edge-arrow-fail)" : inferred ? "url(#trace-edge-arrow-inferred)" : "url(#trace-edge-arrow)";

  return (
    <g className="trace-edge-overlay__edge">
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={onFailEdge ? 2.5 : inferred ? 1.5 : 2}
        strokeDasharray={inferred ? "6 4" : undefined}
        markerEnd={marker}
      />
      {inferred && (
        <text
          x={(sourceX + targetX) / 2 + 8}
          y={midY - 6}
          fill={stroke}
          fontSize="10"
          fontWeight="600"
        >
          inferred
        </text>
      )}
    </g>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{
        fontSize: 10,
        color: "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: 6,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function InlineStats({ items }: { items: Array<[label: string, value: string]> }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gap: 8,
    }}>
      {items.map(([label, value]) => (
        <div
          key={label}
          style={{
            minWidth: 0,
            border: "1px solid var(--border-secondary)",
            borderRadius: 6,
            background: "var(--bg-tertiary)",
            padding: "7px 8px",
          }}
        >
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>{label}</div>
          <div style={{
            color: "var(--text-primary)",
            fontSize: 12,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

const STATUS_CFG: Record<string, { color: string; bg: string; label: string; icon: string }> = {
  Success: { color: "var(--color-green)", bg: "var(--bg-success)", label: "Success", icon: "✓" },
  Failed: { color: "var(--color-red)", bg: "var(--bg-fail)", label: "Failed", icon: "✗" },
  NotExecuted: { color: "var(--text-tertiary)", bg: "var(--bg-tertiary)", label: "Not Executed", icon: "—" },
};

function StatusBadge({ status, error }: { status: string; error?: string }) {
  const c = STATUS_CFG[status] ?? { color: "var(--text-tertiary)", bg: "var(--bg-tertiary)", label: status, icon: "?" };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          borderRadius: 999,
          background: c.bg,
          color: c.color,
          fontWeight: 700,
          fontSize: 12,
        }}>
          {c.icon}
        </span>
        <span style={{ fontWeight: 600, color: c.color, fontSize: 14 }}>{c.label}</span>
      </div>
      {error && (
        <div style={{ marginTop: 6, fontFamily: "ui-monospace, monospace", fontSize: 12, color: "var(--color-red)", background: "var(--color-red-bg)", padding: "6px 10px", borderRadius: 6, wordBreak: "break-all" }}>
          {error}
        </div>
      )}
    </div>
  );
}

function shortId(value: string) {
  return value.startsWith("0x") && value.length > 18
    ? `${value.slice(0, 8)}…${value.slice(-6)}`
    : value;
}

function formatRawPayload(value: string) {
  if (!value || value === "0x") return "0x (empty)";
  return value;
}

function formatDecodedPayload(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function StaticField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>{label}</div>
      <div style={{
        fontSize: 12,
        color: "var(--text-muted)",
        background: "var(--bg-tertiary)",
        border: "1px solid var(--border-secondary)",
        borderRadius: 6,
        padding: "7px 8px",
      }}>
        {value}
      </div>
    </div>
  );
}

function DecodeHint({ programId }: { programId: string }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>Decoded payload</div>
      <div style={{
        fontSize: 12,
        color: "var(--text-secondary)",
        background: "var(--bg-tertiary)",
        border: "1px solid var(--border-secondary)",
        borderRadius: 6,
        padding: "8px 9px",
        lineHeight: 1.4,
      }}>
        <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>Raw hex only</div>
        <div style={{ marginTop: 3 }}>
          Register this program&apos;s Sails IDL to decode typed payloads.
        </div>
        <code style={{
          display: "block",
          marginTop: 6,
          fontFamily: "ui-monospace, monospace",
          fontSize: 11,
          color: "var(--text-muted)",
          overflowWrap: "anywhere",
        }}>
          POST /idl {shortId(programId)}
        </code>
      </div>
    </div>
  );
}

function CopyableField({
  label,
  value,
  displayValue,
  mono,
  code,
  compact,
}: {
  label: string;
  value: string;
  displayValue?: string;
  mono?: boolean;
  code?: boolean;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const shown = displayValue ?? value;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard not available */ }
  }, [value]);

  return (
    <div style={{ marginTop: compact ? 6 : 8, position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>{label}</div>
        <button
          onClick={handleCopy}
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: copied ? "var(--color-green)" : "var(--text-muted)",
            fontSize: 11,
            padding: "1px 4px",
            borderRadius: 4,
            transition: "color 0.15s",
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div style={{
        fontFamily: mono || code ? "ui-monospace, monospace" : "inherit",
        fontSize: 12,
        color: "var(--text-primary)",
        wordBreak: "break-all",
        lineHeight: compact ? 1.25 : 1.4,
        whiteSpace: code ? "pre-wrap" : "normal",
        background: code ? "var(--bg-code)" : "transparent",
        border: code ? "1px solid var(--border-primary)" : "none",
        borderRadius: code ? 6 : 0,
        padding: code ? "8px 10px" : 0,
        maxHeight: code ? 200 : "none",
        overflowY: code ? "auto" : "visible",
      }}>
        {shown}
      </div>
    </div>
  );
}
