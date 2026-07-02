# Hook Performance

## Policy

- `pre-commit` stays close to edit hygiene: formatting, lint repair, secret scan,
  ADR freeze checks, and commit message checks.
- `pre-push` owns expensive local pressure: tests, coverage, signed commits, and
  TDD-cycle checks.
- CI remains the merge gate. Local `pre-push` exists to catch failures before a
  PR waits on CI.

## Local And CI Split

Local `pre-push` is the first expensive gate. It should catch common coverage,
test, and hook regressions while the context is still on the developer machine.
CI still owns remote-only confidence: clean checkout, platform differences,
GitHub runner service wiring, and required branch protection.

Do not move a gate out of CI only because it is present locally. Local hooks can
be misconfigured, interrupted, or absent on another machine; CI is the shared
record.

## Rust Target Warm-Start

Rust hook performance depends on Cargo target reuse, not a compiler-cache
wrapper. New linked worktrees should use `scripts/worktree-spawn.sh` with the
default dependency warm-start so `node_modules/` and a pruned
`src-tauri/target/` are copied from the warm source worktree.

The target copy intentionally preserves `llvm-cov-target/` and DuckDB native
build outputs while excluding volatile coverage raw/profile data, final release
outputs, temporary files, and incremental directories. This is the supported
local cache path for `cargo llvm-cov nextest` and DuckDB-heavy Rust gates.

`sccache` is intentionally not installed by `scripts/setup.sh` and not enabled
by `pre-push`. Local measurements on 2026-06-01 showed no benefit for this repo:
the Rust coverage gate had 0 cache hits, and fresh-target `cargo check --lib`
had 0% Rust hits with no wall-clock win. Reintroduce it only with new
repo-local measurements that beat target warm-start.

## Rust Test Runner

The CI `Integration Tests (Docker)` job runs `cargo llvm-cov nextest --profile
push` for Rust integration coverage (promoted from the local pre-push rust route
on 2026-07-03, audit #6, so a required remote check owns the floor). The
pre-push rust route now runs only the fast gates (`cargo check`, `cargo deny`,
`cargo machete`); `pre-commit` still owns the fast lib-only Tier 1 coverage. The
nextest config lives at `src-tauri/.config/nextest.toml`. Pre-push hook
self-checks still validate that profile with `cargo nextest show-config`, which
reads config without compiling test binaries.

`mysql_integration` runs in a one-thread nextest group because its
container-backed tests share MySQL state. `serial_test` only serializes inside
one process, while nextest schedules individual tests as separate processes.

Doctests are not part of the nextest path. Run them separately when executable
documentation examples become meaningful:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --doc
```

Current repo state has one ignored doctest example and no executable doctests.

## Heartbeat

Long `pre-push` steps are wrapped with a heartbeat:

```text
[pre-push-route] ts-test start
[pre-push-route] ts-test running elapsed=15s
[pre-push-route] ts-test pass duration=74s
```

Successful command output is captured and discarded. Failures print the last 80
lines of the captured log. The tracked `.githooks/pre-push` wrapper enables
Lefthook `execution_out` for `pre-push` only so heartbeat lines are visible
without making `pre-commit` noisy. Tune locally with:

```bash
PRE_PUSH_PATH_ROUTER_HEARTBEAT_SECONDS=10
PRE_PUSH_PATH_ROUTER_LOG_TAIL_LINES=120
```

## Full-Route Concurrency

When a change touches workflow or unknown paths, `pre-push` runs both frontend
and Rust gates. The default is sequential execution: frontend first, then Rust.
This avoids local CPU and memory contention where the Rust gates and Vitest run
at the same time and cause otherwise unrelated test timeouts.

Opt into the old parallel behavior only for an intentionally quiet machine:

```bash
PRE_PUSH_PATH_ROUTER_PARALLEL_GATES=1 git push
```

## Coverage Ratchet

Coverage thresholds are protected by the ratchet in
`docs/quality/coverage-ratchet.md`.
