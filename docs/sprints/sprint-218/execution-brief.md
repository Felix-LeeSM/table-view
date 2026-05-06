# Sprint Execution Brief: sprint-218

## Objective

`src/components/query/QueryTab.test.tsx` (2,308 lines, 1 root describe + 1 nested describe, 80 cases) 를 4-6 behavior-axis test 파일 (`QueryTab.{lifecycle,toolbar,execution,history,dialect,document}.test.tsx`) + 1 shared helper 파일 (`__tests__/queryTabTestHelpers.ts`) 로 분해. 사전 case axis-별 재배치만; case 추가/제거 0; 행동 변경 0. P11 step 2.

## Task Why

- post-209 cycle 의 P11 step 2. `refactoring-candidates.md` §P11 명시.
- Sprint 216 (P11 step 1, SchemaTree.test 2891→6 axis) 의 model implementation 패턴 답습.
- 1,900-2,900 라인 mega test 5건 중 두 번째 (2,308) — Sprint 별 section + AC label 그룹핑이 axis 추출 명확.
- axis 후보가 자연스러움: lifecycle / toolbar / execution / history / dialect / document.
- test-only — risk 낮음.
- 사용자 hooks/lib 작업 진행 중 P10 risk 회피 + P11 step 2 이어 진행.

## Scope Boundary

- 신규 axis test 파일 4-6개 + 신규 shared helper 파일 1 + 사전 entry 처리만.
- `QueryTab.tsx` (228 lines, entry) + `QueryTab/` sub-file 6개 변경 금지.
- 11 sibling test 파일 변경 금지 (`QueryEditor.test.tsx` / `SqlQueryEditor.test.tsx` / `MongoQueryEditor.test.tsx` / `QueryResultGrid.test.tsx` / `QueryResultGrid.multi-statement.test.tsx` / `EditableQueryResultGrid.test.tsx` / `EditableQueryResultGrid.safe-mode.test.tsx` / `FavoritesPanel.test.tsx` / `GlobalQueryLogPanel.test.tsx` / `QueryLog.test.tsx` / `PendingChangesTray.test.tsx`).
- `MainArea.tsx` 변경 금지.
- store / hook / 외부 importer / 모든 src/ component 변경 금지.
- case 1건 추가/제거 금지. case 텍스트 / matcher / fixture / mock / store seed 변경 금지.
- AC label / sprint section header 변경 금지 (axis context comment 추가는 허용).

## Invariants

- 사전 80 case 모두 사후 통과.
- 24 verbatim AC string 사후 axis 파일 안 1건 이상.
- 7 vi.mock factory 사전 동일.
- 사전 import / mock / fixture / store seed pattern 보존.
- ARIA label / verbatim text 보존.
- public surface (`QueryTabProps`) 동결.
- 새 `eslint-disable*` / silent `catch{}` 0.
- helper 파일 외부 import 0.
- axis 파일 안 `it.only` / `it.skip` / 추가 nested describe 0 (단 Sprint 188 nested describe 옵션 B 보존 시 `QueryTab.document.test.tsx` 1개 nested 허용).

## Done Criteria

1. `pnpm vitest run src/components/query/QueryTab*.test.tsx` exit 0 + 80 cases pass.
2. 신규 axis 파일 4-6개 + 각 5-25 case + sibling 11 + sub-file 6 + entry 충돌 0.
3. 사전 entry 처리: 옵션 1 (제거, 권고) 또는 옵션 2 (smoke ≤ 5 case 잔존).
4. 24 verbatim AC string 사후 axis 파일 안 1건 이상.
5. `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` 모두 exit 0. `QueryTab.tsx` + sub-file 6 + 11 sibling test + `MainArea.tsx` 모두 변경 0.

## Verification Plan

- Profile: `command`
- Required checks: contract.md 의 18 checks 동일.
- Required evidence:
  - 변경 파일 목록 (신규 axis + helper + entry 처리)
  - check 1-18 실행 결과
  - AC-01..AC-05 별 evidence
  - 24 verbatim AC string 매치 결과
  - Sprint 188 nested describe 처리 옵션 (A 또는 B) 명시

## Evidence To Return

- Changed files and purpose: 신규 axis 파일 4-6개 + helper 파일 + entry 처리.
- Checks run and outcomes: 18 checks 각각의 exit code + 핵심 출력.
- Done criteria coverage: AC-01~05 별 concrete evidence.
- Assumptions:
  - axis 파일 이름 / 개수 (generator 재량 4-6개).
  - helper 파일 위치 (옵션 B `__tests__/` vs sibling).
  - 사전 entry 처리 (옵션 1 제거 vs 옵션 2 smoke).
  - case 분배 axis 별 (generator 재량 ±2).
  - Sprint 188 nested describe 처리 (옵션 A 평탄화 vs 옵션 B 보존, 권고 B).
  - shared async helper (makeDocTab 등) 위치 (helpers.ts 승격 vs 각 axis inline).
- Residual risk:
  - vi.mock factory ES hoisting — axis 파일 module-level inline 7 factory 누락 시 mock undefined → render fail.
  - 7 factory inline 복제 = 코드 중복 7배 (받아들임 — generator 재량 dynamic import 또는 mockReset 패턴 도입 가능).
  - case body 의 지역 변수명 변경이 의도 안 된 의미 변경 유발 가능성 — generator cut/paste 시 textually 보존 의무.
  - `mockEditorProps` 6 필드 reset 패턴 누락 시 mock leakage.
  - axis 파일 worker 격리에 의존 — test 간 store leakage 발견 시 후속 sprint candidate.
  - Sprint 188 nested describe 의 `localStorage.removeItem(SAFE_MODE_STORAGE_KEY)` 누락 시 axis 분리 후 mock leak.

## References

- Contract: `docs/sprints/sprint-218/contract.md`
- Spec: `docs/sprints/sprint-218/spec.md`
- Findings: `docs/sprints/sprint-218/findings.md` (작성 예정)
- Sprint 216 model implementation: `docs/sprints/sprint-216/{contract,findings,handoff}.md`
- Relevant files:
  - `src/components/query/QueryTab.test.tsx` (2,308 lines, target)
  - `src/components/query/QueryTab.tsx` (entry, 228 lines, 변경 0)
  - `src/components/query/QueryTab/{Toolbar,HistoryPanel,useQueryExecution,useQueryEvents,useQueryFavorites,queryHelpers}.{tsx,ts}` (sub-file 6, 변경 0)
  - 11 sibling test (위 Scope Boundary 참조, 모두 변경 0)
  - `src/components/layout/MainArea.tsx` (변경 0)
- 인접 sprint 문서: `docs/sprints/sprint-216/{spec,contract,handoff}.md`
- 후속 candidates: P11 step 3-5 (`tabStore.test.ts` 2,234 / `StructurePanel.test.tsx` 2,156 / `DataGrid.test.tsx` 1,906), P10 (stores side-effects, risk 높음, Sprint 219).
