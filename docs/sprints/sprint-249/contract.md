# Sprint Contract: sprint-249

## Summary

- Goal: ADR 0022 Phase 5 — DataGrid pending-edit 상태에 대한 Cmd+Z (Ctrl+Z on
  Windows/Linux) undo 단축키. 사용자가 실수로 cell 편집 / Add / Delete /
  Duplicate 한 결과를 commit 전이라면 한 번씩 되돌릴 수 있도록 한다. ADR 0022
  의 "safe write 는 Cmd+Z 안전망" 약속의 구체화. 업계 표준 (TablePlus /
  DBeaver / pgAdmin) 과 일치하는 *pending* 범위 — commit 후 DML reverse 는
  out of scope.
- Audience: Generator + Evaluator agents (harness 흐름)
- Owner: Phase 5 (Sprint 249)
- Verification Profile: `command`

## In Scope

### 1. `useDataGridEdit` 의 undo stack

- `src/components/datagrid/useDataGridEdit.ts`:
  - 신규 internal state `undoStack: Snapshot[]` (max 50 entries — 가장 오래된
    snapshot drop):
    ```ts
    type EditSnapshot = {
      pendingEdits: ReadonlyMap<string, string | null>;
      pendingNewRows: ReadonlyArray<unknown[]>;
      pendingDeletedRowKeys: ReadonlySet<string>;
    };
    ```
  - 신규 helper `pushSnapshot()` — 현재 pending state 의 deep copy 를 stack
    에 push. 50 초과 시 `shift()` 로 가장 오래된 entry drop.
  - 신규 action `undo()` — stack pop → 3 pending state 복원. stack 비어있으면
    no-op.
  - 신규 derived `canUndo: boolean` — `undoStack.length > 0`.
  - 기존 `clearAllPending()` 에서 undo stack 도 `[]` 로 클리어 (commit 성공 /
    명시적 discard 시 history 끊김).

- 기존 mutating handler 6개 모두 snapshot push 추가:
  1. `saveCurrentEdit` — `applyEditOrClear` 결과가 prev 와 다를 때만 push +
     setPendingEdits (no-op edit 은 stack 미오염).
  2. `handleStartEdit` — auto-save path (다른 cell 로 이동하면서 진행 중인
     edit 을 commit) 가 발동될 때만 동일 조건으로 push (prev !== next).
  3. `handleAddRow` — 무조건 push (의도적 액션).
  4. `handleDeleteRow` — `selectedRowIds.size === 0` 가드 통과 후 push.
  5. `handleDuplicateRow` — selectedRowIds 통과 후 push.
  6. `setEditNull` — pendingEdit 변경 안함 (editValue 만 변경) → snapshot 불필요.

- Returned shape 에 추가:
  ```ts
  interface DataGridEditState {
    ...
    undo: () => void;
    canUndo: boolean;
  }
  ```

### 2. `DataGrid` 키보드 바인딩

- `src/components/rdb/DataGrid.tsx`:
  - `useEffect` 로 `keydown` window listener 등록 (mount 시).
  - 조건: `(e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey` →
    `e.preventDefault(); editState.undo();`.
  - active element 가 `INPUT` / `TEXTAREA` / `contenteditable` 인 경우 (사용자
    가 cell input 에서 Cmd+Z 입력) — 기본 텍스트 editor undo 가 우선해야 함.
    그러므로 input target 일 때는 우리 undo 를 발동하지 않는다 (browser native
    undo 통과).
  - listener 는 mount 동안만 살아있고 unmount 시 cleanup.

- 단축키는 *DataGrid 컴포넌트가 마운트되어 있는 동안* 동작 — 다른 탭 (Query
  Tab) 에서는 문서 단축키가 따로 없으므로 전역 listener 로 기능.

### 3. (선택) Toolbar Undo 버튼

- `src/components/datagrid/DataGridToolbar.tsx`:
  - 신규 prop: `onUndo: () => void`, `canUndo: boolean`.
  - "Discard" 버튼 옆에 작은 Undo 버튼 추가:
    ```tsx
    <Button
      variant="ghost"
      size="xs"
      onClick={onUndo}
      disabled={!canUndo}
      aria-label="Undo last pending change"
      title="Undo (Cmd+Z) — pending changes only"
    >
      <Undo2 />
    </Button>
    ```
- Toolbar 가 Undo 버튼을 노출함으로써 단축키를 모르는 사용자도 발견 가능.

### 4. 테스트

- `src/components/datagrid/useDataGridEdit.test.ts` (또는 관련 테스트 파일에
  describe 추가):
  - `[AC-249-U1]` `undo()` on empty stack → no-op (panic 없이 ignore).
  - `[AC-249-U2]` `handleAddRow` → push, `undo()` → pendingNewRows 비어있는
    상태로 복원.
  - `[AC-249-U3]` `handleDeleteRow` → push, `undo()` → pendingDeletedRowKeys
    원복.
  - `[AC-249-U4]` `handleDuplicateRow` → push, `undo()` → pendingNewRows 원복.
  - `[AC-249-U5]` `saveCurrentEdit` (값이 변할 때) → push, `undo()` →
    pendingEdits 원복.
  - `[AC-249-U6]` `saveCurrentEdit` (no-op — 같은 값) → push 안 함, undo
    stack 길이 변화 없음.
  - `[AC-249-U7]` `clearAllPending()` → undo stack 비어짐 (canUndo=false).
  - `[AC-249-U8]` 50 초과 push → 가장 오래된 entry drop.
  - `[AC-249-U9]` 연속 액션 → undo 가 LIFO 순서로 복원 (마지막 액션부터).

- `src/components/rdb/DataGrid.editing.test.tsx` (또는 신규
  `DataGrid.undo.test.tsx`):
  - `[AC-249-K1]` Cmd+Z (metaKey) keydown → editState.undo 호출.
  - `[AC-249-K2]` Ctrl+Z (ctrlKey) keydown → editState.undo 호출 (Windows/Linux).
  - `[AC-249-K3]` Cmd+Shift+Z (redo) → editState.undo 미호출 (현재 redo 미지원
    이지만 undo 도 발동하지 않음을 확인).
  - `[AC-249-K4]` active element 가 `<input>` 일 때 Cmd+Z → editState.undo 미
    호출 (browser native undo 우선).
  - `[AC-249-K5]` Cmd+Z 후 commit (`handleExecuteCommit` 성공) → 새 undo stack
    상태 (clearAllPending → 비어짐).

- `src/components/datagrid/DataGridToolbar.test.tsx` (있으면 / 없으면 신규):
  - `[AC-249-T1]` `canUndo=true` → Undo 버튼 enabled.
  - `[AC-249-T2]` `canUndo=false` → Undo 버튼 disabled.
  - `[AC-249-T3]` 클릭 → `onUndo` 호출.

## Out of Scope

- Redo (Cmd+Shift+Z) — Phase 5 는 undo 만 다룬다. Redo 는 미래 sprint 후보.
- Commit 후 DML reverse (실제 DB row 복원) — ADR 0022 가 명시적으로 미지원
  결정. 업계 표준과 일치.
- DDL editor (Drop / DropColumn / AddColumn / Rename / CreateTable) 의 undo —
  pending edit 개념이 다르며 (form state vs grid state), DDL preview 는 dialog
  open 시점에 이미 "확인" 단계. 본 sprint 는 grid (DataGrid + 가능하면 raw
  query EditableQueryResultGrid) 에 한정.
- EditableQueryResultGrid (raw query) 의 undo — `useRawQueryGridEdit` 도 비슷
  한 pending state 가 있지만, 본 sprint 에서는 RDB grid (TablePlus 의 핵심
  워크플로우) 만 다룸. raw query grid 는 스코프 확장 시점에 후속 sprint 로.
- Mongo grid editing (`useDocumentGridEdit` 등) — Mongo 는 read-only 이므로
  적용 대상 아님.
- `decideSafeModeAction` / SafeModeStore / dry-run / dialog UI 변경.
- `executeQueryDryRun` / `executeQueryBatch` IPC 변경.

## Invariants

- 기존 commit-pipeline (`handleExecuteCommit`) 동작 변경 0 — undo 는 commit
  이전의 *프리뷰* 를 다룸.
- `pendingEdits` / `pendingNewRows` / `pendingDeletedRowKeys` shape 보존.
  undo stack 은 추가 internal state 일 뿐 외부 shape 영향 없음.
- `clearAllPending` 의 외부 호출자 변경 0 — 단지 내부에서 undo stack 도
  초기화.
- `useDataGridEdit` 의 returned interface 는 기존 30+ 필드 보존, `undo` /
  `canUndo` 만 추가 (optional 아님 — 신규 필수 필드, TS 타입 가이드).
- `DataGrid.tsx` 의 다른 keydown listener / ESLint disable 영향 없음.
- AC-248-* / AC-247-* / AC-246-* / AC-245-* / AC-186-* / AC-185-* 기존 가드
  보존.

## Acceptance Criteria

### Hook (`useDataGridEdit`)

- `AC-249-U1` 빈 stack 에서 `undo()` → no-op (state 그대로, panic 없음).
- `AC-249-U2` `handleAddRow` 후 `undo()` → `pendingNewRows.length === 0`.
- `AC-249-U3` `handleDeleteRow` 후 `undo()` → `pendingDeletedRowKeys.size === 0`.
- `AC-249-U4` `handleDuplicateRow` 후 `undo()` → 원복.
- `AC-249-U5` 값이 바뀐 `saveCurrentEdit` 후 `undo()` → pendingEdits 원복.
- `AC-249-U6` 값이 바뀌지 않은 `saveCurrentEdit` (no-op) → undo stack 길이
  유지 (push 안 됨).
- `AC-249-U7` `clearAllPending()` → `canUndo === false`, stack 빔.
- `AC-249-U8` 50 초과 push → stack 길이 50 유지, 첫 entry FIFO drop.
- `AC-249-U9` 연속 두 액션 (예: addRow → addRow) 후 undo 두 번 → LIFO 복원
  (가장 최근 추가 row 부터 사라짐).

### 키보드 / 컴포넌트 (`DataGrid`)

- `AC-249-K1` Cmd+Z (metaKey, key="z", non-shift, target 이 INPUT 아님) →
  `editState.undo` 호출.
- `AC-249-K2` Ctrl+Z (ctrlKey) → 동일.
- `AC-249-K3` Cmd+Shift+Z → undo 미호출 (redo 슬롯 보호).
- `AC-249-K4` active element 가 `<input type="text">` 또는
  `<textarea>` 또는 `[contenteditable]` 인 동안 Cmd+Z → `editState.undo`
  미호출 (native browser undo 우선).
- `AC-249-K5` Cmd+Z 후 commit 성공 → `canUndo` 가 false (clearAllPending 부수
  효과).

### Toolbar

- `AC-249-T1` `canUndo=true` → "Undo" 버튼 enabled.
- `AC-249-T2` `canUndo=false` → "Undo" 버튼 disabled.
- `AC-249-T3` 클릭 → `onUndo` 1회 호출.

### Wire-up

- `AC-249-W1` `DataGrid.tsx` 의 `<DataGridToolbar>` JSX 가
  `onUndo={editState.undo}` + `canUndo={editState.canUndo}` 전달.
- `AC-249-W2` `useDataGridEdit` returned `undo` / `canUndo` shape 매칭 (인터
  페이스 일관성).

## Design Bar / Quality Bar

- TypeScript 0 errors. ESLint 0 errors / 0 warnings.
- vitest 모든 테스트 통과 (예상 ≥ 2975 — 신규 ~13 케이스 추가).
- Rust 미변경 → cargo test / clippy 회귀 가드 통과.
- 단축키는 macOS Cmd+Z + Linux/Windows Ctrl+Z 양쪽 모두 동작.
- 50 entry 한도는 메모리 safety 목적; 일반 사용에서는 거의 도달하지 않음.
  TablePlus / DBeaver 의 일반 패턴 (~ 100 entries) 을 의도적으로 보수적으로
  설정.
- aria-label / title 모두 표기.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 0 errors.
2. `pnpm lint` — 0 errors / 0 warnings.
3. `pnpm vitest run` — 모든 테스트 통과. 신규 `AC-249-*` 매핑 명시.
4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` — 회귀 가드 (Rust
   미변경).
5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — 회귀 가드.
6. `rg "metaKey.*z|ctrlKey.*z|key === \"z\"" src/components/rdb/DataGrid.tsx` — Cmd+Z handler 등록 확인 ≥ 1.
7. `rg "canUndo|undoStack" src/components/datagrid/useDataGridEdit.ts` — undo stack 노출 확인 ≥ 2.

### Required Evidence

- Generator must provide:
  - 변경 / 신규 / 삭제 파일 목록 + 1줄 의도.
  - 위 7 checks 의 stdout/stderr 발췌.
  - `[AC-249-*]` ↔ 테스트 파일:라인 매핑 표.
  - `pushSnapshot` / `undo` 본문 인용 (deep copy / LIFO restore / 50 한도).
  - keydown handler 본문 인용 (modifier check + INPUT target skip).
  - 50 한도 / no-op skip 의 메모리/UX 트레이드오프 노트.
  - 가정 / 잔여 위험.
- Evaluator must cite:
  - 각 AC 항목별로 테스트 파일:라인 또는 코드 위치.
  - clearAllPending 이 undo stack 도 비우는지 verbatim 확인.
  - INPUT/textarea target 우회 로직 검증.

## Test Requirements

### Unit Tests (필수)

- `useDataGridEdit` undo 9 케이스 (`AC-249-U1..U9`).
- `DataGrid` 키보드 5 케이스 (`AC-249-K1..K5`).
- `DataGridToolbar` undo 버튼 3 케이스 (`AC-249-T1..T3`).

### Coverage Target

- 변경 / 신규 파일: 라인 70% 이상.
- 전체 CI: 라인 40% / 함수 40% / 브랜치 35% (현재 통과 기준 유지).

### Scenario Tests (필수)

- [x] Happy path — handleAddRow → Cmd+Z → row 사라짐.
- [x] 에러/예외 — 빈 stack 에서 undo no-op.
- [x] 경계 조건 — 50 초과 stack drop, no-op edit 미push, INPUT target Cmd+Z
  skip.
- [x] 회귀 없음 — commit-pipeline 동작 / Phase 4 dry-run / Phase 2/3 dialog
  / Safe Mode 매트릭스 모두 통과.

## Test Script / Repro Script

```bash
git diff --stat HEAD

pnpm tsc --noEmit
pnpm lint

# 변경 영역 타겟 테스트
pnpm vitest run \
  src/components/datagrid/useDataGridEdit.test.ts \
  src/components/datagrid/DataGridToolbar.test.tsx \
  src/components/rdb/DataGrid.editing.test.tsx \
  src/components/rdb/DataGrid.undo.test.tsx

# 전체 회귀
pnpm vitest run

# Rust 회귀 가드
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings

# Wire-up grep
rg "metaKey.*z|ctrlKey.*z|key === \"z\"" src/components/rdb/DataGrid.tsx
rg "canUndo|undoStack" src/components/datagrid/useDataGridEdit.ts
```

## Ownership

- Generator: harness Generator agent (general-purpose)
- Write scope: 위 In Scope 의 파일들만. raw query grid (Phase X 후보) /
  Mongo / DDL editor / `decideSafeModeAction` / dry-run / dialog 변경 금지.
- Merge order: 단일 commit 권장 — hook + keyboard + toolbar 변경은 atomic.
  lefthook pre-commit 통과 필수.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- Required checks passing: `yes` (전체 7 check).
- Acceptance criteria evidence linked in `handoff.md`.
- ADR 0022 본문 Phase 5 의 "safe write 는 Cmd+Z 안전망" 약속과 일관성 유지.
- 50 entry 한도 / no-op skip / INPUT target skip 등 트레이드오프가 handoff 에
  명시되어 있음.
