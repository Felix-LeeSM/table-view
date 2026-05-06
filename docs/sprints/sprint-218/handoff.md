# Sprint 218 — Handoff

다음 sprint 진입자가 알아야 할 사항.

## 완료 산출물

- 신규 6 axis test 파일 (사전 1 mega file 의 axis-별 분배):
  - `src/components/query/QueryTab.lifecycle.test.tsx` (8 cases) — idle render / execute happy/error / empty-SQL guard / cancel-query event / flex-column body / resize handle.
  - `src/components/query/QueryTab.toolbar.test.tsx` (5 cases) — Sprint 25 Run/Cancel button states.
  - `src/components/query/QueryTab.execution.test.tsx` (17 cases) — Sprint 36 multi-statement / Cancel button live / Format-SQL / Sprint 53 Uglify.
  - `src/components/query/QueryTab.history.test.tsx` (16 cases) — Sprint 34 history record + UI / Sprint 84 metadata + restore + legacy / Sprint 85 coloration.
  - `src/components/query/QueryTab.dialect.test.tsx` (11 cases) — Sprint 82 dialect prop / Sprint 83 mongoExtensions.
  - `src/components/query/QueryTab.document.test.tsx` (23 cases) — Sprint 73 Document paradigm / Sprint 132 raw-query DB-change / Sprint 188 Mongo aggregate safe-mode (옵션 B nested 보존).
- 신규 shared helper: `src/components/query/__tests__/queryTabTestHelpers.ts` (12 named export = 5 mock fn + `mockEditorProps` snapshot + 3 fixture builder + 2 fixture constant + `resetQueryTabStores`). 안에 `vi.mock(...)` 호출 0 (ES hoisting 회피).
- 삭제: `src/components/query/QueryTab.test.tsx` (사전 2,308 lines / 80 cases, 옵션 1 채택).
- `docs/sprints/sprint-218/{spec,contract,execution-brief,findings,evaluator-scorecard,handoff}.md`.

case 합계 = lifecycle 8 + toolbar 5 + execution 17 + history 16 + dialect 11 + document 23 = **80** (사전 동일).

## 다음 sprint 후보

PLAN.md 의 잔여 시퀀스 (post-209 cycle):

- **P11 step 3** — `tabStore.test.ts` (2,234 lines) axis split.
- **P11 step 4** — `StructurePanel.test.tsx` (2,156 lines) axis split.
- **P11 step 5** — `DataGrid.test.tsx` (1,906 lines) axis split.
- **P10** (Sprint 219) — `connectionStore` / `schemaStore` 의 toast / session / IPC orchestration → use-case hook 점진 이동. risk 높음 — 사용자 hooks/lib 작업 안정 후 진입.

## 검증 결과

| 명령 | 결과 |
|------|------|
| `pnpm vitest run src/components/query/QueryTab*.test.tsx` | 6 files / 80 passed, exit 0 |
| `pnpm vitest run` (full suite) | 199 files / 2720 tests passed, exit 0 (사전 194 + 6 신규 - 1 삭제 = 199 ∈ [197, 200] ✓) |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| 신규 axis 파일 수 | 6 (∈ [4, 6] ✓) |
| 신규 axis case 합계 | 80 (사전 동일 ✓) |
| `git diff --stat src/components/query/QueryTab.tsx` | 0 |
| `git diff --stat src/components/query/QueryTab/` | 0 (6 sub-file 모두) |
| 11 sibling test diff | 모두 0 |
| `git diff --stat src/components/layout/MainArea.tsx` | 0 |
| 새 `eslint-disable*` 매치 | 0 |
| 24 verbatim AC string 보존 | 각 정확히 1 매치 |
| Helper named export | 12 (5 mock + 1 prop snapshot + 3 fixture builder + 2 fixture constant + 1 reset) |
| Helper 외부 import | 6 (= axis 파일 수, ≤ 신규 axis 수) |
| `it.only` / `it.skip` | 0 |
| 각 axis 파일 root describe | 1개씩 (document axis 만 옵션 B nested 1개 보존 = 총 describe 2개) |
| 각 axis 파일 vi.mock factory | 각 7개 (사전 동일) |

## Acceptance Criteria 결과

- AC-01 사후 QueryTab*.test.tsx 합계 80 통과 ✓
- AC-02 신규 axis 6개 (∈ [4-6]) + 각 5-23 case + sibling 충돌 0 ✓
- AC-03 helper named export 12 + 외부 import 6 (= axis 수) ✓
- AC-04 사전 entry 옵션 1 (제거) 채택 ✓
- AC-05 24 verbatim AC string 모두 정확히 1 매치 + Global AC 1-10 충족 ✓

Evaluator: **PASS** (Correctness 9 / Completeness 9 / Reliability 10 / Verification Quality 9). P1/P2 finding 0건. F-001..F-002 모두 P3 (helper export count 가 spec headline "8-10" 보다 +2 — spec breakdown 의 5+1+3+2+1=12 와 일치 / execution axis 17 case 가 권고 13-16 +1 — Format-SQL + Uglify cohesion).

## 주의 사항

### Mock 격리 — vitest worker-per-file 의존

vitest 의 worker-per-file 격리에 의존해 5 mock fn instance 가 axis 파일마다 격리됨. `mockReset()` (clearAllMocks 가 아님) + `mockEditorProps` 6 필드 reset + `resetQueryTabStores()` 패턴이 매 axis 파일 `beforeEach` 마다 verbatim 보존 — 사전 QueryTab.test.tsx 와 동일.

### vi.mock factory ES hoisting

7 vi.mock factory (`@lib/tauri` / `@lib/api/verifyActiveDb` / `./SqlQueryEditor` / `./MongoQueryEditor` / `./QueryResultGrid` / `@hooks/useSqlAutocomplete` / `@lib/sql/sqlUtils`) 는 ES hoisting 으로 helper 외부 호출 불가 — 각 axis 파일 module-level inline 7 factory 복제. helper.ts 안 vi.mock 호출 0.

### Sprint 188 nested describe — 옵션 B 보존

`describe("Sprint 188 — Mongo aggregate safe-mode gate", ...)` 6 case 가 `QueryTab.document.test.tsx` 안에 nested 로 보존. nested `beforeEach` 의 `localStorage.removeItem(SAFE_MODE_STORAGE_KEY)` + `useSafeModeStore.setState({ mode: "strict" })` verbatim. setup 격리 명확.

### Helper 12 export — `MOCK_DOC_RESULT` + `makeDocTab` 승격

spec.md headline "8-10" 권고보다 +2 — `MOCK_DOC_RESULT` (Sprint 73 fixture) + `makeDocTab` (Sprint 73 + Sprint 188 fixture builder) 를 cross-axis 공유로 승격. 사전 entry 가 동일 fixture 를 inline 정의하던 것을 단일 helper 로 통합. 코드 중복 회피. helper 외부 import 0 invariant 보존.

### 사용자 병행 작업 분리

본 sprint 작업은 `src/components/query/QueryTab.{axis}.test.tsx` + `__tests__/queryTabTestHelpers.ts` + `docs/sprints/sprint-218/` 안에 격리. Working tree 의 사용자 병행 작업 (hooks/lib) 은 본 sprint commit 에 미포함.

## 검증 명령 (재현)

```sh
pnpm vitest run src/components/query/QueryTab*.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
ls src/components/query/QueryTab.{lifecycle,toolbar,execution,history,dialect,document}.test.tsx
for f in src/components/query/QueryTab.{lifecycle,toolbar,execution,history,dialect,document}.test.tsx; do
  echo "$f: $(grep -cE '^\s*it\(' $f) cases / $(grep -cE 'vi\.mock\(' $f) factories"
done
test -f src/components/query/QueryTab.test.tsx && echo "EXISTS" || echo "REMOVED"
grep -nE "^export (function|const)" src/components/query/__tests__/queryTabTestHelpers.ts | wc -l
git diff --stat src/components/query/QueryTab.tsx src/components/query/QueryTab/  # 0
```

## 미완 / 후속

- **P11 step 3-5**: 잔여 3 mega test (`tabStore.test.ts` 2,234 / `StructurePanel.test.tsx` 2,156 / `DataGrid.test.tsx` 1,906). 본 sprint 의 axis split + helper extraction pattern reference template 으로 사용 권고.
- **P10** (Sprint 219): stores side-effects refactor — 사용자 hooks/lib 작업 안정 후 진입.
- 본 sprint 후속 candidate (informational, F-001..F-002 P3):
  - F-001: helper export count "8-10" headline 과 12 actual 의 차이 — spec breakdown formula 는 5+1+3+2+1=12 로 일치.
  - F-002: execution axis 17 cases — Format-SQL + Uglify cohesion 으로 13-16 권고 +1.
  - vitest pool config 변경 시 mock 격리 재검증.
- cycle 종료 후 `refactoring-candidates.md` retire 예정.
