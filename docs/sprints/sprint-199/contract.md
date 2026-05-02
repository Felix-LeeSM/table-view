# Sprint 199 — Contract

Sprint: `sprint-199` (refactor — `SchemaTree.tsx` 2105-line component
분해).
Date: 2026-05-02.
Type: refactor (행동 변경 0; 컴포넌트 재구성).

`docs/PLAN.md` 의 "리팩토링 sequencing (Sprint 199–..., post-198 cycle)"
첫 항목. [`/CODE_SMELLS.md`](../../../CODE_SMELLS.md) §1-1 frontend god
file #1 (2105 라인) 의 just-in-time refactor — 다음 feature sprint 가
SchemaTree 에 손댈 때 회귀 risk 를 낮추기 위한 토대. Sprint 191 (S191
SchemaTree 분해) 이후 Sprint 196 (`handleDropTable` + history source
필드) / Sprint 198 (Mongo 측 평행 작업) 으로 다시 커진 상태 — 본 sprint
가 두 번째 감량.

## Sprint 안에서 끝낼 단위

- **모듈 구조 신설**: `SchemaTree.tsx` (entry, modern 2018+ 패턴) +
  `SchemaTree/` 하위 디렉토리 3~4 파일. `SchemaTree.tsx` 자체는 2105 →
  600 줄 미만 modification (git --follow 으로 history 연결).
    - `SchemaTree.tsx` — imports + props + state/refs + virtualization
      wiring + dispatch + return JSX shell. row renderer / handler / dialog
      을 sub-file 에서 import 한 thin shell.
    - `SchemaTree/treeRows.ts` — `getVisibleRows` + `rowCountLabel` /
      `rowCountText` / `nodeIdToString` + `VisibleRow` / `BuildVisibleRowsArgs`
      types. **순수 함수만** — React import 0, store import 0.
    - `SchemaTree/useSchemaTreeActions.ts` — 12 handler (`handleExpandSchema`
      / `handleTableClick` / `handleTableDoubleClick` / `handleOpenStructure`
      / `handleDropTable` / `handleStartRename` / `handleConfirmRename` /
      `handleViewClick` / `handleOpenViewStructure` /
      `handleFunctionClick` / `handleRefresh` / `handleRefreshSchema`) +
      `confirmDialog` / `renameDialog` 관련 state + `addHistoryEntry`
      selector subscription. hook 시그니처: `useSchemaTreeActions({
      connectionId })` → `{ confirmDialog, setConfirmDialog, renameDialog,
      ..., handleDropTable, handleConfirmRename, ... }`.
    - `SchemaTree/rows.tsx` — `renderSchemaRow` / `renderCategoryRow` /
      `renderItemRow` 3 row renderer + 행 렌더러용 ContextMenu wrap.
      virtualizer 와 eager path 양쪽이 import.
    - `SchemaTree/dialogs.tsx` — `<DropTableConfirmDialog>` +
      `<RenameTableDialog>` 두 컴포넌트. props: `confirmDialog` /
      `setConfirmDialog` / `isOperating` 등 hook 결과 직접 받음.
- **회귀 0**: 코드 동등성 — `pnpm vitest run` 결과 = pre-split (frontend
  187 files / 2729 tests). pre-split 의 모든 SchemaTree.test.tsx /
  preview.test.tsx / virtualization.test.tsx / dbms-shape.test.tsx /
  rowcount.test.tsx / preview.entrypoints.test.tsx 6 spec 모두 무수정
  통과.

## Acceptance Criteria

### AC-199-01 — 단일 2105-line 파일이 5 파일로 분할

- `src/components/schema/SchemaTree.tsx` (2105) → 600 줄 미만 modification
  (git diff: -1500 이상, 동일 path 유지로 `git log --follow` 추적 가능).
- `src/components/schema/SchemaTree/{treeRows.ts, useSchemaTreeActions.ts,
  rows.tsx, dialogs.tsx}` 4 파일 신규.
- 각 파일 700 라인 이하. `treeRows.ts` 가 가장 클 가능성 (getVisibleRows
  자체가 ~170 라인).

### AC-199-02 — `SchemaTree` props / 외부 사용 무변화

- `interface SchemaTreeProps` 시그니처 동일 (`connectionId: string`).
- `export default function SchemaTree(...)` 위치 동일 (`SchemaTree.tsx`
  파일).
- `<SchemaTree />` 를 import 하는 외부 (예: `SchemaPanel.tsx`,
  `MainArea.tsx`) 호출 코드 무수정.

### AC-199-03 — sub-file 인터페이스 명시

- `treeRows.ts` — pure exports. `getVisibleRows(args: BuildVisibleRowsArgs):
  VisibleRow[]` + 타입 + 3 helper 함수. React 의존성 0.
- `useSchemaTreeActions.ts` — hook export. `useSchemaTreeActions({
  connectionId, treeShape }): { ... }`. 내부에서 store hooks subscribe,
  `addHistoryEntry` 도 selector 구독 (직접 `getState()` 금지 — sprint
  196 의 store-coupling 정책).
- `rows.tsx` — named exports. `renderSchemaRow(row, ctx): JSX.Element`,
  `renderCategoryRow(row, ctx): JSX.Element`, `renderItemRow(row, ctx):
  JSX.Element`. `ctx` 는 `{ handleTableClick, handleDropTable, ... }`
  의 묶음.
- `dialogs.tsx` — `<DropTableConfirmDialog>` + `<RenameTableDialog>` 두
  컴포넌트.

### AC-199-04 — 행동 / DOM 동등성

- pre-split 의 SchemaTree.test.tsx 외 5 spec 의 모든 case 가 byte-for-byte
  무수정 통과 (prop pass-through / aria-* / context menu / search filter /
  virtualization threshold 모두 동일 DOM).
- 신규 케이스 가산은 없음 — 본 sprint 는 분해 only. SchemaTree 자체에
  새 기능 추가는 OOS.

### AC-199-05 — 후속 sprint 진입 단순화

- 다음에 SchemaTree 에 손대는 sprint (sprint-200 또는 후속) 가 (a) 신규
  handler 추가 시 `useSchemaTreeActions.ts` 만 수정, (b) 신규 row 종류
  추가 시 `rows.tsx` + `treeRows.ts` (VisibleRow union 확장) 만 수정,
  (c) dialog 추가 시 `dialogs.tsx` 만 수정. `SchemaTree.tsx` entry 는
  thin shell 로 거의 unchanged 유지.

### AC-199-06 — 회귀 0 + 검증 명령 zero-error

- `pnpm vitest run` — 기존 case 무수정 통과.
- `pnpm tsc --noEmit` 0 / `pnpm lint` 0.
- frontend 변경 only — `cargo` 영역 미수정.

## Out of scope

- **다른 god file 분해** — `DataGridTable.tsx` (1071) / `QueryTab.tsx`
  (1040) / `tabStore.ts` (1002) 등 — Sprint 201 / 203 후보.
- **SchemaTree 자체 기능 추가** — 신규 ContextMenu item / 신규 검색
  필터 등. 본 sprint 는 분해 only.
- **getVisibleRows 의 알고리즘 변경** — 현재 nested loop 그대로 유지.
  성능 최적화는 별도 sprint.
- **CODE_SMELLS §2~7 정리** — Sprint 205+ 후보. SchemaTree 가 §2 (deps
  억제) 1곳을 가지지만 본 sprint 에서 같이 안 만짐.

## 검증 명령

```sh
pnpm vitest run src/components/schema/SchemaTree.test.tsx \
  src/components/schema/SchemaTree.preview.test.tsx \
  src/components/schema/SchemaTree.virtualization.test.tsx \
  src/components/schema/SchemaTree.dbms-shape.test.tsx \
  src/components/schema/SchemaTree.rowcount.test.tsx \
  src/components/schema/SchemaTree.preview.entrypoints.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
```

기대값: 모두 zero error. baseline (frontend 187 files / 2729 tests) 무가산.
