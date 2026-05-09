# Sprint Contract: sprint-250

## Summary

- Goal: DataGrid cell 편집의 종료를 두 가지 자연스러운 손가락 동작으로 통일.
  (a) input blur (다른 cell / toolbar / 빈 영역 클릭) → Tab/Enter 와 동일한
  commit, (b) grid 영역 Esc → Discard 버튼과 동일한 모든 pending 폐기. 단,
  modal/dialog 가 열린 동안에는 modal 의 Esc-close 가 우선이며, cell editor
  안의 Esc 는 cell-cancel 만 발동 (editor-local Esc > grid-wide Esc).
- Audience: Generator + Evaluator agents (harness, /tdd 스타일)
- Owner: Sprint 250
- Verification Profile: `command`

## In Scope

### onBlur commit

- `src/components/datagrid/useDataGridEdit.ts`:
  - 기존 `saveCurrentEdit` 의 의미를 보존하되 input blur 진입점도 동일 commit
    경로로 라우팅. 이미 `handleStartEdit` 가 다른 cell 진입 시 auto-save 하는
    패턴이 있으므로 그 패턴과 정합.
  - **race / loop 방지**: blur → re-render → re-blur 가 commit 을 두 번
    이상 발동하지 않도록 보장. `applyEditOrClear` 의 prev/next identity
    비교가 이미 no-op skip 을 제공하므로 새 가드는 최소화.

- `src/components/datagrid/DataGridTable.tsx` (또는 그 분리된 row-component
  파일):
  - 활성 cell 의 `<input>` / `<textarea>` 에 `onBlur` 핸들러 부착 →
    `editState.saveCurrentEdit()` 호출.
  - NULL chip editor 등 alternate editor 가 있다면 동일하게 처리.
  - blur 와 다른 cell click 이 race 할 때 `editingCell === null` 가드로
    중복 commit 방지.

### Modal-aware Esc discard

- `src/components/rdb/DataGrid.tsx`:
  - 신규 window keydown listener (Sprint 249 Cmd+Z 패턴과 동일):
    ```ts
    if (e.key !== "Escape") return;
    // grid editor 가 열려있으면 cell-local cancel 가 먼저 발동
    if (editState.editingCell !== null) return;
    // modal/dialog 이 열려 있으면 우리 핸들러는 발동 안 함
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    e.preventDefault();
    editState.handleDiscard();
    ```
  - mount 시 add, unmount 시 remove. 기존 Cmd+Z handler 와 별개의 listener
    로 두거나 단일 listener 안에서 분기.

- editor-local Esc (cell input 안의 Esc) 의 cancel 동작은 기존 코드에 이미
  존재 (`cancelEdit` 호출). 변경하지 않음 — grid-wide listener 가
  `editingCell !== null` 가드로 발동하지 않음.

### 회귀 가드

- `useDataGridEdit` 의 returned shape (30+ 필드) 변경 0. `saveCurrentEdit` /
  `handleDiscard` / `cancelEdit` 시그니처 변경 0.
- Sprint 249 의 Cmd+Z handler 동작 변경 0.
- Mongo (DocumentDataGrid) — `useDataGridEdit` 를 같은 형태로 사용하지만
  read-only 이므로 onBlur commit path 도 의미 없음 (no-op 로 흘러감, 회귀
  없음).

## Out of Scope

- Sprint 251 의 store-lift (pending state 가 여전히 useState 로 컴포넌트
  local).
- Sprint 252 의 PreviewDialog polish.
- Per-tab vs all-tabs commit 결정.
- DDL editor / raw query grid 의 onBlur / Esc 처리 (각각 별도 form state /
  hook — 본 sprint 범위 외).
- Modal 감지를 위한 새 zustand store 도입 (DOM query 한 번이면 충분).
- Esc keydown 시 active toast 의 dismiss (toast 시스템은 자체 Esc 안 받음 —
  영향 없음).

## Invariants

- `useDataGridEdit` 의 returned 30+ 필드 보존 — `saveCurrentEdit`,
  `handleDiscard`, `cancelEdit`, `pendingEdits`, `pendingNewRows`,
  `pendingDeletedRowKeys`, `undoStack`, `canUndo`, `undo` 모두 그대로.
- Sprint 249 의 9 개 undo AC 회귀 없음.
- `clearAllPending` 외부 호출자 (commit 성공 path) 변경 0.
- 기존 `cancelEdit` (cell editor Esc) 동작 보존.
- AC-249-* / AC-248-* / AC-247-* / AC-246-* / AC-245-* / AC-186-* / AC-185-*
  기존 가드 보존.
- Mongo grid read-only invariant 보존 (편집 진입 자체가 차단됨 — onBlur
  unreachable).
- IPC / safeModeStore / persistence 변경 0.

## Acceptance Criteria

(spec 의 AC-250-01 ~ AC-250-06 그대로)

- `AC-250-01` cell input onBlur → 값 변경 시 pendingEdits 반영 (commit). 변경
  없으면 no-op + undo snapshot 미push (Sprint 249 의 no-op skip 정책 유지).
- `AC-250-02` grid 영역 Esc + dialog 무존재 → handleDiscard 와 동일하게 4
  슬라이스 (pendingEdits / pendingNewRows / pendingDeletedRowKeys / undoStack)
  비워짐.
- `AC-250-03` Esc + `[role="dialog"]` 또는 `[role="alertdialog"]` 존재 →
  grid discard 미발동, modal 만 닫힘 (Radix Dialog 의 native Esc).
- `AC-250-04` cell input 안에서 Esc → 기존 `cancelEdit` 만 발동 (해당 cell
  editor close + editValue clear), grid-wide discard 발동 안 됨, 다른 pending
  보존.
- `AC-250-05` onBlur 가 두 번 연속 트리거되어도 commit handler 가 expected
  횟수만 호출됨 (race / loop guard).
- `AC-250-06` 기존 vitest suite 회귀 없음 — Mongo grid / DDL editor / raw
  query grid / Sprint 249 Cmd+Z 모두 통과.

## Design Bar / Quality Bar

- TypeScript 0 errors. ESLint 0 errors / 0 warnings.
- vitest 모든 테스트 통과 (예상 ≥ 2985 — Sprint 249 baseline 2980 + 신규
  케이스).
- `it.skip` / `it.todo` / `xit` 도입 금지.
- /tdd 스타일: Generator 는 신규 테스트를 먼저 작성해 fail 을 확인한 후
  구현하고, 최종 단계에서 모든 테스트 pass 를 보고한다 (handoff 에 "tests
  written first" 명시).

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 0 errors.
2. `pnpm lint` — 0 errors / 0 warnings.
3. `pnpm vitest run` — 모든 테스트 통과. 신규 `AC-250-*` 매핑 명시.
4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` — 회귀 가드
   (Rust 미변경).
5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — 회귀 가드.
6. `rg "onBlur" src/components/datagrid/DataGridTable.tsx src/components/datagrid/DataGridTable/` — onBlur 부착 확인 ≥ 1.
7. `rg "Escape" src/components/rdb/DataGrid.tsx` — Esc handler 등록 확인 ≥ 1.

### Required Evidence

- Generator must provide:
  - 변경 / 신규 / 삭제 파일 목록 + 1줄 의도.
  - 위 7 checks 의 stdout/stderr 발췌 (passing 확인).
  - `[AC-250-*]` ↔ 테스트 파일:라인 매핑 표.
  - onBlur handler 본문 인용 (race/loop guard 포함).
  - Esc keydown handler 본문 인용 (modal detection + editor-local Esc 우선).
  - /tdd 흐름 증거: 신규 테스트가 먼저 작성됐음을 단 한 줄로 확인.
  - 가정 / 잔여 위험 (예: blur 가 새 cell click 보다 먼저 fire 되는 브라우저
    동작 가정, document.querySelector dialog detection 의 한계).
- Evaluator must cite:
  - 각 AC 항목별로 테스트 파일:라인 또는 코드 위치.
  - modal detection (예: `[role="dialog"]` query) 가 본문에 verbatim 존재
    하는지 spot-check.
  - editor-local Esc 우선 가드가 코드에 존재하는지 verbatim 확인.

## Test Requirements

### Unit Tests (필수, /tdd)

- `src/components/datagrid/useDataGridEdit.onblur.test.ts` 또는 기존 테스트
  파일에 describe 추가 — 5 케이스 (`AC-250-01`, `AC-250-04`, `AC-250-05` 등
  hook layer).
- `src/components/rdb/DataGrid.esc.test.tsx` 신규 — `AC-250-02`, `AC-250-03`,
  `AC-250-04` (component layer modal detection + editor-local Esc 우선).
- 기존 `DataGrid.editing.test.tsx` / `DataGrid.undo.test.tsx` /
  `useDataGridEdit.undo.test.ts` / `DataGridTable.editing-visual.test.tsx`
  회귀 가드 — 변경 없이 통과.

### Coverage Target

- 변경 / 신규 파일: 라인 70% 이상.
- 전체 CI: 라인 40% / 함수 40% / 브랜치 35% (현재 통과 기준 유지).

### Scenario Tests (필수)

- [x] Happy path — cell 진입 → 값 변경 → 빈 영역 클릭 → commit 확인.
- [x] 에러/예외 — coercion error 가 있는 값으로 onBlur → 기존 inline hint 흐름
  보존.
- [x] 경계 조건 — 활성 editor 안에서 Esc (cell-cancel only), modal 열린 상태
  에서 Esc (grid discard 안 됨), onBlur 중복 트리거 (commit 1회).
- [x] 회귀 없음 — Sprint 249 Cmd+Z 흐름 / Mongo / DDL editor / raw query
  grid 모두 통과.

## Test Script / Repro Script

```bash
git diff --stat HEAD

# /tdd: 신규 테스트가 먼저 작성됐는지 git log 로 확인 가능
# (단일 commit 권장이므로 generator 가 명시)

# 1. 타입체크
pnpm tsc --noEmit

# 2. 린트
pnpm lint

# 3. 변경 영역 타겟 테스트 (빠른 피드백)
pnpm vitest run \
  src/components/datagrid/useDataGridEdit.onblur.test.ts \
  src/components/datagrid/useDataGridEdit.undo.test.ts \
  src/components/datagrid/DataGridTable.editing-visual.test.tsx \
  src/components/rdb/DataGrid.esc.test.tsx \
  src/components/rdb/DataGrid.editing.test.tsx \
  src/components/rdb/DataGrid.undo.test.tsx

# 4. 전체 회귀
pnpm vitest run

# 5. Rust 회귀 가드
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings

# 6. Wire-up grep
rg "onBlur" src/components/datagrid/DataGridTable.tsx src/components/datagrid/DataGridTable/
rg "Escape" src/components/rdb/DataGrid.tsx
```

## Ownership

- Generator: harness Generator agent (general-purpose), /tdd 스타일 엄수.
- Write scope: 위 In Scope 의 파일들만. Sprint 251 의 store-lift / Sprint 252
  의 PreviewDialog polish / DDL editor / raw query grid 변경 금지.
- Merge order: 단일 commit 권장 — onBlur + Esc + 테스트는 atomic. lefthook
  pre-commit 통과 필수.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- Required checks passing: `yes` (전체 7 check).
- Acceptance criteria evidence linked in `handoff.md`.
- /tdd 흐름 증거 (테스트 먼저 작성됐음을 handoff 가 명시).
- Sprint 249 / 248 / 247 / 246 / 245 / ADR 0022 invariants 보존.
