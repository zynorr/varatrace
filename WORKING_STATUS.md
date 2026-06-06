# VaraTrace Working Project Status

Last verified: June 6, 2026

This document describes the working parts of VaraTrace as it stands now. It is
focused on the current implemented product, deployed services, working flows,
and tested behavior.

## Product Summary

VaraTrace is a read-only trace viewer for Vara Network asynchronous messages.
It lets a user enter a Vara message id, transaction hash, or sample alias, then
reconstructs the async message tree behind that interaction.

The current product can:

- Show a graph of messages between programs.
- Mark linked reply edges and inferred causal edges.
- Show message status, failure information, and failure path when available.
- Load live Vara testnet traces from Postgres.
- Fall back to built-in fixtures when live data is missing or unavailable.
- Show recent live traces from the hosted indexer.
- Open shareable deep links such as `/?id=<message-id>`.
- Decode payloads when a program IDL is registered.
- Keep raw payload hex visible when decoding is unavailable.
- Navigate back to the homepage by tapping the VaraTrace logo/name.

## Live Public Deployment

The public product is live.

- Web app: https://varatrace-web.vercel.app
- API: https://varatrace-api.vercel.app
- GitHub repo: https://github.com/zynorr/varatrace
- Railway indexer project: `varatrace-indexer`
- Railway indexer service: `indexer`
- Railway deployment id: `e3b466aa-ff90-444c-9017-4df304b6e1a7`
- Database: Neon Postgres connected to both the API and indexer

Current live-data status from the public API:

- API mode: `live`
- Postgres status: `ready`
- Indexer status: running
- Live messages indexed: over 300
- Live dispatch records indexed: over 300
- Latest indexed block at verification time: around `28033283`

Useful test links:

- Homepage: https://varatrace-web.vercel.app
- Fixture trace: https://varatrace-web.vercel.app/?id=replychain
- Live trace example: https://varatrace-web.vercel.app/?id=0x1aa4a600cb34a8cba42a9a22aae881d9f639a8d3f7ca2b7426697511bf71b580

## Working Architecture

The project currently has four working layers.

```text
Vara testnet
  |
  | websocket events
  v
Railway indexer
  |
  | normalized rows
  v
Neon Postgres
  |
  | trace and status queries
  v
Vercel Fastify API
  |
  | reconstructed trace JSON
  v
Vercel Next.js web app
```

## Core Trace Engine

Location: `packages/core`

The core package is the pure TypeScript reconstruction engine. It does not
depend on the web app, API server, indexer, database, or chain connection.

Working behavior:

- Builds trace trees from normalized `RawMessage[]` and `DispatchRecord[]`.
- Selects the trace root.
- Connects direct reply edges.
- Infers parent-child edges for async program-to-program messages.
- Handles fan-out traces.
- Handles reply-chain traces.
- Handles deep failures.
- Finds the failure path and failure reason.
- Keeps reconstruction deterministic.
- Guards against oversized traces with `TraceTooLargeError`.
- Renders/debugs traces through local ASCII/SVG helpers.

Recorded real-data fixtures exist for:

- Rich inferred/delayed trace
- Long delayed trace
- Six-node reply chain
- Triggered failure trace
- Fan-out trace
- Simple reply trace

Current verification:

- Core tests passing: `37`
- Core typecheck passing

## API

Location: `apps/api`

The API is a Fastify service deployed on Vercel. It reads from Postgres first
and falls back to fixtures when live data is unavailable.

Working API routes:

- `GET /health`
- `GET /status`
- `GET /cache`
- `GET /samples`
- `GET /recent?limit=<n>`
- `GET /trace/:id`
- `POST /idl`

Working behavior:

- Accepts fixture aliases such as `simple`, `replychain`, and `failure`.
- Accepts 32-byte Vara message ids.
- Accepts transaction hashes when indexed.
- Returns reconstructed trace trees as JSON.
- Returns recent live trace summaries.
- Reports live data source status and indexer freshness.
- Uses a short TTL trace cache.
- Registers program IDLs through `POST /idl`.
- Attempts best-effort typed payload decoding through registered IDLs.
- Falls back to raw hex payloads when decoding is unavailable.
- Returns clear validation errors for invalid trace ids.
- Returns `404` for unknown valid ids.
- Returns `413` for traces that exceed the node guard.

Current live API status:

- Hosted URL: https://varatrace-api.vercel.app
- Mode: live
- Postgres: ready
- Indexer: running
- Data source: Neon Postgres

Current verification:

- API tests passing: `64`
- API typecheck passing

## Web App

Location: `apps/web`

The web app is a Next.js + React Flow interface deployed on Vercel.

Working user flows:

- Open homepage.
- Enter a message id, transaction hash, or sample alias.
- Load a trace from the API.
- See a graph view of the async message tree.
- Open shareable URLs with `/?id=...`.
- Use the recent live trace picker.
- Use sample buttons when no trace is loaded.
- Switch light/dark mode.
- Tap the VaraTrace logo/name to return to the homepage.
- Open a node detail panel.
- Resize the detail panel on desktop.
- Use the mobile detail panel overlay.
- See loading, empty, and error states.

Working graph/detail behavior:

- Nodes show source, destination, block, status, and reply state.
- Edges show linked/inferred confidence.
- Failure traces show a failure banner.
- The detail inspector surfaces copy-friendly ids.
- The detail inspector includes root id, reply id, payload, decoded payload,
  and raw fallback information where available.
- Program-name labels are shown when metadata/IDL data is known.

Current public web deployment:

- Hosted URL: https://varatrace-web.vercel.app
- Latest production deployment: ready
- Deep links working
- Homepage logo navigation working

Current verification:

- Web tests passing: `41`
- Web typecheck passing
- Browser smoke test passing on production

## Indexer

Location: `indexer`

The indexer is a long-running Node process deployed on Railway. It connects to
`wss://testnet.vara.network`, subscribes to finalized blocks, normalizes Gear
events, and writes rows into Neon Postgres.

Working behavior:

- Connects to Vara Network testnet.
- Ensures the Postgres schema exists at startup.
- Subscribes to live finalized blocks.
- Parses `MessageQueued`.
- Parses `UserMessageSent`.
- Parses `MessagesDispatched`.
- Stores normalized messages in `raw_messages`.
- Stores dispatch statuses in `dispatch_records`.
- Tracks progress in `indexer_state`.
- Supports bounded historical backfill through `backfill:range`.
- Deduplicates inserts safely.
- Reconnects/resumes through process restart policy.
- Redacts database passwords in diagnostics.
- Handles Neon pooled SSL URLs.

Current Railway deployment:

- Project: `varatrace-indexer`
- Service: `indexer`
- Deployment: `e3b466aa-ff90-444c-9017-4df304b6e1a7`
- Status: success
- Instance state: running
- Dockerfile path: `indexer/Dockerfile`
- Runtime network: `wss://testnet.vara.network`
- Database: same Neon `DATABASE_URL` used by the hosted API

Current verification:

- Indexer tests passing: `32`
- Indexer typecheck passing
- Railway logs show new live blocks being processed
- API `/status` reports `indexerRunning: true`

## Database

Database: Neon Postgres

The live database is shared by:

- Vercel API
- Railway indexer

Working tables:

- `raw_messages`
- `dispatch_records`
- `program_metadata`
- `program_idls`
- `indexer_state`

Working indexes:

- Message block ordering
- Message source lookup
- Message destination lookup
- Message transaction hash lookup
- Dispatch block ordering

What the database currently stores:

- Live indexed Vara testnet messages
- Live dispatch statuses
- Indexer progress/freshness
- Optional program metadata
- Optional registered program IDLs

## Fixtures And Fallbacks

The product can work even when the live database is empty or unavailable.

Fixture aliases currently include:

- `simple`
- `reply`
- `fanout`
- `failure`
- `replychain`
- `mixed`

Fallback behavior:

- API checks Postgres first.
- If Postgres is unconfigured, unavailable, or empty, API serves fixtures.
- Web UI still supports sample traces in fixture mode.
- Public deployment is currently live mode, not fixture-only mode.

## Payload Decoding

IDL registration is implemented through the API.

Working behavior:

- Register an IDL for a program id with `POST /idl`.
- Store IDLs in Postgres when `DATABASE_URL` exists.
- Cache IDL/program metadata by program id.
- Decode known payloads best-effort.
- Preserve raw hex payload when decoding fails or no IDL is known.
- Clear trace cache after a new IDL is registered.

The UI already exposes decoded payload and raw fallback areas in the node
detail inspector.

## Deployment State

Current deployment split:

- Web: Vercel
- API: Vercel
- Database: Neon Postgres
- Indexer: Railway
- Source control: GitHub

Current repo state:

- Branch: `main`
- Local state: synced with `origin/main`
- Latest commit at verification time: `673732f`
- Latest commit message: `Link web brand to homepage`

The current production URLs are ready:

- https://varatrace-web.vercel.app
- https://varatrace-api.vercel.app

## Working Commands

Core:

```bash
cd packages/core
npm test
npm run typecheck
```

API:

```bash
npm run api:test
npm run api:typecheck
```

Web:

```bash
cd apps/web
npm test
npm run typecheck
npm run build
```

Indexer:

```bash
cd indexer
npm test
npm run typecheck
```

Live API checks:

```bash
curl https://varatrace-api.vercel.app/health
curl https://varatrace-api.vercel.app/status
curl 'https://varatrace-api.vercel.app/recent?limit=5'
```

## Current Test Coverage

Current passing suites:

- Core: 37 tests
- API: 64 tests
- Web: 41 tests
- Indexer: 32 tests

Total currently passing tests: 174

The test suites cover:

- Core reconstruction
- Regression fixtures
- Fixture metadata
- API routes
- API data source behavior
- Metadata/IDL decoding
- Web API client
- Web layout
- Trace node card
- Trace view
- Home page behavior
- Indexer schema
- Indexer inserts
- Indexer deduplication
- Indexer trace fetching
- Backfill behavior

## Known Working Samples

Fixture samples:

- https://varatrace-web.vercel.app/?id=simple
- https://varatrace-web.vercel.app/?id=reply
- https://varatrace-web.vercel.app/?id=replychain
- https://varatrace-web.vercel.app/?id=failure
- https://varatrace-web.vercel.app/?id=fanout
- https://varatrace-web.vercel.app/?id=mixed

Recent live traces are available from:

```text
https://varatrace-api.vercel.app/recent?limit=5
```

At verification time, recent live traces included:

```text
0x1aa4a600cb34a8cba42a9a22aae881d9f639a8d3f7ca2b7426697511bf71b580
0x355463a90813639631a845bb2c3e34e59ae5e460d6e7d5ea8b30c53329ad80ae
0x2cc45637d3360ef38af53ef94d6ee694b2eb44ce242e8ecaeabd76c71ed9921f
0x12a5afd91731593907ade1d4ee25f32f6aedddf853b4dd1003c2e5bba0a436c4
0xf490ebd7f8f1f4cd43e6f9ab580e68fc69f66ae79879b88c6ca870fc76e059f6
```

## Current Boundaries

These are the main things that are not fully solved yet:

- Older Vara testnet history can be pruned by the public testnet endpoint.
- Historical backfills should stay near finalized head unless archive access is
  available.
- `FETCH_METADATA` is currently off in Railway to keep the live indexer light.
- Richer decoded payloads require users/projects to register program IDLs.
- Failure, delayed, inferred, and fan-out real traces exist in recorded
  fixtures, but the freshest live traces depend on current testnet activity.
- There is no custom domain yet.
- CI/CD automation is not yet fully wired as GitHub Actions.

## MVP Readiness Summary

The project is in a working MVP state.

What is already operational:

- Public web UI
- Public API
- Live database
- Always-on live indexer
- Fixture fallback
- Trace reconstruction engine
- Deep links
- Recent live traces
- Detail inspector
- Failure display
- IDL registration and decoding path
- Tests across all major packages
- GitHub source repository

The main next polish items are production-hardening tasks, not basic product
enablement tasks:

- Add archive access or a near-head backfill workflow.
- Turn on metadata fetching when resource use is acceptable.
- Add CI/CD checks on pull requests.
- Add observability/alerts for indexer downtime.
- Add a custom domain.
- Collect more real-world rich traces into deterministic fixtures.
