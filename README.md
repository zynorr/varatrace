# VaraTrace

VaraTrace is a read-only web debugger for Vara Network. Paste a message id, and
it reconstructs the asynchronous message tree behind that interaction:
program-to-program hops, replies, dispatch status, inferred causal edges,
failure path, and a shareable `/?id=...` link.

Think "Tenderly-style trace viewer for Vara's async actor model."

## Why It Exists

Vara is built on Gear's actor model, where one user action can fan out into
messages between programs instead of one synchronous call stack. Those messages
can span blocks, include later replies, schedule future work, and fail somewhere
inside the tree.

Block explorers show this mostly as flat events. VaraTrace makes the causal flow
legible for developers.

## Current MVP Status

Working today:

- Reconstruction engine in `packages/core`
- Fastify API with fixture fallback and Postgres-backed live data
- Next.js + React Flow web UI with deep links, detail panel, failure banner,
  recent live trace picker, and light/dark mode
- Vara testnet indexer that writes `raw_messages`, `dispatch_records`, and
  optional `program_metadata` into Postgres
- IDL registration endpoint and best-effort payload decoding with raw-hex fallback
- Docker Compose stack for Postgres, API, web, Adminer, and indexer
- Live-data audit command for finding richer real traces
- Recorded real-data regression fixtures for success, reply, inferred, delayed,
  and failure cases
- Hosted Vercel deployment for the public web UI and Neon-backed API
- Managed Neon Postgres connected to the hosted API, seeded with recent real
  testnet traces

Still being validated for MVP polish:

- Always-on hosted indexer for continuous public live traces
- Archive endpoint or near-head indexing strategy for pruned Vara testnet
  history
- Production hardening for hosted API, web, indexer, and managed Postgres

## Repository Layout

```text
varatrace/
├─ packages/core/      Pure TS reconstruction engine and domain types
├─ apps/api/           Fastify API: health, samples, recent traces, trace JSON
├─ apps/web/           Next.js + React Flow trace viewer
├─ indexer/            Vara testnet event indexer -> Postgres
├─ db/init.sql         Postgres schema
├─ docker-compose.yml  Local product stack
└─ setup.sh            Convenience installer
```

## How It Works

```text
Vara testnet
  events: MessageQueued, UserMessageSent, MessagesDispatched
        |
        v
indexer (@gear-js/api)
  normalizes events into Postgres rows
        |
        v
apps/api dataSource
  Postgres first, fixtures fallback
        |
        v
packages/core buildTraceTree()
  RawMessage[] + DispatchRecord[] -> TraceTree
        |
        v
apps/web
  React Flow tree, node details, status and failure UI
```

The core API contract is stable:

```text
GET /trace/:id -> TraceTree
```

## Quick Start: Docker

Run the local product:

```bash
docker compose --profile app up
```

Open:

- Web UI: http://localhost:3000
- API health: http://localhost:3001/health
- Adminer: http://localhost:8080

The API falls back to bundled fixtures when Postgres is empty.

Build images after code or dependency changes:

```bash
docker compose --profile app build api web
docker compose --profile live build indexer
```

## Live Testnet Indexer

Start Postgres and the live indexer:

```bash
docker compose --profile live up postgres indexer
```

Run the full local product with live indexing:

```bash
docker compose --profile app --profile live up
```

Backfill from a block:

```bash
FROM_BLOCK=28000000 docker compose --profile live up postgres indexer
```

Cache program metadata when available:

```bash
FETCH_METADATA=true docker compose --profile live up postgres indexer
```

Note: public testnet nodes can prune older state, so very old `FROM_BLOCK`
values may return "state already discarded" errors. Use recent finalized blocks
or a node with archive access for deeper historical scans.

## Fixture Mode

Run without Docker or chain access:

```bash
cd packages/core
npm install
npm test
npm run demo

cd ../../apps/api
npm install
npm start

cd ../web
npm install
cp .env.local.example .env.local
npm run dev
```

Then open http://localhost:3000 and try a sample:

```text
simple
reply
fanout
failure
replychain
mixed
```

## API

```text
GET /health       Service health
GET /status       Data-source/indexer status
GET /samples      Fixture sample entry points
GET /recent       Recent live user-originated traces
GET /cache        In-memory trace cache stats
GET /trace/:id    Reconstructed TraceTree
POST /idl         Register a Sails IDL for typed payload decoding
```

Example:

```bash
curl http://localhost:3001/trace/simple
```

Register a Sails IDL for a program:

```bash
curl -X POST http://localhost:3001/idl \
  -H 'content-type: application/json' \
  -d '{
    "programId": "0x...",
    "programName": "ExampleProgram",
    "idl": { "program": { "name": "ExampleProgram" }, "services": [] }
  }'
```

Registered IDLs are cached by program id and persisted to `program_idls` when
`DATABASE_URL` is configured. Trace nodes show `decodedPayload` and
`programName` when decoding succeeds; otherwise the UI keeps raw hex visible and
prompts for an IDL.

Known hosted live smoke sample seeded from recent testnet block `28031089`:

```text
0x2833a42b4982a9480861f9151cee3e3a3747141d9ba3258c15ab6ec494eddc9d
```

Expected shape: a root with one `linked` reply edge.

## Data Model

The engine consumes normalized chain data:

```ts
RawMessage {
  id: string
  source: string
  destination: string
  payload: string
  value: string
  blockNumber: number
  index: number
  replyTo?: string | null
  fromUser?: boolean
}

DispatchRecord {
  id: string
  status: "Success" | "Failed" | "NotExecuted"
  error?: string
}
```

It returns:

```ts
TraceTree {
  rootId: string
  nodes: MessageNode[]
  edges: MessageEdge[]
  failure?: {
    messageId: string
    program: string
    reason: string
    path: string[]
  }
}
```

Edge confidence:

- `linked`: reliable, derived from `UserMessageSent.reply.to`
- `inferred`: heuristic attribution for spawned program messages

## Real-Data Audit

Use the audit command to check whether the indexed data contains the richer
cases needed for MVP validation:

```bash
cd apps/api
npm run audit:live -- --limit=25
```

It reports:

- Rich traces with 3+ nodes
- Inferred-edge traces
- Failure-path traces
- Cross-block / delayed traces

By default it audits the running API at `http://localhost:3001`. To audit a
local Postgres connection directly:

```bash
DATABASE_URL=postgresql://varatrace:varatrace@localhost:5432/varatrace \
  npm run audit:live -- --source=db --limit=100
```

Current local sample status: deterministic real fixtures cover rich inferred,
delayed, reply-chain, and triggered failure traces. Live traffic can still vary,
so use the recorded fixtures for CI and `audit:live` for fresh data checks.

## Tests

Run all package suites:

```bash
cd packages/core && npm test && npm run typecheck
cd ../../apps/api && npm test && npm run typecheck
cd ../web && npm test && npm run typecheck
cd ../../indexer && npm test && npm run typecheck
```

Current verified counts:

- `packages/core`: 37 tests
- `apps/api`: 64 tests
- `apps/web`: 40 tests
- `indexer`: 32 tests

## Deployment

The web app is a standard Next.js deployment. The API can run either as a
Vercel Node function for a quick public endpoint or as the existing Docker image
on a container host. The indexer should run on an always-on container host
because it maintains a websocket subscription.

Deploy the API to Vercel from the repository root so Vercel includes both
`apps/api` and `packages/core`:

```bash
vercel link --yes --project varatrace-api --scope <your-vercel-scope>
vercel deploy --prod -A vercel.api.json \
  -e VARA_WSS=wss://testnet.vara.network
```

Add `-e DATABASE_URL=...` when a managed Postgres database is ready. Without
`DATABASE_URL`, the public API still works in fixture mode.

Deploy the web app to Vercel after the API URL is known:

```bash
cd apps/web
vercel env add NEXT_PUBLIC_API_URL production \
  --value https://your-varatrace-api.vercel.app \
  --yes --force
vercel build --prod
vercel deploy --prebuilt --prod
```

Current public deployment:

- Web: https://varatrace-web.vercel.app
- API: https://varatrace-api.vercel.app
- Data: Neon Postgres connected to `varatrace-api`, seeded with recent
  testnet traces
- Live trace sample:
  `0x2833a42b4982a9480861f9151cee3e3a3747141d9ba3258c15ab6ec494eddc9d`

For continuous live indexed data, run the indexer and API against the same
`DATABASE_URL`. The public `wss://testnet.vara.network` endpoint prunes older
state, so historical backfills should stay near the current finalized head or
use archive access. Example Fly.io config templates are included at
`apps/api/fly.toml.example` and `indexer/fly.toml.example`.

## Environment

| Variable | Used by | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | API, indexer | Compose Postgres | Postgres connection string |
| `VARA_WSS` | API, indexer | `wss://testnet.vara.network` | Vara node websocket |
| `FROM_BLOCK` | indexer | latest only | Optional historical backfill start |
| `TO_BLOCK` | indexer | unset | Optional bounded backfill end |
| `FETCH_METADATA` | indexer | `false` | Cache program metadata in Postgres |
| `NEXT_PUBLIC_API_URL` | web | `http://localhost:3001` | Browser-facing API URL |
| `VARATRACE_API_URL` | audit | `http://localhost:3001` | API target for audit command |

## MVP Checklist

Done:

- Reconstruction engine with linked and inferred edges
- Unit tests for simple, reply, fan-out, failure, and determinism cases
- Fastify API with fixture and Postgres data sources
- Web UI with graph view, details, failure banner, deep links
- Indexer with backfill, live subscribe, Postgres writes, reconnect handling
- Dockerized local stack
- Short-TTL API trace cache
- Real-data regression fixtures for rich, delayed, reply-chain, and failure traces
- IDL registration and decoded payload display
- Program-name labels
- Tx-hash lookup in the search box
- Production Vercel deployment for web UI and Neon-backed API
- Managed Neon Postgres provisioned and API connected
- Recent real testnet traces seeded into hosted DB

In progress:

- Always-on hosted indexer for continuous public live traces

## License

GPL-3.0. VaraTrace uses Gear/Vara concepts and `@gear-js/api`; keep attribution
when reusing code or recorded traces.
