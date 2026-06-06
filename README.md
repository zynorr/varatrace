# VaraTrace

VaraTrace is a read-only web debugger for Vara Network. Paste a message id,
transaction hash, or sample alias, and VaraTrace reconstructs the asynchronous
message tree behind that interaction: program-to-program hops, replies,
dispatch status, inferred causal edges, failure path, payload details, and a
shareable `/?id=...` link.

Think "Tenderly-style trace viewer for Vara's async actor model."

## Live App

- Web app: https://varatrace-web.vercel.app
- API: https://varatrace-api.vercel.app
- GitHub repo: https://github.com/zynorr/varatrace
- Detailed working status: [WORKING_STATUS.md](./WORKING_STATUS.md)

Useful links:

- Homepage: https://varatrace-web.vercel.app
- Fixture trace: https://varatrace-web.vercel.app/?id=replychain
- Recent live trace endpoint:
  https://varatrace-api.vercel.app/recent?limit=5

Current public deployment:

- Web: Vercel project `varatrace-web`
- API: Vercel project `varatrace-api`
- Database: Neon Postgres
- Indexer: Railway project `varatrace-indexer`, service `indexer`
- Indexer Dockerfile: `indexer/Dockerfile`
- Chain endpoint: `wss://testnet.vara.network`

## Why It Exists

Vara is built on Gear's actor model, where one user action can fan out into
messages between programs instead of one synchronous call stack. Those messages
can span blocks, include later replies, schedule future work, and fail inside a
deeper branch of the tree.

Block explorers usually show this as flat events. VaraTrace makes the causal
flow legible for developers.

## What Works Now

The current MVP is live and operational.

- Pure TypeScript reconstruction engine in `packages/core`
- Fastify API with Postgres-first live data and fixture fallback
- Next.js + React Flow web UI
- Always-on Railway indexer writing live Vara testnet data to Neon
- Shareable deep links through `/?id=...`
- Recent live trace picker
- Fixture/sample mode
- Node detail inspector
- Copy-friendly ids
- Root id, reply id, raw payload, and decoded payload surfaces
- Failure banner and failure path support
- IDL registration endpoint for typed payload decoding
- Light/dark mode
- Homepage navigation from the VaraTrace logo/name
- Docker Compose local stack
- Recorded real-data regression fixtures

Current passing test suites:

- `packages/core`: 37 tests
- `apps/api`: 64 tests
- `apps/web`: 41 tests
- `indexer`: 32 tests

Total: 174 passing tests.

## Repository Layout

```text
varatrace/
├─ packages/core/      Pure TS reconstruction engine and domain types
├─ apps/api/           Fastify API: health, samples, recent traces, trace JSON
├─ apps/web/           Next.js + React Flow trace viewer
├─ indexer/            Vara testnet event indexer -> Postgres
├─ db/init.sql         Postgres schema
├─ docker-compose.yml  Local product stack
├─ WORKING_STATUS.md   Detailed current working-state document
└─ setup.sh            Convenience installer
```

## How It Works

```text
Vara testnet
  events: MessageQueued, UserMessageSent, MessagesDispatched
        |
        v
Railway indexer
  normalizes events into Postgres rows
        |
        v
Neon Postgres
  raw_messages, dispatch_records, metadata, IDLs, indexer_state
        |
        v
Vercel Fastify API
  Postgres first, fixtures fallback, cache, payload decoding
        |
        v
packages/core buildTraceTree()
  RawMessage[] + DispatchRecord[] -> TraceTree
        |
        v
Vercel Next.js web app
  React Flow tree, node details, status and failure UI
```

Core API contract:

```text
GET /trace/:id -> TraceTree
```

## Core Data Model

The reconstruction engine consumes normalized chain data:

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

- `linked`: reliable edge derived from reply metadata
- `inferred`: heuristic attribution for spawned async program messages

## API

Public base URL:

```text
https://varatrace-api.vercel.app
```

Routes:

```text
GET  /health       Service health
GET  /status       Data source and indexer status
GET  /cache        In-memory trace cache stats
GET  /samples      Fixture sample entry points
GET  /recent       Recent live traces
GET  /trace/:id    Reconstructed TraceTree
POST /idl          Register a Sails IDL for typed payload decoding
```

Examples:

```bash
curl https://varatrace-api.vercel.app/health
curl https://varatrace-api.vercel.app/status
curl 'https://varatrace-api.vercel.app/recent?limit=5'
curl https://varatrace-api.vercel.app/trace/replychain
```

Register a Sails IDL:

```bash
curl -X POST https://varatrace-api.vercel.app/idl \
  -H 'content-type: application/json' \
  -d '{
    "programId": "0x...",
    "programName": "ExampleProgram",
    "idl": { "program": { "name": "ExampleProgram" }, "services": [] }
  }'
```

Registered IDLs are cached by program id and persisted to `program_idls` when
`DATABASE_URL` is configured. Trace nodes show decoded payloads when decoding
succeeds and keep raw hex visible when decoding is unavailable.

## Web UI

The web app is the main user-facing product.

Working flows:

- Open the homepage
- Enter a message id, transaction hash, or fixture alias
- Load a trace graph
- Open a deep link directly
- Pick from recent live traces
- Inspect a node in the detail panel
- Copy ids from the inspector
- See payload and decoded payload details
- Switch light/dark mode
- Tap the VaraTrace logo/name to return home

Fixture aliases:

```text
simple
reply
fanout
failure
replychain
mixed
```

Fixture examples:

- https://varatrace-web.vercel.app/?id=simple
- https://varatrace-web.vercel.app/?id=replychain
- https://varatrace-web.vercel.app/?id=failure
- https://varatrace-web.vercel.app/?id=mixed

## Indexer

The indexer is a long-running Node process. In production, it runs on Railway
because it maintains a websocket subscription and should not run as a Vercel
serverless function.

Working behavior:

- Connects to `wss://testnet.vara.network`
- Subscribes to finalized blocks
- Parses `MessageQueued`
- Parses `UserMessageSent`
- Parses `MessagesDispatched`
- Writes normalized messages to `raw_messages`
- Writes dispatch statuses to `dispatch_records`
- Tracks freshness in `indexer_state`
- Supports bounded backfill with `FROM_BLOCK` and `TO_BLOCK`
- Handles Neon pooled SSL URLs
- Redacts database passwords in diagnostics

Railway service variables:

- `DATABASE_URL`: same Neon pooled URL used by the hosted API
- `RAILWAY_DOCKERFILE_PATH`: `indexer/Dockerfile`
- `VARA_WSS`: `wss://testnet.vara.network`
- `FETCH_METADATA`: `false` by default; set `true` to cache program metadata

## Database

The live database is Neon Postgres. It is shared by the Vercel API and Railway
indexer.

Tables:

- `raw_messages`
- `dispatch_records`
- `program_metadata`
- `program_idls`
- `indexer_state`

The API reads Postgres first. If Postgres is unavailable, unconfigured, or
empty, it falls back to bundled fixtures.

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

## Live Testnet Indexer Locally

Start Postgres and the live indexer:

```bash
docker compose --profile live up postgres indexer
```

Run the full local product with live indexing:

```bash
docker compose --profile app --profile live up
```

Backfill a bounded range:

```bash
cd indexer
FROM_BLOCK=28033000 TO_BLOCK=28033100 npm run backfill:range
```

With Docker Compose:

```bash
FROM_BLOCK=28033000 TO_BLOCK=28033100 docker compose --profile live up postgres indexer
```

Public Vara testnet nodes can prune older state. Very old `FROM_BLOCK` values
may return "state already discarded" errors. Use recent finalized blocks or an
archive node for deeper historical scans.

## Fixture Mode Without Docker

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

Then open http://localhost:3000 and try a fixture alias:

```text
simple
reply
fanout
failure
replychain
mixed
```

## Tests

Run every package suite:

```bash
cd packages/core && npm test && npm run typecheck
cd ../../apps/api && npm test && npm run typecheck
cd ../web && npm test && npm run typecheck
cd ../../indexer && npm test && npm run typecheck
```

Or run root API commands:

```bash
npm run api:test
npm run api:typecheck
```

Current verified counts:

- `packages/core`: 37 tests
- `apps/api`: 64 tests
- `apps/web`: 41 tests
- `indexer`: 32 tests

## Deployment

### API On Vercel

Deploy the API from the repository root so Vercel includes both `apps/api` and
`packages/core`:

```bash
vercel link --yes --project varatrace-api --scope <your-vercel-scope>
vercel build --prod --yes -A vercel.api.json
vercel deploy --prebuilt --prod --yes -A vercel.api.json
```

Required production environment:

- `DATABASE_URL`
- `VARA_WSS`

Without `DATABASE_URL`, the API still works in fixture mode.

### Web On Vercel

Deploy the web app after the API URL is known:

```bash
cd apps/web
vercel env add NEXT_PUBLIC_API_URL production
vercel build --prod
vercel deploy --prebuilt --prod
```

Required production environment:

- `NEXT_PUBLIC_API_URL`

### Indexer On Railway

The production indexer runs as an always-on Railway service.

```bash
railway login
railway init --name varatrace-indexer
railway add --service indexer
railway variable set RAILWAY_DOCKERFILE_PATH=indexer/Dockerfile --service indexer
railway variable set 'VARA_WSS=wss://testnet.vara.network' --service indexer
railway variable set FETCH_METADATA=false --service indexer
printf '%s' "$DATABASE_URL" | railway variable set DATABASE_URL --stdin --service indexer
railway up --service indexer --detach
```

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
| `RAILWAY_DOCKERFILE_PATH` | Railway indexer | unset | Set to `indexer/Dockerfile` |

## Real-Data Audit

Use the audit command to check whether indexed data contains richer MVP cases:

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

## Current Boundaries

The MVP is working, but these areas still need production polish:

- Older Vara testnet history can be pruned by public testnet nodes.
- Historical backfills need near-head ranges or archive access.
- Railway currently runs with `FETCH_METADATA=false` to keep indexing light.
- Rich decoded payloads require program IDL registration.
- Custom domain is not configured yet.
- GitHub Actions CI/CD is not wired yet.
- Observability/alerting for indexer downtime is still a follow-up.

## License

GPL-3.0. VaraTrace uses Gear/Vara concepts and `@gear-js/api`; keep attribution
when reusing code or recorded traces.
