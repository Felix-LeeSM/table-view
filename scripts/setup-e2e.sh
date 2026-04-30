#!/usr/bin/env bash
# Local E2E test environment setup guide.
#
# As of sprint-169 (ADR 0015), the E2E suite is standardised on the docker
# pipeline. The launcher+workspace flow runs inside the
# `table-view-e2e:local` image (Dockerfile.e2e) against `postgres` and
# `mongo` services managed by `docker-compose.yml`'s `test` profile.
#
# This script is informational only — it prints instructions and exits 0.

set -euo pipefail

cat <<'EOF'
=== E2E Test Environment Setup ===

Canonical entrypoint (Linux host or CI):
  pnpm test:e2e:docker
    → docker compose --profile test up --build \
        --abort-on-container-exit --exit-code-from e2e

What this does:
  1. Builds Dockerfile.e2e (table-view-e2e:local) — Node 22.14.0,
     pnpm 10.20.0, Rust 1.91.0, tauri-driver, webkit2gtk-driver, xvfb,
     postgresql-client, mongosh.
  2. Starts the `postgres` (16-alpine) and `mongo` (mongo:7) services
     and waits for their healthchecks.
  3. Runs `e2e/run-e2e-docker.sh` inside the `e2e` service:
        a. Seeds Postgres from `e2e/fixtures/seed.sql` (idempotent).
        b. Builds the Tauri debug binary (`pnpm tauri build --debug
           --no-bundle`) into a `tauri-target` named volume so
           subsequent runs reuse the cached `target/`.
        c. `exec xvfb-run pnpm test:e2e` — WebdriverIO's exit code
           becomes the container's exit code.
  4. Reports land on the host at `e2e/wdio-report/` via bind mount.

macOS (Apple Silicon) limitation:
  Tauri requires Linux-only webkit2gtk; the docker pipeline is therefore
  not natively runnable on macOS. Use a Linux VM (or rely on CI) — running
  the image under linux/amd64 emulation builds the toolchain but cannot
  exercise the GUI window inside xvfb. See ADR 0015 for details.

Required host tools:
  - docker (Engine 24+ recommended)
  - git

No host-side Node, Rust, pnpm, webkit2gtk, or xvfb is required.

Cleanup:
  docker compose --profile test down            # keep the target cache
  docker compose --profile test down -v         # nuke pgdata + tauri-target

EOF
