# Sprint Contract: sprint-222

## Summary

- Goal: `src/components/rdb/DataGrid.test.tsx` (1,906 lines / 1 root describe / 75 cases) 를 4-6 behavior-axis test 파일 + 1 shared helper 파일로 분해. 행동 변경 0; `DataGrid.tsx` + `FilterBar.tsx` + `FilterBar.test.tsx` + 모든 다른 sibling 변경 0. 사전 75 case 모두 사후 통과.
- Audience: Generator + Evaluator (multi-agent harness, post-209 cycle, **P11 step 5, last**).
- Owner: harness skill orchestrator.
- Verification Profile: `command`

## In Scope

- 신규 axis test 파일 4-6개: `src/components/rdb/DataGrid.{lifecycle,sort,filters-pagination,refetch-overlay,editing}.test.tsx` (이름은 generator 재량).
- 신규 shared helper 파일 (옵션 B 권고): `src/components/rdb/__tests__/dataGridTestHelpers.tsx` (확장자 `.tsx` — JSX 포함).
- 사전 entry `src/components/rdb/DataGrid.test.tsx` 처리: 옵션 1 (제거, 권고) 또는 옵션 2 (smoke ≤ 5 case 잔존).

## Out of Scope

- 행동 변경, 새 feature 추가.
- `src/components/rdb/DataGrid.tsx` 변경.
- `src/components/rdb/FilterBar.tsx` / `FilterBar.test.tsx` 변경.
- 모든 다른 sibling test/component 변경 (datagrid / document / layout / Sprint 216/218/220/221 산출물 / store / hook / 외부 importer).
- case 텍스트 / matcher / fixture data shape 변경.
- AC label / sprint section header 변경.

## Invariants

- 사전 75 case 모두 사후 통과 + case 추가/제거 0.
- 15 verbatim AC string 모두 사후 axis 파일 안에 1건 이상 존재.
- vi.mock factory 3건 사전 동일 (`./FilterBar` / `@stores/schemaStore` / `@stores/tabStore`).
- vi.spyOn module-top 0건 + inline 1건 (`[AC-186-06]` 안 `vi.spyOn(sqlGen, "generateSqlWithKeys")`) 사전 동일.
- 사전 import / mock pattern 보존 — Sprint 76 reactive mock state (`mockTabStoreState` + `subscribers` Set + React `useReducer` rerender) verbatim.
- 사전 fixture data shape 보존 (`MOCK_DATA` literal byte-equivalent).
- 사전 store seed pattern 보존 — `beforeEach` body verbatim (mockReset 6 + mockResolvedValue/mockImplementation + `resetMockTabStore()`).
- 사전 ARIA label / verbatim text 보존.
- public surface (`DataGridProps`) 동결.
- 새 `eslint-disable*` 0 (사전 2건은 byte-equivalent 보존).
- 새 silent `catch{}` 0.
- `it.only` / `it.skip` 0.
- Helper 파일 안 cross-store import 0 (Sprint 221 model 답습 — type-only `import type` 만 허용).

## Acceptance Criteria

- `AC-01`: 사후 DataGrid*.test.tsx glob 합계 case = 사전 75 (옵션 1 정확히 75). `pnpm vitest run src/components/rdb/DataGrid*.test.tsx` exit 0.
- `AC-02`: 신규 axis 파일 4-6개 + 각 ≥ 5 case + ≤ 30 case + sibling 충돌 0.
- `AC-03`: shared helper 파일 (옵션 B) 채택 시 named export ≥ 8. 외부 import 0 (axis 파일만).
- `AC-04`: 사전 entry 처리 옵션 1 (파일 제거, 권고) 또는 옵션 2 (≤ 5 smoke case).
- `AC-05`: 15 verbatim AC string 모두 사후 axis 파일 안 1건 이상 매치. Global AC 1-10 모두 충족.

## Design Bar / Quality Bar

- test-only refactor — `DataGrid.tsx` + `FilterBar.tsx` + `FilterBar.test.tsx` + 모든 다른 sibling 변경 0.
- case 1건도 추가/제거/변경 금지.
- helper 파일은 named export 만. 외부 import 0.
- vi.mock factory 3건 → 각 axis 파일 module-level inline 복제 (helper 외부 호출 불가, ES hoisting).
- helper 안 cross-store runtime import 0 (Sprint 221 lint rule 회피, type-only 만 허용).
- Sprint 76 reactive mock 의 `useReducer` rerender 패턴 axis 파일 module-top 잔존.
- inline `vi.spyOn` ([AC-186-06]) verbatim — helper 통합 금지.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/rdb/DataGrid*.test.tsx` exit 0. Tests passed = 사전 75.
2. `pnpm vitest run` exit 0. file count [210, 213]. tests = 2720.
3. `pnpm tsc --noEmit` exit 0.
4. `pnpm lint` exit 0.
5. `find src/components/rdb -maxdepth 1 -name "DataGrid.*.test.tsx" -not -name "DataGrid.test.tsx" | wc -l` ∈ [4, 6].
6. axis case 합계 = 75 (옵션 1) 또는 ≥ 70 (옵션 2).
7. `git diff --stat src/components/rdb/DataGrid.tsx` 0.
8. `git diff --stat src/components/rdb/FilterBar.tsx src/components/rdb/FilterBar.test.tsx` 0 (모두).
9. `git diff --stat src/components/datagrid/` 0.
10. `git diff --stat src/components/document/DocumentDataGrid.tsx src/components/document/DocumentDataGrid.pagination.test.tsx src/components/document/DocumentDataGrid.refetch-overlay.test.tsx src/components/document/DocumentDataGrid.page-cancel.test.tsx 2>/dev/null` 0.
11. `git diff --stat src/components/layout/MainArea.tsx src/components/layout/MainArea.test.tsx` 0.
12. Sprint 216/218/220/221 산출물 diff 0 (axis test 22 + helper 4).
13. `git diff src/components/rdb/ | grep "^+.*eslint-disable"` 매치 0 (사전 2건 byte-equivalent 보존, 신규 0).
14. 15 verbatim AC string 별 `grep -rnF "<verbatim>" src/components/rdb/DataGrid*.test.tsx | wc -l` ≥ 1.
15. 옵션 1 채택 시 `test ! -f src/components/rdb/DataGrid.test.tsx`.
16. helper 파일 (옵션 B) 존재 시 named export ≥ 8 매치.
17. helper 파일 외부 import 0 — `grep -rn "dataGridTestHelpers" src/ e2e/` 매치 ≤ 6.
18. axis 파일 안 `it.only` / `it.skip` 매치 0.
19. 각 axis 파일 root describe 1개.
20. axis 파일 안 `vi.mock\(` 매치 = 3 각 (사전 3 — module-top inline).
21. axis 파일 + helper 안 module-top `vi.spyOn(...)` 매치 = 0 (사전 0 — 추가 금지). axis 파일 안 inline `vi.spyOn` 1건 (`[AC-186-06]`) 보존.
22. Helper 파일 안 cross-store runtime import 0 — `grep -nE "^import [^t].*@stores/" src/components/rdb/__tests__/dataGridTestHelpers.tsx | wc -l` = 0 (type-only `import type` 만 허용).

### Required Evidence

- Generator must provide:
  - 변경 파일 목록.
  - check 1-22 실행 결과.
  - AC-01..AC-05 별 evidence.
  - 15 verbatim AC string 매치 결과.
  - 옵션 5-axis vs 6-axis 채택 명시.
  - `makePendingEdit()` 위치 명시 (helper vs axis-file outer).
- Evaluator must cite:
  - 각 AC 별 pass/fail 근거.
  - missing 또는 weak evidence finding.

## Test Requirements

- 본 sprint 는 test-only refactor — 신규 case 작성 0.
- 사전 75 case 가 source-of-truth.

## Test Script / Repro Script

1. baseline:
   ```sh
   pnpm vitest run src/components/rdb/DataGrid*.test.tsx
   ```
2. Generator 작업 후 동일 명령 → exit 0 + 75 cases.
3. `pnpm vitest run && pnpm tsc --noEmit && pnpm lint`.
4. axis 파일 목록 + case 합계 검증.

## Ownership

- Generator: general-purpose agent (Phase 3).
- Write scope: `src/components/rdb/DataGrid.<axis>.test.tsx` 신규 + `src/components/rdb/__tests__/dataGridTestHelpers.tsx` (옵션 B) + 사전 entry 처리.
- 변경 금지: `DataGrid.tsx` / `FilterBar.tsx` / `FilterBar.test.tsx` / 모든 다른 sibling.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (1-22 모두)
- Acceptance criteria evidence linked in `handoff.md`
- **본 sprint 후 P11 cycle 종료** — `refactoring-candidates.md` retire 가능 (별도 ops 작업).
