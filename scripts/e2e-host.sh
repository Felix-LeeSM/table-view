#!/usr/bin/env bash
# Host-native E2E runner for lefthook pre-push (ADR 0019, 2026-05-01).
#
# Replaces the CI Linux/xvfb/WebKitGTK/tauri-driver stack with the
# developer's actual runtime (macOS WKWebView / Windows WebView2).
# Sequence:
#   1. Ensure docker daemon is reachable; surface actionable error if not.
#   2. Bring up postgres + mongo containers (`--wait` blocks until healthy).
#   3. Seed postgres from the canonical fixture (idempotent).
#   4. Hand off to wdio (`pnpm test:e2e`) which builds the Tauri debug
#      binary via `tauri.e2e.conf.json` and drives both windows.
#
# Caches across runs:
#   - postgres/mongo containers are reused (compose volumes persist).
#   - `src-tauri/target` is the developer's local cargo cache, not the
#     `cargo-target/` host-mount the docker pipeline used.
#
# Bypass policy: this script must always run on `git push`. `--no-verify`
# and `LEFTHOOK=0` are blocked by `.claude/hooks/pre-bash.sh` and
# documented in `.claude/rules/git-policy.md`.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required for the e2e pre-push gate." >&2
  echo "Install Docker Desktop (macOS) or docker-engine (Linux) and re-run." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: docker daemon is not running." >&2
  echo "Start Docker Desktop (macOS) or 'sudo systemctl start docker' (Linux)." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is required to seed the e2e database." >&2
  echo "macOS: 'brew install libpq && brew link --force libpq'" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "ERROR: pnpm is required to run wdio." >&2
  echo "Install via 'corepack enable' or https://pnpm.io/installation" >&2
  exit 1
fi

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
PGDATABASE="${PGDATABASE:-table_view_test}"

echo "[e2e-host] Starting postgres + mongo (compose --wait)..."
docker compose up -d --wait postgres mongo

echo "[e2e-host] Seeding postgres at ${PGHOST}:${PGPORT}/${PGDATABASE}..."
PGPASSWORD="$PGPASSWORD" psql \
  -h "$PGHOST" \
  -p "$PGPORT" \
  -U "$PGUSER" \
  -d "$PGDATABASE" \
  -v ON_ERROR_STOP=1 \
  -f e2e/fixtures/seed.sql

echo "[e2e-host] Running wdio (host-native WebView)..."
exec env \
  PGHOST="$PGHOST" \
  PGPORT="$PGPORT" \
  PGUSER="$PGUSER" \
  PGPASSWORD="$PGPASSWORD" \
  PGDATABASE="$PGDATABASE" \
  pnpm test:e2e
