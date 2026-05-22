# Sprint 222 — Handoff

다음 sprint 진입자가 알아야 할 사항. **본 sprint = P11 cycle 의 마지막 mega test split — P11 종료**.

## 완료 산출물

- 신규 5 axis test 파일 (사전 1 mega file 의 axis-별 분배):
  - `src/components/rdb/DataGrid.lifecycle.test.tsx` (16 cases) — 초기 mount + queryTableData / loading / error / column headers + ExportButton ([AC-181-10]) / NULL italic / JSONB stringify / executed-query bar / displays SQL / Sprint 99 empty msg / refresh-data event / PK icon / data type / schema.table fallback / Sprint 101 MongoDB banner regression / missing sorts.
  - `src/components/rdb/DataGrid.sort.test.tsx` (10 cases) — sort cycle + Shift+Click variants + sort resets page + orderBy + Sprint 76 per-tab sort 4 cases (AC-02/AC-03).
  - `src/components/rdb/DataGrid.filters-pagination.test.tsx` (11 cases) — 필터 toggle + Cmd+F + pagination + Sprint 26 (6 cases) + props change resets column widths.
  - `src/components/rdb/DataGrid.refetch-overlay.test.tsx` (9 cases) — Sprint 180 loading-flicker fix + column resize + race condition stale response.
  - `src/components/rdb/DataGrid.editing.test.tsx` (29 cases) — Sprint 30 + 31 + 32 + 43 + 44 + 50 + [AC-185-06] + [AC-186-06]. inline `vi.spyOn(sqlGen, "generateSqlWithKeys")` + `mockRestore()` cleanup 보존.
- 신규 shared helper: `src/components/rdb/__tests__/dataGridTestHelpers.tsx` (10 named export = 6 mock fn + `MOCK_DATA` + `createMockQueryTableData` + `resetDataGridMocks` + `renderDataGrid`). 확장자 `.tsx` (renderDataGrid JSX 포함). type-only `TableData` import only (lint rule 회피).
- 삭제: `src/components/rdb/DataGrid.test.tsx` (사전 1,906 lines / 75 cases, 옵션 1 채택).
- `docs/sprints/sprint-222/{spec,contract,execution-brief,findings,evaluator-scorecard,handoff}.md`.

case 합계 = lifecycle 16 + sort 10 + filters-pagination 11 + refetch-overlay 9 + editing 29 = **75** (사전 동일).

## P11 Cycle 종료

| Sprint | 대상 | 사전 | 사후 |
|--------|------|------|------|
| 216 (P11 step 1) | SchemaTree.test.tsx | 2891 / 104 | 6 axis + helper |
| 218 (P11 step 2) | QueryTab.test.tsx | 2308 / 80 | 6 axis + helper |
| 220 (P11 step 3) | StructurePanel.test.tsx | 2156 / 84 | 4 axis + helper |
| 221 (P11 step 4) | tabStore.test.ts | 2234 / 102 | 6 axis + helper |
| 222 (P11 step 5) | DataGrid.test.tsx | 1906 / 75 | 5 axis + helper |
| **합계** | 5 mega test | **11,495 lines / 445 cases** | **27 axis + 5 helper** |

post-209 cycle 의 P1..P11 후보 중 P11 (mega test split) 완료. 잔여 candidate:
- **P10** (Sprint 219) — `connectionStore` / `schemaStore` 의 toast / session / IPC orchestration → use-case hook 점진 이동. risk 높음 — 사용자 hooks/lib 작업 안정 후 진입.
- `docs/archives/etc/refactoring-candidates.md` retire (별도 ops 작업, P10 종료 후 또는 사용자 결정 시).

## 검증 결과

| 명령 | 결과 |
|------|------|
| `pnpm vitest run src/components/rdb/DataGrid*.test.tsx` | 5 files / 75 passed, exit 0 |
| `pnpm vitest run` (full suite) | 211 files / 2720 tests passed, exit 0 (사전 207 + 5 axis - 1 entry = 211 ∈ [210, 213] ✓) |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| 신규 axis 파일 수 | 5 (∈ [4, 6] ✓) |
| 신규 axis case 합계 | 75 (사전 동일 ✓) |
| `git diff --stat src/components/rdb/DataGrid.tsx` | 0 |
| `git diff --stat src/components/rdb/FilterBar*.{tsx,test.tsx}` | 0 (모두) |
| Sibling diff (datagrid / document / layout / Sprint 216/218/220/221 산출물) | 모두 0 |
| 새 `eslint-disable*` 매치 | 0 (사전 2건 byte-equivalent) |
| 16 verbatim AC string 보존 | 각 정확히 1 매치 (15 spec + 1 추가) |
| Helper named export | 10 (≥ 8) |
| Helper 외부 import | 5 (= axis 파일 수) |
| `it.only` / `it.skip` | 0 |
| 각 axis 파일 root describe | 1개씩 |
| 각 axis 파일 vi.mock factory | 3 (사전 3 inline 복제) |
| Module-top `vi.spyOn` / inline `vi.spyOn` | 0 / 1 (editing axis 의 [AC-186-06]) |
| Helper 안 cross-store runtime import | 0 (type-only `TableData`) |

## Acceptance Criteria 결과

- AC-01 사후 75 case 통과 ✓
- AC-02 신규 axis 5개 (∈ [4-6]) + 각 9-29 case + sibling 충돌 0 ✓
- AC-03 helper named export 10 + 외부 import 5 (= axis 수) + cross-store import 0 ✓
- AC-04 사전 entry 옵션 1 (제거) 채택 ✓
- AC-05 16 verbatim AC string + Global AC 1-10 충족 ✓

Evaluator: **PASS** (Correctness 9 / Completeness 9 / Reliability 10 / Verification Quality 9, overall 9.25/10). P1/P2 finding 0건. F-001 (`mockUpdateTabSorts` initialization mechanism — `mockClear` 가 impl 보존하여 행동 동일) P3.

## 주의 사항

### vi.mock factory ES hoisting (3건)

3 vi.mock factory (`./FilterBar` / `@stores/schemaStore` / `@stores/tabStore`) 는 ES hoisting 으로 helper 외부 호출 불가. 각 axis 파일 module-level inline 3 factory 복제 (총 5 axis × 3 = 15 factory). Sprint 218 의 7 factory 패턴 답습. helper.tsx 안 vi.mock 호출 0.

### Sprint 76 reactive mock pattern 보존

tabStore mock 의 React `useReducer` rerender 패턴 (`mockTabStoreState` + `subscribers` Set + `notify()`) axis 파일 module-top inline. sort axis 4 cases 가 의존.

### Inline vi.spyOn ([AC-186-06]) verbatim

editing axis 안 `vi.spyOn(sqlGen, "generateSqlWithKeys").mockReturnValue(...)` + `try/finally spy.mockRestore()` cleanup 사전 verbatim 보존. helper 통합 금지.

### Dynamic await import 마지막 2 case

[AC-185-06] / [AC-186-06] 안 `await import("@stores/connectionStore" | "@stores/safeModeStore" | "@components/datagrid/sqlGenerator")` inline 보존 — module-top 옮기면 vi.mock 회피 의도 깨짐.

### Helper payload-builder + type-only import (Sprint 221 lint rule 답습)

eslint.config.js `no-restricted-imports` rule 회피. helper 가 runtime store import 0 — type-only `import type { TableData } from "@/types/schema"` 만. axis 파일이 `useTabStore` / `useSchemaStore` runtime import (axis 파일은 `*.test.ts` ignored).

### eslint-disable 2건 보존

사전 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` (L1801 + L1862, [AC-185-06] + [AC-186-06] 의 connection seed `as any`) editing axis 안 byte-equivalent 보존. 신규 0.

### Helper 확장자 `.tsx` (Sprint 220 model 답습)

`renderDataGrid()` 가 `<DataGrid ... />` JSX 반환 → `.tsx` 확장자 불가피. Sprint 220 의 `structurePanelTestHelpers.tsx` 와 동일 패턴.

### 사용자 병행 작업 분리

본 sprint 작업은 `src/components/rdb/DataGrid.{axis}.test.tsx` + `__tests__/dataGridTestHelpers.tsx` + `docs/sprints/sprint-222/` 안에 격리.

## 검증 명령 (재현)

```sh
pnpm vitest run src/components/rdb/DataGrid*.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
ls src/components/rdb/DataGrid.{lifecycle,sort,filters-pagination,refetch-overlay,editing}.test.tsx
for f in src/components/rdb/DataGrid.{lifecycle,sort,filters-pagination,refetch-overlay,editing}.test.tsx; do
  echo "$f: $(grep -cE '^\s*it\(' $f) cases / $(grep -cE 'vi\.mock\(' $f) factories"
done
test -f src/components/rdb/DataGrid.test.tsx && echo "EXISTS" || echo "REMOVED"
grep -nE "^export (function|const)" src/components/rdb/__tests__/dataGridTestHelpers.tsx | wc -l
git diff --stat src/components/rdb/DataGrid.tsx src/components/rdb/FilterBar.tsx src/components/rdb/FilterBar.test.tsx  # 0
```

## 미완 / 후속

- **P11 cycle 종료** — `refactoring-candidates.md` §P11 retire 가능. 별도 ops sprint.
- **P10** (Sprint 219): stores side-effects refactor — 사용자 hooks/lib 작업 안정 후 진입. **post-209 cycle 의 마지막 candidate**.
- 본 sprint 후속 candidate (informational, F-001 P3):
  - F-001: `mockUpdateTabSorts` impl install mechanism (helper plain `vi.fn()` + axis-file `mockImplementation` registration). `mockClear` (vs `mockReset`) 보존 행동 동일.
- cycle 종료 후 `refactoring-candidates.md` retire 예정.
