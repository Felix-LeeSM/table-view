# Sprint 316 Execution Brief (Slice C.2 — Slice C FINAL)

## Objective

Column header 우클릭 → context menu 노출 (6 item). RDB + Mongo 둘 다
paradigm-shared `HeaderRow` 사용 → 한 곳 변경으로 두 grid 동시 노출.
Slice C 마감.

## Task Why

Q8 lock 의 두 번째 deliverable. plain click / shift+click 외에 명시적
discoverable interaction 이 필요 — TablePlus 사용자가 우클릭 의존.
discoverability + 명시적 sort 의 두 가지 가치.

## Scope Boundary

수정:
- `src/components/datagrid/DataGridTable/HeaderRow.tsx`
- `src/components/datagrid/DataGridTable/HeaderRow.test.tsx` 신설/확장
- `src/components/rdb/DataGrid.tsx`
- `src/components/document/DocumentDataGrid.tsx`
- `src/components/document/DocumentDataGrid.sort.test.tsx` 확장 또는
  신규 contextmenu test
- `docs/archives/phases/retired/phase-28-decision-log.md` (D-32..D-34)
- `docs/sprints/sprint-316/handoff.md`

미변경:
- Backend
- FilterBar / DocumentFilterBar
- Toolbar / DataGridToolbar
- 셀편집

## Invariants

- 기존 click / shift+click sort mechanic 회귀 0
- HeaderRow 의 기존 prop shape 유지 (신규는 optional)
- FilterBar 동작 0
- 셀편집 mechanic 0

## Done Criteria

1. HeaderRow 가 ContextMenu wrap + 3 신규 callback prop
2. 6 menu item
3. RDB + Mongo 각 grid 가 callback wire
4. RTL — 6 item 각각 click → callback 호출
5. 기존 mechanic 회귀 0
6. `pnpm vitest run` / tsc / lint / build exit 0

## Verification Plan

- Profile: `command`
- 실행:
  1. `pnpm vitest run src/components/datagrid src/components/document/DocumentDataGrid src/components/rdb/DataGrid`
  2. `pnpm vitest run` 전체
  3. `pnpm tsc --noEmit && pnpm lint && pnpm build`
- Evidence:
  - 변경 파일 + 목적
  - 신규 RTL + assertion
  - baseline 3631 → 신규
  - 자율 D-32..D-34
