# Sprint 316 Contract (Slice C.2 — Slice C FINAL)

> Phase 28 Slice C (Q8) FINAL. Column header right-click context menu.
> RDB + Mongo 둘 다 paradigm-shared HeaderRow 사용 → 한 곳 변경으로
> 두 grid 동시 노출.

## Scope

- `HeaderRow` 컴포넌트가 column header 를 Radix `ContextMenu` 로 wrap.
  6 item:
  1. Sort ASC
  2. Sort DESC
  3. Add to sort ASC (multi-key)
  4. Add to sort DESC (multi-key)
  5. Clear sort for this column
  6. Clear all sorts
- HeaderRow 신규 callback 3개:
  - `onSortColumn(column, direction, append)` — 명시적 sort 적용.
  - `onClearColumnSort(column)` — 해당 column 만 제거.
  - `onClearAllSorts()` — 전체 초기화.
- RDB `DataGrid` 와 Mongo `DocumentDataGrid` 가 각자 helper 작성하여
  HeaderRow 에 전달.
- RTL — context menu open + item click → callback 호출 단언.

## Out of Scope

- Hide column (Slice D — Sprint 317+)
- Pin column (미구현, 별 slice 후보)
- workspaceStore.tab.sorts 통합 (cross-session persist) — 별
  sub-sprint
- Column reorder

## Invariants

- 기존 click / shift+click sort mechanic (Sprint 315 까지 lock 한)
  회귀 0.
- `HeaderRow` 의 기존 props (`data`/`order`/`sorts`/`editingCell`/
  `onSort`/`onSaveCurrentEdit`/`onResizeStart`) shape 유지. 신규는
  optional.
- RDB FilterBar / DocumentFilterBar 동작 0 영향.
- 셀 편집 mechanic 0 영향.

## Done Criteria

1. `HeaderRow` 이 ContextMenuTrigger 로 column header wrap.
2. 신규 callback 3개 prop 추가 (optional).
3. RDB DataGrid 가 callback 구현 + HeaderRow 에 전달.
4. DocumentDataGrid 가 callback 구현 + HeaderRow 에 전달.
5. 6 menu item 각각 클릭 시 정확한 callback 호출 단언 (RTL).
6. 기존 sort click/shift+click 회귀 0.
7. `pnpm vitest run` exit 0 / `tsc` / `lint` / `build` 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run src/components/datagrid src/components/document/DocumentDataGrid src/components/rdb/DataGrid`
  2. `pnpm vitest run`
  3. `pnpm tsc --noEmit && pnpm lint && pnpm build`
- Required evidence:
  - 변경 파일 + 목적
  - 신규 RTL + assertion
  - baseline 3631/10 → 신규
  - 자율 D-32..D-34

## 자율 결정 가이드라인

- **D-Q12** "Sort ASC" 가 (a) 명시적 ASC override (현재 sort 와 무관)
  vs (b) toggle (current ASC → no-op). **권장: (a) override**. 근거:
  context menu 는 명시적 user intent. toggle 동작은 plain click 으로
  이미 제공.
- **D-Q13** "Add to sort" 는 append vs replace? **권장: append (현재
  sorts 의 끝에 추가)**. 기존 sort 의 priority 변경 없음. user intent
  명확.
- **D-Q14** "Clear sort" 는 정확히 무엇을 지우는가 — column 별 vs
  전체? **권장: 둘 다**. menu item 2개 분리 ("Clear sort for this
  column" / "Clear all sorts").

## Files (예상)

- `src/components/datagrid/DataGridTable/HeaderRow.tsx` — ContextMenu
  wrap + 3 신규 prop
- `src/components/datagrid/DataGridTable/HeaderRow.test.tsx` (없으면
  신설) — context menu RTL
- `src/components/rdb/DataGrid.tsx` — helper + prop wire
- `src/components/document/DocumentDataGrid.tsx` — helper + prop wire
- `src/components/document/DocumentDataGrid.sort.test.tsx` 확장 또는
  신규 `DocumentDataGrid.contextmenu.test.tsx`
- `docs/phases/phase-28-decisions.md` — D-32..D-34
- `docs/sprints/sprint-316/handoff.md`

## Residual Risk

- Radix ContextMenu 의 portal 이 jsdom test 에서 가시성 영향 — fireEvent
  으로 우회. test 작성 시 검증.
- header 의 click handler 와 contextmenu 의 trigger 가 충돌 (예:
  primary click 이 context menu 도 열음) 가능성 — Radix 가 separately
  handle, 단 통합 테스트로 확인.
- context menu 의 items 가 늘어나면 시각적 grouping (separator) 필요
  — separator 1 개로 sort 그룹 / clear 그룹 분리.
