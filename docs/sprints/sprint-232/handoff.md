# Sprint 232 — Handoff

Date: 2026-05-07.
Owner: harness Generator.

## Summary

`query_table_data` 가 사용자 supplied `order_by` 가 없을 때 PG heap
order 그대로 row 를 반환하던 회귀 (2026-05-07 사용자 보고) 를 닫음.
새 free function `build_default_order_clause(columns: &[ColumnInfo])
-> String` 가 PK 컬럼 declared 순서대로 `" ORDER BY \"col1\" ASC[,
\"col2\" ASC …]"` 을 emit. user override 는 helper 미사용 — 우선순위
보존. PK 0 인 테이블은 빈 string 반환 (현행 보존).

부수효과: 사용자 보고된 "UPDATE 한 row 가 맨 아래로 내려가는 버그" 가
동시 해결 (PG 가 dead tuple + new tuple-at-tail 로 처리해도 PK ASC
ORDER BY 가 deterministic 하게 자리를 잡음).

## Files Changed

| File | Purpose |
| --- | --- |
| `src-tauri/src/db/postgres/queries.rs` | (a) `build_default_order_clause` free function 추가 (line 21-49), (b) `query_table_data` 본문에서 user-supplied order_by 분기 후 `order_clause` 가 빈 string 이면 helper 호출 (line 564), (c) `mod tests` Sprint 232 block 추가 — 6 new unit case + 2 helper builder. |
| `docs/PLAN.md` | Feature sequencing 표 7번 row → ✓ 갱신 (Sprint 232 entry). 8번 row 신규 추가 (Sprint 233/234 placeholder). |
| `docs/sprints/sprint-232/contract.md` | Phase 2 Contract artifact. |
| `docs/sprints/sprint-232/execution-brief.md` | Phase 2 Generator brief. |
| `docs/sprints/sprint-232/findings.md` | 결정 / 트레이드오프 / 잔존 risk. |
| `docs/sprints/sprint-232/handoff.md` | (이 파일) Generator self-report. |
| `docs/sprints/sprint-232/tdd-evidence/red-state.log` | RED 상태 cargo compile error capture. |

## Acceptance Criteria

| AC | Test name | File:line | Result |
| --- | --- | --- | --- |
| AC-232-01 (single PK fallback) | `build_default_order_clause_single_pk` | `queries.rs:894-898` | PASS |
| AC-232-01 (composite PK) | `build_default_order_clause_composite_pk` | `queries.rs:903-915` | PASS |
| AC-232-01 (degenerate empty) | `build_default_order_clause_empty_columns_returns_empty` | `queries.rs:955-959` | PASS |
| AC-232-02 (user override 우선) | invariant comment in `findings.md` §2 + `query_table_data` 본문 line 559-565 (helper 는 user_path 이후에만 호출) | n/a (caller-level invariant) | PASS (코드 review) |
| AC-232-03 (no PK) | `build_default_order_clause_no_pk_returns_empty` | `queries.rs:919-923` | PASS |
| AC-232-04 (executed_query 반영) | helper 의 반환 string 이 그대로 `format!(... order_clause ...)` 에 흡수 — `executed_query` = `inner_sql` (queries.rs line 567). 별도 fixture 없음 (helper 6 case 가 string 자체를 검증). | n/a (composition invariant) | PASS (코드 review) |
| AC-232-04 (quote escape) | `build_default_order_clause_quotes_embedded_double_quote` | `queries.rs:929-936` | PASS |
| AC-232-05 (regression baseline) | `build_default_order_clause_users_table_regression` | `queries.rs:942-951` | PASS |
| AC-232-06 (Sprint 226-231 회귀 0) | `cargo test --lib` (379 PASS / +6 from 373) + `pnpm vitest run` (220 files / 2846 tests, identical to Sprint 231) | n/a | PASS |
| AC-232-07 (PLAN.md 갱신) | `docs/PLAN.md` row 7 (Sprint 232 ✓) + row 8 (Sprint 233/234 placeholder) | `PLAN.md:158-159` | PASS |

Test-count delta: cargo `--lib` 373 → 379 (+6). vitest 2846 → 2846 (0).

## Verification Plan Checklist (12 checks)

| # | Check | Result |
| --- | --- | --- |
| 1 | `pnpm vitest run` | PASS — 220 files / 2846 tests / identical to Sprint 231 |
| 2 | `pnpm tsc --noEmit` | PASS — exit 0, silent |
| 3 | `pnpm lint` | PASS — exit 0, silent |
| 4 | `cargo build --manifest-path src-tauri/Cargo.toml` | PASS — `Finished dev profile … in 0.58s` |
| 5 | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | PASS — `Finished dev profile … in 3.59s`, no warnings |
| 6 | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | PASS — 379 passed, 0 failed, 2 ignored |
| 7 | `cargo test --manifest-path src-tauri/Cargo.toml --lib build_default_order_clause` | PASS — 6/6 |
| 8 | `git diff --stat src/components/structure/useDdlPreviewExecution.ts src/components/structure/SqlPreviewDialog.tsx` | PASS — 0 |
| 9 | `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` | PASS — 0 |
| 10 | `git diff --stat <connection/schema/safeMode stores + lib/safeMode.ts + lib/sql/sqlSafety.ts + useQueryExecution.ts + QueryTab.tsx + ConnectionDialogBody.tsx>` | PASS — 0 |
| 11 | `grep -nE 'is_primary_key' src-tauri/src/db/postgres/queries.rs` | PASS — 4 hits (helper body + 2 test fixture builders + doc comment) |
| 12 | `grep -nE 'build_default_order_clause' src-tauri/src/db/postgres/queries.rs` | PASS — 14 hits (1 fn signature + 1 call site + 1 doc + 11 in tests) |

## TDD Evidence

`docs/sprints/sprint-232/tdd-evidence/red-state.log` — RED state
compile errors (E0425 cannot find function `build_default_order_clause`
in this scope, 6 sites) captured before implementation. After helper
introduction, the same `cargo test --lib build_default_order_clause`
command yields 6/6 PASS.

## Frontend Change Audit

**Result: no frontend code changes were required.**

Reasoning:
- `src/components/rdb/DataGrid.tsx:179-182` — already sends `orderBy =
  undefined` when `sorts.length === 0`, which is the exact trigger for
  the new backend fallback.
- `src/lib/tauri/query.ts:5-25` — `queryTableData` IPC wrapper passes
  `orderBy ?? null` through to backend `Option<&str>`.
- `src/stores/schemaStore.ts:245-265` — store delegation is a
  pass-through, no defaulting.
- DocumentDataGrid (Mongo) is a separate paradigm; Mongo orders by
  `_id` natively, so no change needed.

User-facing effect: existing column-header click-to-sort UI continues
to work unchanged. The new behavior is purely additive on the
`orderBy === undefined` (no user sort) path.

## Assumptions

1. `columns: Vec<ColumnInfo>` arrives at `query_table_data` with
   `is_primary_key` already accurately populated by
   `get_table_columns_inner`. Verified — Sprint 100+ schema fetch joins
   `pg_constraint` and sorts by `pg_attribute.attnum` (declared order).
2. PG identifier double-quoting via `replace('"', "\"\"")` matches the
   convention already used in the user-supplied ORDER BY parser
   (queries.rs:518). Tested directly via
   `build_default_order_clause_quotes_embedded_double_quote`.
3. Frontend `DataGrid.tsx` emits `undefined` for `orderBy` when no user
   sort is active, which the IPC wrapper translates to `null` →
   backend `None`. Verified by reading the full chain.

## Residual Risk

1. **View / unlogged / PK-less tables**: fallback returns empty string
   (current behavior preserved). User-reported repro (UPDATE row
   shifts) is for normal tables with PK, so this gap does not block
   the closure. Determinism for PK-less queries is a separate sprint
   (could grow into ORDER BY by `ctid` or by first column hint).

2. **PK constraint without underlying btree index** (corrupted /
   manually dropped): `is_primary_key == true` but PG falls back to
   sequential scan + sort. Possible latency spike on large tables. Out
   of scope — schema-fetch hardening lives in a future sprint.

3. **Multi-row UPDATE via raw query path**: Sprint 231's Safe Mode gate
   already protects this path. Combined with Sprint 232, a refresh
   after the gated UPDATE will keep rows in their PK position. No new
   risk introduced.

4. **MySQL / SQLite / MongoDB adapters** are not touched. Mongo is
   naturally ordered by `_id` (no fix needed). MySQL / SQLite have
   similar heap-order semantics and may share the same regression — a
   separate sprint can apply the same helper pattern there if a user
   reports it.

## Final State

- 7 acceptance criteria all satisfied (5 directly via cargo unit test;
  2 via composition + caller-level invariant verified by code read).
- 12 verification checks all PASS.
- TDD evidence preserved.
- Frontend diff = 0; no test changes required.
- `docs/PLAN.md` row 7 ✓ entered, row 8 placeholder for Sprint 233/234
  added.

Ready for orchestrator review.
