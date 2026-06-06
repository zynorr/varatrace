# @varatrace/core

The async message-tree reconstruction engine for **VaraTrace** — the part that turns
raw Vara/Gear chain data into the structured tree the UI renders. Pure TypeScript,
no network or framework dependencies, fully unit-tested.

## What it does

Given normalized chain records:
- `RawMessage[]` — from `MessageQueued` + `UserMessageSent`
- `DispatchRecord[]` — from `MessagesDispatched` (per-message Success / Failed / NotExecuted)

`buildTraceTree(messages, statuses)` returns a `TraceTree` with:
- **nodes** (each message + dispatch status)
- **edges** parent → child, each tagged with confidence:
  - `linked` — reliable, derived from a reply's `reply.to`
  - `inferred` — heuristic spawned-message attribution (documented, never silently guessed)
- **failure** — when a message failed: the reason + the path root → first failed message

See the algorithm comment block at the top of `src/buildTraceTree.ts`.

## Run it

```bash
npm install
npm test        # vitest: 6 passing tests over 4 fixtures
npm run demo    # prints reconstructed ASCII trees for all fixtures
npm run typecheck
```

## Status

This package is complete and tested. It is consumed by `apps/api` (the trace
endpoint) and `apps/web` (the React Flow visualizer). The reconstruction logic
here is the "technical heart" described in the grant proposal — the rest of the
system is comparatively thin glue over it.

## Live data

`src/fixtures.ts` emulates real Gear data shapes for offline testing. In
live mode, `apps/api` fetches the same shapes from the Postgres-backed Gear
indexer and passes them straight into `buildTraceTree` — the engine does not
change.

Licensed GPL-3.0 (matches gear-js).
