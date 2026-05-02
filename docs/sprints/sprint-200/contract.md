# Sprint 200 — Contract

Sprint: `sprint-200` (refactor — `DataGridTable.tsx` 1071-line component
분해).
Date: 2026-05-02.
Type: refactor (행동 변경 0; 컴포넌트 재구성).

`docs/PLAN.md` 의 "리팩토링 sequencing (Sprint 199–..., post-198 cycle)"
두 번째 항목. [`/CODE_SMELLS.md`](../../../CODE_SMELLS.md) §1-1 frontend
god file #2 (1071 라인) 의 just-in-time refactor — 다음 feature sprint
가 DataGridTable 에 손댈 때 회귀 risk 를 낮추기 위한 토대. Sprint 199
(`SchemaTree.tsx` 2105 → entry + 5 sub-file) entry-pattern 답습.

## Sprint 안에서 끝낼 단위

- **모듈 구조 신설**: `DataGridTable.tsx` (entry, modern 2018+ 패턴) +
  `DataGridTable/` 하위 디렉토리 6 파일. `DataGridTable.tsx` 자체는
  1071 → 350 줄 미만 modification (git --follow 으로 history 연결).
    - `DataGridTable.tsx` — imports + `DataGridTableProps` interface +
      state/refs (tableRef / editorFocusRef / blobViewer / cellDetail) +
      파생값 (order, totalBodyRowCount, shouldVirtualize) + virtualizer
      wiring + scroll-to-top effect + useDelayedFlag + ctx 빌드 + return
      JSX shell. `parseFkReference` re-export. row renderer / hook /
      header / context menu 를 sub-file 에서 import 한 thin shell.
    - `DataGridTable/columnUtils.ts` — pure: `parseFkReference`,
      `isBlobColumn`, `calcDefaultColWidth`, `MIN_COL_WIDTH`,
      `VIRTUALIZE_THRESHOLD`, `ROW_HEIGHT_ESTIMATE`. **순수 함수만** —
      React import 0, store import 0.
    - `DataGridTable/useCellNavigation.ts` — hook. `useCellNavigation({
      data, order, pendingEdits, onSaveCurrentEdit, onStartEdit })` →
      `{ moveEditCursor }`. Tab/Enter wrap-around 로직.
    - `DataGridTable/useColumnResize.ts` — hook. `useColumnResize({
      tableRef, columnWidths, onColumnWidthsChange })` →
      `{ handleResizeStart }`. resizing ref 내부 보유, mouse drag
      handler 캡슐화.
    - `DataGridTable/contextMenu.tsx` — `useContextMenu()` →
      `{ contextMenu, setContextMenu, handleContextMenu }` +
      `buildContextMenuItems(args): ContextMenuItem[]` (10 items —
      Show Cell Details / Edit Cell / Set to NULL / Delete Row /
      Duplicate Row / separator / Copy as Plain Text · JSON · CSV ·
      SQL Insert).
    - `DataGridTable/DataRow.tsx` — `<DataRow rowIdx ctx />` 컴포넌트 +
      `DataGridRowContext` interface. cell render / 5 mode 분기
      (editing-null / editing-typed / hasPendingEdit / blob / FK link /
      plain) 통째로 흡수. `editorFocusRef` 는 ctx 로 전달 받음.
    - `DataGridTable/HeaderRow.tsx` — `<HeaderRow data order
      columnWidths sorts editingCell onSort onSaveCurrentEdit
      onResizeStart getColumnWidth />` 컴포넌트. `sortMouseStartRef`
      내부 useRef.
- **회귀 0**: 코드 동등성 — `pnpm vitest run` 결과 = pre-split. pre-split
  의 모든 12 DataGridTable.test.tsx (aria-grid / blob-viewer /
  cell-navigation / column-resize / column-sort / context-menu /
  editing-visual / fk-navigation / parseFkReference / refetch-overlay /
  validation-hint / virtualization) 모두 무수정 통과.

## Acceptance Criteria

### AC-200-01 — 단일 1071-line 파일이 7 파일로 분할

- `src/components/datagrid/DataGridTable.tsx` (1071) → 350 줄 미만
  modification (git diff: -700 이상, 동일 path 유지로 `git log --follow`
  추적 가능).
- `src/components/datagrid/DataGridTable/{columnUtils.ts,
  useCellNavigation.ts, useColumnResize.ts, contextMenu.tsx, DataRow.tsx,
  HeaderRow.tsx}` 6 파일 신규.
- 각 파일 700 라인 이하. DataRow.tsx 가 가장 클 가능성 (renderDataRow
  자체가 ~280 라인).

### AC-200-02 — `<DataGridTable>` props / 외부 사용 무변화

- `interface DataGridTableProps` 시그니처 byte-for-byte 동일.
- `export default function DataGridTable(...)` 위치 동일
  (`DataGridTable.tsx` 파일).
- `<DataGridTable />` 를 import 하는 외부 (예:
  `src/components/rdb/DataGrid.tsx:24`) 호출 코드 무수정.

### AC-200-03 — `parseFkReference` named export 보존

- `src/components/datagrid/DataGridTable.parseFkReference.test.ts:24`
  의 `import { parseFkReference } from "@/components/datagrid/DataGridTable"`
  무수정.
- entry 가 `export { parseFkReference } from "./DataGridTable/columnUtils"`
  re-export. `format_fk_reference` (Rust) 와의 contract 무변화 —
  `tests/fixtures/fk_reference_samples.json` 무수정.

### AC-200-04 — sub-file 인터페이스 명시

- `columnUtils.ts` — pure exports. `parseFkReference(ref: string):
  { schema, table, column } | null` + 4 helper / constant. React
  의존성 0.
- `useCellNavigation.ts` — hook export. 내부에서 store hooks subscribe 0,
  args 만 의존.
- `useColumnResize.ts` — hook export. resizing ref 캡슐화. document
  level mouse listener 의 cleanup invariant 유지.
- `contextMenu.tsx` — `useContextMenu()` hook + `buildContextMenuItems`
  pure builder. `<ContextMenu>` 자체는 entry 가 렌더.
- `DataRow.tsx` — `<DataRow>` 컴포넌트 + `DataGridRowContext` interface.
  ctx 객체로 prop drilling 압축.
- `HeaderRow.tsx` — `<HeaderRow>` 컴포넌트. sortMouseStartRef 내부 보유.

### AC-200-05 — 행동 / DOM 동등성

- pre-split 의 12 DataGridTable spec 의 모든 case 가 byte-for-byte
  무수정 통과 (prop pass-through / aria-grid · aria-rowindex ·
  aria-colindex / context menu 10 items / column resize / column sort /
  inline edit 5 mode / FK link icon / BLOB button / virtualization
  paddingTop·paddingBottom spacer / refetch overlay defaultPrevented
  invariant / validation hint 모두 동일 DOM).
- 신규 케이스 가산은 없음 — 본 sprint 는 분해 only.

### AC-200-06 — 회귀 0 + 검증 명령 zero-error

- `pnpm vitest run` — 기존 case 무수정 통과.
- `pnpm tsc --noEmit` 0 / `pnpm lint` 0.
- frontend 변경 only — `cargo` 영역 미수정.

## Out of scope

- **다른 god file 분해** — `QueryTab.tsx` (1040) Sprint 201 후보,
  `tabStore.ts` (1002), `DocumentDataGrid.tsx` (951),
  `useDataGridEdit.ts` (715) 등 — 별도 sprint.
- **DataGridTable 자체 기능 추가** — 신규 cell mode / 신규 ContextMenu
  item / 신규 keyboard shortcut 등. 본 sprint 는 분해 only.
- **renderDataRow 내부 추가 분해** (CellEditor / CellDisplay 분리) —
  reconciliation boundary 변경 risk 로 본 sprint 보류. 후속 sprint
  (FB-4 Quick Look 편집 합류 후, 또는 Sprint 209+) 에서 재검토.
- **§2 (deps suppression) `DataGridTable.tsx:552` 1곳 정리** — Sprint
  207 후보. 본 sprint 에서 같이 안 만짐.
- **CODE_SMELLS §3~7 정리** — Sprint 205+ 후보.

## 검증 명령

```sh
pnpm vitest run src/components/datagrid/DataGridTable.aria-grid.test.tsx \
  src/components/datagrid/DataGridTable.blob-viewer.test.tsx \
  src/components/datagrid/DataGridTable.cell-navigation.test.tsx \
  src/components/datagrid/DataGridTable.column-resize.test.tsx \
  src/components/datagrid/DataGridTable.column-sort.test.tsx \
  src/components/datagrid/DataGridTable.context-menu.test.tsx \
  src/components/datagrid/DataGridTable.editing-visual.test.tsx \
  src/components/datagrid/DataGridTable.fk-navigation.test.tsx \
  src/components/datagrid/DataGridTable.parseFkReference.test.ts \
  src/components/datagrid/DataGridTable.refetch-overlay.test.tsx \
  src/components/datagrid/DataGridTable.validation-hint.test.tsx \
  src/components/datagrid/DataGridTable.virtualization.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
```

기대값: 모두 zero error. baseline 무가산.
