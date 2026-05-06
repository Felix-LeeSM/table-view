# Feature Spec: StructurePanel.test.tsx behavior-axis split (Sprint 220 — P11 step 3)

## Description

`src/components/schema/StructurePanel.test.tsx` (2,156 lines, 1 root `describe("StructurePanel")` + 1 nested `describe("paradigm-aware vocabulary (Sprint 179)")` at L2090, 81 root + 3 nested = 84 total `it` cases) 가 단일 파일에 다수 behavior axis (read-only display + tab switch / Column-CRUD edit + Add + Delete + Review-SQL modal / Index-CRUD Create + Delete + form preview/execute / Constraint-CRUD Add + Delete + dynamic FK/CHECK/UNIQUE / Sprint 179 paradigm-aware vocabulary nested) 의 모든 회귀 가드를 누적 보유한다. Sprint section 헤더 (`NEW TESTS: Column editing functionality` / `INDEX CRUD TESTS` / `CONSTRAINT CRUD TESTS` / `SPRINT 179 — Paradigm-aware vocabulary`) + AC label (AC-01..AC-12 + AC-179-02a/03a/04a) 로 axis 추출 경계가 명확.

본 sprint 는 P11 candidate (`docs/refactoring-candidates.md` §P11) 의 **third step**. Sprint 216 (P11 step 1) 의 SchemaTree.test.tsx (2,891 / 104 cases → 6 axis + helper) 와 Sprint 218 (P11 step 2) 의 QueryTab.test.tsx (2,308 / 80 cases → 6 axis + helper) 의 model implementation 패턴 답습. 후속 P11 step 4-5 (`tabStore.test.ts` 2,234 / `DataGrid.test.tsx` 1,906) 는 별도 sprint candidate.

행동 변경 0 강제. `StructurePanel.tsx` 본체 (231 lines) + `StructurePanel.first-render-gate.test.tsx` (sibling axis test, 233 lines) + 11+ sibling test 파일 모두 변경 금지. test 만 axis 파일 split. 사전 84 case 모두 사후 통과. case 텍스트 / matcher / fixture / mock setup / 모든 verbatim AC string 사전과 byte-equivalent.

이 sprint 는 **test-only refactor + axis split** 패턴 — Sprint 216 / 218 와 동일 카테고리. 100% test 파일 재배치이며 src/component 변경 0. 사전 mega test 가 `vi.mock(...)` factory 0 건 (Sprint 218 의 7 factory 와 다름) — `vi.spyOn(tauri, ...)` 5건만 `beforeEach` 안에서 호출, ES hoisting 위험 없음.

## Sprint Breakdown

### Sprint 220: StructurePanel.test.tsx behavior-axis split

**Goal**: `StructurePanel.test.tsx` (2,156 lines / 84 cases) 를 3-5 behavior-axis test 파일 + 1 shared helper 파일로 분해. 사전 1 root + 1 nested describe + 84 case → 사후 axis-별 root describe + 합계 84. 옵션 1 (entry 제거) 권고. 행동 변경 0. `StructurePanel.tsx` + `StructurePanel.first-render-gate.test.tsx` + 11+ sibling test 변경 0.

**Verification Profile**: `command`

**Acceptance Criteria**:

1. **사후 StructurePanel*.test.tsx 합계 84 case 통과 (+ first-render-gate 사전 cases 변경 0).**
   `pnpm vitest run src/components/schema/StructurePanel*.test.tsx` exit 0.
   합계 case = 84 (사전 84 axis split) + first-render-gate 사전 case (변경 0). first-render-gate 의 사전 case count 는 axis split 후에도 동일.

2. **신규 axis 파일 3-5개 + shared helper.**
   - naming: `src/components/schema/StructurePanel.<axis>.test.tsx`.
   - 각 신규 ≥ 5 case + ≤ 30 case.
   - axis 후보 (5 권고):
     - `StructurePanel.overview.test.tsx` (~28): read-only display + tab switching + error / empty / spinner + refresh-structure event + table headers + em-dash null handling + clear-error-on-tab-switch (25 cases L158-565) + Sprint 179 paradigm-aware vocabulary nested describe 보존 (3 cases L2098-2145). 옵션 B (nested 보존, 권고) — Sprint 218 model.
     - `StructurePanel.columns.test.tsx` (~26): Column-CRUD — Add Column / edit / cancel / save / delete / multiple pending / Review SQL modal / Execute / Cancel / preview/execute error / Actions header / Enter-Escape / Escape closes modal / refresh after execute / table prop reset / pending-add removal.
     - `StructurePanel.indexes.test.tsx` (~16): Index-CRUD — Create Index button + modal + columns checkboxes + close / submit (preview + execute) + delete (PK skip / non-PK delete) + Actions header + drop modal cancel + createIndex preview error + dropIndex preview error + dropIndex execute error + Preview SQL disabled validation.
     - `StructurePanel.constraints.test.tsx` (~17): Constraint-CRUD — Add Constraint button + dynamic modal (FK reference fields / CHECK expression / UNIQUE column checkboxes) + submit (preview + execute) + delete (3 row buttons + drop modal preview/execute/cancel) + Actions header + dropConstraint preview error + Preview SQL disabled validation.
   - generator 재량: ±2 case 이동 / axis 이름 변경 / 3-5 재배치.

3. **신규 shared helper 파일 (옵션 B 권고).**
   - 옵션 B: `src/components/schema/__tests__/structurePanelTestHelpers.ts` 신규. 사전 `__tests__/schemaTreeTestHelpers.ts` 와 분리 (mock 중복 0).
   - named export 9 권고:
     - 3 mock fn: `mockGetTableColumns` / `mockGetTableIndexes` / `mockGetTableConstraints`.
     - 3 fixture constant: `MOCK_COLUMNS` / `MOCK_INDEXES` / `MOCK_CONSTRAINTS`.
     - 2 helper: `setStoreState(overrides)` / `renderPanel(props)`.
     - 1 reset helper: `resetStructurePanelMocks()` — beforeEach body 의 `vi.clearAllMocks()` + 3 mockResolvedValue + `setStoreState()` + 5 `vi.spyOn(tauri, ...)` 통합.
   - vi.mock factory 0 건 (사전 mega test 가 factory 사용 안 함) — ES hoisting 위험 없음 — helper 안 `vi.spyOn(tauri, ...)` 호출 가능.
   - 외부 import 0 — `grep -rn "structurePanelTestHelpers" src/ e2e/` 매치 ≤ 신규 axis 파일 수.

4. **사전 entry 처리.**
   - 옵션 1 (권고): `StructurePanel.test.tsx` 제거. 합계 84 = 신규 axis 합계.
   - 옵션 2 (허용): smoke ≤ 5 case 잔존. 합계 = axis + smoke.

5. **22 verbatim AC string 보존** (각 ≥ 1 매치):
   - "renders Columns tab as active by default"
   - "calls getTableColumns on mount with correct arguments"
   - "switches to Indexes tab and fetches indexes"
   - "switches to Constraints tab and fetches constraints"
   - "shows em-dash for constraints without reference table"
   - "shows error alert when columns fetch fails"
   - "shows empty state for columns when no data returned"
   - "shows spinner while loading (after 1s threshold)"
   - "refetches data on refresh-structure window event"
   - "clears error when switching tabs"
   - "renders Add Column button on columns tab"
   - "saving an edit creates a pending modify change"
   - "clicking delete adds pending drop change and hides the column"
   - "clicking Review SQL opens a modal with SQL preview"
   - "clicking Execute in the modal runs alterTable without preview_only"
   - "submitting create index form shows SQL preview then executes"
   - "primary key indexes do not have a delete button"
   - "executing drop index calls dropIndex without preview_only"
   - "submitting add constraint form shows SQL preview then executes"
   - `[AC-179-02a] paradigm="document" renders Mongo tab label + empty-state copy`
   - `[AC-179-03a] paradigm="rdb" renders the legacy 'Columns' tab`
   - `[AC-179-04a] paradigm undefined falls back to 'Columns' tab`

6. **`StructurePanel.tsx` 변경 0.** `git diff --stat src/components/schema/StructurePanel.tsx` = 0.

7. **Sibling 변경 0.** 다음 파일 모두 `git diff --stat` = 0:
   - `src/components/schema/StructurePanel.first-render-gate.test.tsx` (sibling axis test).
   - `src/components/schema/SchemaPanel.test.tsx` / `SchemaPanel.tsx`.
   - `src/components/schema/SchemaTree.{lifecycle,expand,refresh,search,actions,highlight,dbms-shape,preview,preview.entrypoints,rowcount,virtualization}.test.tsx` (Sprint 216 산출물).
   - `src/components/schema/SchemaTree.tsx` / `SchemaTree/`.
   - `src/components/schema/__tests__/schemaTreeTestHelpers.ts` (Sprint 216 산출물).
   - `src/components/schema/DocumentDatabaseTree.test.tsx` / `DocumentDatabaseTree.tsx` / `DocumentDatabaseTree/`.
   - `src/components/schema/ViewStructurePanel.test.tsx` / `ViewStructurePanel.tsx`.
   - `src/components/schema/treeShape.ts`.

8. **Project-wide regression bar.**
   - `pnpm vitest run` exit 0. 사전 baseline (post-Sprint-218, 199 files / 2720 tests) → 사후 [201, 204] files / 2720 tests (옵션 1 채택 시 +5 axis -1 entry = +4; helper 파일은 test 파일 아님 → file count 영향 0).
   - `pnpm tsc --noEmit` exit 0 — 새 `any` 0.
   - `pnpm lint` exit 0.
   - 새 `eslint-disable*` 0. 새 silent `catch{}` 0. `it.only` / `it.skip` 0.

**Components to Create/Modify**:

- 신규 4 axis test 파일 (위 axis 후보 분배):
  - `src/components/schema/StructurePanel.overview.test.tsx` (~28 case, Sprint 179 nested describe 보존).
  - `src/components/schema/StructurePanel.columns.test.tsx` (~26 case).
  - `src/components/schema/StructurePanel.indexes.test.tsx` (~16 case).
  - `src/components/schema/StructurePanel.constraints.test.tsx` (~17 case).
- `src/components/schema/__tests__/structurePanelTestHelpers.ts` (옵션 B 신규, named export 9).
- `src/components/schema/StructurePanel.test.tsx` (옵션 1 제거 또는 옵션 2 smoke).

> Sprint 179 nested describe 처리: 옵션 A (평탄화) 또는 옵션 B (보존, 권고). Sprint 218 / 216 model 답습 → 옵션 B 권고.

## Global Acceptance Criteria

1. **행동 변경 0.** `StructurePanel.tsx` + `StructurePanel.first-render-gate.test.tsx` + 11+ sibling test 모두 변경 0.

2. **사전 84 case 모두 사후 통과 + 추가/제거 0.** vi.mock factory 사전 0 건 (사전과 동일).

3. **사전 import / mock pattern 보존.** vitest / @testing-library/{react,user-event} / `StructurePanel` default / `useSchemaStore` / `ColumnInfo|IndexInfo|ConstraintInfo` 타입 / `* as tauri from "@lib/tauri"` import 사전 동일.

4. **사전 ARIA label / verbatim text 보존.** `getByRole("tab", { name: "Columns" })` / `getByRole("tab", { name: "Indexes" })` / `getByRole("tab", { name: "Constraints" })` / `getByRole("tab", { name: "Fields" })` (paradigm) / `getByLabelText("Edit column ...")` / `getByLabelText("Delete index ...")` / `getByLabelText("Delete constraint ...")` / `getByText("No columns found")` / `getByText("No fields found")` / `getByRole("dialog", { name: "Create Index" })` / `getByRole("button", { name: "Review SQL (1)" })` / `getByText("Review SQL Changes")` / em-dash `—` 등.

5. **사전 fixture data shape 보존.** `MOCK_COLUMNS` (3 column, id PK / name nullable / org_id FK) / `MOCK_INDEXES` (3 index, users_pkey PK+unique / users_name_idx / users_email_uniq unique) / `MOCK_CONSTRAINTS` (3 constraint, users_pkey PK / users_org_id_fkey FK / users_email_notnull CHECK) byte-equivalent.

6. **사전 store seed pattern 보존.**
   - `beforeEach` body verbatim: `vi.clearAllMocks()` + 3 `mockResolvedValue([...MOCK_*])` + `setStoreState()` + 5 `vi.spyOn(tauri, ...)` (alterTable / createIndex / dropIndex / addConstraint / dropConstraint).
   - axis 파일은 `resetStructurePanelMocks()` helper 호출로 통합 가능 (옵션 B helper 채택 시).

7. **public surface 0 변경.** `StructurePanelProps` (connectionId / table / schema / paradigm) 동결. 외부 importer 변경 0.

8. **새 `eslint-disable*` 0, 새 silent `catch{}` 0.**

9. **vitest baseline file count 증가.** 사전 199 → 사후 [201, 204] (옵션 1 + 4 axis - 1 entry = +3). tests = 2720.

10. **Sibling drift 0.** `StructurePanel.first-render-gate.test.tsx` + Sprint 216 산출물 11 + DocumentDatabaseTree / SchemaPanel / ViewStructurePanel / treeShape / `__tests__/schemaTreeTestHelpers.ts` 모두 변경 0.

## Data Flow

### Before

```
src/components/schema/
  ├─ StructurePanel.test.tsx (2,156 lines, 1 root + 1 nested describe, 84 cases)
  │  ├─ inline: 3 module-top fixture constant (MOCK_COLUMNS / MOCK_INDEXES / MOCK_CONSTRAINTS)
  │  │         + 3 module-top mock fn (mockGetTableColumns/Indexes/Constraints)
  │  │         + 2 module-top helper (setStoreState / renderPanel)
  │  │         + beforeEach (clearAllMocks + 3 mockResolvedValue + setStoreState + 5 vi.spyOn(tauri, ...))
  │  └─ 84 cases by section header + AC label
  ├─ StructurePanel.first-render-gate.test.tsx (233, sibling axis, 변경 0)
  ├─ StructurePanel.tsx (231, entry, 변경 0)
  ├─ SchemaTree.<6 axis>.test.tsx (Sprint 216, 변경 0)
  ├─ __tests__/schemaTreeTestHelpers.ts (Sprint 216, 변경 0)
  └─ ... 11+ sibling test 변경 0
```

### After

```
src/components/schema/
  ├─ __tests__/
  │   ├─ schemaTreeTestHelpers.ts (Sprint 216, 변경 0)
  │   └─ structurePanelTestHelpers.ts (옵션 B 신규)
  │         3 mock fn + 3 fixture constant + 2 helper + 1 reset = 9 named export
  │
  ├─ StructurePanel.overview.test.tsx (~28 cases, Sprint 179 nested 보존)
  ├─ StructurePanel.columns.test.tsx (~26 cases)
  ├─ StructurePanel.indexes.test.tsx (~16 cases)
  ├─ StructurePanel.constraints.test.tsx (~17 cases)
  │
  ├─ (옵션 1) StructurePanel.test.tsx — 제거
  │   OR
  ├─ (옵션 2) StructurePanel.test.tsx — smoke ≤ 5 case
  │
  ├─ StructurePanel.first-render-gate.test.tsx ─── 변경 0
  ├─ StructurePanel.tsx                        ─── 변경 0
  ├─ SchemaTree.<6 axis>.test.tsx              ─── 변경 0
  ├─ __tests__/schemaTreeTestHelpers.ts        ─── 변경 0
  └─ DocumentDatabaseTree / SchemaPanel / ViewStructurePanel / treeShape ─── 변경 0

  Total: +5 (axis 4 + helper 1) - 1 (entry) = +4 file. 합계 case = 84.
```

### Cross-module dependency

```
structurePanelTestHelpers.ts (new, 옵션 B)
  ├─→ vi (vitest)
  ├─→ render (@testing-library/react)
  ├─→ StructurePanel (default)
  ├─→ useSchemaStore (@stores/schemaStore)
  ├─→ ColumnInfo / IndexInfo / ConstraintInfo (@/types/schema)
  ├─→ * as tauri (@lib/tauri)
  └─→ no top-level vi.mock(...) (mega test 사전 0 건)

StructurePanel.<axis>.test.tsx (each)
  ├─→ structurePanelTestHelpers (옵션 B) OR inline (옵션 A)
  ├─→ vitest + @testing-library/{react,user-event}
  ├─→ StructurePanel (default) — helper 통해 간접 또는 직접
  ├─→ ColumnInfo/IndexInfo/ConstraintInfo type — fixture 참조
  └─→ axis-specific local helpers (없음 — 모두 helper 로 흡수 가능)

StructurePanel.tsx → 변경 0
StructurePanel.first-render-gate.test.tsx → 변경 0
11+ sibling test → 변경 0
```

### Mock state lifecycle (사전 동일)

```
helper module top-level (옵션 B):
  export const mockGetTableColumns = vi.fn().mockResolvedValue(MOCK_COLUMNS)
  export const mockGetTableIndexes = vi.fn().mockResolvedValue(MOCK_INDEXES)
  export const mockGetTableConstraints = vi.fn().mockResolvedValue(MOCK_CONSTRAINTS)

  export function resetStructurePanelMocks() {
    vi.clearAllMocks()
    mockGetTableColumns.mockResolvedValue([...MOCK_COLUMNS])
    mockGetTableIndexes.mockResolvedValue([...MOCK_INDEXES])
    mockGetTableConstraints.mockResolvedValue([...MOCK_CONSTRAINTS])
    setStoreState()
    vi.spyOn(tauri, "alterTable").mockResolvedValue({ sql: "..." })
    vi.spyOn(tauri, "createIndex").mockResolvedValue({ sql: "..." })
    vi.spyOn(tauri, "dropIndex").mockResolvedValue({ sql: "..." })
    vi.spyOn(tauri, "addConstraint").mockResolvedValue({ sql: "..." })
    vi.spyOn(tauri, "dropConstraint").mockResolvedValue({ sql: "..." })
  }

axis 파일 beforeEach:
  beforeEach(() => { resetStructurePanelMocks() })

각 it case:
  setStoreState(...)  // optional override
  await act(async () => renderPanel({...}))
  fire events / assert
```

> vi.mock factory 0 건 → ES hoisting 위험 없음 → helper 안 `vi.spyOn(tauri, ...)` 호출 가능 (Sprint 218 와 다름).

## Edge Cases

- **vi.mock factory hoisting**: 본 mega test 는 사전 0 factory — Sprint 218 의 7 factory 와 다름. helper 안 `vi.spyOn(tauri, ...)` 호출 가능 (factory 처럼 hoist 안 됨). 만약 generator 가 axis 파일에서 `vi.mock("@lib/tauri", ...)` 추가하면 사전 동작 변경 — 금지.
- **Mock leakage between axis 파일**: vitest worker-per-file 격리 + `resetStructurePanelMocks()` beforeEach. leakage 0.
- **Shared helper import 누락**: 옵션 B 채택 시 axis 파일에서 helper import 깜빡 시 mock undefined → render fail. evaluator check: 모든 axis 파일이 helper import 보유.
- **`vi.fn()` shared instance + `clearAllMocks()`**: helper 의 module-top-level 정의 → 각 axis 파일이 동일 instance 공유. `clearAllMocks` + `mockResolvedValue([...])` 재할당 패턴 보존.
- **vi.spyOn 5 회 호출 보존**: `beforeEach` body 안 `vi.spyOn(tauri, ...)` 5회 (alterTable / createIndex / dropIndex / addConstraint / dropConstraint). axis 분리 후 동일 패턴 — 사전 byte-equivalent 또는 helper 안 통합.
- **MOCK_COLUMNS spread `[...MOCK_COLUMNS]` 패턴**: 사전 mockResolvedValue 가 spread 로 새 배열 생성 — case 안 mutation 격리. helper 도 동일.
- **Sprint 179 nested describe 처리**:
  - 옵션 A (평탄화): nested 제거, 3 case 평탄.
  - 옵션 B (보존, 권고): overview axis root + nested 1개. setup 격리 명확. 3 case 모두 paradigm prop 으로 render 분기 → describe 감싸기 의미 있음.
- **Axis 파일 case 합계 != 84**: 옵션 1 채택 시 정확히 84.
- **Case 텍스트 변경**: backtick / single-vs-double quote / em-dash `—` / `(regression)` / `(after 1s threshold)` 특수 문자 보존 의무. 특히 paradigm 3 case 의 `[AC-179-...]` bracket-prefix + 내부 `'document'` / `\"rdb\"` 혼용 quote 패턴 byte-equivalent.
- **Assertion 본문 변경**: byte-equivalent. 지역 변수명 변경 허용.
- **AC label prefix 충돌**: AC-01..AC-04 (Index CRUD) vs AC-05..AC-08 (Constraint CRUD) vs AC-09..AC-12 (overview) vs AC-179-02a/03a/04a (paradigm) — 각 axis 별 사전 prefix 보존. axis 별 comment header 명시 권고.
- **`it.only` / `it.skip` 잔존**: 사전 0 → 사후 0.
- **column / index / constraint cross-axis 의존**: 사전 mega test 안 일부 case (예: refresh-structure event L449) 가 columns tab 만 확인 → overview axis. tab switch 가 필요한 read-only case (Indexes/Constraints fetch L218/267) → overview axis 잔존.
- **Section 4 (CONSTRAINT CRUD) 의 mixed error / validation cases**:
  - L1930 (createIndex preview error) / L1974 (dropIndex preview error) / L1996 (dropIndex execute error) → indexes axis.
  - L2023 (dropConstraint preview error) → constraints axis.
  - L2051 (Preview SQL disabled, index form) → indexes axis.
  - L2069 (Preview SQL disabled, constraint form) → constraints axis.
  - 의미적 axis 배치 (사전 section header 위치보다 우선).
- **Async helper duplication**: 사전 `setStoreState` / `renderPanel` 2 helper. helper 파일 승격으로 axis 파일 안 0 inline.
- **userEvent setup**: 사전 `userEvent` import 사용 case 0 — `fireEvent` 만 사용. 사전 import line 보존 (주석 처리 또는 helper 안 흡수).

## Verification Hints

- **Primary regression**:
  ```sh
  pnpm vitest run src/components/schema/StructurePanel*.test.tsx
  # exit 0 + Tests passed (84 + first-render-gate 사전 case)
  ```

- **Axis file shape**:
  ```sh
  ls src/components/schema/StructurePanel.{overview,columns,indexes,constraints}.test.tsx 2>&1
  for f in src/components/schema/StructurePanel.{overview,columns,indexes,constraints}.test.tsx; do
    [ -f "$f" ] && echo "$f: $(grep -cE '^\s*it\(' "$f") cases"
  done
  # 합계 = 84 (옵션 1) 또는 84 - 옵션 2 잔존
  ```

- **Helper file**:
  ```sh
  test -f src/components/schema/__tests__/structurePanelTestHelpers.ts
  grep -nE "^export (function|const) (mockGetTableColumns|mockGetTableIndexes|mockGetTableConstraints|MOCK_COLUMNS|MOCK_INDEXES|MOCK_CONSTRAINTS|setStoreState|renderPanel|resetStructurePanelMocks)" \
    src/components/schema/__tests__/structurePanelTestHelpers.ts | wc -l
  # ≥ 9
  ```

- **Helper 외부 import**:
  ```sh
  grep -rn "structurePanelTestHelpers" src/ e2e/ | wc -l
  # ≤ 4 (= 신규 axis 파일 수)
  ```

- **Sibling + component freeze**:
  ```sh
  git diff --stat src/components/schema/StructurePanel.tsx
  git diff --stat src/components/schema/StructurePanel.first-render-gate.test.tsx
  git diff --stat src/components/schema/SchemaTree.tsx src/components/schema/SchemaTree/
  git diff --stat src/components/schema/SchemaTree.{lifecycle,expand,refresh,search,actions,highlight,dbms-shape,preview,preview.entrypoints,rowcount,virtualization}.test.tsx
  git diff --stat src/components/schema/__tests__/schemaTreeTestHelpers.ts
  git diff --stat src/components/schema/SchemaPanel.test.tsx src/components/schema/SchemaPanel.tsx
  git diff --stat src/components/schema/DocumentDatabaseTree.test.tsx src/components/schema/DocumentDatabaseTree.tsx
  git diff --stat src/components/schema/ViewStructurePanel.test.tsx src/components/schema/ViewStructurePanel.tsx
  git diff --stat src/components/schema/treeShape.ts
  # 모두 0
  ```

- **Project-wide gates**:
  ```sh
  pnpm vitest run    # exit 0, file count [201, 204], tests = 2720
  pnpm tsc --noEmit  # exit 0
  pnpm lint          # exit 0
  ```

- **Verbatim string preservation** (22 strings, bracket-prefix `grep -F`):
  ```sh
  grep -rnF "[AC-179-02a]" src/components/schema/StructurePanel*.test.tsx | wc -l
  grep -rnF "[AC-179-03a]" src/components/schema/StructurePanel*.test.tsx | wc -l
  grep -rnF "[AC-179-04a]" src/components/schema/StructurePanel*.test.tsx | wc -l
  # 각 ≥ 1
  ```

- **AC label 보존**:
  ```sh
  grep -rnE "AC-[0-9]+|AC-179-0[234]" \
    src/components/schema/StructurePanel.{overview,columns,indexes,constraints}.test.tsx | wc -l
  # 사전 매치 수 ~15+ 이상
  ```

- **vi.mock factory 0 건 보존**:
  ```sh
  for f in src/components/schema/StructurePanel.{overview,columns,indexes,constraints}.test.tsx; do
    [ -f "$f" ] && echo "$f: $(grep -cE 'vi\.mock\(' "$f") factory"
  done
  # 각 axis 파일 0 factory (사전 0 — 추가 금지)
  ```

- **vi.spyOn 5건 보존**:
  ```sh
  for f in src/components/schema/StructurePanel.{overview,columns,indexes,constraints}.test.tsx \
           src/components/schema/__tests__/structurePanelTestHelpers.ts; do
    [ -f "$f" ] && echo "$f: $(grep -cE 'vi\.spyOn\(tauri,' "$f") spy"
  done
  # axis 안 0 spy + helper 안 5 spy (옵션 B), 또는 axis 안 5 spy 각 (옵션 A inline)
  ```

- **Lint / behavior 변경 0**:
  ```sh
  git diff src/components/schema/StructurePanel.tsx | wc -l        # 0
  git diff src/components/schema/ | grep "^+.*eslint-disable" | wc -l  # 0
  git diff src/components/schema/ | grep -E "^\+.*it\.(only|skip)" | wc -l  # 0
  ```

- **Entry test 처리**:
  - 옵션 1: `test ! -f src/components/schema/StructurePanel.test.tsx`.
  - 옵션 2: `wc -l src/components/schema/StructurePanel.test.tsx` < 200 + `grep -cE "^\s*it\("` ≤ 5.

- **Sprint 179 nested describe 처리**:
  - 옵션 A: `grep -c 'describe("paradigm-aware vocabulary' src/components/schema/StructurePanel.overview.test.tsx` = 0.
  - 옵션 B (권고): `grep -c 'describe("paradigm-aware vocabulary' src/components/schema/StructurePanel.overview.test.tsx` = 1.

### Critical Files for Implementation

- /Users/felix/Desktop/study/view-table/src/components/schema/StructurePanel.test.tsx
- /Users/felix/Desktop/study/view-table/src/components/schema/StructurePanel.tsx
- /Users/felix/Desktop/study/view-table/src/components/schema/StructurePanel.first-render-gate.test.tsx
- /Users/felix/Desktop/study/view-table/src/components/schema/__tests__/schemaTreeTestHelpers.ts
- /Users/felix/Desktop/study/view-table/docs/sprints/sprint-218/spec.md
