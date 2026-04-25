# Sprint Contract: sprint-114

## Summary
- Goal: DataGridTable 의 tbody 를 viewport 기반 가상화로 전환. page size 1000 에서도 DOM 행 수 ≤ 100 유지. ARIA 속성 (rowindex/colindex) 정확도 유지. 기존 73 DataGrid 테스트 회귀 0.
- Profile: `command`

## In Scope
- `@tanstack/react-virtual` (^3.x) 의존성 추가.
- `src/components/datagrid/DataGridTable.tsx`:
  - 행 수 > VIRTUALIZE_THRESHOLD (200) 일 때 가상화 활성화. 그 이하는 기존 렌더 유지 (회귀 0 보장).
  - `useVirtualizer` 로 visible row index 산출.
  - tbody 가 `transform: translateY(...)` 또는 `padding-top/bottom` spacer 패턴으로 가상 행을 보존.
  - aria-rowindex 는 가상화 후에도 글로벌 인덱스 (visible 행의 실 rowIdx + 2) 로 정확히 유지.
  - selectedRowIds, pendingEdits, contextMenu, FK ref, BLOB 셀 등 기존 cell 기능 보존.
- 테스트:
  - `src/components/datagrid/DataGridTable.virtualization.test.tsx` (신규):
    - page size 1000 의 mock 데이터로 렌더 → DOM `<tr role="row">` (header 제외) 개수 ≤ 100.
    - 첫 행 / 마지막 행이 viewport 내라고 가정한 시나리오 → 해당 인덱스의 row 가 DOM 에 존재.
    - sort/filter 변경 시 viewport 재계산 → scroll position reset 또는 첫 행이 보임.
    - aria-rowindex 정확도 (가상화 후에도).
  - 기존 `DataGrid.test.tsx` 와 `DataGridTable.aria-grid.test.tsx` 회귀 0 (작은 데이터셋이라 가상화 path 미발동).
- jsdom polyfill: `Element.prototype.scrollTo`, `IntersectionObserver` (필요 시), `ResizeObserver` mock (필요 시) — `src/test-setup.ts` 추가.

## Out of Scope
- 컬럼 가상화 (수평).
- Variable row height (heterogeneous).
- Infinite scroll / 동적 로딩.
- DocumentDataGrid 가상화 (별도 sprint).

## Invariants
- 1815 baseline tests 회귀 0 (15 신규 contrast + 1799 기존 + 0 회귀 = 1815, 신규 가상화 테스트 추가 시 1815 + N).
- ARIA: `role="grid"`, `aria-rowcount`, `aria-rowindex`, `role="gridcell"`, `aria-colindex` 정확.
- 셀 편집 / 컨텍스트 메뉴 / FK ref / pending edits / BLOB 처리 동작 유지.
- 정렬 / 필터 / page size 변경 / column resize 동작 유지.

## Acceptance Criteria
- AC-01: page size 1000 mock 데이터로 렌더 시 `screen.getAllByRole("row")` 길이 ≤ 100 + 1 (header).
- AC-02: 정렬 변경 후 첫 행 (rowIdx=0) 의 td 가 DOM 에 존재 (= viewport reset 검증).
- AC-03: 가상화된 행의 `aria-rowindex` 가 실 rowIdx + 2 일치 (visible row 의 첫번째 행이 글로벌 1 행이면 aria-rowindex=2).
- AC-04: 행 수 ≤ 200 (기존 테스트 데이터셋) 인 경우 가상화 path 미발동, 모든 행이 DOM 에 존재 (기존 테스트 회귀 0).
- AC-05: 1815+ vitest 통과, tsc/lint 0.
- AC-06: 회귀 0.

## Verification Plan
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Exit Criteria
- All checks pass + AC-01..06 evidence in handoff.md.
