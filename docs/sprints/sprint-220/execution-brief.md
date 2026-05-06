# Sprint Execution Brief: sprint-220

## Objective

`src/components/schema/StructurePanel.test.tsx` (2,156 lines, 1 root + 1 nested describe, 84 cases) 를 3-5 behavior-axis test 파일 (`StructurePanel.{overview,columns,indexes,constraints}.test.tsx`) + 1 shared helper 파일 (`__tests__/structurePanelTestHelpers.ts`) 로 분해. 사전 case axis-별 재배치만; case 추가/제거 0; 행동 변경 0. P11 step 3.

## Task Why

- post-209 cycle 의 P11 step 3. `refactoring-candidates.md` §P11 명시.
- Sprint 216 (P11 step 1, SchemaTree.test 2891→6 axis) + Sprint 218 (P11 step 2, QueryTab.test 2308→6 axis) 의 model implementation 패턴 답습.
- 1,900-2,900 라인 mega test 5건 중 세 번째 (2,156).
- axis 후보가 자연스러움: overview / columns / indexes / constraints. Sprint 179 paradigm 은 nested 보존 (옵션 B).
- test-only — risk 낮음.
- vi.mock factory 0건 — Sprint 218 의 7 factory ES hoisting 위험 없음. helper 안 vi.spyOn 호출 가능.

## Scope Boundary

- 신규 axis test 파일 3-5개 + 신규 shared helper 파일 1 + 사전 entry 처리만.
- `StructurePanel.tsx` (231 lines, entry) 변경 금지.
- `StructurePanel.first-render-gate.test.tsx` (sibling axis test) 변경 금지.
- 11+ sibling test 변경 금지 (`SchemaPanel.test.tsx` + Sprint 216 axis test 11개 + DocumentDatabaseTree / ViewStructurePanel + treeShape + `__tests__/schemaTreeTestHelpers.ts`).
- store / hook / 외부 importer / 모든 src/ component 변경 금지.
- case 1건 추가/제거 금지. case 텍스트 / matcher / fixture / mock / store seed 변경 금지.
- AC label / sprint section header 변경 금지 (axis context comment 추가는 허용).
- vi.mock factory 추가 금지 (사전 0건 → 사후 0건).

## Invariants

- 사전 84 case 모두 사후 통과.
- 22 verbatim AC string 사후 axis 파일 안 1건 이상.
- vi.mock factory 0건 사전 동일.
- vi.spyOn 5건 사후 보존.
- 사전 import / mock / fixture / store seed pattern 보존.
- ARIA label / verbatim text 보존.
- public surface (`StructurePanelProps`) 동결.
- 새 `eslint-disable*` / silent `catch{}` 0.
- helper 파일 외부 import 0.
- axis 파일 안 `it.only` / `it.skip` / 추가 nested describe 0 (단 Sprint 179 nested describe 옵션 B 보존 시 `StructurePanel.overview.test.tsx` 1개 nested 허용).

## Done Criteria

1. `pnpm vitest run src/components/schema/StructurePanel*.test.tsx` exit 0 + 84 cases + first-render-gate 사전 cases pass.
2. 신규 axis 파일 3-5개 + 각 5-30 case + sibling 12+ + entry 충돌 0.
3. 사전 entry 처리: 옵션 1 (제거, 권고) 또는 옵션 2 (smoke ≤ 5 case 잔존).
4. 22 verbatim AC string 사후 axis 파일 안 1건 이상.
5. `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` 모두 exit 0. `StructurePanel.tsx` + `StructurePanel.first-render-gate.test.tsx` + 11+ sibling 모두 변경 0.

## Verification Plan

- Profile: `command`
- Required checks: contract.md 의 20 checks 동일.
- Required evidence:
  - 변경 파일 목록 (신규 axis + helper + entry 처리)
  - check 1-20 실행 결과
  - AC-01..AC-05 별 evidence
  - 22 verbatim AC string 매치 결과
  - Sprint 179 nested describe 처리 옵션 (A 또는 B) 명시

## Evidence To Return

- Changed files and purpose: 신규 axis 파일 3-5개 + helper 파일 + entry 처리.
- Checks run and outcomes: 20 checks 각각의 exit code + 핵심 출력.
- Done criteria coverage: AC-01~05 별 concrete evidence.
- Assumptions:
  - axis 파일 이름 / 개수 (generator 재량 3-5개).
  - helper 파일 위치 (옵션 B `__tests__/` vs sibling).
  - 사전 entry 처리 (옵션 1 제거 vs 옵션 2 smoke).
  - case 분배 axis 별 (generator 재량 ±2).
  - Sprint 179 nested describe 처리 (옵션 A 평탄화 vs 옵션 B 보존, 권고 B).
  - vi.spyOn 5건 위치 (axis 안 inline vs helper 안 통합).
- Residual risk:
  - case body 의 지역 변수명 변경이 의도 안 된 의미 변경 유발 가능성 — generator cut/paste 시 textually 보존 의무.
  - `MOCK_*` spread `[...MOCK_*]` reset 패턴 누락 시 mock leakage.
  - axis 파일 worker 격리에 의존 — test 간 store leakage 발견 시 후속 sprint candidate.
  - Sprint 179 nested describe 의 paradigm prop 분기 setup 누락 시 axis 분리 후 mock leak.
  - vi.mock factory 가 사전 0 건이라 ES hoisting 위험은 없으나, generator 가 axis 파일에서 `vi.mock("@lib/tauri", ...)` 를 잘못 추가하면 사전 동작 변경.

## References

- Contract: `docs/sprints/sprint-220/contract.md`
- Spec: `docs/sprints/sprint-220/spec.md`
- Findings: `docs/sprints/sprint-220/findings.md` (작성 예정)
- Sprint 216 model: `docs/sprints/sprint-216/{contract,findings,handoff}.md` (P11 step 1)
- Sprint 218 model: `docs/sprints/sprint-218/{contract,findings,handoff}.md` (P11 step 2)
- Relevant files:
  - `src/components/schema/StructurePanel.test.tsx` (2,156 lines, target)
  - `src/components/schema/StructurePanel.tsx` (entry, 231 lines, 변경 0)
  - `src/components/schema/StructurePanel.first-render-gate.test.tsx` (sibling axis test, 변경 0)
  - 11+ sibling test (Sprint 216 SchemaTree axis 11개 + SchemaPanel / DocumentDatabaseTree / ViewStructurePanel + treeShape + `__tests__/schemaTreeTestHelpers.ts`)
- 인접 sprint 문서: `docs/sprints/sprint-218/{spec,contract,handoff}.md`
- 후속 candidates: P11 step 4-5 (`tabStore.test.ts` 2,234 / `DataGrid.test.tsx` 1,906), P10 (stores side-effects, risk 높음, Sprint 219).
