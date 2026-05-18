# Sprint Contract: sprint-390

## Summary

- Goal: **CI gap fix** — wire the `sql-parser-core` path-crate's lib tests and
  the `parse_sql_backend` integration test into `.github/workflows/ci.yml` so
  regressions in either set fail CI. Sprint-385's post-merge review surfaced
  this gap:

  > CI coverage gap (`.github/workflows/ci.yml`): the 31 `sql-parser-core` lib
  > tests and `tests/parse_sql_backend.rs` (2 tests) are NOT in CI's test
  > list. Only the 3 inline `commands::sql_parser::tests` are covered via
  > `--lib`.

- Audience: CI signal. No product behavior changes — TS/Rust source delta is 0.
- Owner: Generator (sprint-390).
- Verification Profile: `ci-infra` (YAML syntax + local cargo dry-runs of the
  two new commands).

## In Scope

- Edit `.github/workflows/ci.yml` only, inside the existing `rust` job
  (`Rust Unit And Storage Tests`).
- Add two new steps **directly after** `Run cargo tests`:
  1. `Run sql-parser-core unit tests` — `cargo test --manifest-path
     src-tauri/sql-parser-core/Cargo.toml --lib`
  2. `Run parse_sql_backend integration test` — `cargo test --manifest-path
     src-tauri/Cargo.toml --test parse_sql_backend`
- Add a single-block YAML comment above the first new step explaining the gap
  + the chosen blast-radius behavior (serial steps, default `if: success()`).
- Write this contract.

## Out of Scope

- Any TS / Rust source changes (the production parser code is unchanged).
- Splitting the `rust` job into a matrix or per-crate parallelism.
- Adding the new steps to the Frontend or Integration jobs (wrong job — these
  are pure Rust unit + integration coverage).
- Caching or runner OS changes (`macos-latest` retained — same as sibling
  Rust step).
- Coverage threshold updates.

## Invariants

- `.github/workflows/ci.yml` parses as valid YAML after edit.
- The two new steps live in the `rust` job, **not** the `frontend` job and
  **not** the `integration-tests` job.
- Steps run serially with the GitHub Actions default `if: success()` — the
  first failure short-circuits the rest. We deliberately do NOT use
  `if: always()`: when `Run cargo tests` is red, the table-view lib regression
  is the higher-priority signal; piling on two more red checks adds noise
  without informational value.
- Source code delta = 0 (TS + Rust). Only YAML + this contract.

## Acceptance Criteria

- `AC-390-01` `.github/workflows/ci.yml` contains a step named
  `Run sql-parser-core unit tests` that invokes
  `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml --lib`.
- `AC-390-02` `.github/workflows/ci.yml` contains a step named
  `Run parse_sql_backend integration test` that invokes
  `cargo test --manifest-path src-tauri/Cargo.toml --test parse_sql_backend`.
- `AC-390-03` Both new steps live under `jobs.rust.steps` (NOT
  `jobs.frontend.steps`, NOT `jobs.integration-tests.steps`).
- `AC-390-04` The two new steps run **serially** with the GitHub Actions
  default `if: success()` — i.e. no explicit `if: always()`. A failure in
  `Run cargo tests` short-circuits the remaining Rust steps. (Trade-off
  documented in Invariants.)
- `AC-390-05` `.github/workflows/ci.yml` parses as valid YAML
  (`python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
  exits 0).

## Verification Plan

### Required Checks

1. **YAML syntax**:
   `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
   exits 0.
2. **Local dry-run of new commands** (proves the CI commands will pass on a
   green tree before the PR is merged):
   - `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml --lib`
     → 31 tests pass.
   - `cargo test --manifest-path src-tauri/Cargo.toml --test
     parse_sql_backend` → 2 tests pass.
3. **No regression in frontend gates** (sprint-390 touches 0 TS files but
   pre-commit / pre-push hooks must still pass): `pnpm lint`, `pnpm vitest
   run`, `pnpm tsc --noEmit` remain green on the diff.

### Required Evidence

- Diff stat for `.github/workflows/ci.yml` (insertions only; 0 deletions).
- Local cargo output lines `test result: ok. 31 passed` and
  `test result: ok. 2 passed`.

## Test Requirements

- No new tests authored — this sprint **wires existing tests** (31 + 2 = 33
  pre-existing) into CI. The "test" being added is the CI step itself.

## Test Script / Repro Script

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml --lib
cargo test --manifest-path src-tauri/Cargo.toml --test parse_sql_backend
```

## Ownership

- Generator: general-purpose Agent (sprint-390).
- Write scope: In Scope.
- Merge order: independent — no upstream sprint blocks this; this sprint
  patches a gap from sprint-385.

## Exit Criteria

- Open P1/P2: 0
- AC 5/5 PASS
- Pre-commit + pre-push hooks green
- PR open + linked
