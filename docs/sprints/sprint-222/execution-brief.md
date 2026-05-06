# Sprint Execution Brief: sprint-222

## Objective

`src/components/rdb/DataGrid.test.tsx` (1,906 lines, 1 root describe, 75 cases) 를 4-6 behavior-axis test 파일 (`DataGrid.{lifecycle,sort,filters-pagination,refetch-overlay,editing}.test.tsx`) + 1 shared helper 파일 (`__tests__/dataGridTestHelpers.tsx`) 로 분해. 사전 case axis-별 재배치만; case 추가/제거 0; 행동 변경 0. **P11 step 5 (last)**.

## Task Why

- post-209 cycle 의 P11 step 5 (마지막). `refactoring-candidates.md` §P11 명시.
- Sprint 216 (P11 step 1, 2891→6) + Sprint 218 (P11 step 2, 2308→6) + Sprint 220 (P11 step 3, 2156→4) + Sprint 221 (P11 step 4, 2234→6) 의 model 답습.
- 1,900-2,900 라인 mega test 5건 중 다섯 번째 (1,906) — 가장 작음.
- axis 후보가 자연스러움 — Sprint section header 가 axis 그룹핑 명확.
- test-only — risk 낮음.
- vi.mock factory 3건 — Sprint 218 의 7 factory 보다 적고, Sprint 220/221 의 0 factory 보다 많음.
- Sprint 222 후 P11 cycle 종료 — `refactoring-candidates.md` §P11 retire 가능.

## Scope Boundary

- 신규 axis test 파일 4-6개 + 신규 shared helper 파일 1 + 사전 entry 처리만.
- `src/components/rdb/DataGrid.tsx` (628 lines) 변경 금지.
- `src/components/rdb/FilterBar.tsx` / `FilterBar.test.tsx` 변경 금지.
- 모든 다른 sibling test/component 변경 금지 (datagrid / document / layout / Sprint 216/218/220/221 산출물).
- store / hook / 외부 importer 변경 금지.
- case 1건 추가/제거 금지. case 텍스트 / matcher / fixture / mock / store seed 변경 금지.
- AC label / sprint section header 변경 금지.
- vi.mock factory 추가/제거 금지 (사전 3건 → 사후 3건 inline 각 axis).
- module-top vi.spyOn 추가 금지 (사전 0건 → 사후 0건). inline vi.spyOn 1건 ([AC-186-06]) 보존.
- 사전 eslint-disable 2건 byte-equivalent 보존, 신규 0.

## Invariants

- 사전 75 case 모두 사후 통과.
- 15 verbatim AC string 사후 axis 파일 안 1건 이상.
- vi.mock factory 3건 + module-top vi.spyOn 0건 + inline vi.spyOn 1건 사전 동일.
- Sprint 76 reactive mock pattern (`mockTabStoreState` + `subscribers` Set + React `useReducer` rerender) verbatim.
- 사전 import / mock / fixture / store seed pattern 보존.
- ARIA label / verbatim text 보존.
- public surface (`DataGridProps`) 동결.
- 새 `eslint-disable*` / silent `catch{}` 0.
- helper 파일 외부 import 0.
- helper 파일 안 cross-store runtime import 0 (Sprint 221 lint rule 회피, type-only 만 허용).
- axis 파일 안 `it.only` / `it.skip` 0.
- 각 axis 파일 root describe 1개 (사전 nested describe 0건 — 옵션 분기 무관).

## Done Criteria

1. `pnpm vitest run src/components/rdb/DataGrid*.test.tsx` exit 0 + 75 cases pass.
2. 신규 axis 파일 4-6개 + 각 5-30 case + sibling 충돌 0.
3. 사전 entry 처리: 옵션 1 (제거, 권고) 또는 옵션 2 (smoke ≤ 5 case).
4. 15 verbatim AC string 사후 axis 파일 안 1건 이상.
5. `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` 모두 exit 0. `DataGrid.tsx` + `FilterBar` + 모든 다른 sibling 변경 0.

## Verification Plan

- Profile: `command`
- Required checks: contract.md 의 22 checks 동일.
- Required evidence:
  - 변경 파일 목록 (신규 axis + helper + entry 처리)
  - check 1-22 실행 결과
  - AC-01..AC-05 별 evidence
  - 15 verbatim AC string 매치 결과
  - 옵션 5-axis vs 6-axis 채택 명시
  - `makePendingEdit()` 위치 명시 (helper vs axis-file outer)

## Evidence To Return

- Changed files and purpose: 신규 axis 파일 4-6개 + helper 파일 + entry 처리.
- Checks run and outcomes: 22 checks 각각의 exit code + 핵심 출력.
- Done criteria coverage: AC-01~05 별 concrete evidence.
- Assumptions:
  - axis 파일 이름 / 개수 (generator 재량 4-6개).
  - editing axis 28 cases 분할 여부 (옵션 5-axis vs 6-axis).
  - 사전 entry 처리 (옵션 1 제거 vs 옵션 2 smoke).
  - case 분배 axis 별 (generator 재량 ±2).
  - `makePendingEdit()` 위치 (helper 승격 vs axis-file outer 잔존).
  - 3 vi.mock factory inline (helper 외부 호출 불가).
- Residual risk:
  - vi.mock factory ES hoisting — axis 파일 module-level inline 3 factory 누락 시 mock undefined → render fail.
  - Sprint 76 reactive mock 의 `useReducer` rerender 누락 시 4 cases fail.
  - inline vi.spyOn ([AC-186-06]) `mockRestore()` cleanup 누락 시 leakage.
  - Dynamic `await import` 마지막 2 case (connectionStore / safeModeStore / sqlGenerator) module-top 옮기지 말 것.
  - Helper 안 cross-store runtime import 시 lint rule 위반 (Sprint 221 model 답습).
  - editing axis 28 cases envelope 30 한도 근접 — 옵션 6-axis 가능.

## References

- Contract: `docs/sprints/sprint-222/contract.md`
- Spec: `docs/sprints/sprint-222/spec.md`
- Findings: `docs/sprints/sprint-222/findings.md` (작성 예정)
- Sprint 216 model: `docs/sprints/sprint-216/{contract,findings,handoff}.md`
- Sprint 218 model: `docs/sprints/sprint-218/{contract,findings,handoff}.md`
- Sprint 220 model: `docs/sprints/sprint-220/{contract,findings,handoff}.md`
- Sprint 221 model: `docs/sprints/sprint-221/{contract,findings,handoff}.md`
- Relevant files:
  - `src/components/rdb/DataGrid.test.tsx` (1,906 lines, target)
  - `src/components/rdb/DataGrid.tsx` (628 lines, 변경 0)
  - `src/components/rdb/FilterBar.tsx` / `FilterBar.test.tsx` (sibling, 변경 0)
  - 모든 다른 sibling test/component (Sprint 216/218/220/221 산출물 등, 모두 변경 0)
  - `eslint.config.js` (lint rule 참조)
- 인접 sprint 문서: `docs/sprints/sprint-221/{spec,contract,handoff}.md`
- 후속: P11 cycle 종료 + `refactoring-candidates.md` retire (별도 ops). P10 (Sprint 219) 사용자 hooks/lib 작업 안정 후.
