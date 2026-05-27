# Sprint Execution Brief: sprint-250

## Objective

DataGrid cell 편집 종료를 두 가지 손가락 동작으로 통일:
- input blur (다른 cell / toolbar / 빈 영역 클릭) → 기존 Tab/Enter 와 동일한
  commit (saveCurrentEdit 라우팅).
- grid 영역 Esc → 모든 pending 폐기 (handleDiscard), 단 modal 열려있으면
  modal Esc 우선, cell editor 안에서는 cell-cancel 만 발동.

## Task Why

기존 동작은 commit 하려면 다른 cell 을 명시적으로 클릭하거나 Tab/Enter 를
눌러야 했음 — TablePlus/DBeaver 의 자연스러운 손가락 동작 (빈 공간 클릭 =
저장, Esc = 모두 버림) 과 어긋나 사용자가 "내 변경이 저장됐나?" 를 매번
확인해야 했다. Sprint 250 은 ADR 0022 Phase 5 의 Cmd+Z 안전망과 짝을 이루는
*입력-종료* 의 일관성 보강 — Cmd+Z 가 commit 전 안전망이라면 onBlur/Esc 는
commit 전 결정 흐름의 마무리.

## Scope Boundary

- 변경: `useDataGridEdit` (onBlur commit 진입점 활용 / 보강), `DataGridTable`
  의 활성 cell input 에 onBlur 부착, `DataGrid.tsx` 의 window Esc keydown
  listener (modal-aware).
- 변경 금지:
  - Sprint 251 의 store-lift (4 슬라이스가 여전히 useState 로 컴포넌트 local).
  - Sprint 252 의 PreviewDialog polish.
  - DDL editor / raw query grid (별도 form state).
  - `decideSafeModeAction` / SafeModeStore / dry-run IPC / dialog 본문.
  - `handleExecuteCommit` / commit-path.
  - Mongo grid read-only invariant.
  - Cmd+Z (Sprint 249) handler 동작.

## Invariants

- `useDataGridEdit` returned 30+ 필드 보존 (`saveCurrentEdit` /
  `handleDiscard` / `cancelEdit` / `pendingEdits` / `pendingNewRows` /
  `pendingDeletedRowKeys` / `undoStack` / `canUndo` / `undo` 모두).
- Sprint 249 9 개 undo AC + 모든 이전 sprint 가드 (AC-185-* ~ AC-249-*) 보존.
- editor-local Esc (cell input 안) 동작 보존 — `cancelEdit` 만 발동.
- Modal Esc-close (Radix Dialog native) 우선.
- IPC / safeModeStore / persistence 변경 0.

## Done Criteria

1. cell input onBlur → saveCurrentEdit 라우팅 (값 변경 시 commit, no-op 시 skip).
2. window keydown 의 Esc → editor 안 / modal 존재 시 미발동, 그 외 handleDiscard.
3. AC-250-01..06 모두 테스트로 매핑.
4. /tdd 흐름: 신규 테스트가 먼저 작성됐음을 handoff 에 한 줄로 명시.
5. Verification Plan 7개 check 모두 pass.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm tsc --noEmit` (0 errors)
  2. `pnpm lint` (0 / 0)
  3. `pnpm vitest run` (전체 통과 + AC-250 매핑 증거)
  4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` (회귀)
  5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  6. `rg "onBlur" src/components/datagrid/DataGridTable.tsx src/components/datagrid/DataGridTable/` (≥ 1)
  7. `rg "Escape" src/components/rdb/DataGrid.tsx` (≥ 1)
- Required evidence:
  - 변경 / 신규 / 삭제 파일 목록 + 1줄 의도.
  - 7 check stdout 발췌.
  - AC ↔ 파일:라인 매핑.
  - onBlur handler / Esc keydown handler 본문 인용.
  - /tdd 흐름 증거.
  - 가정 / 잔여 위험.

## Evidence To Return

- 변경 파일과 purpose
- Checks run and outcomes (7개)
- Done criteria coverage with evidence
- Assumptions (브라우저 blur ordering, dialog selector 한계 등)
- Residual risk or verification gaps

## References

- Spec (master): `docs/sprints/sprint-250/spec.md`
- Contract: `docs/sprints/sprint-250/contract.md`
- Sprint 249 baseline (Cmd+Z 패턴): `docs/sprints/sprint-249/contract.md`
- ADR 0022: `docs/archives/decisions/0022-safe-mode-destructive-only-confirm-with-dry-run/memory.md`
- Relevant files:
  - `src/components/datagrid/useDataGridEdit.ts`
  - `src/components/datagrid/DataGridTable.tsx` (또는 분리된 row-component)
  - `src/components/rdb/DataGrid.tsx`
  - `src/components/datagrid/DataGridToolbar.tsx` (변경 없음, Discard 버튼은
    동일 동작 마우스 진입점)
