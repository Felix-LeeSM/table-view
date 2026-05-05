# Sprint Contract: sprint-211

## Summary

- Goal: `src/components/shared/QuickLookPanel.tsx` (868 lines) god-component 를 entry-pattern 으로 분해. 행동 변경 0; 외부 import path 보존; 980-line `QuickLookPanel.test.tsx` 변경 0.
- Audience: Generator + Evaluator (multi-agent harness, post-209 cycle).
- Owner: harness skill orchestrator.
- Verification Profile: `command`

## In Scope

- `QuickLookShell` presentational shell 분리 (resize handle + role/aria + header chrome + HeaderControls + body slot).
- `RdbQuickLookBody` 분리 (RDB title + per-column FieldRow list + BlobViewerDialog wiring + out-of-bounds null return).
- `DocumentQuickLookBody` 분리 (namespace title + read-only BSON tree path + edit FieldRows path + 멀티-셀렉트 suffix).
- `helpers.ts` 분리 (formatCellValue / isBlobColumn / isJsonColumn / isBoolColumn / looksLikeJson / isEditableColumn / selectedRowIsDirty / clampHeight + 상수 4개 + `FieldRow` + `EditableValue`).
- entry `QuickLookPanel.tsx` 를 (1) 3 props types named export + (2) cross-paradigm state (height / editing / firstSelectedId) + (3) shared resize handler 빌드 + (4) `mode` discriminator 분기만으로 축소.
- 4 sub-file 위치: `src/components/shared/QuickLookPanel/{QuickLookShell.tsx, RdbQuickLookBody.tsx, DocumentQuickLookBody.tsx, helpers.ts}`.

## Out of Scope

- 행동 변경, 새 feature 추가.
- `QuickLookPanel.test.tsx` 변경 (980 lines, 변경 0).
- `useDataGridEdit` (`cellToEditValue` / `editKey` / `getInputTypeForColumn` / `DataGridEditState`) API surface 변경.
- `BsonTreeViewer` / `BlobViewerDialog` API surface 변경.
- `DataGrid.tsx` / `DocumentDataGrid.tsx` import 경로 변경.
- 새 BLOB / 문서 모드 feature 추가.
- RDB / Document body 의 공통 추출 추가 (현 sprint 는 single-source-extract → 단순 분리만).

## Invariants

- 외부 import path: `@components/shared/QuickLookPanel` 가 default React 컴포넌트 export. 3 props types (`QuickLookPanelProps`, `QuickLookPanelRdbProps`, `QuickLookPanelDocumentProps`) named exports of entry.
- 4 sub-file 은 entry 또는 다른 sub-file 로부터만 import (외부 노출 0).
- ARIA 보존: `role="separator"` / `tabIndex=0` / `aria-orientation="horizontal"` / `aria-valuemin="120"` / `aria-valuemax="600"` / `aria-valuenow` / `aria-label="Resize Quick Look panel"` / `aria-label="Row Details"` / `aria-label="Document Details"` / `aria-label="Close row details"` / `aria-label="Close document details"` / `aria-pressed` / `Edit value for {name}` / `Set NULL for {name}` / `Value for {name}` / `View BLOB data for {name}`.
- 상수 보존: `MIN_HEIGHT=120` / `MAX_HEIGHT=600` / `DEFAULT_HEIGHT=280` / `KEYBOARD_RESIZE_STEP=8`.
- Resize semantics: mouse drag (up=grow / down=shrink, document `mouseup`, `cursor` / `userSelect` 복원) + Shift+ArrowUp/Down ±8px clamp [120,600] + plain Arrow / Shift+Enter 무시.
- Edit dispatch ordering: `handleStartEdit(r,c,original) → setEditValue(next) → saveCurrentEdit()`. `next === null` 만 `Set NULL` / boolean `NULL` 경로.
- PK / BLOB / `_id` 읽기전용 게이트.
- Dirty-pill: `pendingEdits` 에 `${firstSelectedId}-` prefix 키 존재 시 ● Modified 표시.
- BLOB viewer 마운트는 RDB body 한정.
- 문서 모드 read-only-tree vs edit-FieldRows 토글: `editing && data` 둘 다 만족해야 FieldRows 렌더, 그 외 BSON tree.
- 새 `eslint-disable*` directive 0. 새 silent `catch{}` 0 (catch-policy 준수). 기존 `formatCellValue` 의 `JSON.stringify` cycle / `JSON.parse` swallow 는 inline justification 코멘트 보존.

## Acceptance Criteria

- `AC-01`: entry path + public surface 보존 (`@components/shared/QuickLookPanel` import 매치 동일, default export 컴포넌트, 3 props types named export 그대로).
- `AC-02`: 5 파일 (entry + `QuickLookShell.tsx` + `RdbQuickLookBody.tsx` + `DocumentQuickLookBody.tsx` + `helpers.ts`) 모두 존재 + 비어있지 않음.
- `AC-03`: entry < 250 lines (god file 868 → 70 %+ 감소). 단일 sub-file < 400 lines.
- `AC-04`: `QuickLookPanel.test.tsx` 변경 0 + `pnpm vitest run src/components/shared/QuickLookPanel.test.tsx` exit 0.
- `AC-05`: 프로젝트 회귀 0 — `pnpm vitest run` (post-Sprint-210 baseline 동일) / `pnpm tsc --noEmit` / `pnpm lint` 모두 exit 0. 새 `eslint-disable*` 0.

## Design Bar / Quality Bar

- 분해 = 추출 + 조립. 새 비즈니스 로직 추가 금지.
- entry 는 paradigm rendering / per-cell formatting / per-field edit rendering / resize-handle JSX 보유 금지.
- `QuickLookShell` 은 presentational. body slot + props 만으로 chrome 렌더.
- `helpers.ts` 는 pure helpers + `FieldRow` / `EditableValue` 만. JSX 외부 0, store mutation 0.
- 모든 sprint commit 의 git diff 가 "이동 + 인덱스 정리" 로 읽혀야 함 (분해 의도 명시).

## Verification Plan

### Required Checks

1. `wc -l src/components/shared/QuickLookPanel.tsx` < 250.
2. `ls src/components/shared/QuickLookPanel/{QuickLookShell.tsx,RdbQuickLookBody.tsx,DocumentQuickLookBody.tsx,helpers.ts}` 4 파일 모두 존재.
3. `wc -l src/components/shared/QuickLookPanel/*.{ts,tsx}` 단일 sub-file < 400.
4. `git diff --stat src/components/shared/QuickLookPanel.test.tsx` 변경 0.
5. `pnpm vitest run src/components/shared/QuickLookPanel.test.tsx` exit 0.
6. `pnpm vitest run` exit 0, post-210 baseline (189 files / 2725 tests) 이상 유지.
7. `pnpm tsc --noEmit` exit 0.
8. `pnpm lint` exit 0.
9. `grep -rn "from \"@components/shared/QuickLookPanel/" src/ e2e/` 매치 0 (sub-files internal).
10. `grep -rn "from \"@components/shared/QuickLookPanel\"" src/ e2e/` 매치 set 동일 (`DataGrid.tsx:26`, `DocumentDataGrid.tsx:6`).
11. `grep -n "export interface QuickLookPanelRdbProps\|export interface QuickLookPanelDocumentProps\|export type QuickLookPanelProps" src/components/shared/QuickLookPanel.tsx` 3 매치.
12. `git diff src/components/shared/QuickLookPanel.tsx src/components/shared/QuickLookPanel/` grep `^+.*eslint-disable` 매치 0.

### Required Evidence

- Generator must provide:
  - 5 changed files (entry rewrite + 4 sub-file 생성) 의 diff stat
  - check 1-12 의 실행 결과 (exit code + 핵심 출력)
  - AC-01..AC-05 별 evidence (파일 경로 + grep 결과 + line count + test summary)
  - 새로 추가한 `eslint-disable*` / silent `catch` 0 임을 git diff 로 보여주기
- Evaluator must cite:
  - 각 AC 별 pass/fail 근거 (concrete output)
  - missing 또는 weak evidence 는 finding 으로

## Test Requirements

### Unit Tests (필수)

- 본 sprint 는 행동 변경 0 의 refactor — 신규 unit test 작성 0.
- 기존 980-line `QuickLookPanel.test.tsx` 가 행동 보존 검증의 source of truth.

### Coverage Target

- 신규 코드 (4 sub-file) 의 직접 unit test 0 (regression test 가 통합 커버).
- 프로젝트 전체 baseline (라인 40% / 함수 40% / 브랜치 35%) 유지.

### Scenario Tests (필수)

- [x] Happy path — RDB & document mode 의 read / edit 모두 기존 test 커버.
- [x] 에러 / 예외 — `_id` 거부 / PK / BLOB 읽기전용 / JSON parse / Esc revert 모두 기존 test 포함.
- [x] 경계 조건 — out-of-bounds row, multi-select first row, resize at min/max, plain Arrow no-op 모두 기존 test 커버.
- [x] 기존 기능 회귀 없음 — `pnpm vitest run` 전체.

## Test Script / Repro Script

1. `git stash --include-untracked` (선택, sprint working state 보호).
2. `pnpm vitest run src/components/shared/QuickLookPanel.test.tsx` — sprint 진입 baseline 확인.
3. Generator 작업 후 동일 명령 다시 실행 → exit 0.
4. `pnpm vitest run && pnpm tsc --noEmit && pnpm lint` 전체 회귀.
5. `wc -l src/components/shared/QuickLookPanel.tsx src/components/shared/QuickLookPanel/*.{ts,tsx}` 라인 카운트 보고.

## Ownership

- Generator: general-purpose agent (multi-agent harness Phase 3).
- Write scope: `src/components/shared/QuickLookPanel.tsx` + `src/components/shared/QuickLookPanel/` 신규 디렉토리 + 4 sub-file 만. 그 외 파일 수정 금지 (test 파일 포함).
- Merge order: 본 sprint commit → handoff.md → PLAN.md hash → 다음 sprint.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (1-12 모두)
- Acceptance criteria evidence linked in `handoff.md`
