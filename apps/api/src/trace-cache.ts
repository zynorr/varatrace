/**
 * In-memory trace tree cache with TTL.
 *
 * Caches reconstructed TraceTree objects by their root message ID so repeated
 * requests (e.g. page refresh, multiple users viewing the same trace) skip the
 * database query + tree reconstruction.
 *
 * Uses a simple Map with TTL-based expiry (no external dependencies).
 * Not a full LRU — entries are evicted by age, not by access frequency.
 * For the expected traffic of a dev tool, this is sufficient.
 */

import type { TraceTree } from "../../../packages/core/src/index.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** How long a cached trace lives before being evicted (in milliseconds). */
const CACHE_TTL_MS = 60_000; // 1 minute

/** Maximum number of entries in the cache (prevents unbounded memory growth). */
const MAX_ENTRIES = 500;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface CacheEntry {
  tree: TraceTree;
  expiresAt: number;
}

const _cache = new Map<string, CacheEntry>();

// ---------------------------------------------------------------------------
// Periodic cleanup — evict expired entries every 30s
// ---------------------------------------------------------------------------

let _cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup(): void {
  if (_cleanupTimer) return;
  _cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _cache) {
      if (entry.expiresAt <= now) {
        _cache.delete(key);
      }
    }
    if (_cache.size === 0 && _cleanupTimer) {
      clearInterval(_cleanupTimer);
      _cleanupTimer = null;
    }
  }, 30_000).unref();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieve a cached trace tree by key.
 * Returns undefined if the key is not in the cache or has expired.
 */
export function getCachedTrace(key: string): TraceTree | undefined {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    _cache.delete(key);
    return undefined;
  }
  return entry.tree;
}

/**
 * Store a trace tree in the cache.
 */
export function setCachedTrace(key: string, tree: TraceTree): void {
  // Evict oldest entries if we're at capacity
  if (_cache.size >= MAX_ENTRIES) {
    const oldest = _cache.entries().next();
    if (oldest.value) {
      _cache.delete(oldest.value[0]);
    }
  }

  _cache.set(key, {
    tree,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  ensureCleanup();
}

/**
 * Invalidate a specific cached trace (e.g. after a re-index).
 */
export function invalidateCachedTrace(key: string): void {
  _cache.delete(key);
}

/**
 * Clear the entire cache.
 */
export function clearCache(): void {
  _cache.clear();
}

/**
 * Get cache stats for debugging / health checks.
 */
export function getCacheStats(): { size: number; maxEntries: number; ttlMs: number } {
  return {
    size: _cache.size,
    maxEntries: MAX_ENTRIES,
    ttlMs: CACHE_TTL_MS,
  };
}
