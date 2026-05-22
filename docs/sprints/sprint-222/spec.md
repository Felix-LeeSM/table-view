# Feature Spec: DataGrid.test.tsx behavior-axis split (Sprint 222 — P11 step 5, last)

## Description

`src/components/rdb/DataGrid.test.tsx` (1,906 lines, 1 root `describe("DataGrid")`, 75 `it` cases) 가 단일 파일에 RDB 그리드 컴포넌트의 다수 behavior axis (initial-render lifecycle / sort cycle + per-tab Sprint 76 / filter toggle + pagination + Sprint 26 / refetch-overlay loading-flicker + race + column-resize / inline editing + commit + row CRUD / multi-row selection + promoteTab triggers + Sprint 44 UX + production env stripe + dangerous-confirm) 의 모든 회귀 가드를 누적 보유한다. Sprint section 헤더 (Regression: loading flicker fix / Sprint 26 / Sprint 30 / Sprint 31 / Sprint 32 / Sprint 43 / Sprint 44 / Sprint 50 / Sprint 76 / Sprint 101) + AC label ([AC-181-10], (AC-180-01), (Sprint 99 AC-01/AC-03), AC-02/AC-03 (Sprint 76), [AC-185-06], [AC-186-06]) 로 axis 추출 경계가 명확.

본 sprint 는 P11 candidate (`docs/archives/backlogs/refactoring-candidates-2026-05-06.md` §P11) 의 **fifth step (last)**. Sprint 216 (P11 step 1) / Sprint 218 (P11 step 2) / Sprint 220 (P11 step 3) / Sprint 221 (P11 step 4) 의 model implementation 패턴 답습. 본 sprint 후 P11 cycle 종료 — `refactoring-candidates.md` 의 §P11 retire 가능. 후속 P11 step 없음.

행동 변경 0 강제. `DataGrid.tsx` 본체 (628 lines) + sibling `FilterBar.tsx` (323 lines) + `FilterBar.test.tsx` (437 lines) 변경 금지. test 만 axis 파일 split. 사전 75 case 모두 사후 통과. case 텍스트 / matcher / fixture / `vi.mock(...)` factory / 모든 verbatim AC string 사전과 byte-equivalent.

이 sprint 는 **test-only refactor + axis split** 패턴. 100% test 파일 재배치. 사전 mega test 가 `vi.mock(...)` factory 3 건 (`./FilterBar` / `@stores/schemaStore` / `@stores/tabStore`) — Sprint 218 의 7 factory 보다 적고 Sprint 220 / 221 의 0 factory 보다 많음. `vi.spyOn(...)` inline 1건 (`[AC-186-06]` 안 `vi.spyOn(sqlGen, "generateSqlWithKeys")`) + module-top 0건.

## Sprint Breakdown

### Sprint 222: DataGrid.test.tsx behavior-axis split

**Goal**: `DataGrid.test.tsx` (1,906 lines / 75 cases) 를 4-6 behavior-axis test 파일 + 1 shared helper 파일로 분해. 사전 1 root describe + 75 case → 사후 axis-별 root describe + 합계 75. 옵션 1 (entry 제거) 권고. 행동 변경 0. `DataGrid.tsx` + `FilterBar.tsx` + `FilterBar.test.tsx` 변경 0.

**Verification Profile**: `command`

**Acceptance Criteria**:

1. **사후 DataGrid*.test.tsx 합계 75 case 통과.**
   `pnpm vitest run src/components/rdb/DataGrid*.test.tsx` exit 0 + 75 cases.

2. **신규 axis 파일 4-6개 + shared helper.**
   - naming: `src/components/rdb/DataGrid.<axis>.test.tsx`.
   - 각 신규 ≥ 5 case + ≤ 30 case.
   - axis 후보 (5 권고):
     - `DataGrid.lifecycle.test.tsx` (~10): 초기 mount + queryTableData 호출 / loading spinner / error / column headers + rows + ExportButton ([AC-181-10]) / NULL italic / JSONB stringify / executed-query bar toggle / displays SQL / PK icon / data-type under name / schema.table fallback / Sprint 99 empty msg / refresh-data event / MongoDB beta banner regression / missing sorts.
     - `DataGrid.sort.test.tsx` (~10): sort cycle ASC→DESC→null + Shift+Click variants + sort resets page + orderBy 인자 + Sprint 76 per-tab sort 4 cases (AC-02/AC-03).
     - `DataGrid.filters-pagination.test.tsx` (~12): 필터 toggle + Cmd+F + pagination + Sprint 26 (6 cases: page-size selector / first-last buttons / jump to page) + props change resets column widths.
     - `DataGrid.refetch-overlay.test.tsx` (~10): Sprint 180 loading-flicker fix (15-19) + column resize (3) + race condition stale response.
     - `DataGrid.editing.test.tsx` (~28): Sprint 30 inline cell editing (5) + Sprint 31 commit & SQL preview (5) + Sprint 32 row operations (5) + Sprint 43 promoteTab triggers (4) + Sprint 44 Data Grid UX (3) + Sprint 50 multi-row selection (5) + [AC-185-06] + [AC-186-06].
   - 옵션 6-axis (대안): editing 28 cases 가 envelope 30 한도 근접 — generator 재량으로 split 가능 (editing ~15 / selection-promote ~13).
   - generator 재량: ±2 case 이동. 합계 75 invariant 보존.

3. **신규 shared helper 파일 (옵션 B 권고).**
   - 옵션 B: `src/components/rdb/__tests__/dataGridTestHelpers.tsx` 신규.
   - **확장자 `.tsx` 불가피**: `renderDataGrid()` 가 `<DataGrid ... />` JSX 반환 (Sprint 220 의 `structurePanelTestHelpers.tsx` 와 동일).
   - named export 8-10 권고:
     - 6 mock fn: `mockQueryTableData` / `mockExecuteQuery` / `mockExecuteQueryBatch` / `mockPromoteTab` / `mockUpdateTabSorts` / `mockSetTabDirty`.
     - 1 fixture constant: `MOCK_DATA` (verbatim).
     - 1-2 fixture builder: `createMockQueryTableData(overrides?)` / `setMockTabStoreState(overrides)`.
     - 1 reset helper: `resetDataGridMocks()`.
     - 1 render helper: `renderDataGrid(props)`.
     - (선택) `makePendingEdit()` — Sprint 31 inline helper 승격.
   - **vi.mock factory 3건 ES hoisting → 각 axis 파일 module-level inline 3 factory 복제 (helper 외부 호출 불가)**.
   - 외부 import 0 — `grep -rn "dataGridTestHelpers" src/ e2e/` 매치 ≤ 6.
   - **Helper 안 cross-store import 금지** (Sprint 221 model 답습 — type-only `import type { ... }` 만 허용).

4. **사전 entry 처리.**
   - 옵션 1 (권고): `src/components/rdb/DataGrid.test.tsx` 제거.
   - 옵션 2 (허용): smoke ≤ 5 case 잔존.

5. **15 verbatim AC string 보존** (각 ≥ 1 매치):
   - "calls queryTableData with correct arguments on mount"
   - "shows error message on failure"
   - "renders column headers and data rows"
   - "renders NULL values as italic text"
   - "renders JSONB objects as JSON.stringify output"
   - "cycles sort: ASC → DESC → null on column header clicks"
   - "ignores stale response when fetchData is called twice rapidly"
   - "shows '0 rows match current filter' + Clear filter button when filters are active"
   - "shows overlay spinner on top of table during refetch (post-threshold)"
   - "double-clicking a cell enters edit mode"
   - "Commit executes SQL and refreshes data"
   - "isolates sort state between tabs — tab A's sort does not leak into tab B"
   - "does not render the MongoDB collection beta banner in the RDB grid"
   - "tolerates a tab whose sorts field is missing"
   - `[AC-185-06] Preview Dialog header renders environment color stripe (production red)`
   - `[AC-186-06] warn + production + dangerous → ConfirmDangerousDialog rendered with reason`

6. **`DataGrid.tsx` 변경 0.** `git diff --stat` = 0.

7. **Sibling 변경 0.** `FilterBar.tsx` / `FilterBar.test.tsx` + 모든 다른 sibling test/component (datagrid / document / layout / Sprint 216/218/220/221 산출물) `git diff --stat` = 0.

8. **Project-wide regression bar.**
   - `pnpm vitest run` exit 0. 사전 baseline (post-Sprint-221, 207 files / 2720 tests) → 사후 [210, 213] files / 2720 tests.
   - `pnpm tsc --noEmit` exit 0.
   - `pnpm lint` exit 0.
   - 새 `eslint-disable*` 0 (사전 2건은 byte-equivalent 보존). 새 silent `catch{}` 0. `it.only` / `it.skip` 0.

**Components to Create/Modify**:

- 신규 5 axis test 파일 (옵션 6-axis 시 6개).
- `src/components/rdb/__tests__/dataGridTestHelpers.tsx` (옵션 B 신규, 확장자 `.tsx`).
- `src/components/rdb/DataGrid.test.tsx` (옵션 1 제거 또는 옵션 2 smoke).

## Global Acceptance Criteria

1. **행동 변경 0.** `DataGrid.tsx` + `FilterBar.tsx` + `FilterBar.test.tsx` + 다른 모든 sibling 변경 0.

2. **사전 75 case 모두 사후 통과 + 추가/제거 0.** vi.mock factory 사전 3건 (사전과 동일). vi.spyOn module-top 0건 + inline 1건 (`[AC-186-06]` 안 verbatim 보존).

3. **사전 import / mock pattern 보존.**

4. **사전 ARIA label / verbatim text 보존.**

5. **사전 fixture data shape 보존.** `MOCK_DATA` literal byte-equivalent.

6. **사전 store mock pattern 보존.** 3 vi.mock factory module-top + reactive Sprint 76 mock pattern (`subscribers` Set + `useReducer` rerender) 보존.

7. **public surface 0 변경.** `DataGridProps` 동결.

8. **새 `eslint-disable*` 0 / silent `catch{}` 0.** 사전 2건 byte-equivalent 보존.

9. **vitest baseline file count 증가.** 사전 207 → 사후 [210, 213].

10. **Sibling drift 0.** Sprint 216/218/220/221 산출물 + DataGrid 본체 + FilterBar + DataGridTable / DataGridToolbar / useDataGridEdit / sqlGenerator + 모든 datagrid test + DocumentDataGrid + MainArea + 모든 다른 test/component 변경 0.

## Edge Cases

- **vi.mock factory hoisting** (3 factory): axis 파일 module-level inline 3 factory 복제 (Sprint 218 model). helper 안 vi.mock 호출 자체가 ES hoisting 위반.
- **Sprint 76 reactive mock pattern**: tabStore mock 의 React `useReducer` rerender 패턴 axis 파일 module-top inline 잔존. helper 안 통합 불가.
- **Sprint 31 `makePendingEdit()` inline helper**: editing axis 안 outer scope 잔존 또는 helper 파일 승격.
- **Inline `vi.spyOn` in [AC-186-06]**: axis 안 verbatim — helper 통합 불필요. `spy.mockRestore()` try/finally 보존.
- **Dynamic `await import` in last 2 cases**: module-top 옮기지 말 것 (vi.mock 회피 의도 보존).
- **MongoDB Collection beta banner regression** (Sprint 101): lifecycle 또는 selection-promote axis 잔존.
- **eslint-disable preservation**: 사전 2건 byte-equivalent. 신규 0.
- **Editing axis 28 cases**: envelope 30 한도 근접 — 옵션 6-axis 가능.

## Verification Hints

- **Primary regression**:
  ```sh
  pnpm vitest run src/components/rdb/DataGrid*.test.tsx
  # exit 0 + 75 passed
  ```

- **Helper file (.tsx)**:
  ```sh
  test -f src/components/rdb/__tests__/dataGridTestHelpers.tsx
  test ! -f src/components/rdb/__tests__/dataGridTestHelpers.ts
  ```

- **Helper 외부 import**:
  ```sh
  grep -rn "dataGridTestHelpers" src/ e2e/ | wc -l
  # ≤ 6
  ```

- **vi.mock factory 3건 보존**:
  ```sh
  for f in src/components/rdb/DataGrid.{lifecycle,sort,filters-pagination,refetch-overlay,editing}.test.tsx; do
    [ -f "$f" ] && echo "$f: $(grep -cE 'vi\.mock\(' "$f") factory"
  done
  # 각 axis 3 factory inline
  ```

- **Helper 안 cross-store import 0**:
  ```sh
  grep -nE "^import .*@stores/" src/components/rdb/__tests__/dataGridTestHelpers.tsx | wc -l
  # 0 (Sprint 221 model — type-only allowed)
  ```

- **Project-wide gates**:
  ```sh
  pnpm vitest run    # exit 0, file count [210, 213], tests = 2720
  pnpm tsc --noEmit  # exit 0
  pnpm lint          # exit 0
  ```

### Critical Files for Implementation

- /Users/felix/Desktop/study/view-table/src/components/rdb/DataGrid.test.tsx
- /Users/felix/Desktop/study/view-table/src/components/rdb/DataGrid.tsx
- /Users/felix/Desktop/study/view-table/src/components/rdb/FilterBar.test.tsx
- /Users/felix/Desktop/study/view-table/docs/sprints/sprint-221/spec.md
- /Users/felix/Desktop/study/view-table/docs/sprints/sprint-220/spec.md
