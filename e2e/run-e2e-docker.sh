#!/usr/bin/env bash
set -euxo pipefail

# sprint-169 / Sprint 3 — E2E container entrypoint.
#
# Runs inside the `e2e` service of `docker compose --profile test`. The
# Postgres and Mongo services are gated by healthchecks (Sprint 2), so this
# script can connect immediately without polling.
#
# Sequence:
#   1. Seed Postgres from the canonical fixture (e2e/fixtures/seed.sql).
#   2. Build the Tauri debug binary (cached by the `tauri-target` named volume
#      on subsequent runs — see Sprint 4). NOTE: wdio.conf.ts also calls
#      `pnpm tauri build --debug --no-bundle` in `onPrepare`, but with the
#      target volume warm that's effectively a cache hit (~5 s).
#   3. Hand off to `xvfb-run pnpm test:e2e` via `exec` so WebdriverIO's exit
#      code becomes the container's exit code (Sprint 3 AC #4).
#
# `set -x` is intentional — when this hangs in CI, the trace is the only
# evidence we have of how far we got.

echo "[e2e] Seeding database..."
PGPASSWORD="$PGPASSWORD" psql \
  -h "$PGHOST" \
  -U "$PGUSER" \
  -d "$PGDATABASE" \
  -v ON_ERROR_STOP=1 \
  -f /app/e2e/fixtures/seed.sql

echo "[e2e] Building Tauri debug binary..."
pnpm tauri build --debug --no-bundle

# Verify the binary exists before handing off to xvfb-run — if the build
# silently produced nothing, xvfb-run will spin forever waiting for a Tauri
# app that never launches.
ls -la /app/src-tauri/target/debug/table-view

echo "[e2e] Running E2E tests..."
# `--auto-servernum` picks an unused display; explicit screen args force
# 24-bit colour, since xvfb-run's default `-screen 0 1280x1024x8` makes
# WebKitGTK refuse to render and silently hangs.
# stdbuf forces line-buffered stdout/stderr so wdio progress shows up in
# real time inside `docker compose up` instead of arriving as one block at
# the end (or never, on timeout).
exec stdbuf -oL -eL xvfb-run \
  --auto-servernum \
  --server-args="-screen 0 1280x720x24 -ac +extension GLX +render -noreset" \
  pnpm test:e2e
