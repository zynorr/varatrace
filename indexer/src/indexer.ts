import { GearApi } from "@gear-js/api";

// ---------------------------------------------------------------------------
// Types for normalized chain events.
// ---------------------------------------------------------------------------

export interface NormalizedMessageQueued {
  id: string;
  source: string;
  destination: string;
  entry: "Init" | "Handle" | "Reply" | "Signal" | string;
  fromUser: boolean;
  blockNumber: number;
  index: number;
}

export interface NormalizedUserMessageSent {
  id: string;
  source: string;
  destination: string;
  payload: string;
  value: string;
  replyTo: string | null;
  blockNumber: number;
  index: number;
}

export interface NormalizedMessagesDispatched {
  id: string;
  status: "Success" | "Failed" | "NotExecuted";
  error: string | null;
}

// ---------------------------------------------------------------------------
// Event parsing helpers.
//
// We use index-based access on `event.data` (GenericEventData is tuple-like).
// Each codec type exposes .toHex() for hashes and .toString() for numbers.
// ---------------------------------------------------------------------------

export function parseMessageQueued(
  eventData: any,
  blockNumber: number,
  index: number,
): NormalizedMessageQueued {
  // gear.MessageQueued { id: H256, source: H256, destination: H256, entry: Entry }
  const id = eventData[0]!.toHex();
  const source = eventData[1]!.toHex();
  const destination = eventData[2]!.toHex();
  const entry = normalizeCodecLabel(eventData[3]) ?? "Handle";

  return {
    id,
    source,
    destination,
    entry,
    // `Handle` is used for both user-originated and program-spawned messages.
    // Without an explicit origin signal here, marking every Handle as a user
    // root suppresses inferred program->program edges in real traces.
    fromUser: entry === "Init",
    blockNumber,
    index,
  };
}

export function parseUserMessageSent(
  eventData: any,
  blockNumber: number,
  index: number,
): NormalizedUserMessageSent {
  // gear.UserMessageSent { message: UserMessage, expiration: Option<u32> }
  // UserMessage { id, source, destination, payload, value, details }
  const msg = eventData[0]; // the UserMessage struct
  const id = msg.id!.toHex();
  const source = msg.source!.toHex();
  const destination = msg.destination!.toHex();
  const payload = msg.payload!.toHex();
  const value = msg.value!.toString();

  // details is Option<ReplyDetails> — null when not a reply
  const details = msg.details;
  let replyTo: string | null = null;
  if (details && details.isSome) {
    try {
      replyTo = details.unwrap().to!.toHex();
    } catch {
      // details might be a direct object in some runtime versions
      replyTo = details.to?.toHex?.() ?? details.to?.toString?.() ?? null;
    }
  }

  return { id, source, destination, payload, value, replyTo, blockNumber, index };
}

export function parseMessagesDispatched(
  eventData: any,
  _blockNumber: number,
): NormalizedMessagesDispatched[] {
  // gear.MessagesDispatched { statuses: BTreeMap<H256, DispatchStatus> }
  // The statuses field is at event.data[1] (index-based) or event.data.statuses (named).
  // It iterates as [messageId, dispatchStatus] pairs.
  // DispatchStatus toHuman() returns "Success" | "Failed" | "NotExecuted".
  let statusEntries: any[];
  try {
    // Access the BTreeMap at index 1 (not index 0!)
    const raw =
      eventData[1] ??
      eventData.statuses; // BTreeMap of statuses
    if (typeof raw?.[Symbol.iterator] === "function") {
      statusEntries = [...raw];
    } else if (typeof raw?.toArray === "function") {
      statusEntries = raw.toArray();
    } else {
      console.warn(`  MessagesDispatched: unexpected statuses shape`);
      return [];
    }
  } catch {
    console.warn(`  MessagesDispatched: could not iterate statuses`);
    return [];
  }

  const results: NormalizedMessagesDispatched[] = [];

  for (const entry of statusEntries) {
    // entry is always a tuple [messageId, dispatchStatus] from BTreeMap iteration
    let id: string;
    let statusObj: any;

    if (Array.isArray(entry)) {
      id = entry[0]!.toHex();
      statusObj = entry[1];
    } else if (entry?.id && entry?.status) {
      // Named tuple or object form (fallback)
      id = entry.id.toHex();
      statusObj = entry.status;
    } else {
      // Last-resort fallback (shouldn't hit this for BTreeMap)
      id = entry?.toHex?.() ?? "unknown";
      statusObj = entry;
    }

    const kind = normalizeDispatchStatusKind(statusObj);

    let error: string | null = null;
    if (kind === "Failed") {
      error = normalizeDispatchError(statusObj);
    }

    results.push({
      id,
      status: kind,
      error,
    });
  }

  return results;
}

function normalizeDispatchStatusKind(
  statusObj: any,
): NormalizedMessagesDispatched["status"] {
  const label =
    statusObj?.__kind ??
    statusObj?.type ??
    (typeof statusObj?.toHuman === "function" ? statusObj.toHuman() : undefined);
  if (label === "Success" || label === "Failed" || label === "NotExecuted") {
    return label;
  }
  return "NotExecuted";
}

export function normalizeDispatchError(statusObj: any): string {
  const failed =
    statusObj?.asFailed ??
    statusObj?.value ??
    statusObj?.toHuman?.();
  const detail = normalizeCodecLabel(failed) ?? normalizeCodecLabel(statusObj);

  if (detail && detail !== "Failed") {
    return detail.startsWith("Failed") ? detail : `Failed: ${detail}`;
  }

  const raw =
    statusObj?.asFailed?.toHex?.() ??
    statusObj?.value?.toHex?.() ??
    statusObj?.toHex?.();

  return raw ? `Failed: ${raw}` : "Dispatch failed";
}

function normalizeCodecLabel(value: any): string | null {
  if (value === undefined || value === null) return null;

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  const kind = value.__kind ?? value.type;
  const nested = kind ? value[`as${kind}`] ?? value.value : undefined;
  if (kind && nested !== undefined && nested !== null) {
    const nestedLabel = normalizeCodecLabel(nested);
    return nestedLabel ? `${kind}: ${nestedLabel}` : String(kind);
  }
  if (kind) {
    return String(kind);
  }

  if (typeof value.toString === "function") {
    const text = value.toString();
    if (text && text !== "[object Object]") {
      return text;
    }
  }

  if (typeof value.toHuman === "function") {
    const human = value.toHuman();
    if (human !== value) {
      const humanLabel = normalizeCodecLabel(human);
      if (humanLabel) return humanLabel;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Shared block processing — used by both backfill and subscription
// ---------------------------------------------------------------------------

interface ProcessBlockResult {
  blockNumber: number;
  msgInserts: any[];
  statusInserts: any[];
}

export function getExtrinsicIndex(record: any): number | null {
  const phase = record?.phase;
  if (!phase) return null;
  if (phase.isApplyExtrinsic) {
    return Number(phase.asApplyExtrinsic?.toString?.() ?? phase.asApplyExtrinsic);
  }
  if (phase.type === "ApplyExtrinsic" || phase.__kind === "ApplyExtrinsic") {
    return Number(phase.value?.toString?.() ?? phase.asApplyExtrinsic?.toString?.() ?? phase.value);
  }
  return null;
}

export function getExtrinsicHash(block: any, extrinsicIndex: number | null): string | null {
  if (extrinsicIndex === null || !Number.isFinite(extrinsicIndex)) return null;
  const extrinsic = block?.block?.extrinsics?.[extrinsicIndex];
  return extrinsic?.hash?.toHex?.() ?? null;
}

async function processBlock(
  api: GearApi,
  blockNumber: number,
  hash?: any,
): Promise<ProcessBlockResult> {
  let blockHash = hash;
  let msgIndex = 0;
  const msgInserts: any[] = [];
  const statusInserts: any[] = [];
  const now = Date.now();

  // Resolve block hash if not provided
  if (!blockHash) {
    blockHash = await api.rpc.chain.getBlockHash(blockNumber);
  }

  let block: any = null;
  try {
    block = await api.rpc.chain.getBlock(blockHash);
  } catch {
    block = null;
  }

  // Fetch events for this block
  let events: any[];
  try {
    const blockEvents = await api.query.system.events.at(blockHash);
    events = [...blockEvents];
  } catch (err) {
    console.error(`  Block ${blockNumber}: failed to fetch events:`, err);
    return { blockNumber, msgInserts, statusInserts };
  }

  for (const record of events) {
    const { event } = record;
    if (!event) continue;
    const { section, method } = event;
    const txHash = getExtrinsicHash(block, getExtrinsicIndex(record));

    if (section !== "gear") continue;

    try {
      if (method === "MessageQueued") {
        const parsed = parseMessageQueued(event.data, blockNumber, msgIndex++);
        msgInserts.push({
          id: parsed.id,
          source: parsed.source,
          destination: parsed.destination,
          payload: "0x",
          value: "0",
          block_number: parsed.blockNumber,
          index: parsed.index,
          timestamp: now,
          reply_to: null,
          from_user: parsed.fromUser,
          tx_hash: txHash,
        });
      } else if (method === "UserMessageSent") {
        const parsed = parseUserMessageSent(event.data, blockNumber, msgIndex++);
        msgInserts.push({
          id: parsed.id,
          source: parsed.source,
          destination: parsed.destination,
          payload: parsed.payload,
          value: parsed.value,
          block_number: parsed.blockNumber,
          index: parsed.index,
          timestamp: now,
          reply_to: parsed.replyTo,
          from_user: false,
          tx_hash: txHash,
        });
      } else if (method === "MessagesDispatched") {
        const statusList = parseMessagesDispatched(event.data, blockNumber);
        for (const s of statusList) {
          statusInserts.push({
            id: s.id,
            status: s.status,
            error: s.error,
            block_number: blockNumber,
          });
        }
      }
    } catch (err) {
      console.error(`  Block ${blockNumber}: error parsing ${section}.${method}:`, err);
    }
  }

  return { blockNumber, msgInserts, statusInserts };
}

// ---------------------------------------------------------------------------
// Historical backfill: scan blocks in parallel batches
// ---------------------------------------------------------------------------

const BACKFILL_BATCH_SIZE = 10; // number of blocks to fetch in parallel

export async function backfillBlocks(
  api: GearApi,
  db: DB,
  fromBlock: number,
  toBlock?: number,
): Promise<void> {
  // Inserts are idempotent, so historical scans can safely enrich an existing
  // live database with older traces without deleting current data first.
  // Get the current finalized head
  const finalizedHeadHash = await api.rpc.chain.getFinalizedHead();
  const finalizedHeader = await api.rpc.chain.getHeader(finalizedHeadHash);
  const finalizedBlock = finalizedHeader.number.toNumber();
  const currentBlock =
    toBlock === undefined ? finalizedBlock : Math.min(toBlock, finalizedBlock);

  if (fromBlock >= currentBlock) {
    console.log(`Backfill: FROM_BLOCK (${fromBlock}) is at or past current head (${currentBlock}) — nothing to backfill.`);
    return;
  }

  const totalBlocks = currentBlock - fromBlock + 1;
  console.log(`\n=== Historical backfill ===`);
  console.log(`  From:  block ${fromBlock}`);
  console.log(`  To:    block ${currentBlock} (finalized head)`);
  console.log(`  Total: ~${totalBlocks.toLocaleString()} blocks`);
  console.log(`  Batch: ${BACKFILL_BATCH_SIZE} blocks in parallel`);

  let totalMsgs = 0;
  let totalStatuses = 0;
  let completed = 0;
  const startTime = Date.now();

  // Process in batches
  for (let start = fromBlock; start <= currentBlock; start += BACKFILL_BATCH_SIZE) {
    const end = Math.min(start + BACKFILL_BATCH_SIZE - 1, currentBlock);
    const batch: number[] = [];
    for (let n = start; n <= end; n++) batch.push(n);

    // Fetch block hashes for the batch in parallel
    let hashes: any[];
    try {
      hashes = await Promise.all(batch.map((n) => api.rpc.chain.getBlockHash(n)));
    } catch (err) {
      console.error(`  Batch ${start}-${end}: failed to get block hashes:`, err);
      completed += batch.length;
      continue;
    }

    // Fetch and process events for all blocks in the batch in parallel
    const results = await Promise.allSettled(
      batch.map((n, i) => processBlock(api, n, hashes[i]!)),
    );

    // Collect all inserts across the batch for a single batched DB write
    const allMsgInserts: any[] = [];
    const allStatusInserts: any[] = [];

    for (let ri = 0; ri < results.length; ri++) {
      const result = results[ri]!;
      if (result.status === "fulfilled") {
        const { msgInserts, statusInserts } = result.value;
        allMsgInserts.push(...msgInserts);
        allStatusInserts.push(...statusInserts);
        totalMsgs += msgInserts.length;
        totalStatuses += statusInserts.length;
      } else {
        console.error(`  Block ${batch[ri]}: error processing block:`, result.reason);
      }
      completed++;
    }

    // One batched write per table per batch
    if (allMsgInserts.length > 0) {
      await db.insertMessages(allMsgInserts);
    }
    if (allStatusInserts.length > 0) {
      await db.insertDispatchStatuses(allStatusInserts);
    }
    await db.updateIndexerState?.(end);

    // Progress report every 50 batches (500 blocks)
    if ((start - fromBlock) % (BACKFILL_BATCH_SIZE * 50) === 0 || end >= currentBlock) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const pct = ((completed / totalBlocks) * 100).toFixed(1);
      const rate = (completed / (Date.now() - startTime) * 1000).toFixed(1);
      console.log(
        `  ${completed.toLocaleString()} / ${totalBlocks.toLocaleString()} blocks (${pct}%)` +
        ` — ${totalMsgs} msgs, ${totalStatuses} statuses` +
        ` — ${rate} blk/s, ${elapsed}s elapsed`,
      );
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nBackfill complete:`);
  console.log(`  Blocks:   ${completed.toLocaleString()}`);
  console.log(`  Messages: ${totalMsgs.toLocaleString()}`);
  console.log(`  Statuses: ${totalStatuses.toLocaleString()}`);
  console.log(`  Time:     ${totalElapsed}s`);
}

// ---------------------------------------------------------------------------
// DB interface
// ---------------------------------------------------------------------------

export interface DB {
  ensureSchema(): Promise<void>;
  insertMessages(rows: any[]): Promise<void>;
  insertDispatchStatuses(rows: any[]): Promise<void>;
  updateIndexerState?(blockNumber: number, lastError?: string | null): Promise<void>;
  hasData(): Promise<boolean>;
  hasMetadata(programId: string): Promise<boolean>;
  getMetadata(programId: string): Promise<string | null>;
  insertProgramMetadata(rows: { programId: string; metaHex: string }[]): Promise<void>;
  close(): Promise<void>;
  dbPath(): string;
}

// ---------------------------------------------------------------------------
// Indexer options
// ---------------------------------------------------------------------------

export interface IndexerOptions {
  /** Block to start from (0 = genesis, default = latest / no backfill). */
  fromBlock?: number;
  /** Optional inclusive end block for a bounded historical scan. */
  toBlock?: number;
  /** Whether to fetch program metadata from the chain and cache it locally. */
  fetchMetadata?: boolean;
}

// ---------------------------------------------------------------------------
// Reconnection helper — exponential backoff
// ---------------------------------------------------------------------------

const MAX_RECONNECT_DELAY_MS = 60_000; // 1 minute max
const INITIAL_RECONNECT_DELAY_MS = 1_000; // 1 second initial

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a new GearApi connection with the same WSS provider, reconnecting
 * with exponential backoff on failure.
 */
async function createApiWithRetry(
  wss: string,
  signal?: AbortSignal,
): Promise<GearApi> {
  let delay = INITIAL_RECONNECT_DELAY_MS;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) throw new Error("Reconnection cancelled");
    try {
      const api = await GearApi.create({ providerAddress: wss });
      console.log(`Indexer: reconnected to ${wss}`);
      return api;
    } catch (err) {
      console.warn(
        `Indexer: connection failed, retrying in ${delay}ms...`,
        (err as Error).message,
      );
      await sleep(delay);
      delay = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
    }
  }
}

// ---------------------------------------------------------------------------
// Main entry: backfill then subscribe (with auto-reconnect)
// ---------------------------------------------------------------------------

export async function startIndexer(
  api: GearApi,
  db: DB,
  options?: IndexerOptions,
): Promise<() => void> {
  const VARA_WSS = process.env.VARA_WSS ?? "wss://testnet.vara.network";
  const fromBlock = options?.fromBlock;
  const toBlock = options?.toBlock;
  const shouldFetchMetadata = options?.fetchMetadata ?? false;
  const { close: closeDb } = db;

  let _unsub: (() => void) | null = null;
  let _currentApi = api;
  let _shutdown = false;
  const abortController = new AbortController();

  // --- Phase 1: Historical backfill ---
  if (fromBlock !== undefined && fromBlock > 0) {
    await backfillBlocks(api, db, fromBlock, toBlock);
  } else {
    console.log("Backfill: skipped (no FROM_BLOCK set). Subscribing to new blocks only.");
  }

  // --- Phase 2: Subscribe to new blocks (with auto-reconnect) ---
  console.log("\n=== Live subscription ===\n");

  async function startSubscription(api: GearApi): Promise<void> {
    if (_shutdown) return;

    // Register disconnect handler for THIS api instance (handles reconnection
    // after WebSocket drops, including after prior reconnections)
    api.on("disconnected", async () => {
      if (_shutdown) return;
      console.warn("Indexer: WebSocket disconnected — reconnecting...");
      try { await api.disconnect(); } catch { /* ignore */ }
      _currentApi = await createApiWithRetry(VARA_WSS, abortController.signal);
      await startSubscription(_currentApi);
    });

    // Track unique program IDs for metadata caching
    let seenProgramsForMeta = new Set<string>();

    try {
      _unsub = await api.rpc.chain.subscribeNewHeads(async (header) => {
        if (_shutdown) return;
        const blockNumber = header.number.toNumber();

        const { msgInserts, statusInserts } = await processBlock(api, blockNumber, header.hash);

        // Batch-write to database
        if (msgInserts.length > 0) {
          await db.insertMessages(msgInserts);

          // Collect unique destination programs for metadata caching
          if (shouldFetchMetadata) {
            for (const m of msgInserts) {
              if (m.destination && m.destination !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
                seenProgramsForMeta.add(m.destination);
              }
            }
          }
        }
        if (statusInserts.length > 0) {
          await db.insertDispatchStatuses(statusInserts);
        }
        await db.updateIndexerState?.(blockNumber);

        if (msgInserts.length > 0 || statusInserts.length > 0) {
          console.log(
            `Block ${blockNumber}: ${msgInserts.length} msgs, ${statusInserts.length} statuses`,
          );
        }

        // Periodically cache metadata for newly seen programs
        if (shouldFetchMetadata && seenProgramsForMeta.size > 0) {
          const { cacheNewMetadata } = await import("./metadata-cache.js");
          await cacheNewMetadata(api, db as any, seenProgramsForMeta);
          seenProgramsForMeta = new Set<string>();
        }
      });
    } catch (err) {
      if (_shutdown) return;
      console.warn(
        `Indexer: subscription error, reconnecting...`,
        (err as Error).message,
      );
      // Disconnect the failed API and reconnect
      try { await api.disconnect(); } catch { /* ignore */ }
      _currentApi = await createApiWithRetry(VARA_WSS, abortController.signal);
      await startSubscription(_currentApi);
    }
  }

  // Start the first subscription
  await startSubscription(api);

  return () => {
    _shutdown = true;
    abortController.abort();
    if (_unsub) _unsub();
    closeDb();
  };
}
