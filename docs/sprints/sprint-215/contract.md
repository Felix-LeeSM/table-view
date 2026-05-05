# Sprint Contract: sprint-215

## Summary

- Goal: `src/components/query/EditableQueryResultGrid.tsx` (654 lines) 의 raw-query edit state machine + commit lifecycle 을 `useRawQueryGridEdit` hook 으로 추출. component 는 hook 호출 1건 + UI 렌더링만 잔존. P8 first step (hook extraction) 만 — `useDataGridPreviewCommit` 와의 공유는 P8 second step (후속 sprint) 에서 검토.
- Audience: Generator + Evaluator (multi-agent harness, post-209 cycle).
- Owner: harness skill orchestrator.
- Verification Profile: `command`

## In Scope

- `useRawQueryGridEdit` hook 신규 작성 (8 state + 14 handler + 1 useEffect (Cmd+S) + safeModeGate 호출 + executeQueryBatch + history record).
- `EditableQueryResultGrid.tsx` 의 9 state + 14 handler + Cmd+S useEffect + 5 store/util 호출 모두 hook 으로 이동.
- Hook 위치: `src/components/query/useRawQueryGridEdit.ts`.

## Out of Scope

- 행동 변경, 새 feature 추가.
- `EditableQueryResultGrid.test.tsx` (450) / `EditableQueryResultGrid.safe-mode.test.tsx` (268) 변경 (2 파일 모두 변경 0).
- `QueryResultGrid.tsx` 변경 (외부 importer).
- `PendingChangesTray.tsx` 변경 (sibling).
- `executeQueryBatch` Tauri command payload 변경.
- `useSafeModeGate` / `useQueryHistoryStore` API 변경.
- `analyzeStatement` / `buildRawEditSql` 호출부 변경.
- "Safe Mode (warn): confirmation cancelled — no changes committed" 메시지 변경.
- "Commit failed — all changes rolled back: {msg}" prefix 변경.
- history `source: "grid-edit"` / `paradigm: "rdb"` / `queryMode: "sql"` tagging 변경.
- Cmd+S event name "commit-changes" 변경.
- `useDataGridPreviewCommit` 와의 공유 (P8 second step, 후속 sprint).
- 새 unit test 작성 의무 (선택, generator 재량).

## Invariants

- `EditableQueryResultGridProps` 시그니처 (`result` / `connectionId` / `plan` / `onAfterCommit?` 4 fields) 동결.
- default export 위치 동결.
- Hook 은 `src/components/query/` 안에서만 사용 (외부 노출 0).
- Safe Mode 5단계 (block / warn confirm / cancel / non-prod skip / prod-auto) 사전 동일.
- ConfirmDangerousDialog `data-slot` + reason + sqlPreview prop 보존.
- SQL preview Dialog production stripe 보존.
- 새 `eslint-disable*` / silent `catch{}` 0.
- `useDataGridPreviewCommit` import hook 안 절대 0.

## Acceptance Criteria

- `AC-01`: hook 파일 존재 + 150~350 lines + 1+ named export. default export 0.
- `AC-02`: component 가 hook 사용 — `grep -n "useRawQueryGridEdit"` ≥ 2. component 본문에서 8 state useState 모두 0 + 6 helper 호출 모두 0.
- `AC-03`: component 사전 미만 (`<654`) + 합산 (component + hook) ≤ 800 + hook 단독 150~350.
- `AC-04`: 2 regression test 변경 0 — `git diff --stat` 모두 0. `pnpm vitest run` 2 파일 exit 0.
- `AC-05`: 프로젝트 회귀 0 — `pnpm vitest run` (post-Sprint-214 baseline 189 files / 2720 tests, ±1 file 허용) / `pnpm tsc --noEmit` / `pnpm lint` 모두 exit 0. 새 `eslint-disable*` 0. 새 silent `catch{}` 0. `QueryResultGrid.tsx` / `PendingChangesTray.tsx` diff 0.

## Design Bar / Quality Bar

- 추출 + 적용. 새 비즈니스 로직 추가 금지.
- hook 입력 4 prop 만 (추가 caller 친화 prop 0).
- hook 안의 history payload `source: "grid-edit"` / `paradigm: "rdb"` / `queryMode: "sql"` hardcoded.
- `useDataGridPreviewCommit` import hook 안 절대 0 (P8 second step 침범 금지).
- 사전 1 catch 본문 의미 (setExecuteError + addHistoryEntry "error" + finally setExecuting(false)) 보존.
- 모든 sprint commit 의 git diff 가 "state machine + handler + lifecycle 이동" 으로 읽혀야 함.

## Verification Plan

### Required Checks

1. `wc -l src/components/query/useRawQueryGridEdit.ts` 150~350.
2. `wc -l src/components/query/EditableQueryResultGrid.tsx` < 654.
3. 합산 (component + hook) ≤ 800.
4. `git diff --stat src/components/query/EditableQueryResultGrid.test.tsx src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` 모두 0.
5. `pnpm vitest run src/components/query/EditableQueryResultGrid.test.tsx src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` exit 0.
6. `pnpm vitest run` exit 0, post-Sprint-214 baseline (189 files / 2720 tests) ±1 file 허용.
7. `pnpm tsc --noEmit` exit 0.
8. `pnpm lint` exit 0.
9. `grep -n "useRawQueryGridEdit" src/components/query/EditableQueryResultGrid.tsx` 매치 ≥ 2.
10. `grep -nE "useState[<(].*pendingEdits|useState[<(].*pendingDeletedRowKeys|useState[<(].*sqlPreview|useState[<(].*executing|useState[<(].*executeError|useState[<(].*pendingConfirm|useState[<(].*editingCell|useState[<(].*editValue" src/components/query/EditableQueryResultGrid.tsx` 매치 0.
11. `grep -n "executeQueryBatch(" src/components/query/EditableQueryResultGrid.tsx` 매치 0.
12. `grep -n "analyzeStatement(" src/components/query/EditableQueryResultGrid.tsx` 매치 0.
13. `grep -n "buildRawEditSql(" src/components/query/EditableQueryResultGrid.tsx` 매치 0.
14. `grep -n "useSafeModeGate(" src/components/query/EditableQueryResultGrid.tsx` 매치 0.
15. `grep -n "useQueryHistoryStore" src/components/query/EditableQueryResultGrid.tsx` 매치 0.
16. `grep -n "useDataGridPreviewCommit" src/components/query/useRawQueryGridEdit.ts` 매치 0 (P8 second step 침범 금지).
17. `grep -n "^export default" src/components/query/useRawQueryGridEdit.ts` 매치 0.
18. `grep -n "^export default function EditableQueryResultGrid" src/components/query/EditableQueryResultGrid.tsx` 매치 1.
19. `grep -rn "from \"@components/query/useRawQueryGridEdit\"\|from \"./useRawQueryGridEdit\"" src/ e2e/` 매치 ≤ 2.
20. `git diff --stat src/components/query/QueryResultGrid.tsx src/components/query/PendingChangesTray.tsx` 모두 0.
21. `git diff src/components/query/ | grep "^+.*eslint-disable"` 매치 0.

### Required Evidence

- Generator must provide:
  - 변경 파일 (hook 신규 + component 수정) 의 diff stat.
  - check 1-21 의 실행 결과 (exit code + 핵심 출력).
  - AC-01..AC-05 별 evidence (파일 경로 + grep 결과 + line count + test summary).
  - 새 `eslint-disable*` / silent `catch` 0 임을 git diff 로 보여주기.
- Evaluator must cite:
  - 각 AC 별 pass/fail 근거 (concrete output).
  - missing 또는 weak evidence 는 finding 으로.

## Test Requirements

### Unit Tests (필수)

- 본 sprint 는 행동 변경 0 의 refactor — 신규 unit test 작성 0 권고. Generator 재량으로 hook unit test 추가 가능.
- 기존 2 regression test (`EditableQueryResultGrid.test.tsx` 450 + `EditableQueryResultGrid.safe-mode.test.tsx` 268 = 718 lines) 가 source of truth.

### Coverage Target

- 신규 hook 의 직접 unit test 0 (regression test 가 통합 커버).
- 프로젝트 전체 baseline (라인 40% / 함수 40% / 브랜치 35%) 유지.

### Scenario Tests (필수)

- [x] Happy path — cell edit / delete row / Commit / Execute / cleanup / onAfterCommit / history.
- [x] 에러 / 예외 — Safe Mode block / warn confirm / cancel / commit failure / multi-statement preview.
- [x] 경계 조건 — no-PK guard / unchanged-skip / Cmd+S during edit / dialog cancel / discard.
- [x] 기존 기능 회귀 없음 — `pnpm vitest run` 전체.

## Test Script / Repro Script

1. baseline 확인:
   ```sh
   pnpm vitest run src/components/query/EditableQueryResultGrid.test.tsx src/components/query/EditableQueryResultGrid.safe-mode.test.tsx
   ```
2. Generator 작업 후 동일 명령 다시 실행 → exit 0.
3. `pnpm vitest run && pnpm tsc --noEmit && pnpm lint` 전체 회귀.
4. `wc -l src/components/query/useRawQueryGridEdit.ts src/components/query/EditableQueryResultGrid.tsx` 라인 카운트 보고.

## Ownership

- Generator: general-purpose agent (multi-agent harness Phase 3).
- Write scope: `src/components/query/{useRawQueryGridEdit.ts, EditableQueryResultGrid.tsx}` + 선택적 hook unit test. 그 외 파일 (2 regression test / QueryResultGrid / PendingChangesTray / dependent libs) 변경 금지.
- Merge order: 본 sprint commit → handoff.md → PLAN.md hash → 다음 sprint.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (1-21 모두)
- Acceptance criteria evidence linked in `handoff.md`
