# VaraTrace local setup (Windows PowerShell). Requires Node 20+ and npm.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "==> Installing reconstruction engine (packages/core)"
Push-Location packages/core; npm install; Pop-Location

Write-Host "==> Installing trace API (apps/api)"
Push-Location apps/api; npm install; Pop-Location

Write-Host "==> Installing web UI (apps/web)"
Push-Location apps/web
npm install
if (-not (Test-Path ".env.local")) { Copy-Item ".env.local.example" ".env.local" }
Pop-Location

Write-Host ""
Write-Host "Setup complete."
Write-Host "Verify the engine:  cd packages/core; npm test; npm run demo"
Write-Host "Run the app (two terminals):"
Write-Host "  Terminal 1:  cd apps/api;  npm start    # http://localhost:3001"
Write-Host "  Terminal 2:  cd apps/web;  npm run dev   # http://localhost:3000"
Write-Host "Then open http://localhost:3000"
Write-Host "Docker app stack: docker compose --profile app up"
Write-Host "Live indexer: `$env:FETCH_METADATA='true'; docker compose --profile live up postgres indexer"
