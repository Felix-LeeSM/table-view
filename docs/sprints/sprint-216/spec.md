# Feature Spec: SchemaTree.test.tsx behavior-axis split (Sprint 216 — P11 step 1)

## Description

`src/components/schema/SchemaTree.test.tsx` (2,891 lines, 1 root `describe("SchemaTree")`, 104 `it` cases) 가 단일 파일에 7+ behavior axis (mount lifecycle / expand-collapse / refresh / search / context-menu actions / a11y / icons) 의 모든 회귀 가드를 누적해 보유한다. 사전 구조는 AC-01~AC-XX label 로 그룹핑되어 axis 추출이 명확. 동일 디렉토리에 사전 5 axis-test (`SchemaTree.dbms-shape.test.tsx` 10 cases / `SchemaTree.preview.test.tsx` 5 / `SchemaTree.preview.entrypoints.test.tsx` 9 / `SchemaTree.rowcount.test.tsx` 4 / `SchemaTree.virtualization.test.tsx` 7) 가 존재해 split convention 확립.

본 sprint 는 P11 candidate (`docs/archives/etc/refactoring-candidates.md` §P11) 의 **first step**. 5개 mega test 중 **`SchemaTree.test.tsx` 만** behavior axis 별로 split, 나머지 4개 (tabStore/QueryTab/StructurePanel/DataGrid) 는 후속 sprint candidate. P10 은 risk 가 더 높아 P11 다음으로 미룸.

행동 변경 0 강제. `SchemaTree.tsx` 본체 + sub-file 5 (Sprint 199 분해) 변경 금지. test 만 axis 파일 split. 사전 104 case 모두 사후 통과. case 텍스트 / matcher / fixture / mock setup / 모든 inline data shape 사전과 byte-equivalent.

이 sprint 는 **test-only refactor + axis split** 패턴 — Sprint 199 / 200 / 201 / 213 / 217 의 entry-pattern god-component split 과 다르고, Sprint 215 의 hook extraction 과도 다름. 100% test 파일 재배치이며 src/component 변경 0.

## Sprint Breakdown

### Sprint 216: SchemaTree.test.tsx behavior-axis split

**Goal**: `SchemaTree.test.tsx` (2891 lines / 104 cases) 를 4-6개 behavior-axis test 파일 + 1개 shared helper 파일로 분해. 사전 1 root describe + 104 case 가 사후 axis-별 describe + 합계 104 case. 사전 entry test 처리 옵션 1 (전부 axis 로 이동, entry 제거) 권고하나 옵션 2 (smoke-only 잔존, axis 가 나머지) 도 허용. 행동 변경 0. 5 사전 axis 파일 변경 0. `SchemaTree.tsx` + sub-file 5개 변경 0.

**Verification Profile**: `command`

**Acceptance Criteria**:

1. **사후 SchemaTree*.test.tsx 합계 104 case 통과.** `pnpm vitest run src/components/schema/SchemaTree*.test.tsx` exit 0 + `Tests passed` 합계 = 사전 동일 (사전 = SchemaTree.test 104 + 사전 5 axis 35 = 139). 사전 5 axis 파일 합계 (35) 변경 0; 본 sprint 신규 axis 파일 합계 = 104.

2. **신규 axis 파일 4-6개 + shared helper.**
   - naming: `src/components/schema/SchemaTree.<axis>.test.tsx`.
   - 각 신규 파일 ≥ 5 case + ≤ 35 case.
   - 신규 axis 이름 후보 (사전 5 axis `dbms-shape` / `preview` / `preview.entrypoints` / `rowcount` / `virtualization` 재사용 금지):
     - `SchemaTree.lifecycle.test.tsx` (~10 case): mount auto-load, connectionId change, edge undefined/empty, header label, root class, fallback, load reject cleanup.
     - `SchemaTree.expand.test.tsx` (~25 case): AC-CAT-01..06 categories, AC-EXPAND-01..02 auto-expand, keyboard, separator, indentation, icon-shift, schema loading spinner.
     - `SchemaTree.refresh.test.tsx` (~6 case): AC-07 refresh button, AC-10 event + cleanup, schema right-click Refresh.
     - `SchemaTree.search.test.tsx` (~10 case): AC-SEARCH-01..10.
     - `SchemaTree.actions.test.tsx` (~30 case): table click → addTab, AC-CM-01..16 context menu, F2 rename, view/function tab open, AC-191-03 toast, AC-192-04 export popover.
     - `SchemaTree.highlight.test.tsx` (~22 case): AC-SEL/ACTIVE/VIS/SEP/ICON, row_count tilde+null+zero, count badges.
   - generator 재량: 6→5/7 재배치 가능.

3. **신규 shared helper 파일 (옵션 B 권고).**
   - 옵션 B: `src/components/schema/__tests__/schemaTreeTestHelpers.ts` 또는 `src/components/schema/SchemaTree.testHelpers.ts` 신규. 5 mock + 2 helper named export.
   - 옵션 A 허용: 각 axis 파일 inline.
   - 외부 import 0 — `grep -rn "schemaTreeTestHelpers" src/ e2e/` 매치 ≤ 신규 axis 파일 수.

4. **사전 entry test 처리.**
   - 옵션 1 (권고): 파일 제거.
   - 옵션 2 (허용): smoke-only ≤ 5 case 잔존. axis 와 의미 중복 0.

5. **23 verbatim string 보존** (각 1건 이상 axis 파일 안):
   - "calls loadSchemas with connectionId on mount"
   - "renders schema names from store"
   - "toggles schema expanded state on click (sprint 144 — auto-expanded on mount)"
   - "calls loadTables when expanding a schema for the first time"
   - "reloads schemas when refresh-schema window event is dispatched"
   - "removes refresh-schema listener on unmount"
   - "calls addTab with correct params when table is clicked"
   - "shows context menu with Structure/Data/Rename/Drop on table right-click"
   - "calls dropTable when confirming drop dialog"
   - "calls renameTable when confirming rename dialog"
   - "shows error when renaming to empty string"
   - "shows error when renaming to name with invalid characters"
   - "renders search input when Tables category is expanded with tables"
   - "filters tables case-insensitively"
   - "shows 'No matching tables' when filter matches no tables"
   - "highlights table node when it matches the active tab"
   - "updates highlight when active tab changes to a different table"
   - "auto-expands schema when active tab has table in that schema"
   - "auto-expands ALL schemas on mount regardless of active tab (sprint 144)"
   - "opens rename dialog when F2 is pressed on a focused table button"
   - "[AC-191-03-1] dropTable rejection surfaces toast error instead of silent swallow"
   - "[AC-192-04-1] header Export popover surfaces 3 actions per schema for RDB connections"
   - "[AC-192-04-2] header Export popover trigger is hidden for non-RDB connections"

6. **`SchemaTree.tsx` + sub-file 5개 변경 0.** `git diff --stat` 모두 0.

7. **사전 5 axis 파일 변경 0.** `git diff --stat` 모두 0.

8. **Project-wide regression bar.**
   - `pnpm vitest run` exit 0. 사전 189 files / 2720 tests → 사후 (189 + Δ files) / 2720 tests. Δ files = 신규 axis (4-7) - 옵션 1 채택 시 1.
   - `pnpm tsc --noEmit` exit 0 — 새 `any` 0.
   - `pnpm lint` exit 0.
   - 새 `eslint-disable*` 0. 새 silent `catch{}` 0.

**Components to Create/Modify**:

- `src/components/schema/SchemaTree.lifecycle.test.tsx` (create, ~250-400 lines, ~10 cases): mount auto-load + re-render skip + connectionId change + edge cases + load failure cleanup + 'Schemas' header label + select-none root class.
- `src/components/schema/SchemaTree.expand.test.tsx` (create, ~700-900 lines, ~25 cases): AC-03 toggle + AC-04 loadTables + AC-08 No tables + AC-CAT-01..06 + Keyboard Enter/Space + Loading spinner + AC-VIS-02..03 + indentation + AC-SEP-01 + AC-ICON-02..04 + AC-EXPAND-01..02 + view/function/procedure items.
- `src/components/schema/SchemaTree.refresh.test.tsx` (create, ~250-350 lines, ~6 cases): AC-07 button + spinner + AC-10 event + cleanup + AC-CM-17..18 schema Refresh.
- `src/components/schema/SchemaTree.search.test.tsx` (create, ~350-450 lines, ~10 cases): AC-SEARCH-01..10.
- `src/components/schema/SchemaTree.actions.test.tsx` (create, ~900-1100 lines, ~30 cases): AC-05 + AC-CM-01..16 + view/function click + view structure/data + F2 rename + AC-191-03 toast + AC-192-04 export.
- `src/components/schema/SchemaTree.highlight.test.tsx` (create, ~600-800 lines, ~22 cases): AC-09 row_count + AC-SEL-01..03 + AC-ACTIVE-01..03 + AC-VIS-01.
- `src/components/schema/__tests__/schemaTreeTestHelpers.ts` (create, ~50-90 lines, 옵션 B): 5 mock + 2 helper named export.
- `src/components/schema/SchemaTree.test.tsx` (modify or delete):
  - 옵션 1 (권고): 파일 제거.
  - 옵션 2 (허용): smoke ≤ 5 case 잔존.

> 위 axis 분배는 권고치 — generator 재량으로 ±2 case 이동, axis 이름 변경, 6→5/7 재배치 가능. 단 AC-2 / AC-3 / AC-4 / AC-5 의 명시 cap 은 준수.

## Global Acceptance Criteria

1. **행동 변경 0 (test-only refactor).** `SchemaTree.tsx` + sub-file 5개 + 사전 5 axis 파일 모두 `git diff --stat` 0.

2. **사전 104 case 모두 사후 통과 + case 추가/제거 0.** axis 파일 합계 = 104 (옵션 1) 또는 104 + 옵션 2 잔존.

3. **사전 import / mock pattern 보존.** vitest / @testing-library/react / SchemaTree default import / 3 store import / 5 mock + 2 helper 사전 동일.

4. **사전 ARIA label / verbatim text 보존.** "public schema" / "users table" / "Tables in public" / "Refresh schemas" / "Filter tables..." / "Rename Table" / "Drop Table" / "Schemas" / "Export" / "No tables" / "No matching tables" 등.

5. **사전 fixture data shape 보존.** schema / table / view / function literal byte-equivalent.

6. **사전 store seed pattern 보존.** `useSchemaStore.setState` / `useConnectionStore.setState` / `useTabStore.setState` shape (특히 connection 7 필드).

7. **public surface 0 변경.** `SchemaTreeProps` 동결. 외부 importer 변경 0.

8. **새 `eslint-disable*` 0, 새 silent `catch{}` 0.**

9. **vitest baseline file count 증가.** 사전 189 → 사후 [192, 196] 범위. test count 동일 2720.

10. **Sibling drift 0.** `SchemaPanel.test.tsx` / `DocumentDatabaseTree.test.tsx` / `StructurePanel.test.tsx` / `StructurePanel.first-render-gate.test.tsx` / `ViewStructurePanel.test.tsx` 변경 0.

## Data Flow

### Before

```
src/components/schema/
  ├─ SchemaTree.test.tsx (2891 lines, 1 root describe, 104 cases)
  │  ├─ inline: 5 mock fn + 2 helper + 3 local async helper
  │  └─ 104 cases by AC labels
  ├─ SchemaTree.dbms-shape.test.tsx (10) — untouched
  ├─ SchemaTree.preview.test.tsx (5) — untouched
  ├─ SchemaTree.preview.entrypoints.test.tsx (9) — untouched
  ├─ SchemaTree.rowcount.test.tsx (4) — untouched
  └─ SchemaTree.virtualization.test.tsx (7) — untouched

  Total: 6 files / 139 cases.
```

### After

```
src/components/schema/
  ├─ __tests__/schemaTreeTestHelpers.ts (옵션 B)
  │     5 mock + 2 helper named export
  │
  ├─ SchemaTree.lifecycle.test.tsx (~10 cases)
  ├─ SchemaTree.expand.test.tsx (~25 cases)
  ├─ SchemaTree.refresh.test.tsx (~6 cases)
  ├─ SchemaTree.search.test.tsx (~10 cases)
  ├─ SchemaTree.actions.test.tsx (~30 cases)
  ├─ SchemaTree.highlight.test.tsx (~22 cases)
  │
  ├─ (옵션 1) SchemaTree.test.tsx — 제거
  │   OR
  ├─ (옵션 2) SchemaTree.test.tsx — smoke-only ≤ 5 case
  │
  ├─ SchemaTree.dbms-shape.test.tsx (10) ─── 변경 0
  ├─ SchemaTree.preview.test.tsx (5) ─────── 변경 0
  ├─ SchemaTree.preview.entrypoints.test.tsx (9) ─ 변경 0
  ├─ SchemaTree.rowcount.test.tsx (4) ─────── 변경 0
  └─ SchemaTree.virtualization.test.tsx (7) ─ 변경 0

  Total: 10-11 files / 139 cases.
```

### Cross-module dependency

```
schemaTreeTestHelpers.ts (new, 옵션 B)
  ├─→ vi (vitest)
  ├─→ useSchemaStore / useConnectionStore / useTabStore
  └─→ no React DOM render

SchemaTree.<axis>.test.tsx (each)
  ├─→ schemaTreeTestHelpers (옵션 B) OR inline (옵션 A)
  ├─→ vitest + @testing-library/react
  ├─→ SchemaTree (default)
  ├─→ 3 store
  └─→ axis-specific local helpers

SchemaTree.tsx + sub-file 5개 → 변경 0
사전 5 axis test 파일 → 변경 0
```

### Mock state lifecycle (사전 동일)

```
beforeEach (모든 axis 파일):
  vi.clearAllMocks()
  mockLoadSchemas.mockResolvedValue(undefined)
  mockLoadTables.mockResolvedValue(undefined)
  resetStores()  // 3 store 초기 상태

각 it case:
  setSchemaStoreState({...})
  optional: useTabStore.setState / useConnectionStore.setState
  await act(() => render(<SchemaTree connectionId="conn1" />))
  fire events / assert
```

## Edge Cases

- **Mock leakage between axis 파일**: vitest worker 격리 + `resetStores()` beforeEach. leakage 0.
- **Shared helper import 누락**: 옵션 B 채택 시 axis 파일에서 helper import 깜빡 시 mockLoadSchemas undefined → render fail. evaluator check: 모든 axis 파일이 helper import 보유.
- **`vi.fn()` shared instance + `vi.clearAllMocks()`**: module-top-level 정의 → axis 파일 동일 instance 공유. clearAllMocks beforeEach. mockResolvedValue reassign 패턴 유지.
- **Axis 파일 case 합계 != 104**: 옵션 1 채택 시 합계 = 104. 옵션 2 채택 시 합계 = 104 - 옵션 2 잔존.
- **Case 텍스트 변경**: case description 1자 변경도 verbatim AC-5 위반 — generator cut/paste 시 textually 보존 의무.
- **Assertion 본문 변경**: case body byte-equivalent. 지역 변수명 변경 허용 — observable behavior 만 보존.
- **AC label prefix 충돌**: 사전 AC-01 두 군데 (76 mount + 2563 sprint107 F2), AC-03 세 군데, AC-04 네 군데 등. axis split 후 각 axis 파일 안 AC label 보존하되 axis 별 comment header 에 sprint number / context 명시 권고.
- **`it.only` / `it.skip` 잔존**: 사전 0 → 사후 0.
- **`describe` nested vs flat**: 사전 1 root + 104 flat. axis 파일 채택 시 각 파일 자체 root describe 1개 + flat it. nested describe 추가 금지.
- **Async helper duplication**: 사전 3 local async helper. 각 axis 파일 필요한 helper 만 inline 또는 helpers.ts 승격.
- **`document.activeElement` / `selectionStart` matcher**: jsdom focus 동작 axis 파일 격리 worker 동일 작동.
- **F2 + dropTable mock 격리**: store override → resetStores cleanup. axis 분리 후 동일 pattern.
- **toast import**: AC-191-03 cases `await import("@/lib/toast")` + spy → 동일 pattern. spy restore 사전 동일.
- **Fail mode**: vitest fast-fail off — 한 axis 파일 fail 시 다른 axis 파일 계속 실행.
- **Order-dependent state**: store-level mutable state 의존 → resetStores beforeEach 격리.

## Verification Hints

- **Primary regression**:
  ```sh
  pnpm vitest run src/components/schema/SchemaTree*.test.tsx
  # exit 0 + Tests passed (139)
  ```

- **Axis file shape**:
  ```sh
  ls src/components/schema/SchemaTree.{lifecycle,expand,refresh,search,actions,highlight}.test.tsx 2>&1
  for f in src/components/schema/SchemaTree.{lifecycle,expand,refresh,search,actions,highlight}.test.tsx; do
    echo "$f: $(grep -c '^  it(' $f) cases"
  done
  # 합계 = 104 (옵션 1) 또는 104 - 옵션 2 잔존
  ```

- **Helper file (옵션 B)**:
  ```sh
  test -f src/components/schema/__tests__/schemaTreeTestHelpers.ts \
    || test -f src/components/schema/SchemaTree.testHelpers.ts
  grep -nE "^export (function|const) (mockLoadSchemas|setSchemaStoreState|resetStores)" \
    src/components/schema/__tests__/schemaTreeTestHelpers.ts  # ≥ 3
  ```

- **Sibling + component freeze**:
  ```sh
  git diff --stat src/components/schema/SchemaTree.tsx \
    src/components/schema/SchemaTree/ \
    src/components/schema/SchemaTree.dbms-shape.test.tsx \
    src/components/schema/SchemaTree.preview.test.tsx \
    src/components/schema/SchemaTree.preview.entrypoints.test.tsx \
    src/components/schema/SchemaTree.rowcount.test.tsx \
    src/components/schema/SchemaTree.virtualization.test.tsx
  # 모두 0
  ```

- **Project-wide gates**:
  ```sh
  pnpm vitest run    # exit 0, file count [192, 196], tests = 2720
  pnpm tsc --noEmit  # exit 0
  pnpm lint          # exit 0
  ```

- **Verbatim string preservation**:
  ```sh
  for s in \
    "calls loadSchemas with connectionId on mount" \
    "reloads schemas when refresh-schema window event is dispatched" \
    "shows context menu with Structure/Data/Rename/Drop on table right-click" \
    "auto-expands ALL schemas on mount regardless of active tab (sprint 144)" \
    "[AC-191-03-1] dropTable rejection surfaces toast error instead of silent swallow"; do
    grep -rn "$s" src/components/schema/SchemaTree*.test.tsx | wc -l
  done
  # 각 string 별 매치 = 1
  ```

- **AC label 보존**:
  ```sh
  grep -rnE "^\s*//\s*AC-[A-Z0-9-]+" src/components/schema/SchemaTree.{lifecycle,expand,refresh,search,actions,highlight}.test.tsx | wc -l
  # 사전 매치 수 (~50+) 이상
  ```

- **Lint / behavior 변경 0**:
  ```sh
  git diff src/components/schema/SchemaTree.tsx | wc -l        # 0
  git diff src/components/schema/SchemaTree/ | wc -l           # 0
  git diff src/components/schema/ | grep "^+.*eslint-disable"  # 0
  ```

- **Entry test 처리**:
  - 옵션 1: `test ! -f src/components/schema/SchemaTree.test.tsx`.
  - 옵션 2: `wc -l SchemaTree.test.tsx` < 200 + `grep -c "^  it("` ≤ 5.

### Critical Files for Implementation

- /Users/felix/Desktop/study/view-table/src/components/schema/SchemaTree.test.tsx
- /Users/felix/Desktop/study/view-table/src/components/schema/SchemaTree.tsx
- /Users/felix/Desktop/study/view-table/src/components/schema/SchemaTree.preview.entrypoints.test.tsx
- /Users/felix/Desktop/study/view-table/src/components/schema/SchemaTree.rowcount.test.tsx
- /Users/felix/Desktop/study/view-table/docs/archives/etc/refactoring-candidates.md
