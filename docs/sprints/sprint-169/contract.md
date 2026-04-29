# Sprint Contract: sprint-169 / Sprint 1 — Image Baseline + Reproducible Build Context

## Summary

- **Goal**: A single `docker build -f Dockerfile.e2e ...` produces a working Linux image with every system, Rust, and Node toolchain dependency the Tauri E2E suite needs, on top of a deterministic, minimal build context. No file the runtime actually reads is silently excluded.
- **Audience**: Generator (제작자) implements; Evaluator (평가자) verifies via `command` profile.
- **Owner**: Generator
- **Verification Profile**: `command`

## In Scope

- `Dockerfile.e2e` content: base image, system libs (Tauri webkit2gtk 4.1, libxdo, etc.), Node 22.14.0 + pnpm 10.20.0, Rust 1.91.0, `tauri-driver`, `xvfb`, `postgresql-client`, the `mongosh` MongoDB shell, layer ordering favouring cache hits on dependency manifests.
- `.dockerignore`: minimise build context while preserving every file that `Cargo.toml`, `build.rs`, `tauri.conf.json`, `vite.config.ts`, or any `include_str!`/`include_bytes!` callsite reads at build time.
- (Optional) a tiny smoke entrypoint or shell helper invoked from `docker run --rm <image> ...` that asserts toolchain versions for AC-02.
- A short follow-up note (in `handoff.md`) documenting why each `.dockerignore` exclusion is safe (the AC-04 audit).

## Out of Scope

- Compose service definitions, healthchecks, env wiring (Sprint 2).
- `e2e/run-e2e-docker.sh` content beyond what's strictly needed by Sprint 1's optional toolchain smoke (Sprint 3 owns the seed/run orchestration).
- Tauri binary build relocation, `target/` cache strategy, BuildKit cache mounts (Sprint 4).
- CI workflow edits, seed-SQL deduplication, ADR updates (Sprint 5).
- Reintroducing the deleted `docker-compose.test.yml` services (mysql/elasticsearch/redis) — out of feature scope entirely.

## Invariants

- macOS-host limitation stays documented; we do NOT pretend the image runs natively on darwin/arm64 outside of `linux/amd64` emulation.
- `tauri-driver` continues to be installed via `cargo install --locked` so the driver binary version is reproducible.
- Toolchain versions in the Dockerfile must equal the values pinned in `.github/workflows/ci.yml`. Drift in either direction is a defect.
- `e2e/wdio-report/` stays gitignored and is excluded from the build context (the report dir is host-only).
- No spec from `e2e/**/*.spec.ts` is renamed, deleted, or excluded from globbing as a side-effect of this sprint.

## Acceptance Criteria

- `AC-01` — `docker build -f Dockerfile.e2e -t table-view-e2e:local --platform linux/amd64 .` succeeds (exit 0). A second consecutive run with no source changes is observably faster (apt/Rust/pnpm dependency layers reused, visible as `CACHED` lines in BuildKit output).
- `AC-02` — Inside the built image, every required tool resolves on `PATH` and reports a version. Verifiable via:
  - `docker run --rm --platform linux/amd64 table-view-e2e:local node --version` → `v22.14.x`
  - `docker run --rm --platform linux/amd64 table-view-e2e:local pnpm --version` → `10.20.0`
  - `docker run --rm --platform linux/amd64 table-view-e2e:local rustc --version` → `1.91.0`
  - `docker run --rm --platform linux/amd64 table-view-e2e:local cargo --version` → matches Rust 1.91.0
  - `docker run --rm --platform linux/amd64 table-view-e2e:local tauri-driver --help` → exits 0 (or `--version` if supported)
  - `docker run --rm --platform linux/amd64 table-view-e2e:local xvfb-run --help` → exits 0
  - `docker run --rm --platform linux/amd64 table-view-e2e:local psql --version` → reports a postgresql-client version
  - `docker run --rm --platform linux/amd64 table-view-e2e:local mongosh --version` → reports a mongosh version
  - `docker run --rm --platform linux/amd64 table-view-e2e:local WebKitWebDriver --version` (or equivalent path resolution proof) → exits 0
- `AC-03` — `docker build` reports a build-context size in the low tens of MB (target: ≤ 80 MB). The Generator includes the `transferring context: ...MB` line from BuildKit output as evidence.
- `AC-04` — `.dockerignore` is audited against every file the build path actually reads. A short table (per file or per pattern) appears in `handoff.md` listing each exclusion (`node_modules`, `src-tauri/target`, `.git`, `*.md`, `docs/`, `e2e/wdio-report/`, etc.) and explaining why it is safe (e.g. "Cargo.toml has no `readme = ...` referencing root README", "no `include_str!` callsite in `src-tauri/src` matches an excluded path"). Exclusions of `*.md` and `docs/` are explicitly justified or narrowed.

## Design Bar / Quality Bar

- Layers: base system → apt installs → Rust toolchain → tauri-driver install → JS dep install (`pnpm install --frozen-lockfile`) → source copy. Source COPY must be the last layer that changes frequently.
- No layer pulls a tool from an unauthenticated network endpoint without pinning (e.g. nodesource setup script is acceptable only if the resulting `node`/`npm` version is asserted afterwards; or pin to NodeSource Node 22 LTS distro package).
- No `latest` tags on the base image. Pin to a specific `ubuntu:24.04` or equivalent.
- Every apt-get install ends with `rm -rf /var/lib/apt/lists/*`.
- Image build is reproducible: same source → same toolchain versions on a re-run on a different host (we accept apt mirror drift in patch versions but not in major/minor).

## Verification Plan

### Required Checks

1. **Cold build**: `docker build -f Dockerfile.e2e -t table-view-e2e:local --platform linux/amd64 .` from a clean buildx state. Capture full output. Expect exit 0.
2. **Warm rebuild**: re-run the same command immediately after. Capture output. Expect the apt/Rust/pnpm install layers to show as `CACHED`.
3. **Toolchain smoke**: run each `docker run --rm` invocation listed in AC-02. Capture stdout per tool.
4. **Context size**: from the cold build output, capture the `transferring context: XX.XXMB` line.
5. **Dockerignore audit**: produce the AC-04 table and include it in `handoff.md`.

### Required Evidence

- Generator must provide:
  - The full `Dockerfile.e2e` content (final form), inline in `handoff.md` or a path reference.
  - The full `.dockerignore` content (final form).
  - Cold-build log (or last ~50 lines) showing exit 0 and the transferring-context line.
  - Warm-rebuild log showing `CACHED` lines for the dependency layers.
  - The eight tool-version stdout snippets from the `docker run --rm` smokes.
  - The `.dockerignore` audit table.
- Evaluator must cite:
  - Each AC pass/fail with a concrete log excerpt or stdout snippet.
  - Any missing or weak evidence as a Finding (severity P1 if it blocks AC verification).

## Test Requirements

### Unit Tests (필수)
- N/A for this sprint — no application code is added/changed. The "tests" are the verification commands above.

### Coverage Target
- N/A.

### Scenario Tests (필수)
- [x] Happy path — cold build succeeds.
- [x] 캐시 시나리오 — warm rebuild reuses dependency layers.
- [x] 빈/엣지 입력 — n/a (no user input surface).
- [x] 회귀 — `e2e/**/*.spec.ts` set unchanged; `wdio.conf.ts` unchanged.

## Test Script / Repro Script

```bash
# 1. Cold build
docker build -f Dockerfile.e2e -t table-view-e2e:local --platform linux/amd64 . 2>&1 | tee /tmp/sprint-169-cold-build.log

# 2. Warm rebuild
docker build -f Dockerfile.e2e -t table-view-e2e:local --platform linux/amd64 . 2>&1 | tee /tmp/sprint-169-warm-build.log

# 3. Toolchain smokes
for cmd in "node --version" "pnpm --version" "rustc --version" "cargo --version" "psql --version" "mongosh --version" "xvfb-run --help" "tauri-driver --help" "WebKitWebDriver --version"; do
  echo "--- $cmd ---"
  docker run --rm --platform linux/amd64 table-view-e2e:local sh -c "$cmd" 2>&1 | head -3
done

# 4. Context size
grep -E "transferring context" /tmp/sprint-169-cold-build.log
```

## Ownership

- Generator: implements `Dockerfile.e2e` + `.dockerignore` + audit note in `handoff.md`.
- Write scope: `Dockerfile.e2e`, `.dockerignore`, `docs/sprints/sprint-169/handoff.md`. No edits to `docker-compose.yml`, `e2e/run-e2e-docker.sh`, `package.json`, or any source code.
- Merge order: stand-alone; nothing depends on this sprint's output to be already merged on `main`. Sprint 2 builds against the same working tree.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
- `.dockerignore` audit table present in `handoff.md`
