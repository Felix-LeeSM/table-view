# Sprint Contract: sprint-373

## Summary

- Goal: Phase 5 마무리 — `queryHistoryStore.entries` + `globalLog` 메모리 retire (M-4/L5), `add_history_entry` source 분류 5종 e2e, A9 retention (31일 vacuum), "Disable history" 토글 (insert IPC 0).
- Audience: state-management-strategy Phase 5 — M-4/L5 책임 누수 해소 + privacy AC.
- Owner: Generator (sprint-373)
- Verification Profile: `mixed` (cargo test + pnpm vitest + e2e + pnpm tsc + pnpm lint)

## In Scope

- `src/stores/queryHistoryStore.ts` — `entries: []` + `globalLog: []` 필드 자체 삭제. `recentVisible` 만 남김.
- `useQueryHistory` hook + 모든 caller — `entries`/`globalLog` read 사이트 0. grep CI: `rg "queryHistoryStore.*entries|globalLog" src/` 0건.
- `src/components/settings/HistorySettings.tsx` — "Disable history" 토글 (`query_history_enabled` setting). UI flag + frontend 가 `add_history_entry` 호출 전 `useSettings(s => s.queryHistoryEnabled)` 체크.
- `src/components/settings/HistoryRetentionSelect.tsx` — 7d/30d/90d/forever select. `set_setting("query_history_retention_days", N)` 호출.
- `src-tauri/src/storage/history_retention_boot.rs` — boot 직후 sprint-371 의 `boot_vacuum_old_history()` 호출 wiring (이미 sprint-371 에서 함수 구현). 본 sprint 는 boot integration + e2e 검증만.
- 5 source caller 마이그 — `add_history_entry` 호출 사이트 각각 `source` 필드 명시:
  - `raw`: `src/components/query/QueryTab.tsx` (사용자 직접 실행).
  - `grid-edit`: `src/components/datagrid/useDataGridEdit.ts` (DataGrid INSERT/UPDATE).
  - `ddl-structure`: `src/components/schema/StructurePanel.tsx` (DDL 메뉴).
  - `mongo-op`: `src/components/document/useMongoBulkOps.ts` (Mongo bulk ops).
  - `sidebar-prefetch`: `src/components/layout/Sidebar.tsx` (preview rows).
- 테스트:
  - `src/stores/queryHistoryStore.retire.test.ts` — `entries`/`globalLog` 부재.
  - `src/components/settings/HistorySettings.disable.test.tsx` — 토글 시 insert IPC 0.
  - `src-tauri/tests/history_retention_31d.rs` — 31일 row 시드 → vacuum 후 0건.
  - `e2e/history-source-5.e2e.ts` — 5 source 모두 각 1회 호출 시뮬 + `query_history` row 5종.

## Out of Scope

- backend wire (sprint-371).
- frontend list/detail/clear (sprint-372).
- ADR (sprint-374).

## Invariants

- `queryHistoryStore.entries` + `globalLog` 정적 read 0 — grep CI.
- `add_history_entry` 호출 사이트 5개 — source 필드 각각 정확.
- Retention vacuum 은 boot 1회 — 사용자 visible 영향 0 (toast 없음).
- Disable 토글 후 `add_history_entry` IPC 0 — 단위 테스트 spy.

## Acceptance Criteria

- `AC-373-01` `queryHistoryStore` 의 type 에 `entries` / `globalLog` 필드 부재. Test: `queryHistoryStore.retire.test.ts` + TS type check.
- `AC-373-02` grep CI: `src/` 에서 `queryHistoryStore.*entries|globalLog` 0건.
- `AC-373-03` Disable 토글 = `false` → 5 source caller 모두 `add_history_entry` IPC 호출 안 함. Test: 5 시나리오 RTL spy.
- `AC-373-04` Disable = `true` 로 복원 → insert IPC 호출 재개. Test.
- `AC-373-05` Retention 31일 boot vacuum integration: 30일 + 1초 전 row 시드 → 앱 boot → sprint-371 의 `boot_vacuum_old_history()` 호출 → row 0건. 29일 row 는 유지. Test: integration `history_retention_31d.rs` (boot path wiring 검증).
- `AC-373-06` 5 source e2e: 5 시나리오 (raw / grid-edit / ddl-structure / mongo-op / sidebar-prefetch) 각각 시뮬 → `query_history` 의 source 컬럼 5종 모두 존재. Test: `history-source-5.e2e.ts`.
- `AC-373-07` Retention default 30d: 신규 사용자 boot → `settings.query_history_retention_days = 30`. Test: 기본값.
- `AC-373-08` Disable default `true`: 신규 사용자 boot → `query_history_enabled = true`. Test.

## Design Bar / Quality Bar

- TDD: 5 source e2e 시나리오 먼저 — sprint 시작 시 source enum 5종 모두 호출 path 0 — red. 각 caller 의 source 명시 → green.
- Retention vacuum 은 별 task — boot snapshot 직후 비동기 task 로 spawn (snapshot timing 미영향).
- Disable 체크는 `add_history_entry` 호출 직전 frontend `useSettings` 한 줄 — backend 영향 0.
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/stores/queryHistoryStore.retire.test.ts src/components/settings/HistorySettings`
2. `cd src-tauri && cargo test -p table-view-lib --test history_retention_31d`
3. `pnpm test:e2e:docker -- e2e/history-source-5.e2e.ts`
4. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`
5. grep CI: `! rg -q "queryHistoryStore.*\.(entries|globalLog)" src/`

### Required Evidence

- TS type-check 결과 (queryHistoryStore.entries 부재).
- 5 source e2e raw row dump.
- Retention vacuum 시뮬 결과.
- Disable 토글 spy raw.

## Test Requirements

- Vitest: store + settings.
- Cargo: retention.
- e2e: 5 source.
- Coverage: queryHistoryStore 100% (대부분 retire), HistorySettings 70%.

## Test Script / Repro Script

1. `pnpm vitest run src/stores/queryHistoryStore src/components/settings`
2. `cd src-tauri && cargo test -p table-view-lib --test history_retention_31d`
3. `pnpm test:e2e:docker -- e2e/history-source-5.e2e.ts`
4. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope. backend history IPC (sprint-371) 변경 0.
- Merge order: 370 + 371 + 372 이후. 374 (ADR) / 376 (UI audit) 본 sprint 의존.

## Exit Criteria

- Open P1/P2: 0
- AC 8/8 PASS
- 5 source e2e green
- 31일 retention vacuum verified
