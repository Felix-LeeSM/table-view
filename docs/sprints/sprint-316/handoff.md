# Sprint 316 Generator Handoff (Slice C.2 — Slice C FINAL)

> Phase 28 Slice C 마감. Column header right-click context menu —
> paradigm-shared `HeaderRow` 한 곳 변경으로 RDB+Mongo 양쪽 grid 자동
> 노출.

## Changed files

- `src/components/datagrid/DataGridTable/HeaderRow.tsx`:
  - `Radix ContextMenu` import + 6 item wrap.
  - 신규 prop 3개 (optional): `onSortColumn`, `onClearColumnSort`,
    `onClearAllSorts`.
  - `hasContextMenu` 분기 — 셋 모두 미제공 시 plain header 렌더 (기존
    회귀 0).
  - disabled state 처리 (D-34).
- `src/components/datagrid/DataGridTable.tsx`: 3 신규 prop forwarding.
- `src/components/rdb/DataGrid.tsx`:
  - `handleSortColumn` (D-32 override) / `handleClearColumnSort` /
    `handleClearAllSorts` 3 helper.
  - `DataGridTable` 에 prop wire.
- `src/components/document/DocumentDataGrid.tsx`:
  - 같은 3 helper.
  - `HeaderRow` 에 prop wire.
- `src/components/datagrid/DataGridTable/HeaderRow.contextmenu.test.tsx`
  (NEW) — 10 case.
- `docs/phases/phase-28-decision-log.md` — D-32..D-34 append.

## Per-AC evidence

- **AC-01** HeaderRow Radix wrap — `HeaderRow.tsx` 의 `hasContextMenu`
  분기.
- **AC-02** 3 신규 callback prop — `HeaderRowProps` interface.
- **AC-03** RDB DataGrid wires — `handleSortColumn` 등 helper +
  `DataGridTable` prop.
- **AC-04** DocumentDataGrid wires — 동일 helper + `HeaderRow` prop.
- **AC-05** 6 menu item — RTL "opens a 6-item menu".
- **AC-06** 기존 click/shift+click mechanic 회귀 0 — 기존 RDB
  `DataGridTable.column-sort.test.tsx` + Mongo `DocumentDataGrid.sort.test.tsx`
  통과 (495 passed in 48 files).
- **AC-07** `pnpm vitest run` **3641 passed / 10 skipped** (baseline
  3631 → +10). exit 0.
- **AC-08** tsc / lint / build exit 0.

## Verification Plan execution

- Profile: `command`
- 실행:
  1. `pnpm vitest run src/components/datagrid src/components/document/DocumentDataGrid src/components/rdb/DataGrid`
     → 48 files / 495 tests passed.
  2. `pnpm vitest run` → 293 files / 3641 passed / 10 skipped.
  3. `pnpm tsc --noEmit` → exit 0.
  4. `pnpm lint` → exit 0.
  5. `pnpm build` → exit 0.

## Autonomous decisions

- **D-32** "Sort ASC" 는 명시적 override (toggle 아님).
- **D-33** HeaderRow 한 곳에 mount, 3 callback 으로 분리. paradigm-
  shared.
- **D-34** disabled state — 의미 없는 액션은 click 차단 + 시각 신호.

## Tests added (10)

1. context menu 없는 경우 plain header (회귀 가드)
2. 6 item 노출
3. Sort ASC → `(col, "ASC", false)`
4. Sort DESC → `(col, "DESC", false)`
5. Add to sort ASC → `(col, "ASC", true)`
6. Add to sort DESC → `(col, "DESC", true)`
7. Clear column sort → `(col)`
8. Clear all sorts → `()`
9. Clear column disabled when not sorted
10. Clear all disabled when sorts empty

## Checks run

- vitest 3641 (+10), 회귀 0
- tsc / lint / build 0

## Residual risk

- **Slice C 종료** — C.1 (Mongo sort wire-up, sprint-315) + C.2
  (context menu, 본 sprint) = Q8 ("Multi-column + column header
  context menu (RDB+Mongo)") 결정 완료.
- workspaceStore.tab.sorts 통합 (collection tab cross-session
  persist) 여전히 deferred — D-29 의 별 sub-sprint 가치 재평가 필요.
- RDB FilterBar 의 Match ALL/ANY toggle (Slice B.2 의 D-27) 통합도
  여전히 별 sub-sprint 후보 — RDB query builder 가 `$or` equivalent
  지원해야 함.
- column reorder 미지원 (RDB+Mongo 둘 다). Slice C 의 범위 밖.

## Persisted handoff

본 보고서 — `docs/sprints/sprint-316/handoff.md`.
