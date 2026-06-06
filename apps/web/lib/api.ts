import type { TraceTree } from "./types";

const DEFAULT_LOCAL_API_URL = "http://localhost:3001";
const DEFAULT_PUBLIC_API_URL = "https://varatrace-api.vercel.app";

function apiUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured;

  if (isHostedVercelHostname(typeof window === "undefined" ? undefined : window.location.hostname)) {
    return DEFAULT_PUBLIC_API_URL;
  }

  return DEFAULT_LOCAL_API_URL;
}

export function resolveApiUrlForTest(hostname?: string): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured;
  return isHostedVercelHostname(hostname) ? DEFAULT_PUBLIC_API_URL : DEFAULT_LOCAL_API_URL;
}

function isHostedVercelHostname(hostname: string | undefined): boolean {
  return hostname?.endsWith(".vercel.app") ?? false;
}

export async function fetchTrace(id: string): Promise<TraceTree> {
  const res = await fetch(`${apiUrl()}/trace/${encodeURIComponent(id)}`);
  if (res.status === 400) throw new Error("Enter a sample name, 32-byte message id, or 32-byte transaction hash.");
  if (res.status === 404) throw new Error("No trace found for that message id or transaction hash.");
  if (!res.ok) throw new Error(`Request failed (${res.status}).`);
  return (await res.json()) as TraceTree;
}

export interface Sample {
  alias: string;
  rootMessageId: string;
  description: string;
}

export interface DataSourceStatus {
  mode: "fixture" | "live";
  postgres: "unconfigured" | "empty" | "ready" | "unavailable";
  liveMessages: number;
  liveDispatches?: number;
  metadataPrograms?: number;
  lastIndexedBlock?: number | null;
  indexedAt?: number | null;
  indexerRunning?: boolean;
  fixtures: number;
  message?: string;
}

export interface RecentTrace {
  id: string;
  source: string;
  destination: string;
  blockNumber: number;
  index: number;
  status: string;
  replyCount: number;
}

export async function fetchStatus(): Promise<DataSourceStatus | null> {
  const res = await fetch(`${apiUrl()}/status`);
  if (!res.ok) return null;
  const data = (await res.json()) as { dataSource?: DataSourceStatus };
  return data.dataSource ?? null;
}

export async function fetchRecentTraces(limit = 8): Promise<RecentTrace[]> {
  const res = await fetch(`${apiUrl()}/recent?limit=${encodeURIComponent(String(limit))}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { traces?: RecentTrace[] };
  return data.traces ?? [];
}

export async function fetchSamples(): Promise<Sample[]> {
  const res = await fetch(`${apiUrl()}/samples`);
  if (!res.ok) return [];
  const data = (await res.json()) as { samples: Sample[] };
  return data.samples;
}
