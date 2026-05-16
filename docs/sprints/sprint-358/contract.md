# Sprint Contract: sprint-358

## Summary

- Goal: Phase 1 dual-write — `connections` / `favorites` / `mru` / `settings` 4 도메인의 mutate 시 file/LS write + SQLite write 둘 다 호출 + mismatch log 0. **`workspaces` 는 W1 시작 시점부터 SQLite-only** (LS write 제거). W1 mismatch reconcile (다음 boot 재시도) 포함.
- Audience: state-management-strategy Phase 1 W1 — file/LS SOT 와 SQLite mirror 의 dual-write 단계.
- Owner: Generator (sprint-358)
- Verification Profile: `mixed` (cargo test + cargo clippy + pnpm vitest + pnpm tsc + pnpm lint)

## In Scope

- `src-tauri/src/commands/persist_connections.rs` / `persist_favorites.rs` / `persist_mru.rs` / `persist_settings.rs` — file/LS write 후 SQLite mirror UPDATE/INSERT. 실패 시 `dev` 로그 + mismatch 카운터 증가.
- `src-tauri/src/commands/persist_workspace.rs` — SQLite-only. `guard_legacy_import_done(state)?` 통과 후 UPDATE. (workspace dual-write 안 함 — codex 6차 #5).
- `src/stores/workspaceStore/persistence.ts` — `localStorage.setItem(..., 'table-view-workspaces')` 호출 제거.
- `src-tauri/src/storage/reconcile.rs` — boot 직후 mismatch 도메인 (`mru` / `settings` 등) diff 감지 → SQLite write 재시도. 3회 실패 시 stop + dev console error.
- 단위 / integration 테스트:
  - `src-tauri/tests/dual_write_connections.rs` (favorites/mru/settings 동일 패턴 × 4 파일).
  - `src-tauri/tests/workspace_sqlite_only.rs`.
  - `src-tauri/tests/dual_write_reconcile.rs`.
  - `src/stores/workspaceStore/persistence.no-ls-write.test.ts`.

## Out of Scope

- 두 workspace window 동시 persist 검증 (sprint-361 이후 — codex 6차 #5).
- SQLite read SOT 전환 (Phase 4 W3 — sprint-370).
- query_history insert (sprint-371).
- datagrid_column_prefs IPC (sprint-369).

## Invariants

- file/LS 쓰기 동작 회귀 0 — 기존 사용자가 본 sprint 머지 후 다음 boot 시 SQLite 0 row 라도 file/LS 가 SOT 라서 데이터 손실 0.
- workspaces 의 LS key (`table-view-workspaces`) 는 read 만 가능 (boot import 용), write 사이트 0 — grep CI.
- 4 도메인 의 SQLite write 실패는 file/LS write 성공으로 간주, mismatch 카운터 + reconcile.
- guard_legacy_import_done 통과 후만 SQLite write — legacy import 전엔 SQLite 빈 채로 skip.

## Acceptance Criteria

- `AC-358-01` `connections` dual-write: `persist_connections` 호출 시 (1) file write + (2) SQLite `UPDATE connections SET ...` 둘 다 실행. Test: spy file fs + SQLite row count.
- `AC-358-02` `favorites` dual-write: 동일 패턴, LS `table-view-favorites` write + SQLite `favorites` insert. Test.
- `AC-358-03` `mru` dual-write: LS `table-view-mru` + SQLite `mru`. Test.
- `AC-358-04` `settings` dual-write: 6 known key (`theme` / `safe_mode` / `home_recent_collapsed` / `sidebar_width` / `query_history_retention_days` / `query_history_enabled`) 모두 file/LS + SQLite mirror. Test 6 케이스.
- `AC-358-05` `workspaces` SQLite-only: `persistWorkspaces` 호출 시 LS `table-view-workspaces` 의 `setItem` 호출 0회. Test: jsdom spy.
- `AC-358-06` grep CI: `src/stores/workspaceStore/persistence.ts` 외 src/ 에서 `localStorage.setItem.*"table-view-workspaces"` 0건. Test: grep test.
- `AC-358-07` Reconcile: SQLite write 실패 시뮬 (e.g. disk full mock) → mismatch 카운터 += 1, 다음 boot reconcile 호출 → SQLite UPDATE 성공. Test: `dual_write_reconcile.rs`.
- `AC-358-08` Guard: `legacy_imported ∈ {pending, importing}` 일 때 dual-write IPC 호출 → `AppError::LegacyImportInProgress` (strategy F.2 race gate — durable write block). Frontend 는 import 완료 (`done`) 후 retry. `done` 시 정상 dual-write. Test: 4 state 별 응답.
- `AC-358-09` mismatch log 0: 정상 path (디스크 정상, guard 통과) 에서 100회 dual-write → mismatch counter 0. Test: stress.

## Design Bar / Quality Bar

- TDD: spy fs + spy SQLite 로 호출 순서 단언 (file write 후 SQLite write 호출 — race condition 0).
- Dual-write 는 file/LS write 가 성공 path — SQLite write 실패는 silent (dev 로그 + counter 만).
- Reconcile 은 boot 직후 단일 task — 사용자 visible 영향 0.
- LS read 사이트 (boot import) 는 그대로 — write 만 차단.
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test dual_write_connections --test workspace_sqlite_only --test dual_write_reconcile`
3. `pnpm vitest run src/stores/workspaceStore/persistence.no-ls-write.test.ts`
4. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`
5. grep CI: `! rg -q 'localStorage\.setItem.*"table-view-workspaces"' src/`

### Required Evidence

- 4 도메인 × dual-write 호출 시퀀스 spy log.
- workspace LS write 0 — RTL spy 결과.
- mismatch counter raw (100회 stress).

## Test Requirements

- Cargo integration: 5+ 테스트 (도메인별).
- Vitest: workspace LS write 0.
- Coverage: `src-tauri/src/commands/persist_*` 라인 70%.
- Scenario: (a) 정상 dual, (b) SQLite 실패, (c) reconcile, (d) pre-import guard, (e) workspace LS write block.

## Test Script / Repro Script

1. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test dual_write_connections --test workspace_sqlite_only --test dual_write_reconcile`
3. `pnpm vitest run src/stores/workspaceStore`
4. `pnpm tsc --noEmit && pnpm lint && rg -q 'localStorage\.setItem.*"table-view-workspaces"' src/ ; [ $? -ne 0 ] && echo OK`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope. 다른 store / 다른 IPC 변경 0.
- Merge order: 355 + 356 이후. 359 / 361 / 365 / 367 / 369 / 370 / 371 등 다수가 본 sprint 의존.

## Exit Criteria

- Open P1/P2: 0
- AC 9/9 PASS
- grep CI: workspace LS write 0
- mismatch counter 100회 stress 0
