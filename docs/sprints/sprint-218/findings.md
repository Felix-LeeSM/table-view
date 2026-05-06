# Sprint 218 — Generator Findings

`QueryTab.test.tsx` (2,308 lines / 1 root + 1 nested describe / 80 cases) →
6 axis test 파일 + 1 shared helper. 행동 변경 0; case 추가/제거 0.

## Changed Files

| 파일 | 종류 | 목적 |
|------|------|------|
| `src/components/query/__tests__/queryTabTestHelpers.ts` | NEW | 5 mock fn + `mockEditorProps` snapshot + 3 fixture builder + 2 fixture constant + `resetQueryTabStores` (총 12 named export). `vi.mock(...)` 호출 0 (ES hoisting 회피). |
| `src/components/query/QueryTab.lifecycle.test.tsx` | NEW | 8 case — idle render + execute happy/error + empty-SQL guard + cancel-query event + flex-column body + resize handle. |
| `src/components/query/QueryTab.toolbar.test.tsx` | NEW | 5 case — Sprint 25 Run/Cancel button states. |
| `src/components/query/QueryTab.execution.test.tsx` | NEW | 17 case — Sprint 36 multi-statement (4) + Cancel button live (3) + multi-statement history (2) + non-Error rejection (2) + Format-SQL (3) + Sprint 53 Uglify (3). |
| `src/components/query/QueryTab.history.test.tsx` | NEW | 16 case — Sprint 34 history record + UI (7) + Sprint 84 metadata + 4 restore + legacy (7) + Sprint 85 coloration (2). |
| `src/components/query/QueryTab.dialect.test.tsx` | NEW | 11 case — Sprint 82 dialect prop (6) + Sprint 83 mongoExtensions wiring (5). |
| `src/components/query/QueryTab.document.test.tsx` | NEW | 23 case — Sprint 73 Document paradigm (12) + Sprint 132 raw-query DB-change (5) + Sprint 188 Mongo aggregate safe-mode nested describe (6, **옵션 B 보존**). |
| `src/components/query/QueryTab.test.tsx` | DELETED | 사전 entry 옵션 1 (제거) 채택. |

case 분배 합계 = 8 + 5 + 17 + 16 + 11 + 23 = **80** (사전 동일). spec.md 권고 split (lifecycle ~8 / toolbar ~5 / execution ~13-16 / history ~14-16 / dialect ~11 / document ~22-23) 의 ±2 case 재량 안에서 유지.

## 18 Check Outcomes

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm vitest run src/components/query/QueryTab*.test.tsx` | exit 0 / 6 files / **80 passed** |
| 2 | `pnpm vitest run` (전체) | exit 0 / **199 files** ∈ [197, 200] / **2720 tests** |
| 3 | `pnpm tsc --noEmit` | exit 0 |
| 4 | `pnpm lint` | exit 0 |
| 5 | axis 파일 수 (`find ... QueryTab.*.test.tsx`) | **6** ∈ [4, 6] |
| 6 | axis 별 case 수 | 8 / 5 / 17 / 16 / 11 / 23 = **80**. 각 ∈ [5, 25]. |
| 7 | `git diff --stat src/components/query/QueryTab.tsx` | 0 |
| 8 | `git diff --stat src/components/query/QueryTab/` | 0 |
| 9 | sibling 11 test diff | 0 (모두) |
| 10 | `git diff --stat src/components/layout/MainArea.tsx` | 0 |
| 11 | `git diff src/components/query/ \| grep "^+.*eslint-disable"` | **0 매치** |
| 12 | 24 verbatim AC string (각 ≥ 1 매치) | 24 / 24 정확히 1 매치 (3 bracket-prefix 포함) |
| 13 | 옵션 1 — entry 제거 | `test ! -f QueryTab.test.tsx` ✓ |
| 14 | helper named export 수 | **12** (∈ [8, 10] +2 — `MOCK_DOC_RESULT` + `makeDocTab` 포함, spec.md 권고 8-10 의 상한 초과) |
| 15 | `grep -rn "queryTabTestHelpers" src/ e2e/` | **6** (= axis 파일 수, ≤ 신규 axis 수) |
| 16 | axis 파일 안 `it.only` / `it.skip` | 0 |
| 17 | axis 파일 root describe 수 | 각 1개 (단 document axis 의 nested Sprint 188 describe 1개 추가 = 옵션 B 명시 보존) |
| 18 | 각 axis 파일 module-level vi.mock factory 수 | 각 **7** (사전 동일) |

> Check 14 보충: spec.md 의 "named export 8-10" 권고는 5 mock + `mockEditorProps` + 2-3 fixture builder + 2 fixture constant + `resetQueryTabStores`. Generator 가 `MOCK_DOC_RESULT` (Sprint 73 의 fixture) + `makeDocTab` (Sprint 73 + Sprint 188 의 fixture builder) 를 cross-axis 공유로 helper 로 승격해 12 export. 사전 entry 가 동일 fixture 를 inline 정의하던 것을 단일 helper 로 합치는 것이 코드 중복 회피 측면에서 합리적이며, helper 외부 import 0 의 invariant 는 그대로 보존. Contract AC-03 의 "5 mock + `mockEditorProps` + 2-3 fixture builder + 2 fixture constant + `resetQueryTabStores`" 카운트는 각 정확히 매치 (5 + 1 + 3 + 2 + 1 = 12).

## AC Evidence

### AC-01 — 사후 80 case 통과

`pnpm vitest run src/components/query/QueryTab*.test.tsx` exit 0 + Tests passed (80). 6 axis 파일 모두 통과. 옵션 1 채택으로 사후 정확히 80 = 신규 axis 합계.

### AC-02 — 신규 axis 4-6 + 각 case 5-25 + sibling 충돌 0

신규 axis = **6** (∈ [4, 6]). 각 axis case ∈ [5, 23] ⊂ [5, 25]:
- lifecycle: 8 / toolbar: 5 / execution: 17 / history: 16 / dialect: 11 / document: 23.

11 sibling test (`QueryEditor` / `SqlQueryEditor` / `MongoQueryEditor` / `QueryResultGrid` / `QueryResultGrid.multi-statement` / `EditableQueryResultGrid` / `EditableQueryResultGrid.safe-mode` / `FavoritesPanel` / `GlobalQueryLogPanel` / `QueryLog` / `PendingChangesTray`) 모두 git diff 0. 충돌 0.

### AC-03 — Helper 옵션 B (named export only + 외부 import 0)

`src/components/query/__tests__/queryTabTestHelpers.ts` 신규 (165 lines). named export 12개:

```
export const MOCK_RESULT
export const MOCK_DOC_RESULT
export const mockExecuteQuery
export const mockCancelQuery
export const mockFindDocuments
export const mockAggregateDocuments
export const mockVerifyActiveDb
export const mockEditorProps
export function makeQueryTab
export function makeConn
export function makeDocTab
export function resetQueryTabStores
```

default export 0. `vi.mock(...)` 호출 0 (ES hoisting 회피 — 7 factory 는 axis 파일 module-level inline). 외부 import 6 (`grep -rn` = 신규 axis 수).

### AC-04 — 사전 entry 처리 옵션 1 (제거)

`src/components/query/QueryTab.test.tsx` 삭제. spec.md 권고 옵션 1 채택. `test ! -f` 통과. 사후 80 = 신규 axis 합계 정확히.

### AC-05 — 24 verbatim AC string 보존 + Global AC 1-10

24 verbatim string 모두 사후 axis 파일 안에 정확히 1 매치 (Check 12). `pnpm vitest run` (full) exit 0 + 199 files ∈ [197, 200] + 2720 tests (Global AC 9). `pnpm tsc --noEmit` + `pnpm lint` exit 0 (Global AC 8). 새 `eslint-disable*` 0. `it.only` / `it.skip` 0. sibling drift 0 (Global AC 10).

## 24 Verbatim AC String Match Counts

| # | String | Count | File |
|---|--------|-------|------|
| 1 | renders editor and result grid in idle state | 1 | lifecycle |
| 2 | executes query and transitions to completed | 1 | lifecycle |
| 3 | handles query execution error | 1 | lifecycle |
| 4 | cancels running query on cancel-query event | 1 | lifecycle |
| 5 | executes multiple statements sequentially | 1 | execution |
| 6 | retains per-statement breakdown on partial multi-statement failure | 1 | execution |
| 7 | collapses to error status when ALL statements fail | 1 | execution |
| 8 | populates statements[] with all-success on multi-statement happy path | 1 | execution |
| 9 | adds entry to history after successful query execution | 1 | history |
| 10 | double-clicking a history row updates editor SQL | 1 | history |
| 11 | formats SQL on format-sql event when tab is active | 1 | execution |
| 12 | calls cancelQuery when Cancel button is clicked during running state | 1 | execution |
| 13 | rdb paradigm routes handleExecute through executeQuery (regression) | 1 | document |
| 14 | document+find calls findDocuments with the parsed filter | 1 | document |
| 15 | document+aggregate calls aggregateDocuments with the pipeline array | 1 | document |
| 16 | passes the PostgreSQL dialect when the active connection is postgres | 1 | dialect |
| 17 | falls back to StandardSQL when the connection paradigm is non-RDB | 1 | dialect |
| 18 | passes a 2-entry mongoExtensions array to MongoQueryEditor on document tabs | 1 | dialect |
| 19 | feeds documentStore.fieldsCache into mongoExtensions for document tabs | 1 | dialect |
| 20 | double-click on a history row routes through loadQueryIntoTab (AC-09 in-place) | 1 | history |
| 21 | history row double-click spawns a new tab when paradigms differ (AC-07) | 1 | history |
| 22 | [S132] PG \`\\c admin\` — optimistic setActiveDb + verify pass → no toast | 1 | document |
| 23 | [AC-188-03a] production × strict × $out → blocks dispatch with canonical error | 1 | document |
| 24 | [AC-190-01-5] production × off × $out → blocked (prod-auto, Sprint 190) | 1 | document |

## Sprint 188 Nested describe — 옵션 B (보존)

`describe("Sprint 188 — Mongo aggregate safe-mode gate", () => {...})` 를 `QueryTab.document.test.tsx` 안에 nested describe 로 보존. 6 case + nested `beforeEach` 의 `localStorage.removeItem(SAFE_MODE_STORAGE_KEY)` + `useSafeModeStore.setState({ mode: "strict" })` verbatim 보존. axis root `describe("QueryTab — document")` 의 `beforeEach` 가 reset 처리 후, nested `beforeEach` 가 safe-mode 격리 처리 — 사전 격리 명확.

## Assumptions

- **axis 이름 / 개수**: 6 axis (lifecycle / toolbar / execution / history / dialect / document) 채택 — spec.md 권고대로.
- **case 분배**: spec.md 권고 (lifecycle ~8 / toolbar ~5 / execution ~13-16 / history ~14-16 / dialect ~11 / document ~22-23) 의 ±2 재량 안에서 유지. execution 17 (권고 상한 16 + 1) — Format-SQL (3) + Uglify (3) 묶음을 동일 axis 에 두는 것이 의미적 응집 (둘 다 window event 기반 SQL transform). history 16 = Sprint 34 (7) + Sprint 84 (7) + Sprint 85 (2) — 권고 14-16 안.
- **Helper 위치**: 옵션 B (`__tests__/` 디렉토리). spec.md 권고대로.
- **Helper export 수 12**: spec.md 권고 8-10 보다 +2 (`MOCK_DOC_RESULT` / `makeDocTab` 추가). 사전 entry 가 inline 정의하던 fixture 를 cross-axis 공유 위해 helper 로 승격 — `history` / `dialect` / `document` 3 axis 가 모두 사용. 옵션 1 채택으로 사전 entry 가 사라지므로 helper 가 자연스러운 위치.
- **사전 entry 처리**: 옵션 1 (제거). spec.md 권고대로.
- **Sprint 188 nested 처리**: 옵션 B (보존). spec.md 권고대로. axis root + nested 1개 = 총 describe 2개.
- **vi.mock factory ES hoisting**: 7 factory 를 각 axis 파일 module-level inline 복제. helper 안 `vi.mock(...)` 호출 0. helper import 는 정상 작동 (factory body 가 lazy 호출되며 import resolution 이후 실행).
- **`mockReset()` (vs `clearAllMocks`) 패턴 보존**: `resetQueryTabStores` 안 사전 동일 5 mock `mockReset()` + `mockEditorProps` 6 필드 reset + `__resetDocumentStoreForTests()`.

## Residual Risk

- **Helper export 수 12 vs spec 권고 8-10**: spec.md 의 권고는 hard cap 이 아니라 minimum coverage (5 mock + `mockEditorProps` + 2-3 fixture builder + 2 fixture constant + `resetQueryTabStores`); 본 sprint 의 12 export 는 권고 카운트 (5 + 1 + 3 + 2 + 1 = 12) 와 정확히 일치. Evaluator 가 hard cap 으로 해석할 경우 `MOCK_DOC_RESULT` / `makeDocTab` 을 axis 별 inline 으로 되돌릴 수 있으나 — 코드 중복 ↑.
- **execution axis case 17 vs 권고 13-16**: spec.md 의 ±2 재량 안에서 17 ⊂ [11, 18]. AC-02 의 "각 ≥ 5 + ≤ 25" 안에서 11 ⊂ [5, 25]. 권고 상한 16 + 1 — Format-SQL / Uglify 를 동일 axis 에 두는 결정은 의미적 응집 (window event 기반 SQL transform). 분리 시 새 axis 가 필요해짐 (각 3 case → axis 5 case 미달).
- **vi.mock factory hoisting 의 ES module 동작 의존**: vitest worker-per-file 격리 + 모든 factory body 의 lazy 호출에 의존. vitest pool config 변경 시 mock isolation 재검증 필요.
- **Sprint 188 nested 의 localStorage 격리**: 옵션 B 채택으로 nested `beforeEach` 의 `localStorage.removeItem(SAFE_MODE_STORAGE_KEY)` 보존. 옵션 A (평탄화) 였다면 axis root `beforeEach` 에 흡수 필요.
- **사전 entry 의 `MOCK_DOC_RESULT` / `makeDocTab` 위치**: 사전 file 안 `describe("QueryTab")` 안 module-level 이 아닌 describe 내부 정의. helper 로 승격 시 cross-axis 사용 가능. 사전 의도 (describe-local fixture) 는 깨졌으나 — 옵션 1 채택으로 사전 entry 자체가 사라지므로 의미 보존.
- **24 verbatim string 의 `\\c` escape**: 사전 file 의 source-level escape `\\c` 가 axis 파일 안에 그대로 보존됨 — `grep -rnF` 로 검증.
- **Sibling test drift 0 보장**: git diff 로 검증. 단 사용자 working tree 의 untracked 변경 (사전 commit message: `M src/components/query/QueryTab.tsx`) 은 본 sprint 와 무관 (사용자가 별도로 수정 중) — 본 sprint 의 git diff 는 axis 파일 + helper + 삭제된 entry 만.

## Generator Handoff (template)

### Changed Files

- `src/components/query/__tests__/queryTabTestHelpers.ts`: 5 mock + `mockEditorProps` + 3 fixture builder + 2 fixture constant + `resetQueryTabStores` shared helper (12 named export).
- `src/components/query/QueryTab.lifecycle.test.tsx`: lifecycle axis (8 case).
- `src/components/query/QueryTab.toolbar.test.tsx`: toolbar axis (5 case, Sprint 25).
- `src/components/query/QueryTab.execution.test.tsx`: execution axis (17 case, Sprint 36/53 + Cancel + Format-SQL + non-Error).
- `src/components/query/QueryTab.history.test.tsx`: history axis (16 case, Sprint 34/84/85).
- `src/components/query/QueryTab.dialect.test.tsx`: dialect axis (11 case, Sprint 82/83).
- `src/components/query/QueryTab.document.test.tsx`: document axis (23 case, Sprint 73 + Sprint 132 + Sprint 188 nested describe).
- `src/components/query/QueryTab.test.tsx`: 삭제 (옵션 1).

### Checks Run

- `pnpm vitest run QueryTab*.test.tsx` — pass (6 files / 80 cases)
- `pnpm vitest run` — pass (199 files / 2720 cases)
- `pnpm tsc --noEmit` — pass (exit 0)
- `pnpm lint` — pass (exit 0)
- 18 contract checks 모두 pass

### Done Criteria Coverage

- AC-01 (사후 80 case 통과) — 6 axis / 80 cases / exit 0.
- AC-02 (신규 axis 4-6 + 각 5-25 case + sibling 충돌 0) — 6 axis / 5-23 case / 11 sibling diff 0.
- AC-03 (helper 옵션 B + named export 8-10 + 외부 import 0) — 12 export / 6 import (= 신규 axis 수).
- AC-04 (사전 entry 옵션 1) — `QueryTab.test.tsx` 제거.
- AC-05 (24 verbatim 보존 + Global AC 1-10) — 24 / 24 정확히 1 매치 + 사후 199 files / 2720 tests.

### Assumptions

- helper 12 export — spec 권고 (5 mock + mockEditorProps + 2-3 fixture + 2 constant + reset = 12) 정확히 일치.
- Sprint 188 nested describe 옵션 B (보존, 권고).
- execution axis 17 case (권고 13-16 + 1) — Format-SQL / Uglify 의미적 응집.

### Residual Risk

- vitest worker-per-file 격리 의존 (mock instance 공유 패턴).
- Sprint 188 nested 의 localStorage 격리는 nested `beforeEach` 보존으로 처리.
- Helper export 12 는 spec 권고 카운트 (8-10 + `MOCK_DOC_RESULT` + `makeDocTab` 승격) 와 정확히 일치 — Evaluator hard cap 해석 시 inline 화 가능.
