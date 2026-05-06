# Sprint 222 — Generator Findings (P11 step 5, last)

## Summary

`src/components/rdb/DataGrid.test.tsx` (1,906 lines / 1 root describe / 75 cases)
를 5 behaviour-axis test 파일 + 1 shared helper 파일로 분해.

옵션 1 (entry 제거) + 옵션 5-axis 채택. 행동 변경 0; case 추가/제거 0; sibling drift 0.

## Changed files

- 신규 axis test 5개 (`src/components/rdb/`):
  - `DataGrid.lifecycle.test.tsx` — 16 cases
  - `DataGrid.sort.test.tsx` — 10 cases
  - `DataGrid.filters-pagination.test.tsx` — 11 cases
  - `DataGrid.refetch-overlay.test.tsx` — 9 cases
  - `DataGrid.editing.test.tsx` — 29 cases
- 신규 shared helper: `src/components/rdb/__tests__/dataGridTestHelpers.tsx` (.tsx — `renderDataGrid` 가 `<DataGrid />` JSX 반환).
- 삭제: `src/components/rdb/DataGrid.test.tsx` (사전 1,906 lines, 옵션 1 채택).

case 합계 = 16 + 10 + 11 + 9 + 29 = **75** (사전 동일).

## Axis split decision

**5-axis** (spec recommendation) over 6-axis. Editing axis 29 cases (envelope 30
한도 근접 but within). 6-axis split (editing ~15 + selection-promote ~13) was
considered but rejected to honour the spec's primary recommendation; the
single-axis grouping keeps Sprint 30/31/32/43/44/50 + AC-185-06 + AC-186-06
under one cohesive describe and avoids fracturing the Sprint 31 `makePendingEdit()`
helper across files.

## `makePendingEdit()` location

**Axis-file outer scope** — declared inside `DataGrid.editing.test.tsx`'s
top-level `describe("DataGrid", ...)` block (verbatim L322-336 in axis file)
between the Sprint 31 section header and the first Sprint 31 case. Not
promoted to the helper module. Rationale:

- Used by 5 cases all in editing axis (40-44).
- Closes over `screen` (testing-library) at function-call time without
  dragging an extra param through the helper signature.
- Verbatim preservation of the Sprint 31 inline-helper pattern.

## 22-check verification outcomes

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm vitest run src/components/rdb/DataGrid*.test.tsx` exit 0 + 75 | PASS — 5 files / 75 passed |
| 2 | `pnpm vitest run` exit 0, file count [210, 213], tests 2720 | PASS — 211 files / 2720 tests passed |
| 3 | `pnpm tsc --noEmit` exit 0 | PASS — clean |
| 4 | `pnpm lint` exit 0 | PASS — clean |
| 5 | axis file count ∈ [4, 6] | PASS — 5 |
| 6 | axis case 합계 = 75 (옵션 1) | PASS — 16+10+11+9+29 = 75 |
| 7 | `git diff --stat src/components/rdb/DataGrid.tsx` 0 | PASS — empty |
| 8 | FilterBar diffs 0 | PASS — empty |
| 9 | `src/components/datagrid/` diff 0 | PASS — empty |
| 10 | document/* siblings diff 0 | PASS — empty |
| 11 | layout/MainArea diff 0 | PASS — empty |
| 12 | Sprint 216/218/220/221 산출물 diff 0 | PASS — all empty |
| 13 | new `eslint-disable` in src/components/rdb/ diff | PASS — 0 (사전 2건은 editing axis 안 byte-equivalent 보존) |
| 14 | 16 verbatim AC strings ≥ 1 match each | PASS — 모두 매치 ("Commit executes SQL and refreshes data" 2 매치 = 1 comment + 1 it title, 사전과 동일) |
| 15 | `test ! -f DataGrid.test.tsx` (옵션 1) | PASS — REMOVED |
| 16 | helper named exports ≥ 8 | PASS — 10 (`MOCK_DATA` + `createMockQueryTableData` + 6 mock fn + `resetDataGridMocks` + `renderDataGrid`) |
| 17 | helper external imports ≤ 6 | PASS — 5 (각 axis 파일 1회) |
| 18 | `it.only` / `it.skip` 0 | PASS — 5 axis 모두 0 |
| 19 | 각 axis 파일 root describe 1개 | PASS — 5 axis 모두 1개 (nested 0) |
| 20 | axis 파일 안 `vi.mock(` = 3 each | PASS — 5 axis 모두 3 factory inline (`./FilterBar` / `@stores/schemaStore` / `@stores/tabStore`) |
| 21 | module-top `vi.spyOn` 0 + inline `vi.spyOn` 1 in `[AC-186-06]` | PASS — module-top 0건 (5 axis + helper); inline 1건 (`DataGrid.editing.test.tsx:797` `vi\n.spyOn(sqlGen, "generateSqlWithKeys")`) verbatim |
| 22 | helper cross-store runtime imports 0 | PASS — 0 (type-only `import type { TableData } from "@/types/schema"` 만 존재) |

### Verification commands run (full output references)

```sh
pnpm vitest run src/components/rdb/DataGrid*.test.tsx
# Test Files  5 passed (5)
# Tests       75 passed (75)
# Duration    2.85s

pnpm vitest run
# Test Files  211 passed (211)
# Tests       2720 passed (2720)
# Duration    43.38s

pnpm tsc --noEmit
# (no output, exit 0)

pnpm lint
# (no output, exit 0)
```

## Acceptance Criteria coverage

- **AC-01** — 사후 DataGrid*.test.tsx 합계 case = 75 (옵션 1 정확히 75).
  `pnpm vitest run src/components/rdb/DataGrid*.test.tsx` exit 0 + 75 cases.
  Evidence: check 1, check 6.
- **AC-02** — 신규 axis 5개 (∈ [4, 6]) + 각 9-29 cases (∈ [5, 30]) + sibling 충돌 0.
  Evidence: check 5, check 6, checks 7-12.
- **AC-03** — Helper file (옵션 B) 채택. named export 10 (≥ 8). 외부 import 5
  (= axis 파일 수). Helper 안 cross-store runtime import 0.
  Evidence: check 16, check 17, check 22.
- **AC-04** — 사전 entry 옵션 1 (제거) 채택. `DataGrid.test.tsx` 부재.
  Evidence: check 15.
- **AC-05** — 16 verbatim AC string 모두 사후 axis 파일 안 1건 이상 매치
  ("Commit executes SQL..." 사전 2 매치 보존, 나머지 15건 1 매치). Global AC 1-10
  모두 충족 (행동 변경 0 / 75 case 보존 / mock pattern 보존 / fixture
  byte-equivalent / public surface 동결 / 새 eslint-disable 0 / vitest baseline
  207→211 ∈ [210, 213] / sibling drift 0).
  Evidence: check 14, check 7-13.

## 15 verbatim AC string match counts

| String | Match count |
|--------|-------------|
| `calls queryTableData with correct arguments on mount` | 1 |
| `shows error message on failure` | 1 |
| `renders column headers and data rows` | 1 |
| `renders NULL values as italic text` | 1 |
| `renders JSONB objects as JSON.stringify output` | 1 |
| `cycles sort: ASC → DESC → null on column header clicks` | 1 |
| `ignores stale response when fetchData is called twice rapidly` | 1 |
| `shows '0 rows match current filter' + Clear filter button when filters are active` | 1 |
| `shows overlay spinner on top of table during refetch (post-threshold)` | 1 |
| `double-clicking a cell enters edit mode` | 1 |
| `Commit executes SQL and refreshes data` | 2 (사전과 동일 — 1 comment + 1 it title) |
| `isolates sort state between tabs — tab A's sort does not leak into tab B` | 1 |
| `does not render the MongoDB collection beta banner in the RDB grid` | 1 |
| `tolerates a tab whose sorts field is missing` | 1 |
| `[AC-185-06] Preview Dialog header renders environment color stripe (production red)` | 1 |
| `[AC-186-06] warn + production + dangerous → ConfirmDangerousDialog rendered with reason` | 1 |

## Key preservation patterns

- **3 vi.mock factory** (`./FilterBar` / `@stores/schemaStore` / `@stores/tabStore`)
  — 각 axis 파일 module-level inline 복제 (ES hoisting). Helper 안 호출 0.
- **Sprint 76 reactive mock pattern** (`mockTabStoreState` + `subscribers` Set +
  React `useReducer` rerender) — 각 axis 파일 module-top 잔존 verbatim. Helper
  통합 불가 (`vi.mock("@stores/tabStore", ...)` factory 가 `mockTabStoreState`
  closure 캡처).
- **`mockUpdateTabSorts.mockImplementation(...)`** — helper 가 export 한
  `vi.fn()` instance 에 각 axis 파일 module-top 에서 axis-local
  `mockTabStoreState` 를 mutate 하는 impl 등록. `resetMockTabStore()` 의
  `mockClear()` 가 impl 를 보존하므로 reset 후에도 impl 활성.
- **Inline `vi.spyOn(sqlGen, "generateSqlWithKeys")`** — `[AC-186-06]` 안
  verbatim. `try/finally` 안 `spy.mockRestore()` cleanup 보존. Helper 통합 0.
- **Dynamic `await import(connectionStore / safeModeStore / sqlGenerator)`** —
  마지막 2 case 안 inline 보존 (vi.mock 회피 의도).
- **사전 eslint-disable 2건** (`DataGrid.editing.test.tsx` 안 AC-185-06 + AC-186-06
  안) byte-equivalent 보존. 신규 추가 0.
- **MOCK_DATA fixture** byte-equivalent (helper 의 `MOCK_DATA` 가 사전 module-top
  literal 와 byte-equivalent).
- **`beforeEach` body** — `resetDataGridMocks()` (helper) + axis-local
  `resetMockTabStore()`. 합쳐서 사전 `beforeEach` body 와 의미 동일.

## Helper named exports (10)

1. `MOCK_DATA` — 사전 fixture verbatim.
2. `createMockQueryTableData(overrides?)` — 사전 inline factory.
3. `mockQueryTableData` — `vi.fn(() => Promise.resolve({ ...MOCK_DATA }))`.
4. `mockExecuteQuery` — `vi.fn(...)` (사전 module-top 동일).
5. `mockExecuteQueryBatch` — `vi.fn(...)` (사전 module-top 동일).
6. `mockPromoteTab` — `vi.fn()`.
7. `mockUpdateTabSorts` — `vi.fn()` (impl 는 axis-local 등록).
8. `mockSetTabDirty` — `vi.fn()`.
9. `resetDataGridMocks()` — 사전 `beforeEach` body 의 mockReset 6 + happy-path
   reinstall 재구성.
10. `renderDataGrid(props)` — `<DataGrid connectionId="conn1" table="users" schema="public" {...props} />` JSX 반환.

## Assumptions

- **5-axis** (옵션 A) 채택 — spec primary recommendation. 6-axis 가능성은
  `editing` 29 cases 가 envelope 30 임계점에 있으나 within bound 이므로 split
  불요로 판단.
- **`makePendingEdit()`** axis-file outer scope 보존 (helper 승격 X) — Sprint 31
  inline-helper 패턴 verbatim.
- **`mockUpdateTabSorts` impl install** — helper 가 plain `vi.fn()` 으로 export,
  각 axis 파일 module-top 이 `mockUpdateTabSorts.mockImplementation(...)` 로
  axis-local `mockTabStoreState` 를 mutate 하는 impl 등록. `resetMockTabStore()`
  의 `mockClear()` 는 impl 보존 (reset 아님). 결과: 사전 `vi.fn(impl)` constructor
  pattern 과 동작 동일.
- **3 vi.mock factory ES hoisting** — helper 외부 호출 불가 → 각 axis 파일
  module-level inline 3 factory 복제. Sprint 218 model 답습.
- **Helper 확장자 `.tsx`** — `renderDataGrid` 가 `<DataGrid />` JSX 반환
  (Sprint 220 `structurePanelTestHelpers.tsx` 와 동일 pattern).
- **Helper 안 cross-store runtime import 금지** (Sprint 221 lint rule 답습) —
  type-only `import type { TableData } from "@/types/schema"` 만 사용. 사전
  `useSchemaStore` / `useTabStore` runtime import 0.
- **Pre-existing eslint-disable 2건** (AC-185-06 + AC-186-06 안 `as any` 캐스트)
  byte-equivalent 보존 in `DataGrid.editing.test.tsx`.

## Residual risk

- **vi.mock factory ES hoisting** — 5 axis 파일 module-level inline 3 factory.
  hoisted body 는 helper 가 export 한 `mockQueryTableData` / `mockExecuteQuery`
  / `mockExecuteQueryBatch` / `mockPromoteTab` / `mockUpdateTabSorts` /
  `mockSetTabDirty` 를 import 결과로 참조. vitest 의 module-level mock hoisting
  은 vi.mock 이 import 보다 먼저 실행되지만, factory **본문**은 첫 호출 시점에
  evaluate 되므로 import 가 완료된 시점에 mock fn instance 가 resolvable.
- **Sprint 76 reactive mock 의 `useReducer` rerender** — 각 axis 파일에 verbatim
  보존. 누락 시 sort cycle / per-tab restoration 4 cases fail.
- **Inline `vi.spyOn` cleanup** — `try/finally` 안 `spy.mockRestore()` 보존.
  누락 시 next test 가 mocked impl 누수.
- **Dynamic `await import`** 마지막 2 case 안 inline. module-top 옮기면 vi.mock
  회피 의도 깨짐.
- **vitest worker-per-file 격리 의존** — helper 의 module-level `vi.fn()`
  instance 가 axis 파일마다 fresh evaluate. pool config 변경 시 mock isolation
  검증 필요 (사전 ADR 0019/0020 회귀 가드 동일).
- 본 sprint 후 **P11 cycle 종료** — `refactoring-candidates.md` retire 가능
  (별도 ops). 후속 P11 step 없음.
