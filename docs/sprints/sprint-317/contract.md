# Sprint 317 Contract (Slice D.1)

> Phase 28 Slice D (Q9+Q10) — Hide column hybrid + 상단 배지 +
> per-collection persist. **Sprint 317 = D.1: Mongo 만**. RDB 는
> Sprint 318 (D.2) 에서 parity.

## Scope

- `useHiddenColumns(persistenceKey?)` hook 신설 — `useColumnWidths`
  패턴 복제. localStorage key prefix `hidden-columns:`. 값은 `string[]`
  (JSON serialize 가능).
- `HeaderRow` context menu 에 "Hide column" item 추가 — 신규 prop
  `onHideColumn?: (column: string) => void`. 미제공 시 item 미노출.
- `DocumentDataGrid` 에 `useHiddenColumns` 호출 (key
  `document:<db>:<coll>`). `visibleOrder` 계산하여 HeaderRow `order`,
  `--cols` template, row cell map 에 일관 적용.
- 상단 배지 — `n columns hidden | Show all` (n > 0 일 때만). 배지는
  DocumentFilterBar 아래 / Toolbar 와 grid 사이에 inline 표시.
- `aria-label="Hidden columns badge"`, `aria-label="Show all hidden
  columns"`.

## Out of Scope (Sprint 318)

- RDB DataGrid 의 hide column 통합 — Sprint 318 에서 같은 hook 재사용
  + DataGridTable + RDB DataGrid 적용.

## Invariants

- 기존 Mongo grid sort / filter / 셀편집 / pagination 회귀 0.
- 기존 column resize / 너비 persist 회귀 0.
- RDB DataGrid 회귀 0 (`onHideColumn` 미주입 → context menu item 미노출).
- `aria-label` 안정성.

## Done Criteria

1. `useHiddenColumns` hook export — load/save/clear localStorage,
   hide/show/toggle/clear API.
2. HeaderRow context menu 에 `Hide column` item — `onHideColumn` 제공
   시만 노출.
3. DocumentDataGrid 가 hide column 적용:
   - context menu hide → 해당 column 즉시 grid 에서 사라짐
   - `--cols` template, row map 도 visible 만
   - localStorage `hidden-columns:document:<db>:<coll>` 에 persist
4. 배지 — `1 column hidden` (singular) / `N columns hidden` 표기,
   `Show all` 버튼 클릭 → 전부 복원.
5. hook + UI RTL ≥ 5 case.
6. `pnpm vitest run` exit 0 / tsc / lint / build 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run src/hooks src/components/document/DocumentDataGrid src/components/datagrid`
  2. `pnpm vitest run`
  3. `pnpm tsc --noEmit && pnpm lint && pnpm build`

## 자율 결정 가이드라인

- **D-Q15** persist 단위 = `document:<db>:<coll>` (column-widths 와
  parallel). **권장 채택**.
- **D-Q16** 배지 위치 — Toolbar 안 vs 그 아래 inline strip vs
  FilterBar 옆. **권장: Toolbar 와 grid 사이 inline strip**.
  filterCount badge 도 비슷한 위치 → consistency.
- **D-Q17** Show all 액션의 즉시 효과 — hidden 전체 비우기 +
  localStorage 도 clear. 사용자 명시적 reset 의도.
- **D-Q18** column 하나만 남는 상태에서 그것도 hide 가능한가? **권장:
  허용**. 단 grid 가 빈 헤더 표시. Show all 로 복원. (방어 코드: 모든
  column hidden → 사용자가 즉시 인식하여 Show all 클릭.) 별도 guard
  추가는 user-hostile.

## Files (예상)

- `src/hooks/useHiddenColumns.ts` (NEW)
- `src/hooks/useHiddenColumns.test.ts` (NEW)
- `src/components/datagrid/DataGridTable/HeaderRow.tsx` — context menu
  item + prop
- `src/components/datagrid/DataGridTable/HeaderRow.contextmenu.test.tsx` 확장
- `src/components/document/DocumentDataGrid.tsx` — hook 호출 + visibleOrder
  + 배지
- `src/components/document/DocumentDataGrid.hide.test.tsx` (NEW)
- `docs/archives/phases/retired/phase-28-decision-log.md` — D-35..D-38
- `docs/sprints/sprint-317/handoff.md`

## Residual Risk

- column 0개 visible 상태 — grid 가 빈 헤더 + 빈 cell. 사용자가
  배지 클릭으로 복원. UX guardrail (예: 최소 1 column) 은 D.2 의
  evaluator 평가 시 결정.
- localStorage quota 초과 — useColumnWidths 와 동일 silent no-op.
- shared HeaderRow context menu 의 item 순서 — Hide 가 sort items 뒤
  separator 다음에 위치 (Clear all 와 함께 묶음 그룹).
