# Sprint Execution Brief: sprint-169 / Sprint 1 — Image Baseline + Reproducible Build Context

## Objective

- Land a `Dockerfile.e2e` + `.dockerignore` pair that builds a working Linux/amd64 image with all toolchains the Tauri E2E suite needs, with a small deterministic build context, and with cached re-build behaviour.

## Task Why

- Phase 1 of the Docker E2E pipeline. Compose wiring (Sprint 2), pipeline run (Sprint 3), cache strategy (Sprint 4), and CI delegation (Sprint 5) all depend on this image being reproducible and complete.
- The current uncommitted `Dockerfile.e2e` is a working draft but has not been audited against `.dockerignore` (which excludes `*.md` and `docs/`), and version drift between this file and `.github/workflows/ci.yml` has not been verified.

## Scope Boundary

- Only `Dockerfile.e2e`, `.dockerignore`, and `docs/sprints/sprint-169/handoff.md` may change in this sprint.
- Do NOT touch `docker-compose.yml` (Sprint 2), `e2e/run-e2e-docker.sh` (Sprint 3), `package.json` scripts, `wdio.conf.ts`, or any source under `src/` or `src-tauri/`.
- Do NOT begin moving the Tauri build out of image build time — that is Sprint 4's decision.
- Do NOT add MySQL/Elasticsearch/Redis services or revive `docker-compose.test.yml`.

## Invariants

- Toolchain versions in the Dockerfile must match the values used in `.github/workflows/ci.yml` for Node, pnpm, and Rust. Confirm by reading the workflow file.
- `tauri-driver` install path: `cargo install tauri-driver --locked`.
- macOS-host limitation: do not introduce instructions implying native darwin/arm64 execution outside `--platform linux/amd64`.
- `e2e/**/*.spec.ts` must remain readable inside the build context (i.e. not excluded by `.dockerignore`).
- `e2e/wdio-report/` continues to be excluded from the context.

## Done Criteria

1. Cold `docker build -f Dockerfile.e2e -t table-view-e2e:local --platform linux/amd64 .` exits 0.
2. Warm rebuild shows `CACHED` lines for apt/Rust/pnpm-install layers (i.e. dep layers stable across re-runs).
3. Eight required tools (`node`, `pnpm`, `rustc`, `cargo`, `tauri-driver`, `xvfb-run`, `psql`, `mongosh`, `WebKitWebDriver`) are runnable inside the image and report versions matching the contract.
4. Cold-build context transfer size is in the low tens of MB (≤ 80 MB target). Recorded as evidence.
5. `.dockerignore` audit table is in `handoff.md`, with each excluded pattern justified against actual build inputs (Cargo.toml, build.rs, tauri.conf.json, vite.config.ts, any `include_str!` callsite). Exclusions of `*.md`/`docs/` are explicitly justified (or narrowed).

## Verification Plan

- **Profile**: `command`
- **Required checks** (run in this order):
  1. Cold build → capture exit code, full log, context-size line.
  2. Warm rebuild → capture log; assert `CACHED` lines.
  3. Toolchain smokes → eight `docker run --rm` invocations; capture stdout per tool.
  4. `.dockerignore` static audit → produce table in `handoff.md`.
- **Required evidence**:
  - Final `Dockerfile.e2e` and `.dockerignore` contents.
  - Cold + warm build logs (or relevant excerpts).
  - Eight tool-version stdout snippets.
  - Context-size line from BuildKit output.
  - Audit table.

## Evidence To Return

- Changed files: `Dockerfile.e2e`, `.dockerignore`, `docs/sprints/sprint-169/handoff.md`. (Plus this brief and contract — already in place.)
- Checks run with concrete pass/fail outcome and command output.
- Per-AC evidence (AC-01 → cold/warm logs; AC-02 → tool smokes; AC-03 → context-size line; AC-04 → audit table).
- Assumptions made (e.g. base image choice, NodeSource setup approach, mongosh distribution).
- Residual risk (e.g. if `WebKitWebDriver --version` is not a real flag, document the alternative version-proof path).

## References

- Contract: `docs/sprints/sprint-169/contract.md`
- Spec (master): `docs/sprints/sprint-169/spec.md`
- Existing draft files:
  - `Dockerfile.e2e`
  - `.dockerignore`
- CI workflow for version pinning: `.github/workflows/ci.yml`
- ADR providing context for multi-window toolchain: `memory/decisions/0014-e2e-switchwindow-multi-window/memory.md`
