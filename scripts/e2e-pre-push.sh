#!/usr/bin/env bash
# pre-push e2e wrapper (ADR 0020, 2026-05-01).
#
# Cleans up the stale `e2e` service container before invoking the docker
# compose pipeline. Without this, an aborted previous run can leave a
# `Created`/`Exited` e2e container bound to a docker network that no
# longer exists, and the next `up --profile test` fails with
# `network <id> not found` before any test runs.
#
# Postgres + Mongo are NOT touched — they have host port bindings
# (15432 / 37017) and named volumes, so reusing healthy ones avoids the
# warm-up cost on every push.
#
# Bypass policy: this script must always run on `git push`. `--no-verify`
# and `LEFTHOOK=0` are blocked by `.claude/hooks/pre-bash.sh` and
# documented in `.claude/rules/git-policy.md`.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required for the e2e pre-push gate." >&2
  echo "Install Docker Desktop (macOS) or docker-engine (Linux)." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: docker daemon is not running." >&2
  echo "Start Docker Desktop (macOS) or 'sudo systemctl start docker' (Linux)." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "ERROR: pnpm is required to run the e2e pipeline." >&2
  echo "Install via 'corepack enable' or https://pnpm.io/installation" >&2
  exit 1
fi

# Best-effort cleanup of any stale e2e service container. `|| true`
# because the first run on a fresh checkout has no container to remove.
docker compose --profile test rm -fs e2e >/dev/null 2>&1 || true

exec pnpm test:e2e:docker
