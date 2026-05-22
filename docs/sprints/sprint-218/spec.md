# Feature Spec: QueryTab.test.tsx behavior-axis split (Sprint 218 — P11 step 2)

## Description

`src/components/query/QueryTab.test.tsx` (2,308 lines, 1 root `describe("QueryTab")` + 1 nested `describe("Sprint 188 — Mongo aggregate safe-mode gate")`, 74 root + 6 nested = 80 total `it` cases) 가 단일 파일에 다수 behavior axis (idle/execute lifecycle / Toolbar / Multi-statement / History record + restore / Format-SQL / Cancel / Document paradigm routing / Dialect routing / Mongo autocomplete + fieldsCache / S132 raw-query DB-change / S188 Mongo aggregate safe-mode gate) 의 모든 회귀 가드를 누적 보유한다. Sprint 별 section 헤더 (Sprint 25/34/36/53/73/82/83/84/85/132/188) 와 AC label (AC-01..11 / AC-S139-04 / AC-188-03[a-f] / AC-190-01-5) 로 axis 추출 경계가 명확.

본 sprint 는 P11 candidate (`docs/archives/backlogs/refactoring-candidates-2026-05-06.md` §P11) 의 **second step**. Sprint 216 (P11 step 1) 에서 `SchemaTree.test.tsx` (2,891 / 104 cases) 를 6 axis + helper 로 split 한 model implementation 패턴 답습. 후속 P11 step 3-5 (`tabStore.test.ts` 2,234 / `StructurePanel.test.tsx` 2,156 / `DataGrid.test.tsx` 1,906) 는 별도 sprint candidate.

행동 변경 0 강제. `QueryTab.tsx` 본체 (228 lines) + `QueryTab/` sub-file 6개 변경 금지. test 만 axis 파일 split. 사전 80 case 모두 사후 통과. case 텍스트 / matcher / fixture / mock setup / 24 verbatim AC string 사전과 byte-equivalent.

이 sprint 는 **test-only refactor + axis split** 패턴 — Sprint 216 와 동일 카테고리. 100% test 파일 재배치이며 src/component 변경 0.

## Sprint Breakdown

### Sprint 218: QueryTab.test.tsx behavior-axis split

**Goal**: `QueryTab.test.tsx` (2,308 lines / 80 cases) 를 4-6 behavior-axis test 파일 + 1 shared helper 파일로 분해. 사전 1 root + 1 nested describe + 80 case → 사후 axis-별 root describe + 합계 80. 옵션 1 (entry 제거) 권고. 행동 변경 0. `QueryTab.tsx` + sub-file 6개 + 11 sibling test 변경 0.

**Verification Profile**: `command`

**Acceptance Criteria**:

1. **사후 QueryTab*.test.tsx 합계 80 case 통과.** `pnpm vitest run src/components/query/QueryTab*.test.tsx` exit 0 + 80 cases.

2. **신규 axis 파일 4-6개 + shared helper.**
   - naming: `src/components/query/QueryTab.<axis>.test.tsx`.
   - 각 신규 ≥ 5 case + ≤ 25 case.
   - axis 후보 (6 권고):
     - `QueryTab.lifecycle.test.tsx` (~8): idle render + execute happy/error + empty-SQL guard + cancel-query event + flex-column body + resize handle.
     - `QueryTab.toolbar.test.tsx` (~5): Sprint 25 Run/Cancel button states.
     - `QueryTab.execution.test.tsx` (~13-16): Sprint 36 multi-statement (4) + Cancel button live (3) + multi-statement history (2) + non-Error rejection (2) + Format-SQL (3) + Sprint 53 Uglify (3).
     - `QueryTab.history.test.tsx` (~14-16): Sprint 34 history record + UI (7) + Sprint 84 metadata + 4 restore + legacy (8) + Sprint 85 coloration (2).
     - `QueryTab.dialect.test.tsx` (~11): Sprint 82 dialect prop (6) + Sprint 83 mongoExtensions (5).
     - `QueryTab.document.test.tsx` (~22-23): Sprint 73 Document paradigm (12) + Sprint 132 raw-query DB-change (5) + Sprint 188 Mongo aggregate safe-mode nested describe (6).
   - generator 재량: ±2 case 이동 / axis 이름 변경 / 4-7 재배치.

3. **신규 shared helper 파일 (옵션 B 권고).**
   - 옵션 B: `src/components/query/__tests__/queryTabTestHelpers.ts` 신규.
   - named export 8-10:
     - 5 mock: `mockExecuteQuery` / `mockCancelQuery` / `mockFindDocuments` / `mockAggregateDocuments` / `mockVerifyActiveDb`.
     - 1 prop snapshot: `mockEditorProps`.
     - 2-3 fixture builder: `makeQueryTab` / `makeConn` / `makeDocTab`.
     - 2 fixture constant: `MOCK_RESULT` / `MOCK_DOC_RESULT`.
     - 1 reset helper: `resetQueryTabStores`.
   - vi.mock factory 는 ES hoisting 으로 axis 파일 module-level inline 보존 (helper 외부 호출 불가) — generator 가 7 factory inline 복제 또는 dynamic import 패턴.
   - 외부 import 0 — `grep -rn "queryTabTestHelpers" src/ e2e/` 매치 ≤ 신규 axis 파일 수.

4. **사전 entry 처리.**
   - 옵션 1 (권고): `QueryTab.test.tsx` 제거.
   - 옵션 2 (허용): smoke ≤ 5 case 잔존.

5. **24 verbatim AC string 보존** (각 ≥ 1 매치):
   - "renders editor and result grid in idle state"
   - "executes query and transitions to completed"
   - "handles query execution error"
   - "cancels running query on cancel-query event"
   - "executes multiple statements sequentially"
   - "retains per-statement breakdown on partial multi-statement failure"
   - "collapses to error status when ALL statements fail"
   - "populates statements[] with all-success on multi-statement happy path"
   - "adds entry to history after successful query execution"
   - "double-clicking a history row updates editor SQL"
   - "formats SQL on format-sql event when tab is active"
   - "calls cancelQuery when Cancel button is clicked during running state"
   - "rdb paradigm routes handleExecute through executeQuery (regression)"
   - "document+find calls findDocuments with the parsed filter"
   - "document+aggregate calls aggregateDocuments with the pipeline array"
   - "passes the PostgreSQL dialect when the active connection is postgres"
   - "falls back to StandardSQL when the connection paradigm is non-RDB"
   - "passes a 2-entry mongoExtensions array to MongoQueryEditor on document tabs"
   - "feeds documentStore.fieldsCache into mongoExtensions for document tabs"
   - "double-click on a history row routes through loadQueryIntoTab (AC-09 in-place)"
   - "history row double-click spawns a new tab when paradigms differ (AC-07)"
   - "[S132] PG `\\c admin` — optimistic setActiveDb + verify pass → no toast"
   - "[AC-188-03a] production × strict × $out → blocks dispatch with canonical error"
   - "[AC-190-01-5] production × off × $out → blocked (prod-auto, Sprint 190)"

6. **`QueryTab.tsx` + sub-file 6개 변경 0.** `git diff --stat` 모두 0:
   - `src/components/query/QueryTab.tsx`
   - `src/components/query/QueryTab/{Toolbar.tsx, HistoryPanel.tsx, useQueryExecution.ts, useQueryEvents.ts, useQueryFavorites.ts, queryHelpers.ts}`

7. **Sibling test 변경 0.** 11 sibling test 모두 변경 0:
   - `QueryEditor.test.tsx` / `SqlQueryEditor.test.tsx` / `MongoQueryEditor.test.tsx`
   - `QueryResultGrid.test.tsx` / `QueryResultGrid.multi-statement.test.tsx`
   - `EditableQueryResultGrid.test.tsx` / `EditableQueryResultGrid.safe-mode.test.tsx`
   - `FavoritesPanel.test.tsx` / `GlobalQueryLogPanel.test.tsx`
   - `QueryLog.test.tsx` / `PendingChangesTray.test.tsx`

8. **Project-wide regression bar.**
   - `pnpm vitest run` exit 0. 사전 baseline (post-Sprint-216, 194 files / 2720 tests) → 사후 [197, 200] files / 2720 tests.
   - `pnpm tsc --noEmit` exit 0 — 새 `any` 0.
   - `pnpm lint` exit 0.
   - 새 `eslint-disable*` 0. 새 silent `catch{}` 0. `it.only` / `it.skip` 0.

**Components to Create/Modify**:

- 신규 6 axis test 파일 (위 axis 후보 분배).
- `src/components/query/__tests__/queryTabTestHelpers.ts` (옵션 B 신규).
- `src/components/query/QueryTab.test.tsx` (옵션 1 제거 또는 옵션 2 smoke).

> Sprint 188 nested describe 처리: 옵션 A (평탄화) 또는 옵션 B (보존, 권고).

## Global Acceptance Criteria

1. **행동 변경 0.** component / sub-file / sibling test 모두 변경 0.

2. **사전 80 case 모두 사후 통과 + 추가/제거 0.** 7 vitest mock factory 사전 동일 (`@lib/tauri` / `@lib/api/verifyActiveDb` / `./SqlQueryEditor` / `./MongoQueryEditor` / `./QueryResultGrid` / `@hooks/useSqlAutocomplete` / `@lib/sql/sqlUtils`).

3. **사전 import / mock pattern 보존.** vitest / @testing-library/{react,user-event} / codemirror lang-sql + state types / 6 store + useToastStore / SAFE_MODE_STORAGE_KEY / mock + fixture 모두 사전 동일.

4. **사전 ARIA label / verbatim text 보존.** `getByTestId("mock-editor")` / `getByTestId("execute-btn")` / `data-paradigm` / `data-status` 등.

5. **사전 fixture data shape 보존.** `MOCK_RESULT` / `MOCK_DOC_RESULT` / `makeQueryTab(overrides)` / `makeConn(overrides)` / `makeDocTab(overrides)` / `PROD_PIPELINE` / `SAFE_PIPELINE`.

6. **사전 store seed pattern 보존.**
   - `beforeEach`: 6 store reset + 5 mock `mockReset()` + `mockEditorProps` 6 필드 reset + `__resetDocumentStoreForTests()`.
   - Sprint 188 nested `beforeEach`: `localStorage.removeItem(SAFE_MODE_STORAGE_KEY)` + `useSafeModeStore.setState({ mode: "strict" })`.

7. **public surface 0 변경.** `QueryTabProps` 동결. `MainArea.tsx` 변경 0.

8. **새 `eslint-disable*` 0, 새 silent `catch{}` 0.**

9. **vitest baseline file count 증가.** 사전 194 → 사후 [197, 200]. tests = 2720.

10. **Sibling drift 0.** 11 sibling test + `MainArea.tsx` 변경 0.

## Data Flow

### Before

```
src/components/query/
  ├─ QueryTab.test.tsx (2,308 lines, 1 root + 1 nested describe, 80 cases)
  │  ├─ inline: 7 vi.mock factory + 5 mock fn + module-level mockEditorProps
  │  │         + 2-3 fixture builder + 2 fixture constant
  │  │         + Sprint 188 nested describe (setupProductionMongo, PROD/SAFE pipeline)
  │  └─ 80 cases by Sprint section + AC label
  ├─ QueryTab.tsx (228, entry, untouched)
  └─ QueryTab/{Toolbar, HistoryPanel, useQueryExecution, useQueryEvents,
              useQueryFavorites, queryHelpers}.{ts,tsx} (untouched)
```

### After

```
src/components/query/
  ├─ __tests__/queryTabTestHelpers.ts (옵션 B)
  │     5 mock + 1 prop snapshot + 2-3 fixture + 2 constant + 1 reset
  │
  ├─ QueryTab.lifecycle.test.tsx (~8 cases)
  ├─ QueryTab.toolbar.test.tsx (~5 cases)
  ├─ QueryTab.execution.test.tsx (~13-16 cases)
  ├─ QueryTab.history.test.tsx (~14-16 cases)
  ├─ QueryTab.dialect.test.tsx (~11 cases)
  ├─ QueryTab.document.test.tsx (~22-23 cases, Sprint 188 nested 보존 권고)
  │
  ├─ (옵션 1) QueryTab.test.tsx — 제거
  │   OR
  ├─ (옵션 2) QueryTab.test.tsx — smoke ≤ 5 case
  │
  ├─ QueryTab.tsx                      ─── 변경 0
  └─ QueryTab/...                      ─── 변경 0

  Total: 7-8 files / 80 cases.
```

### Cross-module dependency

```
queryTabTestHelpers.ts (new, 옵션 B)
  ├─→ vi (vitest)
  ├─→ 6 store (useTabStore / useQueryHistoryStore / useConnectionStore / useDocumentStore / useToastStore / useSafeModeStore)
  ├─→ ConnectionConfig / DatabaseType / QueryResult / QueryTab type
  └─→ no React DOM render

QueryTab.<axis>.test.tsx (each)
  ├─→ queryTabTestHelpers (옵션 B) OR inline (옵션 A)
  ├─→ vitest + @testing-library/{react,user-event}
  ├─→ QueryTab (default)
  ├─→ 6 store + useToastStore + SAFE_MODE_STORAGE_KEY
  ├─→ codemirror lang-sql + state types (dialect axis)
  └─→ axis-specific local helpers (sprint 188 setupProductionMongo)

QueryTab.tsx + sub-file 6 → 변경 0
11 sibling test → 변경 0
MainArea.tsx → 변경 0
```

### Mock state lifecycle (사전 동일)

```
모든 axis 파일 module-top:
  vi.mock("@lib/tauri", () => ({...}))         // hoisted
  vi.mock("@lib/api/verifyActiveDb", () => ({...}))
  vi.mock("./SqlQueryEditor", async () => ({...}))
  vi.mock("./MongoQueryEditor", async () => ({...}))
  vi.mock("./QueryResultGrid", () => ({...}))
  vi.mock("@hooks/useSqlAutocomplete", () => ({...}))
  vi.mock("@lib/sql/sqlUtils", () => ({...}))

beforeEach:
  resetQueryTabStores()  // 6 store + 5 mock + mockEditorProps + documentStore reset

각 it case:
  setStore(...)
  await act(() => render(<QueryTab tab={...} />))
  fire events / assert
```

> vi.mock factory ES hoisting 으로 helper 외부 호출 불가. axis 파일 module-level inline 7 factory 또는 dynamic import 패턴.

## Edge Cases

- **vi.mock factory hoisting**: import 보다 위로 hoist — helper 외부 호출 불가. axis 파일 module-level inline.
- **Mock leakage between axis 파일**: vitest worker 격리 + `resetQueryTabStores()` beforeEach. leakage 0.
- **Shared helper import 누락**: 옵션 B 채택 시 axis 파일에서 helper import 깜빡 시 mock undefined → render fail.
- **`vi.fn()` shared instance + `mockReset()`**: module-top-level 정의 → axis 파일 안 동일 instance. 사전 `mockReset()` (vs `clearAllMocks`) 패턴 보존.
- **Sprint 188 nested describe 처리**:
  - 옵션 A (평탄화): nested 제거, 6 case 평탄.
  - 옵션 B (보존, 권고): axis root + nested 1개. setup 격리 명확.
- **Axis 파일 case 합계 != 80**: 옵션 1 채택 시 정확히 80.
- **Case 텍스트 변경**: backtick / em-dash / × 특수 문자 보존 의무.
- **Assertion 본문 변경**: byte-equivalent. 지역 변수명 변경 허용.
- **AC label prefix 충돌**: AC-01/02/07/09 등 sprint 별 재사용. axis 별 comment header 명시 권고.
- **`it.only` / `it.skip` 잔존**: 사전 0 → 사후 0.
- **Async helper duplication**: `makeDocTab` helper 승격 또는 module-top-level.
- **userEvent setup**: Sprint 188 cases `userEvent.setup()` 호출. axis 분리 후 동일.
- **toast import**: Sprint 132 cases `useToastStore` reset beforeEach + assertion. helper reset 포함.
- **localStorage 격리 (Sprint 188)**: nested describe `beforeEach`. 옵션 B 채택 시 nested 자체 보존.

## Verification Hints

- **Primary regression**:
  ```sh
  pnpm vitest run src/components/query/QueryTab*.test.tsx
  # exit 0 + Tests passed (80)
  ```

- **Axis file shape**:
  ```sh
  ls src/components/query/QueryTab.{lifecycle,toolbar,execution,history,dialect,document}.test.tsx 2>&1
  for f in src/components/query/QueryTab.{lifecycle,toolbar,execution,history,dialect,document}.test.tsx; do
    [ -f "$f" ] && echo "$f: $(grep -cE '^\s*it\(' "$f") cases"
  done
  # 합계 = 80 (옵션 1)
  ```

- **Helper file**:
  ```sh
  test -f src/components/query/__tests__/queryTabTestHelpers.ts
  grep -nE "^export (function|const) (mockExecuteQuery|mockCancelQuery|mockFindDocuments|mockAggregateDocuments|mockVerifyActiveDb|mockEditorProps|makeQueryTab|makeConn|makeDocTab|MOCK_RESULT|MOCK_DOC_RESULT|resetQueryTabStores)" \
    src/components/query/__tests__/queryTabTestHelpers.ts | wc -l
  # ≥ 8
  ```

- **Sibling + component freeze**:
  ```sh
  git diff --stat src/components/query/QueryTab.tsx src/components/query/QueryTab/ \
    src/components/query/QueryEditor.test.tsx src/components/query/SqlQueryEditor.test.tsx \
    src/components/query/MongoQueryEditor.test.tsx src/components/query/QueryResultGrid.test.tsx \
    src/components/query/QueryResultGrid.multi-statement.test.tsx \
    src/components/query/EditableQueryResultGrid.test.tsx \
    src/components/query/EditableQueryResultGrid.safe-mode.test.tsx \
    src/components/query/FavoritesPanel.test.tsx src/components/query/GlobalQueryLogPanel.test.tsx \
    src/components/query/QueryLog.test.tsx src/components/query/PendingChangesTray.test.tsx \
    src/components/layout/MainArea.tsx
  # 모두 0
  ```

- **Project-wide gates**:
  ```sh
  pnpm vitest run    # exit 0, file count [197, 200], tests = 2720
  pnpm tsc --noEmit  # exit 0
  pnpm lint          # exit 0
  ```

- **Verbatim string preservation** (24 strings, bracket-prefix `grep -F`):
  ```sh
  for s in \
    "renders editor and result grid in idle state" \
    "executes query and transitions to completed" \
    "rdb paradigm routes handleExecute through executeQuery (regression)" \
    "passes a 2-entry mongoExtensions array to MongoQueryEditor on document tabs" \
    "double-click on a history row routes through loadQueryIntoTab (AC-09 in-place)"; do
    grep -rn "$s" src/components/query/QueryTab*.test.tsx | wc -l
  done
  for s in \
    "[S132] PG \`\\c admin\` — optimistic setActiveDb + verify pass → no toast" \
    "[AC-188-03a] production × strict × \$out → blocks dispatch with canonical error" \
    "[AC-190-01-5] production × off × \$out → blocked (prod-auto, Sprint 190)"; do
    grep -rnF "$s" src/components/query/QueryTab*.test.tsx | wc -l
  done
  # 각 ≥ 1
  ```

- **AC label 보존**:
  ```sh
  grep -rnE "(AC-[A-Z0-9-]+|S132|AC-188|AC-190|AC-S139)" \
    src/components/query/QueryTab.{lifecycle,toolbar,execution,history,dialect,document}.test.tsx | wc -l
  # 사전 ~45+ 이상
  ```

- **vi.mock factory 보존**:
  ```sh
  for f in src/components/query/QueryTab.{lifecycle,toolbar,execution,history,dialect,document}.test.tsx; do
    [ -f "$f" ] && echo "$f: $(grep -cE 'vi\.mock\(' "$f") factory"
  done
  # 각 axis 파일 7 factory inline (옵션 A)
  ```

- **Lint / behavior 변경 0**:
  ```sh
  git diff src/components/query/QueryTab.tsx | wc -l        # 0
  git diff src/components/query/QueryTab/ | wc -l           # 0
  git diff src/components/query/ | grep "^+.*eslint-disable" | wc -l  # 0
  git diff src/components/query/ | grep -E "^\+.*it\.(only|skip)" | wc -l  # 0
  ```

- **Entry test 처리**:
  - 옵션 1: `test ! -f src/components/query/QueryTab.test.tsx`.
  - 옵션 2: `wc -l < 200 + grep -c "^\s*it(" ≤ 5`.

- **Sprint 188 nested describe 처리**:
  - 옵션 A: `grep -c "describe(\"Sprint 188" QueryTab.document.test.tsx` = 0.
  - 옵션 B (권고): `grep -c "describe(\"Sprint 188" QueryTab.document.test.tsx` = 1.

### Critical Files for Implementation

- /Users/felix/Desktop/study/view-table/src/components/query/QueryTab.test.tsx
- /Users/felix/Desktop/study/view-table/src/components/query/QueryTab.tsx
- /Users/felix/Desktop/study/view-table/docs/sprints/sprint-216/spec.md
- /Users/felix/Desktop/study/view-table/docs/sprints/sprint-216/evaluator-scorecard.md
- /Users/felix/Desktop/study/view-table/docs/archives/backlogs/refactoring-candidates-2026-05-06.md
