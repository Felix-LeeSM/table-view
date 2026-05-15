# Sprint 318 Contract — Slice D.2 (RDB DataGrid Hide Column)

## Scope

Sprint 317 D.1 의 Mongo hide column 기능을 RDB `DataGrid` /
`DataGridTable` 에도 적용 (paradigm parity).

`useHiddenColumns` hook 은 이미 존재. RDB 측에서 (a) DataGridTable
에 visible-column filter 도입, (b) RDB DataGrid 가 hook 호출 + 배지
mount, (c) HeaderRow 가 이미 갖는 `onHideColumn` 을 wire.

## Done Criteria

1. `DataGridTable` 가 `hiddenColumnNames?: ReadonlySet<string>` +
   `onHideColumn?: (col: string) => void` 두 신규 optional prop 수용.
2. 미제공 시 회귀 0 — 기존 RDB grid 테스트가 그대로 통과.
3. 제공 시 hidden column 이 (a) HeaderRow 에서 (b) DataRow 에서
   (c) pendingNewRows 에서 모두 drop, `aria-colcount` 도 visible 수.
4. `--cols` CSS template 도 visible 만 포함 (남은 column 폭 보존).
5. RDB `DataGrid` 가 `useHiddenColumns('rdb:<schema>:<table>')` 호출,
   배지 strip + Show all 노출 (DocumentDataGrid 와 동일 마크업).
6. Hide 액션 후 localStorage `hidden-columns:rdb:<schema>:<table>` 에
   persist.
7. ≥ 5 RTL/unit case (DataGridTable visible-filter 단위 + RDB DataGrid
   E2E-style RTL).
8. tsc / lint / build / vitest exit 0.

## Out of Scope

- per-column show popover.
- column reorder 와의 상호작용 (이미 columnOrder 가 있지만 본 sprint
  는 hidden filter 만 추가).
- raw query result grid (`EditableQueryResultGrid`) 의 hide — 후속
  sprint.

## Invariants

- 기존 RDB DataGrid / DataGridTable / DataRow 테스트 회귀 0.
- 기존 column widths localStorage 호환.
- HeaderRow / context menu (sprint-316) 동작 유지.

## Verification Plan

- Profile: `command`
- Required checks: `pnpm vitest run`, `pnpm tsc --noEmit`,
  `pnpm lint`, `pnpm build`.
- Required evidence: 변경 파일 리스트, 신규 RTL/unit 케이스 수, 전체
  test count.
