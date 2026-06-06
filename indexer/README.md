# VaraTrace Indexer

Minimal chain indexer that subscribes to Vara Network (Gear Protocol) events
and writes normalized data to Postgres for the VaraTrace API.

## What it indexes

Three key events from the `gear` pallet:

| Event | What it captures |
|---|---|
| `MessageQueued` | A message enqueued (program→program or from extrinsic) |
| `UserMessageSent` | A message sent to a user; carries `reply.to` (the causal link) |
| `MessagesDispatched` | Per-message dispatch status (Success / Failed / NotExecuted) |

Data is stored in two Postgres tables — `raw_messages` and `dispatch_records` —
matching the `RawMessage` and `DispatchRecord` shapes that
`packages/core/buildTraceTree.ts` consumes.

## Quick start

```bash
# 1. Start Postgres
docker compose up -d postgres

# 2. Set up env
cp .env.example .env
# Edit .env if needed (defaults to testnet WSS + local Postgres)

# 3. Install & run
npm install
npm start
```

The indexer subscribes to `wss://testnet.vara.network` and writes every new
block's events to Postgres in real time.

Set `FROM_BLOCK=<block>` to backfill historical blocks before subscribing to
new heads. Set `FETCH_METADATA=true` to cache program metadata in the
`program_metadata` table; the API uses that cache to decode payloads without
opening a chain connection for every unknown program.

Backfill inserts are idempotent, so historical scans can enrich an existing
live database with older traces. After a scan, run
`npm run audit:live -- --limit=25` from `apps/api` to find rich validation
traces.

### Docker profile

From the repo root, you can also run the indexer through Compose:

```bash
docker compose --profile live up postgres indexer
```

The Compose service uses the local `varatrace-indexer:local` image and installs
Node dependencies at image build time, not on every container start. Rebuild
after dependency changes:

```bash
docker compose --profile live build indexer
```

Useful environment overrides:

```bash
FROM_BLOCK=28000000 FETCH_METADATA=true docker compose --profile live up postgres indexer
```

## Query examples

Once the indexer is running and the API is configured with `DATABASE_URL`,
visit http://localhost:3001/trace/:messageId to see a reconstructed trace tree.

You can also query Postgres directly:

```sql
-- All messages
SELECT id, source, destination, block_number FROM raw_messages LIMIT 10;

-- A specific message
SELECT * FROM raw_messages WHERE id = '0x...';

-- Dispatch status for a message
SELECT * FROM dispatch_records WHERE id = '0x...';

-- Recent messages with their dispatch status
SELECT m.id, m.source, m.destination, d.status, d.error
FROM raw_messages m
LEFT JOIN dispatch_records d ON d.id = m.id
ORDER BY m.block_number DESC
LIMIT 20;
```

## Architecture

```
Vara chain  ──WSS──►  indexer (this package)  ──SQL──►  Postgres  ◄──SQL──  apps/api
  (events)           (@gear-js/api + pg)               (varatrace)         (dataSource.ts → buildTraceTree)
```

The indexer is intentionally minimal — it subscribes forward from the latest
block and stores normalized event data. It does NOT reconstruct trace trees;
that's the engine's job in `packages/core`.

## License

GPL-3.0 (inherited from gear-js references).
