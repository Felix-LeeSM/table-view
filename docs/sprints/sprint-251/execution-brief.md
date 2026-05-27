# Sprint Execution Brief: sprint-251

## Objective

`useDataGridEdit` 의 4 슬라이스 (`pendingEdits` / `pendingNewRows` /
`pendingDeletedRowKeys` / `undoStack`) 를 `(connectionId, schema, table)` 키
단위 zustand store 로 lift. 탭 전환으로 인한 컴포넌트 unmount/remount 가
사용자의 pending 작업물을 잃지 않게 한다. tab close + connection drop 시
entry purge. Cross-window 동기화 / localStorage 는 out-of-scope.

## Task Why

Sprint 250 이 onBlur + Esc 로 commit 전 *입력-종료* 의 자연스러움을 정리했지만,
사용자가 탭을 갈아탔다 돌아오면 그 입력 자체가 사라지는 build-in 을 만들어
놓고 정리한 셈. Sprint 251 은 그 *진짜 신뢰성* — 작업이 사라지지 않는다 —
을 채워, ADR 0022 Phase 5 의 "Cmd+Z 안전망" 약속을 탭 lifecycle 너머까지
확장한다. 사용자는 탭 전환 / 새 connection 열기 / dirty preview 탭에서
persistent 탭으로 promote 등 일상 워크플로 어디서든 pending 작업물이 살아
있다고 신뢰할 수 있어야 한다.

## Scope Boundary

- 변경: 신규 `dataGridEditStore` (zustand, in-memory only),
  `useDataGridEdit` 재배선 (4 슬라이스 store-backed, returned shape 변경 0),
  `tabStore.removeTab` / `clearTabsForConnection` wire-up (purge 호출).
- 변경 금지:
  - `useDataGridEdit` returned 30+ 필드 (외부 인터페이스 보존).
  - DDL editor / raw query grid 의 별도 pending state.
  - Mongo grid (read-only).
  - `decideSafeModeAction` / SafeModeStore / dry-run IPC / dialog 본문.
  - `handleExecuteCommit` / commit-path.
  - Sprint 250 의 onBlur / Esc 동작 (회귀 가드).
  - Sprint 252 PreviewDialog polish.
  - Cmd+Z (Sprint 249) 동작.
  - localStorage persistence / cross-window 동기화.

## Invariants

- `useDataGridEdit` returned 30+ 필드 보존.
- AC-250-01..06 / AC-249-U1..U9 / AC-248-* / AC-247-* / AC-246-* / AC-245-* /
  AC-186-* / AC-185-* 모두 회귀 없음.
- `tabStore.dirtyTabIds` publish 흐름 보존.
- `setTabDirty` 호출 흐름 (useDataGridEdit 가 commit hint 발동) 변경 0.
- IPC / safeModeStore / persistence 변경 0.
- Mongo grid read-only invariant 보존.

## Done Criteria

1. 신규 `dataGridEditStore` (entries map, getEntry, setSlice, clearEntry,
   purgeKey, purgeForConnection — 5 store actions).
2. `useDataGridEdit` 가 4 슬라이스를 store selector + setter 로 read/write.
   returned shape 변경 0.
3. `tabStore.removeTab` 가 같은 키 다른 탭 없을 때 entry purge.
4. `tabStore.clearTabsForConnection` 가 connection 의 모든 entry purge.
5. AC-251-S1..S5 (store), H1..H5 (hook), T1..T3 (tabStore wire), R1..R4
   (회귀) 모두 매핑.
6. /tdd 흐름: 신규 테스트 먼저, fail → 구현 → pass.
7. Verification Plan 7개 check 모두 pass.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm tsc --noEmit` (0 errors)
  2. `pnpm lint` (0 / 0)
  3. `pnpm vitest run` (전체 통과 + AC-251 매핑 증거)
  4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` (회귀)
  5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  6. `rg "dataGridEditStore|DataGridEditStore" src/` (≥ 3 — 정의 + 사용)
  7. `rg "purgeKey|purgeForConnection" src/stores/tabStore.ts` (≥ 1)
- Required evidence:
  - 변경 / 신규 / 삭제 파일 목록.
  - 7 check stdout 발췌.
  - AC ↔ 파일:라인 매핑.
  - store 본문 인용 (entry key 합성 helper, immutable update).
  - useDataGridEdit 재배선 인용.
  - tabStore wire-up 인용.
  - /tdd 흐름 증거.
  - 가정 / 잔여 위험.

## Evidence To Return

- 변경 파일과 purpose
- Checks run and outcomes (7개)
- Done criteria coverage with evidence
- Assumptions (Hot reload 시 store identity, 동일 키 두 탭 share, undoStack 50 한도 store 환경 보존)
- Residual risk (cross-window, persistence 의도적 제외)

## References

- Spec (master): `docs/sprints/sprint-250/spec.md`
- Contract: `docs/sprints/sprint-251/contract.md`
- Sprint 250 baseline: `docs/sprints/sprint-250/contract.md` + `findings.md`
- Sprint 249 baseline (undoStack pattern): `docs/sprints/sprint-249/contract.md`
- ADR 0022: `docs/archives/decisions/0022-safe-mode-destructive-only-confirm-with-dry-run/memory.md`
- Relevant files:
  - `src/components/datagrid/useDataGridEdit.ts`
  - `src/stores/dataGridEditStore.ts` (신규)
  - `src/stores/tabStore.ts`
  - `src/stores/tabStore/types.ts`
