# Sprint Execution Brief: sprint-249

## Objective

ADR 0022 Phase 5 — DataGrid pending-edit 상태 (cell 편집 / Add / Delete /
Duplicate) 에 대한 Cmd+Z (macOS) / Ctrl+Z (Linux/Windows) undo 단축키 + 보조
Toolbar Undo 버튼. 50 entry 한도, INPUT/textarea target 우회 (browser native
undo 우선), commit / discard 시 stack 비움.

## Task Why

ADR 0022 의 핵심 약속 — "destructive 만 dialog, safe write 는 Cmd+Z 안전망" —
의 마지막 조각. Phase 1-4 가 정책 / dialog / dry-run / explicit dry-run 버튼
까지 완성했고, Phase 5 의 pending undo 가 완성되어야 사용자가 cell 더블클릭
실수 / Add Row 오타 / Delete Row 잘못 누름 같은 일상적 mistake 을 commit 전에
복구할 수 있다. TablePlus / DBeaver / pgAdmin 모두 동일한 *pending-only*
범위 (commit 후 DML reverse 는 미지원) — 본 sprint 도 그 표준을 따름.

## Scope Boundary

- 변경: `useDataGridEdit` (undo stack + 6 mutating handler 에 snapshot push +
  새 `undo` / `canUndo` export), `DataGrid.tsx` (Cmd+Z keydown listener +
  toolbar wire), `DataGridToolbar.tsx` (Undo 버튼).
- 변경 금지:
  - raw query grid (`useRawQueryGridEdit`, `EditableQueryResultGrid`) — 후속
    sprint 후보, 본 sprint 범위 밖.
  - DDL editor (CreateTable / DropTable / AddColumn / DropColumn / Rename) —
    form state 패턴이 다름.
  - `decideSafeModeAction` / SafeModeStore / dry-run IPC / dialog 본문 / Phase
    1-4 무관.
  - Redo (Cmd+Shift+Z) — 본 sprint 는 undo only.
  - Commit 후 DML reverse (DB 단위 undo).

## Invariants

- `useDataGridEdit` 의 30+ returned 필드 그대로, `undo` / `canUndo` 만 추가.
- `pendingEdits` / `pendingNewRows` / `pendingDeletedRowKeys` shape 보존.
- `clearAllPending` 외부 호출자 변경 0 — undo stack 도 비우게 내부 확장만.
- `handleExecuteCommit` 동작 / commit-path 변경 0.
- INPUT/textarea/contenteditable focus 시 Cmd+Z 는 browser native undo 우선
  (우리 핸들러는 발동 안 함).
- AC-248-* / AC-247-* / AC-246-* / AC-245-* / AC-186-* / AC-185-* 가드 보존.

## Done Criteria

1. `useDataGridEdit` 에 `undoStack: EditSnapshot[]` 내부 state + `pushSnapshot`
   helper + `undo` action + `canUndo` derived 추가. 50 entry 한도, no-op edit
   미push, `clearAllPending` 시 비움.
2. 6 mutating handler (`saveCurrentEdit`, `handleStartEdit` auto-save,
   `handleAddRow`, `handleDeleteRow`, `handleDuplicateRow`, [`setEditNull` 은
   skip — pending state 변경 없음]) 에 snapshot push 통합.
3. `DataGrid.tsx` window keydown listener — Cmd+Z (metaKey) / Ctrl+Z (ctrlKey)
   + key="z" + non-Shift + non-INPUT target 이면 `editState.undo()` + preventDefault.
4. `DataGridToolbar.tsx` 신규 Undo 버튼 (canUndo gate, aria-label, title with
   shortcut).
5. AC-249-U1..U9 (hook), K1..K5 (keyboard), T1..T3 (toolbar), W1..W2 (wire)
   매핑 완료.
6. Verification Plan 7개 check 모두 pass.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm tsc --noEmit` (0 errors)
  2. `pnpm lint` (0 / 0)
  3. `pnpm vitest run` (전체 통과 + AC-249 매핑 증거)
  4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` (회귀 가드)
  5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  6. `rg "metaKey.*z|ctrlKey.*z|key === \"z\"" src/components/rdb/DataGrid.tsx` (≥ 1)
  7. `rg "canUndo|undoStack" src/components/datagrid/useDataGridEdit.ts` (≥ 2)
- Required evidence:
  - 변경 / 신규 / 삭제 파일 목록 (1줄 의도)
  - 7 check stdout 발췌
  - AC ↔ 파일:라인 매핑
  - `pushSnapshot` 본문 인용 (deep copy + 50 한도).
  - `undo` 본문 인용 (LIFO restore).
  - keydown handler 본문 (modifier check + INPUT target skip).
  - 가정 / 잔여 위험 (raw query grid 미커버, redo 미지원, 50 한도 결정 근거).

## Evidence To Return

- 변경 파일과 purpose
- Checks run and outcomes (7개)
- Done criteria coverage with evidence
- Assumptions
- Residual risk or verification gaps

## References

- Contract: `docs/sprints/sprint-249/contract.md`
- Phase 4 baseline: `docs/sprints/sprint-248/contract.md`, `findings.md`
- ADR 0022: `docs/archives/decisions/0022-safe-mode-destructive-only-confirm-with-dry-run/memory.md`
- Relevant files:
  - `src/components/datagrid/useDataGridEdit.ts`
  - `src/components/datagrid/DataGridToolbar.tsx`
  - `src/components/rdb/DataGrid.tsx`
