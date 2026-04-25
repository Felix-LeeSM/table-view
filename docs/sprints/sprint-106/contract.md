# Sprint Contract: sprint-106

## Summary
- Goal: DataGridTable 의 `<table>` 에 `role="grid"`, header 의 `<tr>`/`<th>` 에 `role="row"`/`role="columnheader"`, body `<tr>`/`<td>` 에 `role="row"`/`role="gridcell"` + `aria-rowindex`/`aria-colindex` 부여. 정렬/필터 변경 시에도 인덱스 정확.
- Profile: `command`

## In Scope
- `src/components/datagrid/DataGridTable.tsx`:
  - `<table>` (line 492): `role="grid"`, `aria-rowcount={data.rows.length + pendingNewRows.length + 1}` (header 포함), `aria-colcount={data.columns.length}`.
  - thead `<tr>` (line 497): `role="row"` + `aria-rowindex={1}`.
  - thead `<th>` (line 503): `role="columnheader"` + `aria-colindex={visualIdx + 1}`.
  - tbody `<tr>` (line 576): `role="row"` + `aria-rowindex={rowIdx + 2}` (header 가 1).
  - tbody `<td>` (line 611): `role="gridcell"` + `aria-colindex={visualIdx + 1}`.
  - empty-state `<tr>`/`<td>` (line 853-878): `role="row"` + `role="gridcell"` (colSpan 유지). aria-rowindex 는 안 부여 (헤더 후 1행 빈 자리).
  - pendingNewRows `<tr>`/`<td>` (line 881-901): `role="row"` + `aria-rowindex={data.rows.length + 1 + newIdx + 1}`, `<td>` 는 `role="gridcell"` + `aria-colindex={visualIdx + 1}`.
- 테스트 추가:
  - 컨테이너 `role="grid"`.
  - 헤더 `<th>` 의 `role="columnheader"` + `aria-colindex` 1..N.
  - body `<td>` 의 `role="gridcell"` + `aria-colindex`.
  - body `<tr>` 의 `aria-rowindex` 가 (header 1) + (data idx 시작 2).
  - 정렬 후 `aria-rowindex` 가 visual order 따라 2..N+1 유지 (rowIdx 는 정렬된 순서, ARIA 는 visual position).
  - column reorder 후 `aria-colindex` 가 visual 순서 따라감.

## Out of Scope
- 키보드 셀 네비게이션 (Tab/Arrow grid navigation) — 별도 sprint.
- `aria-selected` on row.
- header `aria-sort` (이미 sprint-? 다른 곳에서 처리될 수 있음 — 본 sprint 는 role/index 만).

## Invariants
- 회귀 0 (1775 통과 유지).
- 셀 이벤트 핸들러 (onClick, onContextMenu 등) 유지.
- DataGrid 시각적 출력 동일.

## Acceptance Criteria
- AC-01: `<table>` element has `role="grid"`.
- AC-02: header `<tr>` has `role="row"` + `aria-rowindex="1"`. 모든 `<th>` 가 `role="columnheader"` + `aria-colindex=1..N`.
- AC-03: body `<tr>` (rowIdx 0..N-1) 에 `role="row"` + `aria-rowindex=2..N+1`.
- AC-04: body `<td>` 에 `role="gridcell"` + `aria-colindex=1..M`.
- AC-05: column reorder (visualIdx 가 dIdx 와 다른 경우) 시 aria-colindex 가 visual 순서 따라감.
- AC-06: pendingNewRows 가 있으면 그들의 `<tr>` 도 `role="row"` + 적절한 aria-rowindex.
- AC-07: 회귀 0.

## Verification Plan
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Exit Criteria
- All checks pass + AC-01..07 evidence in handoff.md.
