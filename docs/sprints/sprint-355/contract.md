# Sprint Contract: sprint-355

## Summary

- Goal: Phase 1 SQLite 인프라 스켈레톤. `sqlx` 의 `sqlite` feature 추가 + `migrations/0001_initial.sql` 9 table (8 도메인 + `meta`) 적용 + Q2 corrupt recovery (`.bak` rename) + `import_legacy_localstorage` IPC + `meta.legacy_imported` 4-state enum + A/C 도메인 mutate IPC 의 `guard_legacy_import_done()`.
- Audience: state-management-strategy Phase 1 의 SQLite 단일 path 도입 — 후속 dual-write / snapshot / dual-read 의 토대.
- Owner: Generator (sprint-355)
- Verification Profile: `mixed` (cargo test + cargo clippy + pnpm vitest + pnpm tsc + pnpm lint)

## In Scope

- `src-tauri/Cargo.toml` — `sqlx` `features = ["runtime-tokio-rustls", "sqlite", "migrate", "json"]`.
- `src-tauri/migrations/0001_initial.sql` — 9 tables: 8 도메인 (`connections`, `connection_groups` with `collapsed`, `workspaces` PK `(connection_id, db_name)`, `mru`, `settings` key-value, `query_history` Q13 schema + `query_mode` + `sql_redacted`, `favorites`, `datagrid_column_prefs` PK 5-tuple) + `meta` (key-value, `legacy_imported` 4-state + `last_legacy_import_at`). 인덱스 포함.
- `src-tauri/src/storage/local.rs` — pool init / migration runner / atomic snapshot helper.
- `src-tauri/src/storage/corrupt_recovery.rs` — open 시 SQLite corruption 감지 → `state.db.bak` rename → fresh start. 사용자 toast 없음 (Q2).
- `src-tauri/src/storage/meta.rs` — `meta` 키-값 table 의 `legacy_imported` 상태 enum: `pending` | `importing` | `done` | `failed` (strategy line 1184 정합) + `last_legacy_import_at`.
- `src-tauri/src/commands/import_legacy.rs` — `import_legacy_localstorage(payload: LegacyPayload)` IPC:
  - 진입 시 `pending → importing` transition.
  - 완료 시 `importing → done` 저장.
  - 실패 시 `importing → failed` (`last_legacy_import_at` 기록).
  - idempotent (이미 `done` 이면 no-op).
- `src-tauri/src/commands/guard.rs` — `guard_legacy_import_done(state)` helper. A/C 도메인 mutate IPC 진입 시 호출. `legacy_imported != "done"` 이면 `AppError::LegacyImportInProgress` (strategy line 1189 정합).
- 단위 / integration 테스트:
  - `src-tauri/tests/migration_apply.rs` — 9 table (8 도메인 + meta) 존재 + 인덱스 + PK.
  - `src-tauri/tests/corrupt_recovery.rs` — bad header bytes 시뮬 → 재시작 후 fresh DB + `.bak` 존재.
  - `src-tauri/tests/legacy_import.rs` — payload 적용 + idempotent + guard reject.

## Out of Scope

- keyring 이주 (sprint-356).
- `get_initial_app_state` snapshot IPC (sprint-357).
- 실제 도메인 dual-write (sprint-358).
- query_history wire 외부 IPC (sprint-371). 본 sprint 는 schema 만.

## Invariants

- 기존 file-based connections.json / LS 동작 회귀 0 — sqlite 추가는 read-only side channel.
- Migration runner 는 멱등 (재실행 안전).
- Corrupt recovery 는 데이터 백업 (`.bak` rename) 후 fresh start, 사용자 visible 변화 0.
- Guard 가 모든 A/C mutate IPC entry 에 적용됨 — grep CI 로 검증.

## Acceptance Criteria

- `AC-355-01` `cargo build --features sqlite` Win/Mac/Linux CI 통과. Test: CI matrix.
- `AC-355-02` Migration 적용 후 9 table 존재 — `connections`/`connection_groups`/`workspaces`/`mru`/`settings`/`query_history`/`favorites`/`datagrid_column_prefs`/`meta`. Test: `SELECT name FROM sqlite_master WHERE type='table'` assert.
- `AC-355-03` PK / 인덱스 검증: `workspaces` PK `(connection_id, db_name)`, `datagrid_column_prefs` PK 5-tuple, `query_history` `idx_history_connection_executed` + `idx_history_tab`. Test: `PRAGMA index_list` assert.
- `AC-355-04` Corrupt recovery: 디스크에 corrupt 파일 시뮬 (header 첫 16 byte XOR) → 앱 boot → `.bak` rename + fresh DB. 사용자 toast 0. Test: integration `corrupt_recovery.rs`.
- `AC-355-05` `import_legacy_localstorage(payload)` IPC: 첫 호출 → `pending → importing → done` transition + SQLite row 들 insert. 둘째 호출 (`done` 상태) → no-op. Test: 2회 호출 시퀀스 + state transition log.
- `AC-355-06` Guard: `legacy_imported ∈ {pending, importing}` 일 때 A/C mutate IPC (예: `set_setting`) 호출 → `AppError::LegacyImportInProgress` (strategy line 1189). `done` 시 정상 진행. `failed` 시 별도 retry path (boot 시 재시도). Test: 4 state 별 guard 응답.
- `AC-355-07` Guard 적용 grep CI: A/C 도메인 mutate IPC (settings/connections/groups/mru/favorites/workspaces/datagrid_prefs/query_history insert) 모두 진입 직후 `guard_legacy_import_done(state)?` 호출. Test: grep test.

## Design Bar / Quality Bar

- TDD: 각 AC red test 먼저 — migration_apply.rs 의 `assert!(table_exists("workspaces"))` 가 처음엔 fail.
- `cargo fmt` + `cargo clippy --all-targets --all-features -- -D warnings` clean.
- Migration SQL 파일은 멱등 ID 순서 — `0001_*.sql` 단일 파일.
- IPC error 는 명확 enum (`AppError::Validation` / `AppError::LegacyImportInProgress` / `AppError::Storage`).
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo fmt --check`
2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
3. `cd src-tauri && cargo test -p table-view-lib --lib`
4. `cd src-tauri && cargo test -p table-view-lib --test migration_apply`
5. `cd src-tauri && cargo test -p table-view-lib --test corrupt_recovery`
6. `cd src-tauri && cargo test -p table-view-lib --test legacy_import`
7. `pnpm tsc --noEmit && pnpm lint`
8. `pnpm vitest run` (full)

### Required Evidence

- Migration 적용된 schema 의 `PRAGMA` 출력 raw.
- Corrupt recovery test fixture (XOR offset 위치) + `.bak` 존재 확인.
- Guard test 의 `AppError` enum 값 raw.
- grep CI 결과 (mutate IPC list).

## Test Requirements

- Cargo unit: storage helpers / guard 단위 테스트.
- Cargo integration: 3 test 파일 (migration / corrupt / legacy).
- Vitest: 변경 0 (frontend wire 0).
- Coverage: `src-tauri/src/storage/**` 라인 70% 이상.
- Scenario: (a) clean install, (b) corrupt file recovery, (c) legacy import idempotent, (d) guard reject.

## Test Script / Repro Script

1. `cd src-tauri && cargo fmt && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test migration_apply`
3. `cd src-tauri && cargo test -p table-view-lib --test corrupt_recovery`
4. `cd src-tauri && cargo test -p table-view-lib --test legacy_import`
5. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope 만. 기존 `connections.json` / 도메인 store 변경 0.
- Merge order: 353/354 이후, 356 / 357 / 359 / 361 와 병렬 가능.

## Exit Criteria

- Open P1/P2: 0
- AC 7/7 PASS
- CI matrix 3 OS green
