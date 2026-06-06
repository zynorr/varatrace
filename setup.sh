#!/usr/bin/env bash
# VaraTrace local setup (macOS / Linux). Requires Node 20+ and npm.
set -e
cd "$(dirname "$0")"

echo "==> Installing reconstruction engine (packages/core)"
( cd packages/core && npm install )

echo "==> Installing trace API (apps/api)"
( cd apps/api && npm install )

echo "==> Installing web UI (apps/web)"
( cd apps/web && npm install && { [ -f .env.local ] || cp .env.local.example .env.local; } )

cat <<'EOF'

Setup complete.

Verify the engine:
  cd packages/core && npm test && npm run demo

Run the app (two terminals):
  Terminal 1:  cd apps/api && npm start     # http://localhost:3001
  Terminal 2:  cd apps/web && npm run dev    # http://localhost:3000

Then open http://localhost:3000 and click a sample (simple / reply / fanout / failure).

Docker app stack:
  docker compose --profile app up

Live indexer:
  FETCH_METADATA=true docker compose --profile live up postgres indexer
EOF
