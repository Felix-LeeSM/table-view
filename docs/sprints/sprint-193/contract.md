# Sprint 193 — Contract

Sprint: `sprint-193` (`useDataGridEdit` 분해 — 책임별 3개 sub-hook 추출).
Date: 2026-05-02.
Type: refactor (홀수 sequencing — Sprint 194 의 Quick Look 편집 의존).

`docs/refactoring-smells.md` §2 의 god surface 항목 — "하나의 훅이 RDB
(SQL 생성/검증/커밋) + Document(MQL 프리뷰/커밋) 을 paradigm 분기로
모두 처리, 1141 줄" — 을 책임별 sub-hook 으로 분해. Sprint 192 (FB-3
DB 단위 export) 가 후순위로 미뤄졌으므로 Sprint 191 (SchemaTree 분해)
직후 진입.

`useDataGridEdit` 의 외부 인터페이스 (`DataGridEditState`) 와 시그니처
는 **보존**. 5 사이트 (RDB DataGrid + DocumentDataGrid + 5 callsite)
코드 무변경. 회귀 가드는 기존 12 test files / 118 tests.

## Sprint 안에서 끝낼 단위

- `useCommitFlash` (Sprint 98 의 isCommitFlashing + 400ms safety timer)
  추출 — 가장 작고 독립적.
- `useDataGridSelection` (selectedRowIds + anchorRowIdx + handleSelectRow
  + selectedRowIdx derivation) 추출 — paradigm-agnostic.
- `useDataGridPreviewCommit` (sqlPreview + mqlPreview + commitError +
  pendingConfirm + handleCommit + handleExecuteCommit + runRdbBatch +
  Safe Mode handoff confirmDangerous/cancelDangerous) 추출 — 가장 큰
  단위, 약 400 줄.

메인 `useDataGridEdit` 는 facade 로 축소: cell editing state + pending
edits/errors/newRows/deletedKeys + dirty tracking + 위 3 sub-hook 의
return 을 묶어 동일 `DataGridEditState` 를 반환.

## Acceptance Criteria

### AC-193-01 — `useCommitFlash` 추출

`src/hooks/useCommitFlash.ts` 신설. 시그니처:

```ts
export interface UseCommitFlashReturn {
  isCommitFlashing: boolean;
  beginCommitFlash(): void;
}
export function useCommitFlash(): UseCommitFlashReturn;
```

내부 책임:
- `isCommitFlashing` state.
- `beginCommitFlash` callback — flag = true + 400ms safety timeout 으로
  자동 false (Sprint 98 의 AC-01 200ms 윈도우 보호).
- 메모리 누수 방지: unmount 시 timer drain (`useEffect` cleanup).

검증:
- `src/hooks/useCommitFlash.test.ts` 신설 — 4 case:
  1. 초기 `isCommitFlashing === false`.
  2. `beginCommitFlash()` → 동기적으로 `true`.
  3. 400ms 후 자동 `false` (vi.useFakeTimers).
  4. 연속 호출 시 이전 timer 가 cancelled (다음 호출의 400ms 만 active).
- 기존 `useDataGridEdit.commit-shortcut.test.ts` 의 isCommitFlashing
  단언이 그대로 통과.

### AC-193-02 — `useDataGridSelection` 추출

`src/hooks/useDataGridSelection.ts` 신설. 시그니처:

```ts
interface UseDataGridSelectionParams {
  rowCount: number;  // visible row count for shift-select range cap
}
export interface UseDataGridSelectionReturn {
  selectedRowIds: Set<number>;
  anchorRowIdx: number | null;
  selectedRowIdx: number | null;  // derived: single row or last in set
  handleSelectRow(rowIdx: number, metaKey: boolean, shiftKey: boolean): void;
  clearSelection(): void;
}
export function useDataGridSelection(
  params: UseDataGridSelectionParams,
): UseDataGridSelectionReturn;
```

내부 책임:
- 단일 / multi (Cmd+click) / range (shift+click) 3가지 selection 모드.
- `selectedRowIdx` 는 derived: set.size === 1 → 그 idx, 아니면 last
  toggled idx (현재 useDataGridEdit:300+ 줄 derivation 그대로).

검증:
- `src/hooks/useDataGridSelection.test.ts` 신설 — 5 case (single click /
  meta-toggle add / meta-toggle remove / shift range / shift extend).
- 기존 `useDataGridEdit.multi-select.test.ts` 가 통과.

### AC-193-03 — `useDataGridPreviewCommit` 추출

`src/hooks/useDataGridPreviewCommit.ts` 신설. 시그니처:

```ts
interface UseDataGridPreviewCommitParams {
  paradigm: "rdb" | "document";
  connectionId: string | null;
  schema: string;
  table: string;
  page: number;
  fetchData(): Promise<void>;
  // pending state read-only handles from outer hook
  pendingEdits: Map<string, string | null>;
  pendingNewRows: unknown[][];
  pendingDeletedRowKeys: Set<string>;
  // pending state writers (for clearing on success)
  clearAllPending(): void;
  setPendingEditErrors(errs: Map<string, string>): void;
  // commit-flash hook
  beginCommitFlash(): void;
}

export interface UseDataGridPreviewCommitReturn {
  sqlPreview: string[] | null;
  setSqlPreview(v: string[] | null): void;
  mqlPreview: MqlPreview | null;
  setMqlPreview(v: MqlPreview | null): void;
  commitError: CommitError | null;
  setCommitError(v: CommitError | null): void;
  pendingConfirm: { reason: string; sql: string; statementIndex: number } | null;
  handleCommit(): void;
  handleExecuteCommit(): Promise<void>;
  confirmDangerous(): Promise<void>;
  cancelDangerous(): void;
}
export function useDataGridPreviewCommit(
  params: UseDataGridPreviewCommitParams,
): UseDataGridPreviewCommitReturn;
```

내부 책임:
- SQL/MQL preview 생성 (paradigm 분기).
- Safe Mode gate (`useSafeModeGate` consume).
- `runRdbBatch` (batch executeQuery + statement-level error handling).
- `runMqlBatch` (insertDocument / updateDocument / deleteDocument
  dispatch).
- `pendingConfirm` warn 분기 + `confirmDangerous` / `cancelDangerous`.
- `commitError` 라이프사이클 (commit attempt 시 clear, batch reject 시
  set, dismiss 시 clear).

검증:
- 신규 단위 테스트 0건 (기존 12 test files / 118 cases 가 회귀 가드).
- 단, paradigm 분기 + Safe Mode gate + commitError 의 cross-cutting
  단언이 충분히 covered 되어 있음을 findings 에 정리.

### AC-193-04 — facade `useDataGridEdit` 축소

메인 hook 은 다음만 보유:
- cell editing state (`editingCell` / `editValue` / `setEditValue` /
  `setEditNull` / `saveCurrentEdit` / `cancelEdit` / `handleStartEdit`).
- pending edits / errors / newRows / deletedKeys state + 액션
  (`handleAddRow` / `handleDeleteRow` / `handleDuplicateRow` /
  `handleDiscard`).
- dirty tracking (`setTabDirty` useEffect).
- 3 sub-hook 의 return 을 한 `DataGridEditState` 로 묶어 반환.

목표 라인 수: 1141 → ~600 (-540, ~47%).

검증:
- `pnpm vitest run src/components/datagrid/useDataGridEdit` → 12 files
  / 118 cases 모두 통과 (회귀 0).
- 5 사이트 callsite 코드 무변경:
  `git diff` 가 src/components/{rdb,document}/DataGrid*.tsx 에 0 line
  diff.

## Out of Scope

- **`useDataGridEdit.test.ts` 분할** (smell §8.1, defer 항목).
- **`DataGridTable.tsx` 분해** — 1071 줄 sibling god component, smell
  §2. 별 sprint 후보 (Sprint 195 또는 후속).
- **paradigm 별 sub-hook 으로 추가 분해** (RDB-only / Document-only
  hook). `useDataGridPreviewCommit` 가 paradigm 분기를 흡수했지만
  내부적으로는 if-paradigm 분기 유지. 실제 paradigm 분리는 Quick
  Look 합류 후 더 정확히 결정.
- **MQL preview 의 lib pure 추출** (D-4 후보). `generateMqlPreview` 가
  이미 lib (`./mqlGenerator`) 이지만 pendingChanges → MqlCommand 변환
  helper 분리 여지. 별 sprint.
- **store coupling 추가 정리**. Sprint 189 가 store coupling 정리만
  했고 본 sprint 는 응집도 분해. `useTabStore.setTabDirty` 직접 select
  은 facade 가 보유. 정리 별 sprint.

## 기준 코드 (변경 surface)

- **NEW** `src/hooks/useCommitFlash.ts` (~50 줄).
- **NEW** `src/hooks/useCommitFlash.test.ts` (~80 줄, 4 case).
- **NEW** `src/hooks/useDataGridSelection.ts` (~100 줄).
- **NEW** `src/hooks/useDataGridSelection.test.ts` (~120 줄, 5 case).
- **NEW** `src/hooks/useDataGridPreviewCommit.ts` (~400 줄).
- `src/components/datagrid/useDataGridEdit.ts` — 1141 → ~600. 3 sub-
  hook consume + facade composition.
- callsite (`DataGrid.tsx`, `DocumentDataGrid.tsx`) — 무변경.

## Dependencies

- Sprint 191 closure: `useSchemaCache` 추출 패턴 reuse — 본 sprint 는
  같은 hook-extraction 패턴을 datagrid 에 적용.
- Sprint 189 closure: `useSafeModeGate` 가 이미 lib pure function 위에
  있어 `useDataGridPreviewCommit` 가 안전하게 consume.

## Refs

- `docs/refactoring-smells.md` §2 — useDataGridEdit god surface.
- `docs/refactoring-plan.md` §63 — 3-4 일 추정.
- `memory/conventions/refactoring/lib-hook-boundary/memory.md` D-2 —
  components → hooks → lib import 방향.
- `memory/conventions/refactoring/decomposition/memory.md` A-3 —
  책임별 분해, A-5 — commit decomposition.
