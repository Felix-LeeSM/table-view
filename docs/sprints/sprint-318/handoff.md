# Sprint 318 Handoff — Slice D.2 (RDB DataGrid Hide Column)

## Status: PASS

## Scope completed

Sprint 317 D.1 의 Mongo hide column 기능을 RDB `DataGrid` /
`DataGridTable` 에도 적용.

- `DataGridTable` 가 `hiddenColumnNames?: ReadonlySet<string>` +
  `onHideColumn?: (col: string) => void` 두 신규 optional prop 수용.
  내부 `order` 가 hidden filter 적용 (`useMemo` 로 stable identity).
  미제공 시 회귀 0.
- HeaderRow 의 `onHideColumn` 을 `DataGridTable` 가 forward (Sprint 317
  의 HeaderRow 신규 prop 활용).
- RDB `DataGrid` 가 `useHiddenColumns('rdb:<schema>:<table>')` 호출,
  Toolbar 와 grid 사이 inline strip 으로 배지 + Show all 노출
  (DocumentDataGrid 와 동일 마크업).

## Files changed

| 파일 | 종류 | 변경 |
|------|------|------|
| `src/components/datagrid/DataGridTable.tsx` | edit | `hiddenColumnNames` + `onHideColumn` prop, visible order, HeaderRow wire |
| `src/components/datagrid/DataGridTable.hide.test.tsx` | NEW | 6 case |
| `src/components/rdb/DataGrid.tsx` | edit | `useHiddenColumns` 호출, 배지 strip, DataGridTable wire |
| `src/components/rdb/DataGrid.hide.test.tsx` | NEW | 5 case |
| `docs/archives/phases/retired/phase-28-decision-log.md` | edit | D-39..D-42 append |
| `docs/sprints/sprint-318/contract.md` | NEW | sprint contract |
| `docs/sprints/sprint-318/execution-brief.md` | NEW | execution brief |
| `docs/sprints/sprint-318/handoff.md` | NEW | 본 문서 |

## Per-Done-Criterion evidence

1. **신규 prop 수용** — `DataGridTable.tsx:80-93` (선언) +
   `DataGridTable.hide.test.tsx` 의 case 1 ("renders every column
   when hiddenColumnNames is not provided") 가 회귀 가드.
2. **미제공 시 회귀 0** — vitest full sweep 3668 pass (baseline
   3657 → +11 신규). 기존 axis test (sort/aria-grid/column-sort
   etc.) 무수정.
3. **hidden column drop** — DataGridTable.hide.test.tsx 의 case 2
   ("drops hidden columns from the header row") + case 3 ("drops
   hidden cells from each body row and updates aria-colcount") +
   case 5 ("drops hidden columns from pendingNewRows too").
4. **--cols template** — case 3 의 `cols.split(/\s+/)` 길이 단언
   (visible count 와 동일).
5. **RDB wire + 배지** — DataGrid.hide.test.tsx 의 case 2 ("Hide
   column removes the column from the grid and surfaces a badge").
6. **localStorage persist** — DataGrid.hide.test.tsx 의 case 3
   ("persists hidden columns under hidden-columns:rdb:<schema>:<table>")
   + case 5 ("loads persisted hidden columns on mount") + case 4
   의 wipe 단언.
7. **≥ 5 RTL/unit** — DataGridTable 6 + DataGrid 5 = **11 신규 case**.
8. **tsc / lint / build / vitest exit 0** — 아래 "Checks run".

## Checks run

- `pnpm vitest run src/components/datagrid/DataGridTable.hide.test.tsx`
  → 6/6 pass.
- `pnpm vitest run src/components/rdb/DataGrid.hide.test.tsx` → 5/5 pass.
- `pnpm vitest run` → **297 files, 3668 pass / 10 skip / 0 fail**.
- `pnpm tsc --noEmit` → exit 0.
- `pnpm lint` → exit 0.
- `pnpm build` → exit 0 (Vite 빌드 성공, 신규 경고 없음).

## Autonomous decisions (recorded in `docs/archives/phases/retired/phase-28-decision-log.md`)

- **D-39**: RDB hide column persist 단위 = `hidden-columns:rdb:<schema>:<table>`
  (column-widths 와 namespace 공유).
- **D-40**: visible filter 책임 = `DataGridTable` 안 (caller 는 prop 만
  전달).
- **D-41**: 배지 마크업은 Mongo 와 1:1 — paradigm 간 UX uniformity.
- **D-42**: 두 신규 prop 모두 optional — 기존 caller 회귀 0.

## Out of scope (deferred)

- raw query result grid (`EditableQueryResultGrid`) 의 hide.
- per-column show popover.
- column reorder 와의 상호작용 강화 (현재는 hidden 이 reorder 보다
  먼저 filter 적용 → reorder 가 hidden index 를 referenced 하지 않음).

## Residual risk

- Mongo D.1 과 동일 — 0 column visible 도 허용. Show all lifeline 이
  안전망.
- columnOrder 변경 + hide 동시 인터랙션 — `order` memo 의 dep 가
  `[baseOrder, hiddenColumnNames, data.columns]` 라 양쪽 변경에 모두
  반응. 다만 edge case (예: hide 후 reorder 시도) 의 UX 는 후속
  sprint 에서 별도 평가 필요.
- D-40 의 책임 분기는 paradigm-shared shell 에 hide 결합 — 향후 다른
  paradigm 이 `DataGridTable` 채택 시 자동 혜택. 그러나 Document
  paradigm 의 inline render 가 별도 implementation 으로 남음 — 두
  구현이 미래에 분기 가능.
