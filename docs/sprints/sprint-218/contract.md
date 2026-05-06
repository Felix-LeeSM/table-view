# Sprint Contract: sprint-218

## Summary

- Goal: `src/components/query/QueryTab.test.tsx` (2,308 lines / 1 root + 1 nested describe / 80 cases) 를 4-6 behavior-axis test 파일 + 1 shared helper 파일로 분해. 행동 변경 0; `QueryTab.tsx` + sub-file 6개 + 11 sibling test 모두 변경 0. 사전 80 case 모두 사후 통과.
- Audience: Generator + Evaluator (multi-agent harness, post-209 cycle, P11 step 2).
- Owner: harness skill orchestrator.
- Verification Profile: `command`

## In Scope

- 신규 axis test 파일 4-6개: `src/components/query/QueryTab.{lifecycle,toolbar,execution,history,dialect,document}.test.tsx` (이름은 generator 재량, 단 사전 sibling test 파일 11개와 충돌 0).
- 신규 shared helper 파일 (옵션 B 권고): `src/components/query/__tests__/queryTabTestHelpers.ts`.
- 사전 entry `QueryTab.test.tsx` 처리: 옵션 1 (제거, 권고) 또는 옵션 2 (smoke ≤ 5 case 잔존, 허용).
- 모든 신규 axis 파일이 사전 80 case 의 axis-별 분배.
- Sprint 188 nested describe 처리: 옵션 A (평탄화) 또는 옵션 B (보존, 권고).

## Out of Scope

- 행동 변경, 새 feature 추가.
- `QueryTab.tsx` 본체 변경 (entry, 228 lines).
- `QueryTab/{Toolbar.tsx, HistoryPanel.tsx, useQueryExecution.ts, useQueryEvents.ts, useQueryFavorites.ts, queryHelpers.ts}` 6 sub-file 변경.
- 11 sibling test 파일 변경 (`QueryEditor.test.tsx` / `SqlQueryEditor.test.tsx` / `MongoQueryEditor.test.tsx` / `QueryResultGrid.test.tsx` / `QueryResultGrid.multi-statement.test.tsx` / `EditableQueryResultGrid.test.tsx` / `EditableQueryResultGrid.safe-mode.test.tsx` / `FavoritesPanel.test.tsx` / `GlobalQueryLogPanel.test.tsx` / `QueryLog.test.tsx` / `PendingChangesTray.test.tsx`).
- `MainArea.tsx` 변경.
- store / hook / 외부 importer 변경.
- case 텍스트 / matcher / fixture data shape 변경.
- 새 unit test 작성 (case 추가/제거 0).
- AC label / sprint section 헤더 변경.

## Invariants

- 사전 80 case 모두 사후 통과 + case 추가/제거 0.
- 24 verbatim AC string 모두 사후 axis 파일 안에 1건 이상 존재.
- 사전 7 vi.mock factory 보존 (`@lib/tauri` / `@lib/api/verifyActiveDb` / `./SqlQueryEditor` / `./MongoQueryEditor` / `./QueryResultGrid` / `@hooks/useSqlAutocomplete` / `@lib/sql/sqlUtils`).
- 사전 import / mock pattern 보존 — 5 mock fn (`mockExecuteQuery` / `mockCancelQuery` / `mockFindDocuments` / `mockAggregateDocuments` / `mockVerifyActiveDb`) + module-level `mockEditorProps` snapshot.
- 사전 ARIA label / verbatim text 보존 (`getByTestId("mock-editor")` / `getByTestId("execute-btn")` / `data-paradigm` / `data-status`).
- 사전 fixture data shape 보존 (`MOCK_RESULT` / `MOCK_DOC_RESULT` / `makeQueryTab` / `makeConn` / `makeDocTab` / `PROD_PIPELINE` / `SAFE_PIPELINE`).
- 사전 store seed pattern 보존 — `beforeEach` 6 store reset + 5 mock `mockReset()` + `mockEditorProps` 6 필드 reset + `__resetDocumentStoreForTests()`. Sprint 188 nested `beforeEach` 의 `localStorage.removeItem(SAFE_MODE_STORAGE_KEY)` + `useSafeModeStore.setState({ mode: "strict" })` 보존.
- public surface (`QueryTabProps`) 동결.
- 새 `eslint-disable*` / silent `catch{}` 0.
- `it.only` / `it.skip` 0.

## Acceptance Criteria

- `AC-01`: 사후 QueryTab*.test.tsx glob 합계 case = 사전 80 (옵션 1 채택 시 정확히 80, 옵션 2 채택 시 axis + entry smoke 합계 = 80). `pnpm vitest run src/components/query/QueryTab*.test.tsx` exit 0.
- `AC-02`: 신규 axis 파일 4-6개 + 각 ≥ 5 case + ≤ 25 case + sibling test 11개와 충돌 0.
- `AC-03`: shared helper 파일 (옵션 B) 채택 시 named export 8-10 (5 mock + `mockEditorProps` + 2-3 fixture builder + 2 fixture constant + `resetQueryTabStores`) 보유. 외부 import 0 (axis 파일만).
- `AC-04`: 사전 entry 처리 옵션 1 (파일 제거, 권고) 또는 옵션 2 (≤ 5 smoke case 잔존).
- `AC-05`: 24 verbatim AC string 모두 사후 axis 파일 안 1건 이상 매치. Global AC 1-10 모두 충족.

## Design Bar / Quality Bar

- test-only refactor — `QueryTab.tsx` + sub-file 6개 + 11 sibling test + `MainArea.tsx` 변경 0.
- case 1건도 추가/제거/변경 금지. axis-별 재배치만.
- helper 파일은 named export 만 (default export 0). 외부 import 0 (axis 파일 only).
- vi.mock factory ES hoisting 으로 helper 외부 호출 불가 — axis 파일 module-level inline 7 factory 복제.
- AC label / sprint section header / 모든 comment 사전 동일하거나 axis context 추가 (의미 추가, 의미 변경 금지).
- 모든 sprint commit 의 git diff 가 "case 이동 + helper 추출" 으로 읽혀야 함.
- Sprint 188 nested describe 보존 (옵션 B 권고) — setup 격리 명확.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/query/QueryTab*.test.tsx` exit 0. Tests passed = 사전 80.
2. `pnpm vitest run` exit 0. file count [197, 200]. tests = 2720.
3. `pnpm tsc --noEmit` exit 0.
4. `pnpm lint` exit 0.
5. `find src/components/query -maxdepth 1 -name "QueryTab.*.test.tsx" -not -name "QueryTab.test.tsx" | wc -l` ∈ [4, 6].
6. `for f in <new axis files>; do grep -cE "^\s*it\(" $f; done` 합계 ∈ [75, 80] (옵션 2 채택 시 ≥ 75).
7. `git diff --stat src/components/query/QueryTab.tsx` 0.
8. `git diff --stat src/components/query/QueryTab/` 0.
9. `git diff --stat src/components/query/QueryEditor.test.tsx src/components/query/SqlQueryEditor.test.tsx src/components/query/MongoQueryEditor.test.tsx src/components/query/QueryResultGrid.test.tsx src/components/query/QueryResultGrid.multi-statement.test.tsx src/components/query/EditableQueryResultGrid.test.tsx src/components/query/EditableQueryResultGrid.safe-mode.test.tsx src/components/query/FavoritesPanel.test.tsx src/components/query/GlobalQueryLogPanel.test.tsx src/components/query/QueryLog.test.tsx src/components/query/PendingChangesTray.test.tsx` 모두 0.
10. `git diff --stat src/components/layout/MainArea.tsx` 0.
11. `git diff src/components/query/ | grep "^+.*eslint-disable"` 매치 0.
12. 24 verbatim AC string 별 `grep -rnF "<verbatim>" src/components/query/QueryTab*.test.tsx | wc -l` ≥ 1.
13. 옵션 1 채택 시 `test ! -f src/components/query/QueryTab.test.tsx`. 옵션 2 채택 시 `wc -l < 200 + grep -cE "^\s*it\(" ≤ 5`.
14. helper 파일 (옵션 B) 존재 시 named export 8-10 매치 (5 mock + `mockEditorProps` + 2-3 fixture builder + 2 fixture constant + `resetQueryTabStores`).
15. helper 파일 외부 import 0 — `grep -rn "queryTabTestHelpers" src/ e2e/` 매치 ≤ 신규 axis 파일 수.
16. axis 파일 안 `it.only` / `it.skip` 매치 0.
17. 각 axis 파일 root describe 1개 (Sprint 188 nested 옵션 B 채택 시 `QueryTab.document.test.tsx` 의 root + nested 1개 = 총 describe 2개 허용).
18. 7 vi.mock factory 가 각 axis 파일 module-level 에 inline (`grep -cE "vi\.mock\(" $f` ≥ 7 각 파일).

### Required Evidence

- Generator must provide:
  - 변경 파일 목록 (신규 axis + helper + entry 처리).
  - check 1-18 실행 결과.
  - AC-01..AC-05 별 evidence.
  - 24 verbatim AC string 매치 결과.
  - Sprint 188 nested describe 처리 옵션 (A 또는 B) 명시.
- Evaluator must cite:
  - 각 AC 별 pass/fail 근거.
  - missing 또는 weak evidence finding.

## Test Requirements

- 본 sprint 는 test-only refactor — 신규 case 작성 0.
- 사전 80 case 가 source-of-truth. 옵션 1 채택 시 사후 80 = 신규 axis 파일 합계.

## Test Script / Repro Script

1. baseline:
   ```sh
   pnpm vitest run src/components/query/QueryTab*.test.tsx
   ```
2. Generator 작업 후 동일 명령 → exit 0 + 80 cases.
3. `pnpm vitest run && pnpm tsc --noEmit && pnpm lint`.
4. axis 파일 목록 + case 합계 검증.

## Ownership

- Generator: general-purpose agent (Phase 3).
- Write scope: `src/components/query/QueryTab.<axis>.test.tsx` 신규 + `src/components/query/__tests__/queryTabTestHelpers.ts` (옵션 B) + 사전 entry 처리.
- 변경 금지: `QueryTab.tsx` / sub-file 6 / 11 sibling test 파일 / `MainArea.tsx` / store / hook.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (1-18 모두)
- Acceptance criteria evidence linked in `handoff.md`
