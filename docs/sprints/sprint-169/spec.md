# Feature Spec: Docker-based E2E Test Runtime

## Description
Provide a reproducible, container-only execution environment for the WebdriverIO + tauri-driver E2E suite so contributors and CI can run the full launcher+workspace flow against backing PostgreSQL and MongoDB services without installing webkit2gtk, xvfb, Rust, or Node on the host. The container must be the single source of truth for the E2E runtime — replacing the hand-rolled apt/cargo/setup steps in `.github/workflows/ci.yml` and the partial uncommitted scaffolding currently on disk (`Dockerfile.e2e`, modified `docker-compose.yml`, `.dockerignore`, `e2e/run-e2e-docker.sh`).

This is an **infrastructure / build feature**: nearly every acceptance criterion is observable via shell command output, container exit codes, or file inspection. There is no host-visible UI surface to verify.

## Sprint Breakdown

### Sprint 1: Image baseline + reproducible build context
**Goal**: A single `docker build` command produces a working Linux image containing every system, Rust, and Node toolchain dependency required to run the Tauri E2E suite, with a build context that is small, deterministic, and does not silently drop files the runtime needs.
**Verification Profile**: command
**Acceptance Criteria**:
1. `docker build -f Dockerfile.e2e -t table-view-e2e:local .` completes successfully on a clean Linux host (or `linux/amd64` buildx target from macOS) and the resulting image exit code is `0`. Re-running the same build with no source changes is observably faster (cache hit on the dependency layers).
2. Inside the built image, the following are all resolvable on `PATH` (verifiable via `docker run --rm table-view-e2e:local <cmd> --version`): `node`, `pnpm`, `cargo`, `rustc`, `tauri-driver`, `xvfb-run`, `psql`, and the WebKitWebDriver binary used by `tauri-driver`. Versions for `node`, `pnpm`, and `rustc` match the values used by `.github/workflows/ci.yml` (currently Node 22.14.0, pnpm 10.20.0, Rust 1.91.0) — drift between the Dockerfile and CI is treated as a defect.
3. The build context sent to the daemon excludes host-only artifacts (`node_modules`, `src-tauri/target`, `.git`, `e2e/wdio-report/`, editor metadata, OS junk) so that `docker build` output reports a context size in the low tens of MB, not hundreds. The exclusion list does not omit any file the Rust crate or the Vite/Tauri build actually reads at compile time — verified by a successful build that uses ONLY the in-context files.
4. `.dockerignore` is reviewed against actual build inputs; if any file currently excluded (e.g. via `*.md`, `docs/`) is required by `Cargo.toml`, `build.rs`, `tauri.conf.json`, `vite.config.ts`, or any `include_str!`/`include_bytes!` callsite, the exclusion is narrowed. The reviewed result is documented (in spec follow-up notes or sprint handoff) so the decision is not silently relitigated later.

**Components to Create/Modify**:
- `Dockerfile.e2e`: defines the Linux image with Tauri system libs, Node, pnpm, Rust, tauri-driver, xvfb, postgresql-client, and MongoDB shell. Layers are ordered so dependency manifests change less often than source.
- `.dockerignore`: minimises build context while preserving every input the Rust+Vite+Tauri build reads.
- (optional) a tiny smoke script invoked from inside the image to assert toolchain versions, used by AC#2.

---

### Sprint 2: Compose stack — services healthy and wired
**Goal**: A single `docker compose` invocation brings up Postgres + MongoDB and a runnable E2E container, with healthchecks that the E2E service waits for, and with environment variables that match what the specs and helpers actually consume.
**Verification Profile**: command
**Acceptance Criteria**:
1. `docker compose --profile test config` validates without warnings, and the rendered config shows the `e2e` service depending on both `postgres` and `mongo` with `condition: service_healthy`. Default-only (no `--profile test`) up does NOT start the `e2e` service — it is opt-in.
2. `docker compose up -d postgres mongo` followed by polling `docker compose ps --format json` reports both services as `healthy` within 60 seconds on a cold start. The healthcheck commands actually exercise the protocol (Postgres `pg_isready` against the configured DB, MongoDB `db.adminCommand('ping')` via `mongosh`), not just TCP liveness.
3. The `e2e` service receives every env var that `e2e/_helpers.ts`, `e2e/connection-switch.spec.ts`, and `e2e/run-e2e-docker.sh` read at runtime — at minimum `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `E2E_PG_HOST`, `E2E_MONGO_HOST`, plus any Mongo credentials the spec uses (`testuser`/`testpass`). The values resolve to the in-network compose service hostnames (`postgres`, `mongo`), not `localhost`.
4. With Postgres+Mongo up but the `e2e` service NOT yet running, `psql` from inside an ad-hoc container on the same compose network can connect to `postgres:5432` with the configured credentials, and `mongosh` can connect to `mongo:27017` and run a ping. (Proves the network and credentials are correct independent of the E2E container's behaviour.)

**Components to Create/Modify**:
- `docker-compose.yml`: keeps existing dev `postgres` service shape, adds `mongo` and `e2e` services with healthchecks and the test profile. The compose file remains the single source of truth — the deleted `docker-compose.test.yml` does not return.
- `.env.example`: updated to list every variable the test profile reads, with comments explaining defaults and host-port-collision handling.

---

### Sprint 3: End-to-end pipeline runs green inside the container
**Goal**: One command on the host runs the entire E2E suite inside the container against the compose-managed databases, with a clean container exit code that reflects test pass/fail.
**Verification Profile**: command
**Acceptance Criteria**:
1. `pnpm test:e2e:docker` (or the underlying `docker compose --profile test up --build --abort-on-container-exit --exit-code-from e2e`) runs the entire WebdriverIO suite end-to-end and exits with code `0` on a green run and a non-zero code if ANY spec fails. The exit code is propagated from the `e2e` container, not masked by compose orchestration.
2. The seeded Postgres state required by the existing specs (the `users` / `orders` / `products` tables and rows currently duplicated in `.github/workflows/ci.yml` and `e2e/run-e2e-docker.sh`) is applied exactly once per run, before WebdriverIO starts. Re-running the suite without tearing the volume down does not fail on duplicate-key seed errors.
3. The Mongo-dependent `e2e/connection-switch.spec.ts` actually executes (does not `skip()`) when run inside the docker profile, because `E2E_MONGO_HOST` is set. Its three `it(...)` blocks all pass.
4. Multi-window flows (launcher ↔ workspace, ADR 0014) work inside the container — `browser.switchWindow()` paths in `e2e/_helpers.ts` resolve, and at least one currently-green multi-window spec from `e2e/` (e.g. `home-workspace-swap.spec.ts`, `db-switcher.spec.ts`, or `connection-switch.spec.ts`) finishes without timing out on the workspace-window lookup. The xvfb display lifecycle is correct: only one xvfb instance, cleanly torn down at process exit.
5. The set of specs executed inside the container matches the set executed by `wdio.conf.ts`'s `specs` glob — there is no silent filter that hides a spec from the docker run. If any spec is intentionally skipped under docker (e.g. an environment-only spec), the skip is explicit and documented.

**Components to Create/Modify**:
- `e2e/run-e2e-docker.sh`: orchestrates seed-then-run inside the container; idempotent against re-runs; propagates the WebdriverIO exit code as the container exit code.
- `wdio.conf.ts`: reviewed (not necessarily edited) to confirm the `onPrepare` Tauri build, the `tauri-driver` lookup paths, and the binary path resolve correctly inside the container layout. If the in-image binary location differs from the host expectation, the config accommodates both rather than hard-coding a host-only path.
- `package.json` `test:e2e:docker` script: confirmed to be the documented entrypoint.

---

### Sprint 4: Build cache, report extraction, and operator ergonomics
**Goal**: Iterating on tests no longer requires rebuilding the Tauri binary from scratch every time, and test artifacts produced inside the container are observable from the host for triage.
**Verification Profile**: mixed (command + static)
**Acceptance Criteria**:
1. The Tauri debug binary build (`pnpm tauri build --debug --no-bundle`) is structured so that a code-only change to `src/` or `e2e/` does NOT force a from-scratch Rust rebuild on the next `pnpm test:e2e:docker`. Whether this is achieved by moving the build out of the image into a runtime step with a cached `target/` volume, by `cargo-chef`-style dependency layering, by BuildKit cache mounts, or by another mechanism is the Generator's choice — but the second consecutive run must observably reuse compiled artifacts (visible in cargo/Tauri output as "Finished" with no full crate recompilation, or measurable as a meaningful wall-clock reduction). Document the chosen approach and its trade-offs in the sprint handoff.
2. After a run (pass or fail), `e2e/wdio-report/` on the host contains the WebdriverIO spec reporter output and any logs/screenshots the suite produced inside the container. The directory is created automatically when needed and is not committed to git (verify it is gitignored, and that `.dockerignore` does not block the bind mount).
3. On a failure run, the host can recover the test logs without re-running anything (i.e. the report files survive `docker compose down`). The exact mechanism — bind mount, named volume + copy step, `docker cp` — is the Generator's choice, but the criterion holds.
4. The image can be rebuilt without invalidating the dependency layers when only application source changes — verified by changing one line of TypeScript or Rust source and observing that `docker build` reuses the apt/Rust/pnpm install layers.

**Components to Create/Modify**:
- `Dockerfile.e2e`: layer ordering revisited; binary build relocated if needed for cache friendliness.
- `docker-compose.yml`: adds whatever volume/bind-mount strategy is chosen for report extraction and (if applicable) Rust target caching.
- `e2e/run-e2e-docker.sh`: aware of any new build/cache contract; still runs green idempotently.

---

### Sprint 5: CI integration + seed deduplication + documentation
**Goal**: GitHub Actions runs the E2E suite via the docker pipeline instead of a hand-rolled apt+cargo+xvfb sequence, the seed SQL has exactly one definition, and contributors have a single up-to-date setup document.
**Verification Profile**: mixed (command + static)
**Acceptance Criteria**:
1. `.github/workflows/ci.yml`'s `e2e` job either (a) calls `pnpm test:e2e:docker` directly, or (b) reuses the same Dockerfile and seed script as the local pipeline. The hand-rolled apt installs of `webkit2gtk-driver`/`xvfb`/`libwebkit2gtk-4.1-dev`/etc. and the inline `psql` heredoc that duplicates `e2e/run-e2e-docker.sh` are removed from the workflow. The workflow's e2e job is observably green on push/PR.
2. The seed SQL (the `users`/`orders`/`products` definitions + sample rows) lives in exactly one place — either a checked-in `.sql` file consumed by both the local script and the workflow, or the script alone consumed by the workflow. `grep -rn "CREATE TABLE IF NOT EXISTS users"` returns one definition, not two.
3. On failure, the CI run still uploads the contents of `e2e/wdio-report/` as a build artifact (parity with the existing `e2e-logs` upload behaviour). A red CI run produces an artifact a maintainer can download and inspect.
4. `scripts/setup-e2e.sh` and any README/ADR text that mentions running E2E tests is updated to point to the docker entrypoint as the canonical path for Linux/CI, and to clearly state the macOS limitation (no native run; requires Linux VM or buildx). References to the deleted `docker-compose.test.yml` are removed or redirected.
5. An ADR (or a dedicated section in `memory/decisions/0014-e2e-switchwindow-multi-window/memory.md` or a new ADR) records the decision to standardise E2E execution on the docker pipeline, including the macOS-host limitation and the rationale for keeping/relocating the Tauri build (per Sprint 4's decision).

**Components to Create/Modify**:
- `.github/workflows/ci.yml`: e2e job slimmed to docker invocation; artifact upload preserved.
- `scripts/setup-e2e.sh`: rewritten to point to the docker flow; obsolete instructions removed.
- A canonical seed source (one file, referenced by both local and CI paths).
- `memory/decisions/...`: new or updated ADR capturing the standardisation.
- `README.md` or `docs/architecture.md` (whichever already documents test commands): one-line update pointing at `pnpm test:e2e:docker`.

---

## Global Acceptance Criteria
1. The entire pipeline — image build, compose up, seed, WebdriverIO run, teardown — is invokable from a clean Linux host with only `docker` and `git` installed. No host-side Node, Rust, pnpm, webkit2gtk, or xvfb is required.
2. Every change preserves the green status of all currently-passing specs in `e2e/` (regression-free). No spec is silently disabled to make the docker pipeline pass.
3. macOS hosts cannot run the container natively (Tauri's Linux-only webkit2gtk dependency); this constraint is explicitly documented wherever the docker entrypoint is described, and no contributor-facing instruction implies otherwise.
4. Secrets and credentials remain confined to compose env / `.env` (not committed). The committed `.env.example` documents every variable the test profile reads.
5. Container exit codes are honest: a failing E2E run produces a non-zero exit from `pnpm test:e2e:docker` and from the corresponding CI step.
6. There is exactly one source of truth for: (a) toolchain versions (Node/pnpm/Rust), (b) seed SQL, (c) test runner entrypoint. Drift between Dockerfile, CI workflow, and local scripts is treated as a regression.

## Data Flow
- Host invokes `pnpm test:e2e:docker` → compose builds the `e2e` image (or reuses cache) → compose starts `postgres` and `mongo`, waits for healthchecks → starts `e2e` container.
- Inside `e2e`: `run-e2e-docker.sh` connects to `postgres` over the compose network, runs the seed SQL idempotently → invokes `xvfb-run pnpm test:e2e` → WebdriverIO (per `wdio.conf.ts`) builds the Tauri debug binary if not cached, spawns `tauri-driver`, runs every spec under `e2e/**/*.spec.ts`.
- Specs interact with two Tauri windows via `browser.switchWindow()` (ADR 0014), connect to `postgres` and `mongo` via the env-var-resolved hostnames (`E2E_PG_HOST`, `E2E_MONGO_HOST`), and emit reports into `e2e/wdio-report/`.
- On exit: WebdriverIO's exit code is the container's exit code → compose's `--exit-code-from e2e` propagates it to the host → CI marks the job green/red accordingly. Reports are visible on the host via the bind mount/volume from Sprint 4. Compose tears down both DB services.

## UI States
*(Omitted — this is build/test infrastructure, no host-visible UI surface.)*

## Edge Cases
- **macOS host attempting to run the docker pipeline**: the build cannot produce a runnable Tauri Linux binary on Apple Silicon without buildx + linux/amd64 emulation, and even then xvfb+webkit run only inside the container. Document the limitation; do not silently fail mid-build.
- **Re-running with stale Postgres volume**: existing seeded rows must not break the `INSERT INTO users ...` step; seeding is idempotent or scoped per-run.
- **MongoDB credentials drift**: if compose's Mongo root user/password ever drifts from what the spec hardcodes (`testuser`/`testpass`), the spec skips silently because it short-circuits on `E2E_MONGO_HOST`. Treat credential drift as a build error, not as a skip.
- **`tauri-driver` binding to the wrong window**: ADR 0014 already mandates `browser.switchWindow()`; the docker pipeline must not introduce a new race where the workspace window mounts before/after the driver expects.
- **`.dockerignore` over-exclusion**: if `*.md`/`docs/` ever masks a file the Rust crate actually `include_str!`s or that `Cargo.toml` references via `readme = "..."`, the build silently picks up a stale or empty file. The Sprint 1 review must catch this.
- **Seed SQL drift between CI workflow and the docker script**: any future column/table addition that lands in only one place will pass one pipeline and fail the other; Sprint 5's deduplication must close this.
- **Concurrent host port collisions**: dev Postgres on 5432 may conflict with a developer's local Postgres; `.env.example` already addresses this for some ports — make sure the test profile honours the same overrides.
- **`tauri-driver`/`webkit2gtk-driver` version skew**: an apt update inside the image can silently bump WebKitWebDriver while `tauri-driver` is pinned via `cargo install --locked`. If the pairing breaks, the failure mode is opaque; the image build should fail loudly (e.g. via the Sprint 1 smoke check) rather than at the first WebDriver session.
- **`xvfb-run` and process supervision**: a crashed Tauri app inside xvfb can leave a zombie display; the entrypoint must not leak across runs (matters when the container is reused).
- **Container exit code masking**: `docker compose up` without `--exit-code-from` returns 0 even when a service failed. Sprint 3 explicitly requires the exit code from the `e2e` service to propagate.

## Verification Hints
- **Per-sprint smoke**: `docker build -f Dockerfile.e2e -t table-view-e2e:local .` (Sprint 1), `docker compose --profile test config` and `docker compose up -d postgres mongo` + healthcheck poll (Sprint 2), `pnpm test:e2e:docker` end-to-end (Sprint 3), repeat-run wall-clock comparison + `ls e2e/wdio-report/` (Sprint 4), `gh run watch` on a CI push + `grep -rn "CREATE TABLE IF NOT EXISTS users"` (Sprint 5).
- **Critical evidence the Evaluator should require**:
  - Sprint 1: full `docker build` log showing successful layer caching on a re-run; `docker run --rm <image> <cmd> --version` for each required tool.
  - Sprint 2: `docker compose ps --format json` showing both DB services `healthy`; an ad-hoc `psql` and `mongosh` connection from a sibling container on the compose network.
  - Sprint 3: full `pnpm test:e2e:docker` log with WebdriverIO spec reporter output covering `connection-switch.spec.ts`, plus the container's exit code.
  - Sprint 4: two consecutive `pnpm test:e2e:docker` runs with timestamps, demonstrating cache reuse; `ls -la e2e/wdio-report/` after a run.
  - Sprint 5: link to a green `e2e` job on a CI push; `grep` showing exactly one seed-SQL definition; updated `setup-e2e.sh` content.
- **Open questions flagged for the user (NOT blockers, but explicit decisions Generator/Evaluator should not silently make)**:
  1. Should the Tauri debug binary build stay at image-build time, move to runtime with a cached `target/` volume, or use BuildKit cache mounts? (Sprint 4 forces a decision and asks for it to be recorded.)
  2. Should reports be exposed via bind mount or named volume + post-run copy? (Sprint 4 leaves this open.)
  3. Should CI continue to run the e2e job natively-on-runner with `services:` blocks (current style) but using the same Dockerfile for the binary, or fully delegate to `pnpm test:e2e:docker`? (Sprint 5 picks one.)
  4. Should additional services from the deleted `docker-compose.test.yml` (mysql, elasticsearch, redis) be reintroduced into `docker-compose.yml` under separate profiles, or stay deleted until a spec actually needs them? (Out of scope here; flagged so the integration-tests CI job is not silently broken.)
  5. Should the `wait-for-test-db.sh` script be retired now that compose healthchecks gate the `e2e` service, or kept for the integration-tests job? (Cross-cutting with question 4.)
