import "dotenv/config";
import { GearApi } from "@gear-js/api";
import { startIndexer } from "./indexer.js";
import * as db from "./db-pg.js";

const VARA_WSS = process.env.VARA_WSS ?? "wss://testnet.vara.network";
const FROM_BLOCK = process.env.FROM_BLOCK
  ? Number(process.env.FROM_BLOCK)
  : undefined;
const TO_BLOCK = process.env.TO_BLOCK
  ? Number(process.env.TO_BLOCK)
  : undefined;
const FETCH_METADATA = process.env.FETCH_METADATA === "true";

async function main() {
  console.log(`VaraTrace Indexer`);
  console.log(`  WSS:   ${VARA_WSS}`);
  console.log(`  From:  ${FROM_BLOCK ?? "latest"}`);
  if (TO_BLOCK !== undefined) console.log(`  To:    ${TO_BLOCK}`);
  console.log(`  DB:    Postgres — ${db.dbPath()}`);
  console.log(`  Meta:  ${FETCH_METADATA ? "fetching & caching program metadata" : "off (set FETCH_METADATA=true to enable)"}`);

  // Ensure the schema exists
  await db.ensureSchema();

  // Check if we already have data
  const existing = await db.hasData();
  console.log(`  Data:  ${existing ? "has existing data" : "empty (fresh start)"}`);

  // Connect to the Vara chain
  console.log("\nConnecting to Vara network...");
  const api = await GearApi.create({ providerAddress: VARA_WSS });

  const chain = (await api.rpc.system.chain()).toHuman();
  const nodeName = (await api.rpc.system.name()).toHuman();
  const nodeVersion = (await api.rpc.system.version()).toHuman();
  console.log(`  Chain:  ${chain}`);
  console.log(`  Node:   ${nodeName} ${nodeVersion}`);

  // Start indexing — backfill then subscribe
  const shutdown = await startIndexer(api, db, {
    fromBlock: FROM_BLOCK,
    toBlock: TO_BLOCK,
    fetchMetadata: FETCH_METADATA,
  });

  // Handle graceful shutdown
  const cleanup = async () => {
    console.log("\nShutting down...");
    shutdown();
    await api.disconnect().catch(() => {});
    await db.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  console.log("\nIndexer is running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
