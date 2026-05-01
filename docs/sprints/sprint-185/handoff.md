# Sprint 185 — Handoff

| AC | Subject | Evidence |
|----|---------|----------|
| AC-185-01 | `analyzeStatement` 12-case 단위 통과 | `src/lib/sqlSafety.ts` (NEW) + `src/lib/sqlSafety.test.ts` `[AC-185-01a-l]`. `pnpm vitest run src/lib/sqlSafety.test.ts` → **14 passed** (12 contract + 2 추가). 분류: DELETE/UPDATE WHERE 유무, DROP TABLE/DATABASE, TRUNCATE, INSERT, SELECT, case-insensitive, 주석 stripping, subquery WHERE. |
| AC-185-02 | `safeModeStore` 5-case 단위 통과 + bridge 등록 | `src/stores/safeModeStore.ts` (NEW) + `src/stores/safeModeStore.test.ts` `[AC-185-02a-e]`. `pnpm vitest run src/stores/safeModeStore.test.ts` → **5 passed**. default `"strict"` / setMode / toggle / persist roundtrip / SYNCED_KEYS exactly `["mode"]`. `attachZustandIpcBridge<SafeModeState>` 채널 `"safe-mode-sync"` 로 attach. |
| AC-185-03 | `SafeModeToggle` 3-case 시각/상호작용 회귀 통과 | `src/components/workspace/SafeModeToggle.tsx` (NEW) + `src/components/workspace/SafeModeToggle.test.tsx` `[AC-185-03a-c]`. `pnpm vitest run src/components/workspace/SafeModeToggle.test.tsx` → **3 passed**. strict 렌더 (shield-on + "Safe Mode" + aria-pressed=true) / off 렌더 (shield-off + "Safe Mode: Off" + aria-pressed=false) / 클릭 토글. `WorkspaceToolbar.tsx` 에 `<SafeModeToggle />` `<DisconnectButton>` 직전에 wire. |
| AC-185-04 | useDataGridEdit RDB 분기 4 시나리오 통과 | `src/components/datagrid/useDataGridEdit.safe-mode.test.ts` `[AC-185-04a-d]`. `pnpm vitest run src/components/datagrid/useDataGridEdit.safe-mode.test.ts` → **4 passed**. (a) production+strict+WHERE-less DELETE → 차단 + executeQueryBatch 0 호출 + commitError matches `/Safe Mode blocked.*DELETE without WHERE/` / (b) production+strict+safe DML → 통과 / (c) non-production+strict+WHERE-less → 통과 (env-gated) / (d) production+off+WHERE-less → 통과 (mode override). |
| AC-185-05 | EditableQueryResultGrid 동일 4 시나리오 통과 | `src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` `[AC-185-05a-d]`. `pnpm vitest run src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` → **4 passed**. 동일 4 시나리오. `executeError` 메시지에 `Safe Mode blocked: ... (toggle Safe Mode off in toolbar to override)` 형태. |
| AC-185-06 | Preview Dialog 헤더 색띠 — 두 surface | DataGrid: `src/components/rdb/DataGrid.tsx` line 502+ Preview Dialog 의 DialogHeader 직전에 `<div className="h-1" data-environment-stripe="..." style={{ background: ENVIRONMENT_META[env].color }} aria-hidden />`. `src/components/rdb/DataGrid.test.tsx` `[AC-185-06]` 회귀 통과 (74/74). EditableQueryResultGrid: `src/components/query/EditableQueryResultGrid.tsx` 의 동일 위치 동일 패턴. `src/components/query/EditableQueryResultGrid.test.tsx` `[AC-185-06]` 회귀 통과 (15/15). production 색 `#ef4444`. |
| AC-185-07 | 회귀 + 시나리오 + skip-zero + 산출물 git diff 0 | `pnpm vitest run` → **176 files, 2578 tests passed**. `pnpm tsc --noEmit` exit 0. `pnpm lint` exit 0. `cd src-tauri && cargo test --lib` → **326 passed; 0 failed; 2 ignored**. `cargo clippy --all-targets --all-features -- -D warnings` no warnings. `cargo fmt --check` no diff. `grep -RnE 'it\.(skip\|todo)\|xit\(' src/lib/sqlSafety.test.ts src/stores/safeModeStore.test.ts src/components/workspace/SafeModeToggle.test.tsx src/components/datagrid/useDataGridEdit.safe-mode.test.ts src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` → 0 matches. `git diff src-tauri/` empty. `git diff src/types/connection.ts` empty. |

## Check matrix

| Check | Result |
|-------|--------|
| `pnpm vitest run src/lib/sqlSafety.test.ts` | **14 passed** |
| `pnpm vitest run src/stores/safeModeStore.test.ts` | **5 passed** |
| `pnpm vitest run src/components/workspace/SafeModeToggle.test.tsx` | **3 passed** |
| `pnpm vitest run src/components/datagrid/useDataGridEdit.safe-mode.test.ts` | **4 passed** |
| `pnpm vitest run src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` | **4 passed** |
| `pnpm vitest run src/components/rdb/DataGrid.test.tsx` | **74 passed** |
| `pnpm vitest run src/components/query/EditableQueryResultGrid.test.tsx` | **15 passed** |
| `pnpm vitest run` | **176 files, 2578 tests passed** |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| `cd src-tauri && cargo test --lib` | **326 passed; 0 failed; 2 ignored** |
| `cargo clippy --all-targets --all-features -- -D warnings` | clean |
| `cargo fmt --check` | clean (no diff) |
| skip-zero (`it.skip` / `it.todo` / `xit`) in 신규 5 파일 | 0 |
| `#[ignore]` net new | 0 |
| `git diff src-tauri/` | empty |
| `git diff src/types/connection.ts` | empty |

## Files changed (purpose, one line each)

- **NEW** `src/lib/sqlSafety.ts` — analyzer (regex 기반, pure/sync/no-throw,
  comment stripping, case-insensitive). 4 dangerous kinds: WHERE-less
  DELETE/UPDATE, DROP TABLE/DATABASE/SCHEMA, TRUNCATE.
- **NEW** `src/lib/sqlSafety.test.ts` — 14 cases (12 contract + 2 추가).
- **NEW** `src/stores/safeModeStore.ts` — Zustand + `persist` middleware
  (`zustand/middleware`) + `attachZustandIpcBridge` (channel
  `"safe-mode-sync"`, `SYNCED_KEYS = ["mode"]`).
- **NEW** `src/stores/safeModeStore.test.ts` — 5 cases (default / setMode /
  toggle / persist / SYNCED_KEYS).
- **NEW** `src/components/workspace/SafeModeToggle.tsx` — toolbar 토글 버튼
  (shield-on / shield-off icon + 라벨 + aria-pressed + production accent
  border).
- **NEW** `src/components/workspace/SafeModeToggle.test.tsx` — 3 cases.
- `src/components/workspace/WorkspaceToolbar.tsx` — `<SafeModeToggle />`
  를 `<DisconnectButton>` 앞에 wire (1 import + 1 element 추가).
- `src/components/datagrid/useDataGridEdit.ts` — RDB 분기
  `handleExecuteCommit` 에 Safe Mode 게이트 inject (`executeQueryBatch`
  호출 직전). useSafeModeStore + useConnectionStore selector 추가. Mongo
  분기 무수정.
- **NEW** `src/components/datagrid/useDataGridEdit.safe-mode.test.ts` —
  4 cases (block/pass × 2 dimensions).
- `src/components/query/EditableQueryResultGrid.tsx` — `handleExecute` 에
  동일 게이트 inject + Preview Dialog 헤더 위에 environment 색띠 (1px,
  aria-hidden, data-environment-stripe).
- **NEW** `src/components/query/EditableQueryResultGrid.safe-mode.test.tsx`
  — 4 cases.
- `src/components/rdb/DataGrid.tsx` — Preview Dialog 헤더 위에 environment
  색띠 (동일 패턴).
- `src/components/rdb/DataGrid.test.tsx` — `[AC-185-06]` 색띠 회귀 1 case.
- `src/components/query/EditableQueryResultGrid.test.tsx` — `[AC-185-06]`
  색띠 회귀 1 case.
- `docs/sprints/sprint-185/contract.md` (이미 존재).
- **NEW** `docs/sprints/sprint-185/findings.md` — 9 sections.
- **NEW** `docs/sprints/sprint-185/handoff.md` — this file.

## Phase 23 진행 메모

본 sprint 는 Phase 23 의 첫 sprint (MVP — strict / off 2 모드 + WHERE-less
DML / DDL drop 정적 분석 + production 색띠). Phase 23 의 종료는 후속
sprint 들 (warn 모드 + DDL typing confirm / structure surface 색띠 / Mongo
dangerous-op) 완료 시점. 본 sprint 는 Phase 22 의 Preview/Commit 게이트
인터페이스 위에 얹혀 산출물 무파괴 — RDB 분기 두 commit entry 의 *몇 줄
inject* 외 Sprint 175~184 의 production 코드 git diff 0.
