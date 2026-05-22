# Feature Spec: useRawQueryGridEdit hook 추출 (Sprint 215)

## Description

`src/components/query/EditableQueryResultGrid.tsx` (654 lines) 가 raw-query result grid 의 모든 책임 — primary-key 기반 cell-edit state machine (`editingCell` / `editValue` / `pendingEdits` Map / `pendingDeletedRowKeys` Set / `persistInflightEdit` 의 unchanged-skip rule), `noPk` 가드, SQL preview lifecycle (`buildRawEditSql` 호출 → `sqlPreview` state → preview Dialog 렌더), Safe Mode gate (`useSafeModeGate(connectionId)` 호출 + `analyzeStatement` + `;`-split decide loop), warn-tier handoff (`pendingConfirm` state + `ConfirmDangerousDialog` mount + confirm/cancel handlers + "Safe Mode (warn): confirmation cancelled — no changes committed" 문자열), execute batch (`executeQueryBatch` 호출 + `executing` / `executeError` lifecycle + `onAfterCommit` callback), query history 기록 (`addHistoryEntry({ source: "grid-edit", paradigm: "rdb", queryMode: "sql", connectionId, sql, executedAt, duration, status })`), Cmd+S `commit-changes` window event 리스너, context menu (`Show Cell Details` / `Edit Cell` / `Delete Row`), cell detail dialog, table render (PK badge / pending-edit highlighting / line-through deletion / NULL italic), pending changes toolbar / discard / commit / `PendingChangesTray` render — 를 단일 default export 함수 안에 보유한다.

본 sprint 는 P8 candidate (`docs/archives/backlogs/refactoring-candidates-2026-05-06.md` §P8) 의 **first step** 을 처리한다. raw-query 전용 hook **`useRawQueryGridEdit`** 를 추출해 component 로부터 state machine 과 commit lifecycle 을 분리한다 — UI (table / context menu / cell detail dialog / SQL preview Dialog / ConfirmDangerousDialog mount / PendingChangesTray render / no-pk banner) 는 component 잔존, 모든 state + handler + computed flag (`noPk` / `hasPendingChanges`) 은 hook 으로 이동. P8 의 second step (`useDataGridPreviewCommit` 와의 commit runner / history writer 공유) 은 본 sprint 가 다루지 않으며 후속 sprint 에서 검토한다.

P8 risk note: "raw-query editability plan과 structured table edit는 source row model이 달라서 성급한 통합은 위험" — hook scope 을 **단일 component 내부 state machine + commit lifecycle** 로 한정. `useDataGridPreviewCommit` 와의 cross-component DRY 시도하지 않음.

행동 변경 0 강제. `EditableQueryResultGridProps` 시그니처 / default export / `executeQueryBatch` payload / Safe Mode 메시지 텍스트 / history entry shape / Cmd+S 이벤트명 / context menu 라벨 / 모든 ARIA label 사전과 byte-equivalent. 2 regression test (`EditableQueryResultGrid.test.tsx` 450 lines / `EditableQueryResultGrid.safe-mode.test.tsx` 268 lines) 동결.

이 sprint 는 **단일 component 에서 hook extraction** 패턴 — Sprint 199 / 200 / 201 / 210 / 211 / 213 의 entry-pattern god-file split 과 다르고, Sprint 214 의 cross-component DRY 와도 다르다. component 자체는 default export 위치/이름 유지하면서, internal state/handler 를 hook 호출 한 줄로 대체한다.

## Sprint Breakdown

### Sprint 215: useRawQueryGridEdit extraction + EditableQueryResultGrid 적용

**Goal**: `src/components/query/useRawQueryGridEdit.ts` (create) 가 raw-query grid 의 모든 edit state machine + commit lifecycle (cell editing, pending edits Map, pending deleted rows Set, in-flight edit persistence, noPk guard, hasPendingChanges flag, SQL preview state, executing/error state, pendingConfirm state, Safe Mode gate decide loop, warn-tier handoff, executeQueryBatch + history record + onAfterCommit + setExecuting cleanup, Cmd+S 이벤트 리스너) 을 보유. `EditableQueryResultGrid.tsx` 가 hook 호출 1건 + UI 렌더링만 잔존. Public default export / props interface / 2 regression test 모두 변경 0.

**Verification Profile**: command

**Acceptance Criteria**:

1. **Hook 파일 존재 + 비어있지 않음.** `src/components/query/useRawQueryGridEdit.ts` 가 sprint 종료 후 존재. `wc -l src/components/query/useRawQueryGridEdit.ts` ≥ 150 lines. hook 은 named export — `grep -nE "^export (function|const) useRawQueryGridEdit" src/components/query/useRawQueryGridEdit.ts` 매치 ≥ 1. default export 없음 — `grep -n "^export default" src/components/query/useRawQueryGridEdit.ts` 매치 0.

2. **Component 가 hook 사용.** `grep -n "useRawQueryGridEdit" src/components/query/EditableQueryResultGrid.tsx` 매치 ≥ 2 (import + 호출). `EditableQueryResultGrid.tsx` 본문에서 다음 state declaration 0건:
   - `pendingEdits` / `pendingDeletedRowKeys` / `sqlPreview` / `executing` / `executeError` / `pendingConfirm` / `editingCell` / `editValue` 모두 `useState[<(].*name` 매치 0.
   - `executeQueryBatch(` / `analyzeStatement(` / `buildRawEditSql(` / `useSafeModeGate(` / `useQueryHistoryStore` / `addEventListener("commit-changes"` 6개 모두 매치 0 (hook 안으로 이동).

3. **Boilerplate 감소.**
   - `wc -l src/components/query/EditableQueryResultGrid.tsx` strictly less than **654** (사전).
   - `wc -l src/components/query/EditableQueryResultGrid.tsx` + `wc -l src/components/query/useRawQueryGridEdit.ts` ≤ **800**.
   - hook 단독: 150 ≤ wc -l ≤ 350.

4. **2 regression test 변경 0.** `git diff --stat src/components/query/EditableQueryResultGrid.test.tsx src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` 모두 0.

5. **공개 surface 동결.**
   - `grep -rn "from \"./EditableQueryResultGrid\"\|from \"@components/query/EditableQueryResultGrid\"" src/ e2e/` 매치 = 사전 3건 (test 2 + QueryResultGrid 1).
   - `grep -n "^export default function EditableQueryResultGrid" src/components/query/EditableQueryResultGrid.tsx` 매치 1.
   - `grep -n "^export interface EditableQueryResultGridProps" src/components/query/EditableQueryResultGrid.tsx` 매치 1.
   - `git diff --stat src/components/query/QueryResultGrid.tsx src/components/query/PendingChangesTray.tsx` 모두 0.

6. **Project-wide regression bar.**
   - `pnpm vitest run src/components/query/EditableQueryResultGrid.test.tsx src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` exit 0.
   - `pnpm vitest run` exit 0 (file count ±1 buffer 허용).
   - `pnpm tsc --noEmit` exit 0 — 새 `any` 0.
   - `pnpm lint` exit 0.
   - 새 `eslint-disable*` 0. 새 silent `catch{}` 0.

**Components to Create/Modify**:

- `src/components/query/useRawQueryGridEdit.ts` (create):
  raw-query grid 의 edit state machine + commit lifecycle hook. 입력:
  - `result: QueryResult` — read-only row source.
  - `connectionId: string` — Safe Mode gate / history / executeQueryBatch.
  - `plan: RawEditPlan` — `pkColumns.length === 0` 으로 noPk flag + buildRawEditSql.
  - `onAfterCommit?: () => void` — 성공 commit 후 호출.
  
  출력 (정확한 shape generator 재량, 단 다음 의미 모두 노출):
  - **Read-only flags**: `noPk: boolean`, `hasPendingChanges: boolean`.
  - **State**: `editingCell`, `editValue`, `pendingEdits`, `pendingDeletedRowKeys`, `sqlPreview`, `executing`, `executeError`, `pendingConfirm`.
  - **Handlers**: `setEditValue`, `startEdit(r,c)`, `cancelEdit()`, `saveCurrentEdit()`, `deleteRow(r)`, `handleCommit()`, `handleRevertEdit(key)`, `handleRevertDelete(rowKey)`, `handleDiscard()`, `handleExecute()`, `confirmDangerous()`, `cancelDangerous()`, `dismissPreview()`.
  
  hook 안에서 사전 동일 호출:
  - `useSafeModeGate(connectionId)`.
  - `useQueryHistoryStore((s) => s.addHistoryEntry)`.
  - `executeQueryBatch(connectionId, sqls, queryId)`.
  - `analyzeStatement(sql)`.
  - `buildRawEditSql(rows, edits, deletes, plan)`.
  - `editKey` / `cellToEditString` (from `useDataGridEdit`).
  - `toast.error` / `toast.info`.
  
  Cmd+S window event 리스너 hook 안 `useEffect` — `hasPendingChanges || editingCell` 가드.
  
  warn cancel 메시지 verbatim: `"Safe Mode (warn): confirmation cancelled — no changes committed"`.
  commit 실패 prefix verbatim: `` `Commit failed — all changes rolled back: ${message}` ``.
  history entry payload verbatim: `{ sql, executedAt, duration, status, connectionId, paradigm: "rdb", queryMode: "sql", source: "grid-edit" }`.

- `src/components/query/EditableQueryResultGrid.tsx` (modify):
  hook 호출 1건. 사전 9 state / 14 handler / 1 useEffect (Cmd+S) / `useSafeModeGate` / `useQueryHistoryStore` / `executeQueryBatch` / `analyzeStatement` / `buildRawEditSql` import 모두 hook 안으로 이동. UI 잔존:
  - **No-PK banner** (role="status", "Read-only — primary key required to edit").
  - **Pending toolbar** (hasPendingChanges 가드, 카운트, Discard / Commit).
  - **PendingChangesTray** (props: result / pendingEdits / pendingDeletedRowKeys / plan / onRevertEdit / onRevertDelete).
  - **Table render** (PK badge / pending highlight / line-through / NULL italic / inline editor).
  - **Context menu** (UI-only state 잔존).
  - **Cell detail dialog** (UI-only).
  - **SQL preview Dialog** (production stripe — `connectionEnvironment` selector component 잔존, stripe UI-only).
  - **ConfirmDangerousDialog**.

- `src/components/query/useRawQueryGridEdit.test.ts` (선택, generator 재량).

## Global Acceptance Criteria

1. **행동 변경 0.** 사용자 관찰 가능한 모든 흐름이 사전과 동일:
   - **Cell edit happy path**: double-click → input → 변경 → Enter → pendingEdits 추가 → toolbar (`{n} edit(s), {m} delete(s) pending`) → Commit → SQL preview Dialog → Execute → executeQueryBatch → cleanup + onAfterCommit + history "success" / "grid-edit".
   - **Unchanged-skip rule**: 같은 cell 변경 안 하고 Enter → pendingEdits 변화 0. 변경 후 원래 값으로 되돌림 → entry 삭제.
   - **No-PK guard**: `plan.pkColumns.length === 0` 시 (a) `startEdit` early return, (b) ContextMenu Edit/Delete `aria-disabled="true"`, (c) banner 표시.
   - **Delete row**: right-click → "Delete Row" → pendingDeletedRowKeys 추가 → 행 line-through opacity-50 → toolbar.
   - **Cmd+S shortcut**: `commit-changes` event → `hasPendingChanges || editingCell` 가드 → handleCommit.
   - **SQL preview Dialog**: "SQL Preview" header + 각 statement `<pre>` (`whitespace-pre-wrap break-all`) + executeError alert + Cancel/Execute. Enter (Shift 미포함) → handleExecute. Cancel/X → setSqlPreview(null) + setExecuteError(null).
   - **Production stripe**: `data-environment-stripe="production"` 1px 스트라이프. ENVIRONMENT_META 매핑 component 잔존.
   - **Discard**: 모든 pending state reset.
   - **Revert single edit**: tray revert → 해당 key/rowKey 만 삭제.
   - **Safe Mode block**: `setExecuteError(decision.reason)` + `toast.error(reason)` + executeQueryBatch 0.
   - **Safe Mode warn confirm**: `setPendingConfirm({reason, sql})` + executeQueryBatch 0 → ConfirmDangerousDialog mount → Run anyway → confirmDangerous → setPendingConfirm(null) + runBatch.
   - **Safe Mode warn cancel**: `setExecuteError("Safe Mode (warn): confirmation cancelled — no changes committed")` + `toast.info` + executeQueryBatch 0.
   - **Production + off + dangerous**: prod-auto block "production environment forces Safe Mode".
   - **Non-production + strict + dangerous**: env-gated → "allow" → 정상 commit.
   - **Commit failure**: catch → `setExecuteError(\`Commit failed — all changes rolled back: ${msg}\`)` + history "error" + setExecuting(false). pendingEdits 미clear.
   - **Multi-statement preview**: edits + deletes → buildRawEditSql 가 UPDATE + DELETE 반환 → preview 안 각 `<pre>` 별도 → Execute 시 executeQueryBatch 단일 호출.

2. **Public default export 동결.** `EditableQueryResultGrid` default export + `EditableQueryResultGridProps` 4 fields (`result` / `connectionId` / `plan` / `onAfterCommit?`) 시그니처 변경 0. `QueryResultGrid.tsx:19` import 라인 변경 0.

3. **사전 1 catch 본문 의미 보존.** `runBatch` try/catch (setExecuteError + history "error" + finally setExecuting(false)) hook 안에서 의미 유지. silent catch 0.

4. **regression test 2 파일 byte-identical.** 사전 cases 모두 통과.

5. **Lint / TypeScript / build exit 0.** 새 `any` 0. file count ±1 허용.

6. **Diff sanity.**
   - `EditableQueryResultGrid.tsx` net `-` ≥ 200.
   - `useRawQueryGridEdit.ts` net `+` 150-350.
   - 합산 ≤ +146 (cap 800).

7. **Hook 외부 import 0.** `grep -rn "useRawQueryGridEdit" src/ e2e/` 매치 = 1 (consumer 만; unit test +1 허용).

8. **`useDataGridPreviewCommit` 공유 0.** P8 first step 한정. `grep -n "useDataGridPreviewCommit" src/components/query/useRawQueryGridEdit.ts` 매치 0.

9. **Sibling drift 0.** `QueryResultGrid.tsx` / `PendingChangesTray.tsx` 변경 0.

## Data Flow

### Before (single-component lifecycle)

```
[EditableQueryResultGrid]                                       [Tauri]
   ├─ 9 useState + useSafeModeGate + useQueryHistoryStore
   ├─ persistInflightEdit (unchanged-skip)
   ├─ user double-click ──► startEdit
   ├─ user Enter ──► saveCurrentEdit (pendingEdits 머지)
   ├─ user Commit / Cmd+S ──► handleCommit
   │   merged = persistInflightEdit(pendingEdits)
   │   sqls = buildRawEditSql(rows, merged, deletes, plan)
   │   setSqlPreview(sqls)
   ├─ Dialog mount + user Execute ──► handleExecute
   │   for sql of sqlPreview:
   │     analyzeStatement → safeModeGate.decide
   │     block: setExecuteError + toast.error + return
   │     confirm: setPendingConfirm + return
   │   runBatch(sqlPreview):
   │     setExecuting(true) + recordedSql 캡처
   │     try:
   ├─     executeQueryBatch(connId, sqls, qid) ───────────────────┤
   │                                                          ←───┤
   │       cleanup + onAfterCommit + history "success"
   │     catch (err):
   │       setExecuteError + history "error"
   │     finally setExecuting(false)
   ├─ Cmd+S window listener (commit-changes) → handleCommit
   ├─ ConfirmDangerousDialog Confirm → confirmDangerous → runBatch
   └─ ConfirmDangerousDialog Cancel → cancelDangerous
```

### After

```
[EditableQueryResultGrid]              [useRawQueryGridEdit]                [Tauri]
   ├─ const grid = useRawQueryGridEdit({
   │     result, connectionId, plan, onAfterCommit })
   │
   │  ── hook 내부 (lifecycle 사전 동일):
   │     ├─ 8 useState (state)
   │     ├─ useSafeModeGate / useQueryHistoryStore
   │     ├─ persistInflightEdit + 14 handlers
   │     ├─ handleExecute → runBatch → executeQueryBatch ──────────────────┤
   │     │                                                              ←──┤
   │     ├─ confirmDangerous / cancelDangerous
   │     ├─ useEffect: addEventListener("commit-changes")
   │     └─ returns { 8 state + 14 handlers + 2 flags }
   │
   ├─ UI-only state: contextMenu / cellDetail (잔존)
   ├─ UI-only selector: connectionEnvironment (stripe)
   ├─ render:
   │   - no-pk banner (grid.noPk)
   │   - pending toolbar
   │   - PendingChangesTray
   │   - table (cells with grid.editingCell / pendingEdits / pendingDeletedRowKeys)
   │   - ContextMenu (grid.startEdit / deleteRow + grid.noPk gate)
   │   - CellDetailDialog (UI-only)
   │   - SQL Preview Dialog (grid.sqlPreview / executing / executeError / dismissPreview / handleExecute)
   │   - ConfirmDangerousDialog (grid.pendingConfirm / confirmDangerous / cancelDangerous)
```

### Cross-module dependency

```
useRawQueryGridEdit.ts (new)
  ├─→ useSafeModeGate(connectionId)
  ├─→ useQueryHistoryStore((s) => s.addHistoryEntry)
  ├─→ analyzeStatement (from "@/lib/sql/sqlSafety")
  ├─→ buildRawEditSql (from "@lib/sql/rawQuerySqlBuilder")
  ├─→ executeQueryBatch (from "@lib/tauri")
  ├─→ editKey + cellToEditString (from "@components/datagrid/useDataGridEdit")
  ├─→ toast (from "@lib/toast")
  └─→ no React DOM render

EditableQueryResultGrid.tsx (modify)
  ├─→ useRawQueryGridEdit (new)
  ├─→ useConnectionStore (environment selector — stripe UI only)
  ├─→ getInputTypeForColumn
  ├─→ Dialog primitives + ContextMenu + CellDetailDialog + ConfirmDangerousDialog + Button
  ├─→ PendingChangesTray (props via hook output)
  └─→ ENVIRONMENT_META

QueryResultGrid.tsx → unchanged
```

## Edge Cases

- **In-flight edit + Commit click**: `handleCommit` 에서 `persistInflightEdit(pendingEdits)` 가 활성 input editValue 를 fold. unchanged-skip rule 적용.
- **Empty pendingEdits + Commit**: buildRawEditSql 결과 0 → early return. Dialog 미표시.
- **Empty pendingEdits + 0 deletes + Cmd+S**: hasPendingChanges=false + editingCell=null → 가드 통과 안 함.
- **Empty pendingEdits + editingCell !== null + Cmd+S**: editingCell 가드 통과 → persistInflightEdit unchanged-skip → sqls 0 → early return.
- **Delete + edit on same row**: 두 Map 모두 entry 보유. UI 상 cell 하이라이트 + line-through 둘 다.
- **No-PK guard**: 3중 가드 (startEdit / ContextMenu disabled / banner).
- **Multi-statement preview with mixed safety**: for-loop 가 first dangerous 발견 시 분기.
- **Dialog Cancel / X click during preview**: dismissPreview → dialog close. pendingEdits 잔존.
- **Cancel during commit phase**: 사전 동일 — 진행 중 promise abort 안 함.
- **Commit failure**: catch → setExecuteError + history "error" + finally setExecuting(false). pendingEdits 미clear.
- **Connection environment 변경 during preview**: stripe 즉시 반영. Safe Mode gate 도 즉시.
- **Safe Mode store change during preview**: 즉시 반영 (Zustand subscribe).
- **History record exception**: addHistoryEntry sync action 으로 throw 없음 가정.
- **onAfterCommit failure**: 사전 `onAfterCommit?.()` await 없이 → throw 시 catch fallthrough → success entry 미기록 + error entry. 사전 동일.
- **Unmount during commit**: 사전 동일 — 보호 추가 안 함.
- **Hook 재실행 (key change)**: connectionId 변경 시 useSafeModeGate 새 environment. pendingEdits state 는 caller 의 cleanup 결정.
- **Cmd+S during input editing (unchanged)**: 가드 통과 → handleCommit → persistInflightEdit unchanged-skip → sqls 0 → early return.
- **Cmd+S with deletes only**: hasPendingChanges=true → buildRawEditSql DELETE emit → Dialog.
- **rowKeyFn rule**: 사전 `\`row-1-${rowIdx}\`` 형식. PendingChangesTray 동일 prefix 가정.

## Verification Hints

- **Primary regression**: `pnpm vitest run src/components/query/EditableQueryResultGrid.test.tsx src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` exit 0.

- **File-shape**:
  - `wc -l src/components/query/useRawQueryGridEdit.ts` ≥ 150, ≤ 350.
  - `wc -l src/components/query/EditableQueryResultGrid.tsx` < 654.
  - 합산 ≤ 800.

- **Hook surface**:
  - `grep -nE "^export (function|const) useRawQueryGridEdit"` 매치 ≥ 1.
  - `grep -n "^export default" src/components/query/useRawQueryGridEdit.ts` 매치 0.
  - `grep -n "useRawQueryGridEdit" src/components/query/EditableQueryResultGrid.tsx` 매치 ≥ 2.

- **State migration (component 에서 모두 제거)**:
  - 8 state 의 `useState[<(].*name` 매치 0.
  - 6 helper 호출 (`executeQueryBatch` / `analyzeStatement` / `buildRawEditSql` / `useSafeModeGate` / `useQueryHistoryStore` / `addEventListener("commit-changes")`) 매치 0.

- **Public-surface**:
  - `grep -rn "from \"./EditableQueryResultGrid\"\|from \"@components/query/EditableQueryResultGrid\"" src/ e2e/` 매치 = 사전 3건.
  - `grep -rn "from \"@components/query/useRawQueryGridEdit\"\|from \"./useRawQueryGridEdit\"" src/ e2e/` 매치 ≤ 2.
  - `^export default function EditableQueryResultGrid` 매치 1.
  - `^export interface EditableQueryResultGridProps` 매치 1.

- **Project-wide gates**: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` 모두 exit 0.

- **Test file 동결**: `git diff --stat src/components/query/EditableQueryResultGrid.test.tsx src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` 모두 0.

- **Sibling drift 0**: `QueryResultGrid.tsx` / `PendingChangesTray.tsx` 변경 0.

- **새 eslint-disable / silent catch 0**:
  - `git diff src/components/query/ | grep "^+.*eslint-disable"` 0.
  - 빈 catch 0.

- **P8 first-step 한정**:
  - `grep -n "useDataGridPreviewCommit" src/components/query/useRawQueryGridEdit.ts` 매치 0.
  - hook 입력 4 prop 만 (추가 caller 친화 prop 0).

- **Behavioural pin (regression 통합 커버)**:
  - "Safe Mode blocked: ..." prefix.
  - "Safe Mode (warn): confirmation cancelled — no changes committed" verbatim.
  - "Commit failed — all changes rolled back: ..." prefix verbatim.
  - history source verbatim "grid-edit".
  - Cmd+S event verbatim "commit-changes".

### Critical Files for Implementation

- /Users/felix/Desktop/study/view-table/src/components/query/useRawQueryGridEdit.ts
- /Users/felix/Desktop/study/view-table/src/components/query/EditableQueryResultGrid.tsx
- /Users/felix/Desktop/study/view-table/src/components/query/EditableQueryResultGrid.test.tsx
- /Users/felix/Desktop/study/view-table/src/components/query/EditableQueryResultGrid.safe-mode.test.tsx
- /Users/felix/Desktop/study/view-table/src/hooks/useSafeModeGate.ts
