/**
 * Metadata cache companion for the VaraTrace indexer.
 *
 * Collects unique program IDs encountered during indexing,
 * fetches their metadata from the chain (via GearApi), and
 * stores the raw meta hex in Postgres so the API can decode
 * payloads without a live chain connection.
 *
 * Activated by setting FETCH_METADATA=true (env var).
 * Designed to be called after each batch of blocks is processed.
 */
export interface MetadataStore {
  hasMetadata(programId: string): Promise<boolean>;
  getMetadata(programId: string): Promise<string | null>;
  insertProgramMetadata(
    rows: { programId: string; metaHex: string }[],
  ): Promise<void>;
}

/**
 * Given a set of unique program IDs, fetch metadata for any that
 * are not yet cached, and store the results.
 *
 * @param api - Connected GearApi instance.
 * @param db - MetadataStore (the Postgres db module).
 * @param programIds - Set of program addresses seen in the latest batch.
 */
export async function cacheNewMetadata(
  api: any,
  db: MetadataStore,
  programIds: Set<string>,
): Promise<void> {
  if (programIds.size === 0) return;

  // Filter to programs we don't have metadata for yet
  const uncached: string[] = [];
  for (const pid of programIds) {
    if (!(await db.hasMetadata(pid))) {
      uncached.push(pid);
    }
  }

  if (uncached.length === 0) return;

  // Fetch metadata for all uncached programs in parallel
  const metaEntries: { programId: string; metaHex: string }[] = [];
  const results = await Promise.allSettled(
    uncached.map(async (programId) => {
      const metaHex = await fetchMetaHex(api, programId);
      if (metaHex) {
        metaEntries.push({ programId, metaHex });
      }
    }),
  );

  // Log any failures
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r.status === "rejected") {
      console.warn(
        `  Metadata: failed to fetch for ${uncached[i]!.slice(0, 10)}...: ${r.reason?.message ?? r.reason}`,
      );
    }
  }

  // Store the successfully fetched metadata
  if (metaEntries.length > 0) {
    await db.insertProgramMetadata(metaEntries);
    console.log(
      `  Metadata: cached ${metaEntries.length} program(s) (${uncached.length - metaEntries.length} failed / no metadata)`,
    );
  } else if (uncached.length > 0) {
    console.log(
      `  Metadata: no metadata found for ${uncached.length} program(s)`,
    );
  }
}

/**
 * Fetch raw metadata hex for a program from the chain.
 * Returns null if the program has no metadata.
 */
async function fetchMetaHex(
  api: any,
  programId: string,
): Promise<string | null> {
  // Try multiple API paths
  let metadata: any = null;

  try {
    metadata =
      (await api.gear?.metadata?.get?.(programId)) ??
      (await api.gear?.getMetadata?.(programId)) ??
      (await api.programMetadata?.get?.(programId)) ??
      null;
  } catch {
    return null;
  }

  if (!metadata) return null;

  // Serialize the metadata to its hex representation for storage
  try {
    // ProgramMetadata has a toHex() method or a hex property
    const hex =
      metadata.toHex?.() ??
      metadata.hex?.() ??
      metadata.toString?.() ??
      null;
    return hex;
  } catch {
    return null;
  }
}
