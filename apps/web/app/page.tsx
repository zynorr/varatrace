"use client";
import { useEffect, useState, useCallback } from "react";
import {
  fetchRecentTraces,
  fetchTrace,
  fetchSamples,
  fetchStatus,
  type DataSourceStatus,
  type RecentTrace,
  type Sample,
} from "../lib/api";
import type { TraceTree } from "../lib/types";
import { TraceView } from "../components/TraceView";
import { useTheme } from "../components/ThemeProvider";

export default function Home() {
  const [id, setId] = useState("");
  const [tree, setTree] = useState<TraceTree | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedId, setLoadedId] = useState("");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [status, setStatus] = useState<DataSourceStatus | null>(null);
  const [recentTraces, setRecentTraces] = useState<RecentTrace[]>([]);
  const { theme, toggle, mounted } = useTheme();

  useEffect(() => {
    fetchSamples().then(setSamples).catch(() => {});
    fetchStatus().then((nextStatus) => {
      setStatus(nextStatus);
      if (nextStatus?.mode === "live") {
        fetchRecentTraces().then(setRecentTraces).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const run = useCallback(async (value: string) => {
    const q = value.trim();
    if (!q) return;
    const validationError = validateTraceInput(q);
    if (validationError) {
      setTree(null);
      setLoadedId("");
      setError(validationError);
      return;
    }
    setLoading(true);
    setError(null);
    setTree(null);
    try {
      const t = await fetchTrace(q);
      setTree(t);
      setLoadedId(q);
      const url = new URL(window.location.href);
      url.searchParams.set("id", q);
      window.history.replaceState({}, "", url);
    } catch (e) {
      setLoadedId("");
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const urlId = new URLSearchParams(window.location.search).get("id");
    if (urlId) { setId(urlId); run(urlId); }
  }, [run]);

  return (
    <main style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header style={{
        padding: "12px 20px",
        borderBottom: "1px solid var(--border-primary)",
        display: "flex",
        gap: 12,
        alignItems: "center",
        background: "var(--bg-primary)",
        boxShadow: "var(--header-shadow)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-indigo)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <strong style={{ fontSize: 17, letterSpacing: "-0.3px", color: "var(--text-primary)" }}>VaraTrace</strong>
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>— async message debugger for Vara</span>
          {status && <DataSourceBadge status={status} />}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {recentTraces.length > 0 && (
            <RecentTracePicker
              traces={recentTraces}
              currentId={loadedId}
              disabled={loading}
              onSelect={(traceId) => {
                setId(traceId);
                run(traceId);
              }}
            />
          )}

          {/* Theme toggle — only render after hydration to avoid server/client emoji mismatch */}
          {mounted ? (
            <button
              onClick={toggle}
              title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              style={{
                border: "1px solid var(--border-primary)",
                background: "var(--bg-primary)",
                cursor: "pointer",
                borderRadius: 8,
                width: 34,
                height: 34,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "var(--bg-primary)"}
            >
              {theme === "light" ? "🌙" : "☀️"}
            </button>
          ) : (
            /* Placeholder keeps layout stable before hydration */
            <div style={{ width: 34, height: 34 }} />
          )}

          <form
            onSubmit={(e) => { e.preventDefault(); run(id); }}
            style={{ display: "flex", gap: 8 }}
          >
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="message id / tx hash / sample name"
              style={{
                width: 340,
                padding: "9px 12px",
                border: "1px solid var(--border-input)",
                borderRadius: 8,
                fontFamily: "ui-monospace, monospace",
                fontSize: 13,
                outline: "none",
                background: "var(--bg-primary)",
                color: "var(--text-primary)",
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--color-indigo)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border-input)")}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "9px 18px",
                borderRadius: 8,
                border: "none",
                background: loading ? "var(--text-muted)" : "var(--text-primary)",
                color: loading ? "var(--bg-secondary)" : "var(--bg-secondary)",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 600,
                fontSize: 13,
                transition: "background 0.15s, opacity 0.15s",
              }}
            >
              {loading ? "Tracing…" : "Trace"}
            </button>
          </form>
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {loading && (
          <Centered>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className="spinner" style={{
                width: 20, height: 20,
                border: "2px solid var(--spinner-track)",
                borderTopColor: "var(--color-indigo)",
                borderRadius: "50%",
                animation: "spin 0.6s linear infinite",
              }} />
              <span style={{ color: "var(--text-tertiary)", fontSize: 14 }}>Reconstructing trace…</span>
            </div>
          </Centered>
        )}
        {error && (
          <Centered>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
              <span style={{ color: "var(--color-red)", fontSize: 14 }}>{error}</span>
            </div>
          </Centered>
        )}
        {!loading && !error && !tree && (
          <Centered>
            <div style={{ textAlign: "center", maxWidth: 500 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
              <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.5 }}>
                Paste a message id or transaction hash to visualize its async message tree across programs and blocks.
              </p>
              {samples.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Try a sample</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                    {samples.map((s) => (
                      <button
                        key={s.alias}
                        onClick={() => { setId(s.alias); run(s.alias); }}
                        title={s.description}
                        style={{
                          padding: "7px 14px",
                          borderRadius: 999,
                          border: "1px solid var(--sample-btn-border)",
                          background: "var(--sample-btn-bg)",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 500,
                          color: "var(--sample-btn-text)",
                          transition: "all 0.15s",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-indigo)"; e.currentTarget.style.color = "var(--color-indigo)"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(99,102,241,0.15)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--sample-btn-border)"; e.currentTarget.style.color = "var(--sample-btn-text)"; e.currentTarget.style.boxShadow = "none"; }}
                      >
                        {s.alias}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Centered>
        )}
        {tree && <TraceView tree={tree} />}
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      animation: "fadeIn 0.25s ease",
    }}>
      {children}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

const shortHex = (value: string) =>
  value.startsWith("0x") && value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;

function validateTraceInput(value: string): string | null {
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return null;
  if (/^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/.test(value)) return null;
  if (value.startsWith("0x")) {
    return "Hex ids must be exactly 32 bytes: 0x plus 64 hex characters.";
  }
  return "Enter a sample name, 32-byte message id, or 32-byte transaction hash.";
}

function RecentTracePicker({
  traces,
  currentId,
  disabled,
  onSelect,
}: {
  traces: RecentTrace[];
  currentId: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const activeId = currentId.trim();
  const activeTrace = traces.find((trace) => trace.id === activeId);
  const placeholder = activeTrace
    ? `Viewing ${formatRecentTrace(activeTrace)}`
    : activeId
      ? `Viewing ${shortHex(activeId)}`
      : "Recent live traces";

  return (
    <select
      aria-label="Recent live traces"
      value=""
      disabled={disabled}
      onChange={(event) => {
        const next = event.currentTarget.value;
        if (!next) return;
        onSelect(next);
      }}
      style={{
        width: 270,
        padding: "9px 10px",
        border: "1px solid var(--border-input)",
        borderRadius: 8,
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
        fontSize: 12,
        outline: "none",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <option value="">{placeholder}</option>
      {traces.map((trace) => (
        <option key={trace.id} value={trace.id}>
          {formatRecentTrace(trace)}
        </option>
      ))}
    </select>
  );
}

function formatRecentTrace(trace: RecentTrace): string {
  return [
    `#${trace.blockNumber.toLocaleString()}`,
    shortHex(trace.id),
    `to ${shortHex(trace.destination)}`,
    trace.status,
    trace.replyCount > 0 ? `${trace.replyCount} ${trace.replyCount === 1 ? "reply" : "replies"}` : null,
  ].filter(Boolean).join(" · ");
}

function DataSourceBadge({ status }: { status: DataSourceStatus }) {
  const live = status.mode === "live";
  const hasBlock = typeof status.lastIndexedBlock === "number";
  const label = live
    ? hasBlock
      ? `indexed #${status.lastIndexedBlock!.toLocaleString()}`
      : `${status.liveMessages.toLocaleString()} live messages`
    : "fixture mode";
  const title = live
    ? [
        "Reading traces from indexed Postgres data",
        `${status.liveMessages.toLocaleString()} messages`,
        `${(status.liveDispatches ?? 0).toLocaleString()} dispatches`,
        `${(status.metadataPrograms ?? 0).toLocaleString()} metadata entries`,
      ].join(" · ")
    : status.postgres === "empty"
      ? "Postgres is connected but empty; start the live indexer to populate traces"
      : "Using bundled sample fixtures";
  const dotColor = live
    ? status.indexerRunning
      ? "var(--color-green)"
      : "var(--color-indigo)"
    : "var(--text-muted)";

  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: `1px solid ${live ? "var(--color-green-border)" : "var(--border-secondary)"}`,
        borderRadius: 999,
        padding: "4px 8px",
        background: live ? "var(--bg-success)" : "var(--bg-tertiary)",
        color: live ? "var(--color-green)" : "var(--text-muted)",
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: dotColor,
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
}
