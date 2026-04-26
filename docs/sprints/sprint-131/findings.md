# Sprint 131 — Evaluator Findings

**Sprint**: Mongo paradigm in-connection DB switch
**Verification profile**: `mixed` (vitest + tsc + lint + contrast + cargo test + clippy + e2e static)
**Baseline commit**: `58a061c` (S130)
**Date**: 2026-04-26

## Verification Results

| # | Command | Outcome |
| --- | --- | --- |
| 1 | `pnpm vitest run` | **pass** — 1986 / 1986 tests across 124 files (above 1981 baseline) |
| 2 | `pnpm tsc --noEmit` | **pass** — 0 errors |
| 3 | `pnpm lint` | **pass** — 0 errors |
| 4 | `pnpm contrast:check` | **pass** — 72 themes / 144 modes / 864 pairs, 0 new violations (64 allowlisted) |
| 5 | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **pass** — 262 passed, 2 ignored, 0 failed |
| 6 | `cargo clippy --all-targets --all-features -- -D warnings` | **pass** — 0 warnings |
| 7 | e2e static compile probe (`wdio run --spec='nonexistent-…'`) | **pass** — config + types compile; only "spec not found" runtime |

All 7 required checks green.

## Acceptance Criteria Mapping

| AC | Verdict | Evidence |
| --- | --- | --- |
| **AC-01** MongoAdapter `active_db` field + lifecycle | PASS | `mongodb.rs:110` (field), `:122-124` (`new()`), `:292-304` (`connect()` seeds default+active), `:316-320` (`disconnect()` clears active) |
| **AC-02** `switch_active_db` validation/connection-guard/probe/best-effort | PASS | `mongodb.rs:208-249` — empty/whitespace → Validation; `current_client()` short-circuit → Connection; `list_database_names` Ok arm rejects missing db with Database error; Err arm logs `warn!` and proceeds; success mutates `active_db` + `info!` |
| **AC-03** `DocumentAdapter::switch_database` trait default + Mongo override | PASS | Trait default at `db/mod.rs:286-292` returns `AppError::Unsupported`; MongoAdapter override at `mongodb.rs:343-345` delegates to inherent `switch_active_db` |
| **AC-04** `meta.rs` Document arm replacement | PASS | `meta.rs:99` reads `ActiveAdapter::Document(adapter) => adapter.switch_database(&db_name).await`. The S130 `"…lands in Sprint 131"` placeholder string is gone from production code (verified by grep). |
| **AC-05** Dispatch tests cover Document Ok + Err propagation | PASS | `meta.rs:396-409` `switch_dispatch_document_paradigm_propagates_ok_from_adapter`; `:417-540` `…propagates_err_from_adapter` (uses inline `ErroringDocumentAdapter`). Search/Kv arms still assert Unsupported (`:542+`). |
| **AC-06** `DbSwitcher.handleSelect` paradigm branch | PASS | `DbSwitcher.tsx:185-189` — `paradigm === "rdb" → useSchemaStore…clearForConnection`; `paradigm === "document" → useDocumentStore…clearConnection`. Single if/else, common invoke before branch. `paradigm` added to `useCallback` deps (`:197`). |
| **AC-07** connectionStore Mongo activeDb seeding | PASS | `connectionStore.test.ts:576-607` (Mongo with `database: "analytics"` → `activeDb === "analytics"`); `:609-638` (Mongo with empty database → `activeDb === undefined`). Production code in `connectionStore.ts` is paradigm-agnostic (already correct from S130). |
| **AC-08** New tests count | PASS | Rust: 3 new (rejects-empty, not-connected, current_active_db_starts_none) + 1 `#[ignore]` happy-path live, 2 new dispatch tests in meta.rs. TS: 3 new DbSwitcher scenarios + 2 new connectionStore scenarios. Verified via grep on test names. |
| **AC-09** 7 verification commands green | PASS | See table above. |
| **AC-10** No user-visible regression | PASS | PG arm unchanged in `meta.rs` Rdb branch and `DbSwitcher` rdb path; new Mongo dispatch is the only behavioural delta. Search/Kv still return `Unsupported`. Cross-paradigm regression guards (`does NOT clear …`) prove store isolation. |

## Code Review Notes

### Strengths
- **Lock ordering documented**: comment at `mongodb.rs:215-217` explicitly pins client-before-active_db ordering, mirroring PG sub-pool discipline. This is a good preventative against future deadlocks.
- **Best-effort fallback is well-justified**: docstring at `:202-207` calls out the `42501`-analogue scenario and explains why a `warn!` rather than a toast is correct. The contract's design bar is satisfied verbatim.
- **Cross-paradigm regression guards** (`DbSwitcher.test.tsx:446-516`): the test for "Mongo switch must NOT touch schemaStore" and the symmetric "RDB switch must NOT touch documentStore" are exactly the kind of small-detail tests that catch future regressions where a refactor accidentally clears both stores.
- **Dispatch Err propagation test** (`meta.rs:417-540`): going beyond just "Ok bubbles through" is good rigor. The inline `ErroringDocumentAdapter` is verbose but correctly isolated.

### Minor concerns (non-blocking)
1. **`current_active_db()` is exposed but not yet consumed** (`mongodb.rs:257-259`). Generator's handoff acknowledges this is forward-prep for S132 raw-query detect; not over-engineering, but worth tracking that it has 0 production callers right now. The `test_current_active_db_starts_none` test pins lifecycle without exercising the post-switch read. The `#[ignore]`'d live test at `:1572-1576` does exercise it, so the contract is ultimately covered.
2. **Live-Mongo happy path is `#[ignore]`-gated** (acknowledged in handoff). `cargo test --lib` does not exercise the actual `list_database_names` probe + name-comparison path. CI coverage on the probe-OK branch is therefore zero. This is per-contract (live mongo not required) but means a regression in the `if !names.iter().any(|n| n == db_name)` predicate would only be caught by manual `--ignored` runs.
3. **`ErroringDocumentAdapter` is ~120 LOC of trait stubs** in `meta.rs`. Could have been extracted as a test helper, but inline is acceptable since it is only used by the one Err-propagation test. Not worth refactoring for sprint-131.
4. **No new `documentStore.clearConnection` invocation test** for the case where `paradigm === "document"` and the connection is connected but `clearConnection` itself throws — the `try/catch` in `handleSelect` would surface the toast, but there's no scenario test for that. Per contract test requirements this is not mandated; flagging only as forward improvement.

### Anti-patterns checked
- No TODOs, no console.logs, no placeholder text.
- TypeScript stays strict (no new `any`).
- No scope creep — handoff explicitly defers tab autofill, raw-query detect, and shortcuts to later sprints.
- Memory palace lessons referenced: Generator did not run `cargo check` or `cargo test` against `--all-features` outside the `--lib` scope (which is what the contract requested).

## Sprint 131 Evaluation Scorecard

| Dimension | Score | Notes |
| --- | --- | --- |
| **Correctness (35%)** | **9/10** | All ACs satisfied. `switch_active_db` covers empty / not-connected / not-found / probe-fail / success. Lock-ordering documented. Trait default + override pair is clean. Minor: live-Mongo path only exercised behind `#[ignore]`. |
| **Completeness (25%)** | **9/10** | All 10 ACs mapped to file:line evidence. New tests added at every requested boundary (Rust + TS). Dispatch tests cover both Ok and Err branches. No scope creep. `current_active_db` exposed for S132 with explicit handoff note. |
| **Reliability (20%)** | **8/10** | Best-effort fallback is correct. Cross-paradigm regression guards lock down store isolation. `disconnect()` clears active_db so reconnect cannot leak. One soft spot: probe-OK arm has no automated coverage. |
| **Verification Quality (20%)** | **9/10** | All 7 commands green with concrete numbers (1986 vitest, 262 cargo). Evidence packet includes file:line for every AC. e2e static compile probe correctly distinguishes "compile fail" from "spec not found". |
| **Overall** | **8.85/10** | |

## Verdict: **PASS**

All four System rubric dimensions ≥ 7/10. All Done Criteria evidenced. All 7 verification commands green. No user-visible regression.

## Done-Criteria Checklist

- [x] AC-01 MongoAdapter `active_db` field + connect/disconnect lifecycle
- [x] AC-02 `switch_active_db` empty / not-connected / probe / best-effort fallback
- [x] AC-03 `DocumentAdapter::switch_database` trait default + Mongo override
- [x] AC-04 `meta.rs` Document arm replacement (placeholder removed)
- [x] AC-05 Dispatch tests Document Ok + Err propagation
- [x] AC-06 `DbSwitcher.handleSelect` paradigm branch (rdb + document)
- [x] AC-07 connectionStore Mongo activeDb seeding (with + without default db)
- [x] AC-08 Required new tests in mongodb.rs / meta.rs / DbSwitcher.test.tsx / connectionStore.test.ts
- [x] AC-09 All 7 verification commands green
- [x] AC-10 PG path 0 regressions, Mongo new dispatch live, Search/Kv still Unsupported

## Feedback for Generator

**None — sprint-131 implementation meets the contract without rework.**

If the team wants to harden coverage further for S132 prep:
1. **Probe-OK branch coverage**: introduce a tiny mockable layer over `client.list_database_names()` so the "name found / name missing" predicates in `switch_active_db` get an automated unit test that does not need a live Mongo. Current state forces `--ignored` runs.
   - Current: only `#[ignore]`'d live-Mongo test exercises the probe path.
   - Expected: a unit test that pins `if !names.iter().any(...)` against a stub, so a refactor of the predicate is caught in CI.
   - Suggestion: thread `list_database_names` through a tiny trait the adapter holds, or add an integration test under `tests/` that reuses the harness Mongo container in CI matrix.
2. **`current_active_db` post-switch assertion**: the existing test only pins the `None` initial state. Add a test that pre-seeds `active_db` via direct mutex mutation (or via a `#[cfg(test)]` setter) and confirms `current_active_db().await == Some(...)`. Cheap, rounds out the lifecycle.
   - Current: `test_current_active_db_starts_none`.
   - Expected: also `test_current_active_db_after_seed_returns_value`.
   - Suggestion: add a `#[cfg(test)] fn seed_active_db_for_test(&self, db: &str)` to bypass the connection guard.

Both are nice-to-have, not blocking.

## Handoff Evidence

- Changed files: 7 (5 production + 2 tests + 1 doc).
- 7 verification commands: all green.
- Findings persisted at `docs/sprints/sprint-131/findings.md`.
- Open P1/P2: 0.
- Residual risk: live-Mongo happy-path `#[ignore]`-gated; tab autofill deferred to later sprint per contract carve-out.
