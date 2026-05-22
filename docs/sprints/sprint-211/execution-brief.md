# Sprint Execution Brief: sprint-211

## Objective

`src/components/shared/QuickLookPanel.tsx` (868 lines) god-component 를 entry-pattern 으로 분해. 1 shell (`QuickLookShell`) + 2 paradigm body (`RdbQuickLookBody`, `DocumentQuickLookBody`) + 1 helpers module 추출. entry 는 (1) 3 props types named export + (2) cross-paradigm state (height / editing / firstSelectedId) + (3) shared resize handler 빌드 + (4) `mode` discriminator 분기만 보존. 행동 변경 0.

## Task Why

- post-209 cycle 의 P2 후보. 868-line god 단일 파일이 RDB / Document 양 paradigm + edit / read-only / resize / BLOB / dirty-pill 7개 concern 을 동시 보유.
- Sprint 105 키보드 resizer / Sprint 90 column header / Sprint 194 edit-mode 각 별 변경이 한 파일에서 충돌.
- Sprint 199 SchemaTree / 200 DataGridTable / 201 QueryTab / 208 tabStore / 210 DocumentDataGrid 와 동일한 entry-pattern 답습 → 비용/위험 통제.
- 980-line `QuickLookPanel.test.tsx` 가 source-of-truth → 분해 후 그 자체가 회귀 가드.

## Scope Boundary

- `src/components/shared/QuickLookPanel.tsx` 와 신규 `src/components/shared/QuickLookPanel/` 디렉토리만 수정.
- `QuickLookPanel.test.tsx` 변경 금지 (980 lines, 변경 0).
- `useDataGridEdit` (`cellToEditValue` / `editKey` / `getInputTypeForColumn` / `DataGridEditState`) / `BsonTreeViewer` / `BlobViewerDialog` API 변경 금지.
- `DataGrid.tsx` / `DocumentDataGrid.tsx` import 경로 변경 금지.
- 새 feature, 새 동작, 새 테스트 작성 금지.

## Invariants

- 외부 import path: `@components/shared/QuickLookPanel` 가 React 컴포넌트 default export. 3 props types (`QuickLookPanelProps`, `QuickLookPanelRdbProps`, `QuickLookPanelDocumentProps`) named exports of entry.
- ARIA: `role="separator"` / `aria-valuemin="120"` / `aria-valuemax="600"` / `aria-valuenow` / `aria-label="Resize Quick Look panel"` / region `aria-label="Row Details"` (RDB) / `aria-label="Document Details"` (document) / close `aria-label` 매핑 / edit toggle `aria-pressed` / per-cell labels (`Edit value for {n}` / `Set NULL for {n}` / `Value for {n}` / `View BLOB data for {n}`) 그대로.
- 상수: `MIN_HEIGHT=120` / `MAX_HEIGHT=600` / `DEFAULT_HEIGHT=280` / `KEYBOARD_RESIZE_STEP=8`.
- Resize: mouse drag (up=grow / down=shrink, document `mouseup`, `cursor` / `userSelect` 복원) + Shift+ArrowUp/Down ±8px clamp [120,600] + plain Arrow / Shift+Enter no-op.
- Edit dispatch ordering: `handleStartEdit(r,c,original) → setEditValue(next) → saveCurrentEdit()`. boolean `Select` 3-way (true / false / NULL).
- PK / BLOB / `_id` 읽기전용 게이트.
- Dirty-pill: `pendingEdits` 에 `${firstSelectedId}-` prefix 키 존재 시 ● Modified 표시. 읽기전용 call-site 0 / 다른 행 dirty 0.
- BLOB viewer 마운트는 RDB body 한정.
- Document mode read-only-tree vs edit-FieldRows 토글: `editing && data` 둘 다 만족해야 FieldRows.
- 새 `eslint-disable*` 0, 새 silent `catch{}` 0. 기존 `formatCellValue` 의 swallow comment 보존.

## Done Criteria

1. 5 파일 (entry + 4 sub-file) 모두 존재 + 비어있지 않음.
2. entry < 250 lines, 단일 sub-file < 400 lines.
3. `QuickLookPanel.test.tsx` 변경 0 + `pnpm vitest run src/components/shared/QuickLookPanel.test.tsx` exit 0.
4. `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` 모두 exit 0.
5. 외부 import 경로 / props types named exports / 동작 변경 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `wc -l src/components/shared/QuickLookPanel.tsx` < 250.
  2. `ls src/components/shared/QuickLookPanel/{QuickLookShell.tsx,RdbQuickLookBody.tsx,DocumentQuickLookBody.tsx,helpers.ts}` 4 파일 존재.
  3. `wc -l src/components/shared/QuickLookPanel/*.{ts,tsx}` 단일 sub-file < 400.
  4. `git diff --stat src/components/shared/QuickLookPanel.test.tsx` 변경 0.
  5. `pnpm vitest run src/components/shared/QuickLookPanel.test.tsx` exit 0.
  6. `pnpm vitest run` exit 0, post-210 baseline (189 files / 2725 tests) 이상.
  7. `pnpm tsc --noEmit` exit 0.
  8. `pnpm lint` exit 0.
  9. `grep -rn "from \"@components/shared/QuickLookPanel/" src/ e2e/` 매치 0.
  10. `grep -rn "from \"@components/shared/QuickLookPanel\"" src/ e2e/` 매치 set 동일 (`DataGrid.tsx:26`, `DocumentDataGrid.tsx:6`).
  11. `grep -n "export interface QuickLookPanelRdbProps\|export interface QuickLookPanelDocumentProps\|export type QuickLookPanelProps" src/components/shared/QuickLookPanel.tsx` 3 매치.
  12. `git diff src/components/shared/QuickLookPanel.tsx src/components/shared/QuickLookPanel/` grep `^+.*eslint-disable` 매치 0.
- Required evidence:
  - 5 변경 파일의 diff stat
  - check 1-12 의 실행 결과 (exit code + 핵심 출력)
  - AC-01..AC-05 별 evidence (파일 경로 + grep 결과 + line count + test summary)

## Evidence To Return

- Changed files and purpose: 5 파일 (entry rewrite + 4 sub-file 생성) + 각각의 책임 한 줄 설명.
- Checks run and outcomes: 12 checks 각각의 exit code + 핵심 출력 line.
- Done criteria coverage with evidence: AC-01~05 별 concrete evidence.
- Assumptions made during implementation: 기존 hook signature / `BsonTreeViewer` / `BlobViewerDialog` / `useDataGridEdit` API 그대로 사용, 새 API 도입 0 가정. `HeaderControls` 패턴 단일화 (`QuickLookShell` 내부 inline 또는 helper) — entry 외부 노출 0.
- Residual risk or verification gaps: 행동 보존 검증의 단일 source of truth = 980-line `QuickLookPanel.test.tsx`. test 자체가 누락된 케이스가 있다면 본 sprint 가 잡지 못함 — 후속 sprint candidate.

## References

- Contract: `docs/sprints/sprint-211/contract.md`
- Findings: `docs/sprints/sprint-211/findings.md` (작성 예정)
- Relevant files:
  - `src/components/shared/QuickLookPanel.tsx` (target, 868 lines)
  - `src/components/shared/QuickLookPanel.test.tsx` (980 lines, regression guard)
  - `src/components/rdb/DataGrid.tsx:26` (importer, 변경 0)
  - `src/components/document/DocumentDataGrid.tsx:6` (importer, 변경 0)
  - `src/components/datagrid/useDataGridEdit.ts` (`cellToEditValue` / `editKey` / `getInputTypeForColumn` / `DataGridEditState`)
  - `src/components/shared/BsonTreeViewer.tsx`
  - `src/components/shared/BlobViewerDialog.tsx`
  - 이전 entry-pattern 참고: `src/components/document/DocumentDataGrid.tsx` (Sprint 210), `src/components/rdb/DataGridTable.tsx` (Sprint 200), `src/components/schema/SchemaTree.tsx` (Sprint 199)
- 인접 sprint 문서: `docs/sprints/sprint-210/{contract,findings,handoff}.md`
- 후속 candidates: `docs/archives/etc/refactoring-candidates.md` §P2
