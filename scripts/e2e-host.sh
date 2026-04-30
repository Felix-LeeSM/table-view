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

if ! command -v pnpm >/dev/null 2>&1; then
  echo "ERROR: pnpm is required to run wdio." >&2
  echo "Install via 'corepack enable' or https://pnpm.io/installation" >&2
  exit 1
fi

PGHOST="${PGHOST:-localhost}"
# Non-default port (15432) — see docker-compose.yml `postgres.ports`.
# Avoids collisions with a host postgres on :5432 (the common case for
# devs running Postgres.app / brew postgres alongside this repo).
PGPORT="${PGPORT:-15432}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
PGDATABASE="${PGDATABASE:-table_view_test}"
# Mongo host port — default 37017 (prod 27017 + 10000), override via
# `MONGO_PORT=...` for parallel shards.
MONGO_HOST="${MONGO_HOST:-localhost}"
MONGO_PORT="${MONGO_PORT:-37017}"

echo "[e2e-host] Starting postgres + mongo (compose --wait --no-recreate)..."
# `--no-recreate` keeps already-healthy containers as-is. Without it,
# compose detects benign config drift (e.g. unrelated docker-compose.yml
# edits) and tries to recreate the container — which then fails with a
# host-port collision (5432) because the old one still owns the bind.
docker compose up -d --wait --no-recreate postgres mongo

# Seed via the postgres container's bundled psql so the host doesn't need
# libpq/psql installed. `-T` disables TTY allocation (safe for stdin
# redirect); `-e PGPASSWORD=` propagates the secret without leaking it
# into the compose env.
echo "[e2e-host] Seeding postgres via container psql..."
docker compose exec -T -e PGPASSWORD="$PGPASSWORD" postgres \
  psql -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 \
  < e2e/fixtures/seed.sql

echo "[e2e-host] Running wdio (host-native WebView)..."
exec env \
  PGHOST="$PGHOST" \
  PGPORT="$PGPORT" \
  PGUSER="$PGUSER" \
  PGPASSWORD="$PGPASSWORD" \
  PGDATABASE="$PGDATABASE" \
  MONGO_HOST="$MONGO_HOST" \
  MONGO_PORT="$MONGO_PORT" \
  pnpm test:e2e
