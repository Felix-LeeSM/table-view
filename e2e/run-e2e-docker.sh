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
#      `pnpm tauri build --debug --no-bundle` in `onPrepare`; with the target
#      volume warm that's effectively a cache hit (~5 s).
#   3. Start Xvfb explicitly (`xvfb-run` was hanging silently in CI even with
#      `--auto-servernum` — bypassing it gives us a known-good display +
#      observable Xvfb stderr) and hand off to `pnpm test:e2e` via `exec`.
#
# `set -x` is intentional — the trace is the only evidence we have of how
# far we got when something hangs in CI.

echo "[e2e] Seeding database..."
PGPASSWORD="$PGPASSWORD" psql \
  -h "$PGHOST" \
  -U "$PGUSER" \
  -d "$PGDATABASE" \
  -v ON_ERROR_STOP=1 \
  -f /app/e2e/fixtures/seed.sql

echo "[e2e] Building Tauri debug binary..."
pnpm tauri build --debug --no-bundle

# Verify the binary exists before handing off to wdio.
ls -la /app/src-tauri/target/debug/table-view

echo "[e2e] Starting Xvfb on :99..."
Xvfb :99 -screen 0 1280x720x24 -ac +extension GLX +render -noreset \
  >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!
export DISPLAY=:99

# Give Xvfb a moment to come up, then verify the X socket exists.
for i in 1 2 3 4 5 6 7 8 9 10; do
  if [ -S /tmp/.X11-unix/X99 ]; then
    echo "[e2e] Xvfb ready after ${i}s (pid=${XVFB_PID})"
    break
  fi
  if ! kill -0 "$XVFB_PID" 2>/dev/null; then
    echo "[e2e] Xvfb died — log follows:"
    cat /tmp/xvfb.log
    exit 1
  fi
  sleep 1
done

echo "[e2e] Running E2E tests..."
exec pnpm test:e2e
