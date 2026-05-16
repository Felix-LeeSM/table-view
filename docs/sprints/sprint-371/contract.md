# Sprint Contract: sprint-371

## Summary

- Goal: Phase 5 query_history backend — F.5 wire 의 4 IPC (`add_history_entry` / `list_history` / `get_history_detail` / `clear_history`) + privacy (`sql_redacted` NOT NULL + fallback / list 응답 sql 없음 / detail 만 원문 / clear VACUUM transaction 분리 / executedAt drift validation).
- Audience: state-management-strategy F.5 Query History Privacy Contract.
- Owner: Generator (sprint-371)
- Verification Profile: `mixed` (cargo test + cargo clippy + pnpm vitest + pnpm tsc + pnpm lint)

## In Scope

- `src-tauri/src/commands/history.rs` — 4 IPC:
  - `add_history_entry(req: AddHistoryEntryRequest)` — `HistoryQueryMode` discriminated union 검증 (invalid combo → 400). `sql_redacted` backend 생성 (regex). executedAt drift 검증 (|now - executedAt| > 5min → backend now override + dev warning).
  - `list_history(req: ListHistoryRequest)` — `HistoryQueryModeFilter` 검증 (paradigm 없이 queryMode → 400). `tabId` 있을 때 `connectionId` 필수 (없으면 400). `limit` default 100 / clamp 500. cursor pagination. 응답에 `sql` 필드 없음.
  - `get_history_detail(req: GetHistoryDetailRequest)` — `sql` + `sqlRedacted` 반환.
  - `clear_history()` — BEGIN/COUNT/DELETE/COMMIT → VACUUM (transaction 밖) → emit_all(history.clear) → `{deletedCount}` 반환.
- `src-tauri/src/storage/sql_redact.rs` — regex 기반 quoted literal `?` 마스킹. panic 시 원문 fallback (column NOT NULL 보장).
- `src/lib/tauri/history.ts` — 4 wrapper.
- 테스트:
  - `src-tauri/tests/history_add_discriminated_union.rs` — 4 case (rdb+sql OK / rdb+find FAIL / document+find OK / document+sql FAIL).
  - `src-tauri/tests/history_list_filter.rs` — filter union + tabId+connectionId 검증 + limit clamp.
  - `src-tauri/tests/history_list_no_sql.rs` — list 응답 어디에도 `sql` 필드 없음.
  - `src-tauri/tests/history_detail.rs` — sql + sqlRedacted 반환.
  - `src-tauri/tests/history_clear.rs` — DELETE + VACUUM (transaction 밖) + deletedCount.
  - `src-tauri/tests/sql_redact.rs` — regex + panic fallback.
  - `src-tauri/tests/history_executed_at_drift.rs` — clock drift override.

## Out of Scope

- Frontend integration (sprint-372).
- queryHistoryStore retire (sprint-373).
- query_history schema 자체 (이미 sprint-355 의 0001 에 포함).

## Invariants

- `sql_redacted` NOT NULL — backend redact 함수가 panic 시 원문 fallback (column 채움).
- list response 어디에도 `sql` 필드 없음 — RTL/serde 단위 테스트로 강제.
- detail IPC 는 단일 row id 만 — bulk dump path 0.
- VACUUM 은 transaction 밖 (SQLite 제약).
- executedAt drift > 5min → backend now override + dev warning.
- HistoryQueryMode discriminated union — invalid combo 는 serde 단계에서 reject.

## Acceptance Criteria

- `AC-371-01` `add_history_entry({paradigm:"rdb", queryMode:"sql", ...})` PASS, `{paradigm:"rdb", queryMode:"find", ...}` FAIL (400). Test: `history_add_discriminated_union.rs`.
- `AC-371-02` `list_history({filter:{queryMode:"find"}})` (paradigm 없음) → 400 `AppError::Validation`. Test: `history_list_filter.rs`.
- `AC-371-03` `list_history({tabId:"tab-1"})` (connectionId 없음) → 400 `AppError::Validation`. Test.
- `AC-371-04` `list_history({limit:1000})` → clamp 500, 응답 rows ≤ 500. Test.
- `AC-371-05` `list_history` 응답 `rows[*]` 의 어느 row 에도 `sql` 필드 부재, 모두 `sqlRedacted` 포함. Test: `history_list_no_sql.rs` (serde_json::Value 키 검사).
- `AC-371-06` `get_history_detail({id})` 응답 `{id, sql, sqlRedacted}` 정확히 3 키. Test.
- `AC-371-07` `clear_history()` — BEGIN → COUNT → DELETE → COMMIT → VACUUM → emit_all → `{deletedCount: N}` 반환. SQLite query trace 로 VACUUM 이 transaction 밖 확인. Test.
- `AC-371-08` `sql_redact("SELECT * FROM users WHERE email = 'a@b.com'")` → `"SELECT * FROM users WHERE email = ?"`. panic 시 원문 fallback. Test: `sql_redact.rs`.
- `AC-371-09` executedAt drift: `add_history_entry({executedAt: now - 10min, ...})` → backend now override, row 의 `executed_at` = backend now. dev warning log 1회. Test.
- `AC-371-10` Retention backend impl: `boot_vacuum_old_history()` 함수 + `executed_at < now - retention_days` 삭제 로직 구현 + 단위 테스트 (function-level). 실제 boot 호출 + e2e 검증은 sprint-373 책임 (cross-reference).

Note: `query_history_enabled=false` frontend gating 은 sprint-373 의 AC-373-03/04 책임 — 본 sprint 범위 0.

## Design Bar / Quality Bar

- TDD: 10 AC 각각 red test 먼저 → 구현 → green.
- Serde discriminated union: `#[serde(tag = "paradigm", rename_all = "lowercase")]` + 내부 enum 으로 queryMode.
- Regex sql_redact 는 `?` quoted literal + numeric literal + named param. fallback 은 catch_unwind.
- VACUUM 은 별 statement — `sqlx::Acquire` 후 commit 후 `sqlx::query("VACUUM").execute()`.
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test history_add_discriminated_union --test history_list_filter --test history_list_no_sql --test history_detail --test history_clear --test sql_redact --test history_executed_at_drift`
3. `pnpm vitest run src/lib/tauri/history.test.ts`
4. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`

### Required Evidence

- 10 AC raw 결과.
- VACUUM transaction trace.
- list 응답 JSON 키 dump (sql 부재 확인).
- regex redact 의 input/output 쌍.

## Test Requirements

- Cargo integration: 7 테스트 파일.
- Vitest: wrapper.
- Coverage: `commands/history.rs` + `storage/sql_redact.rs` 80%.

## Test Script / Repro Script

1. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test history_add_discriminated_union --test history_list_filter --test history_list_no_sql --test history_detail --test history_clear --test sql_redact --test history_executed_at_drift`
3. `pnpm vitest run src/lib/tauri/history.test.ts`
4. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope. queryHistoryStore (frontend) 변경 0 — sprint-373 의 책임.
- Merge order: 355 + 365 + 370 (W3 진입 후) 이후 — Phase 5 선행 조건 = Phase 1 + Phase 4. 372 / 373 본 sprint 의존.

## Exit Criteria

- Open P1/P2: 0
- AC 10/10 PASS
- list 응답 sql 부재 verified
- VACUUM transaction 분리 verified
