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

## Rust Build Cache

Rust hooks use `sccache` when it is installed. The hook sets:

```bash
RUSTC_WRAPPER=sccache
CARGO_INCREMENTAL=0
```

Each worktree keeps its own `target/`. Only cacheable `rustc` compilation
outputs are shared. If dependency versions, features, compiler flags, target
triple, or source inputs change, the cache key changes and compilation falls
back to a miss. Stale entries remain harmless and age out by cache pressure.
If `sccache` is missing, the hook prints a warning and continues with normal
Cargo compilation because cache absence does not change correctness.

The cache location is the user's sccache default unless `SCCACHE_DIR` is set
before the sccache server starts. This keeps worktrees independent and avoids
copying or sharing `target/`.
The app crate may report non-cacheable calls because it builds `cdylib` outputs;
the expected win is reused dependency compilation across worktrees and repeated
hook runs.

Useful diagnostics:

```bash
sccache --zero-stats
lefthook run pre-push --no-auto-install --no-tty
sccache --show-stats
```

## Rust Test Runner

`pre-push` uses `cargo llvm-cov nextest --profile push` for Rust coverage. The
nextest config lives at `src-tauri/.config/nextest.toml`. Hook self-checks
validate that profile with `cargo nextest show-config`, which reads config
without compiling test binaries.

Doctests are not part of the nextest path. Run them separately when executable
documentation examples become meaningful:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --doc
```

Current repo state has one ignored doctest example and no executable doctests.

## Heartbeat

Long `pre-push` steps are wrapped with a heartbeat:

```text
[pre-push-route] rust-test-and-coverage start
[pre-push-route] rust-test-and-coverage running elapsed=15s
[pre-push-route] rust-test-and-coverage pass duration=74s
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
This avoids local CPU and memory contention where Rust coverage and Vitest run
at the same time and cause otherwise unrelated test timeouts.

Opt into the old parallel behavior only for an intentionally quiet machine:

```bash
PRE_PUSH_PATH_ROUTER_PARALLEL_GATES=1 git push
```

## Coverage Ratchet

Coverage thresholds are protected by the ratchet in
`docs/quality/coverage-ratchet.md`.
