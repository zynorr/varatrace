import "dotenv/config";
import { GearApi } from "@gear-js/api";
import { backfillBlocks } from "./indexer.js";
import * as db from "./db-pg.js";

function argNumber(name: string, fallback?: number): number | undefined {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
  const raw = arg?.split("=")[1] ?? process.env[name.toUpperCase()];
  const parsed = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main() {
  const fromBlock = argNumber("from", argNumber("from_block"));
  const toBlock = argNumber("to", argNumber("to_block"));
  if (!fromBlock || !toBlock) {
    console.error("Usage: npm run backfill:range -- --from=<block> --to=<block>");
    process.exit(1);
  }
  if (toBlock < fromBlock) {
    console.error("--to must be greater than or equal to --from");
    process.exit(1);
  }

  const wss = process.env.VARA_WSS ?? "wss://testnet.vara.network";
  console.log(`Backfill range ${fromBlock}..${toBlock}`);
  console.log(`  WSS: ${wss}`);
  console.log(`  DB:  ${db.dbPath()}`);

  await db.ensureSchema();
  const api = await GearApi.create({ providerAddress: wss });
  try {
    await backfillBlocks(api, db, fromBlock, toBlock);
  } finally {
    await api.disconnect().catch(() => {});
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
