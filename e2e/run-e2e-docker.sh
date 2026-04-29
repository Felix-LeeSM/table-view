#!/usr/bin/env bash
set -euo pipefail

# sprint-169 / Sprint 3 — E2E container entrypoint.
#
# Runs inside the `e2e` service of `docker compose --profile test`. The
# Postgres and Mongo services are gated by healthchecks (Sprint 2), so this
# script can connect immediately without polling.
#
# Sequence:
#   1. Seed Postgres from the canonical fixture (e2e/fixtures/seed.sql).
#   2. Build the Tauri debug binary (cached by the `tauri-target` named volume
#      on subsequent runs — see Sprint 4).
#   3. Hand off to `xvfb-run pnpm test:e2e` via `exec` so WebdriverIO's exit
#      code becomes the container's exit code (Sprint 3 AC #4).

echo "[e2e] Seeding database..."
PGPASSWORD="$PGPASSWORD" psql \
  -h "$PGHOST" \
  -U "$PGUSER" \
  -d "$PGDATABASE" \
  -v ON_ERROR_STOP=1 \
  -f /app/e2e/fixtures/seed.sql

echo "[e2e] Building Tauri debug binary..."
pnpm tauri build --debug --no-bundle

echo "[e2e] Running E2E tests..."
exec xvfb-run pnpm test:e2e
