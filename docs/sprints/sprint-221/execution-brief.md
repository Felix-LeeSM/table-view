# Sprint Execution Brief: sprint-221

## Objective

`src/stores/tabStore.test.ts` (2,234 lines, 1 root + 11 L1 nested + 2 L2 nested describe, 102 cases) 를 5-7 behavior-axis test 파일 (`tabStore.{lifecycle,query,preview,persistence,sort,lifecycle-actions}.test.ts`) + 1 shared helper 파일 (`__tests__/tabStoreTestHelpers.ts`) 로 분해. 사전 case axis-별 재배치만; case 추가/제거 0; 행동 변경 0. P11 step 4.

## Task Why

- post-209 cycle 의 P11 step 4. `refactoring-candidates.md` §P11 명시.
- Sprint 216 (P11 step 1, SchemaTree.test 2891→6 axis) + Sprint 218 (P11 step 2, QueryTab.test 2308→6 axis) + Sprint 220 (P11 step 3, StructurePanel.test 2156→4 axis) 의 model implementation 패턴 답습.
- 1,900-2,900 라인 mega test 5건 중 네 번째 (2,234).
- axis 후보가 자연스러움 — 사전 14 describe 가 axis 그룹핑 명확.
- test-only — risk 낮음.
- vi.mock factory 0건 + vi.spyOn 0건 — Sprint 220 와 동일 (Sprint 218 의 7 factory 와 다름).

## Scope Boundary

- 신규 axis test 파일 5-7개 + 신규 shared helper 파일 1 + 사전 entry 처리만.
- `src/stores/tabStore.ts` (596 lines, post-Sprint 208 entry) 변경 금지.
- `src/stores/tabStore/{types,persistence,tracker}.ts` (Sprint 208 sub-files) 변경 금지.
- 9 sibling store test/source 변경 금지.
- Sprint 216/218/220 산출물 (axis test 16 + helper 3) 변경 금지.
- 외부 importer 51건 변경 금지.
- case 1건 추가/제거 금지. case 텍스트 / matcher / fixture / mock / store seed 변경 금지.
- AC label / sprint section header 변경 금지.
- vi.mock factory / vi.spyOn 추가 금지 (사전 0건 → 사후 0건).
- Helper 안 cross-store import 금지 (lint rule 회피).

## Invariants

- 사전 102 case 모두 사후 통과.
- 20 verbatim AC string 사후 axis 파일 안 1건 이상.
- vi.mock factory 0건 / vi.spyOn 0건 사전 동일.
- 사전 import / mock / fixture / store seed pattern 보존.
- public surface (`useTabStore` API + selector + types + `SYNCED_KEYS`) 동결.
- 새 `eslint-disable*` / silent `catch{}` 0.
- helper 파일 외부 import 0 (axis 파일만).
- helper 파일 안 cross-store import 0.
- axis 파일 안 `it.only` / `it.skip` / 추가 nested describe 0 (단 Sprint 195 doubly-nested 옵션 B 보존 시 `lifecycle-actions` axis 1+2 = 3 describe 허용).

## Done Criteria

1. `pnpm vitest run src/stores/tabStore*.test.ts` exit 0 + 102 cases pass.
2. 신규 axis 파일 5-7개 + 각 5-30 case + sibling 9 + Sprint 216/218/220 산출물 + entry 충돌 0.
3. 사전 entry 처리: 옵션 1 (제거, 권고) 또는 옵션 2 (smoke ≤ 5 case 잔존).
4. 20 verbatim AC string 사후 axis 파일 안 1건 이상.
5. `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` 모두 exit 0. `tabStore.ts` + sub-file 3 + 9 sibling store + Sprint 216/218/220 산출물 모두 변경 0.

## Verification Plan

- Profile: `command`
- Required checks: contract.md 의 20 checks 동일.
- Required evidence:
  - 변경 파일 목록 (신규 axis + helper + entry 처리)
  - check 1-20 실행 결과
  - AC-01..AC-05 별 evidence
  - 20 verbatim AC string 매치 결과
  - Sprint 195 doubly-nested describe 처리 옵션 (A 또는 B) 명시

## Evidence To Return

- Changed files and purpose: 신규 axis 파일 5-7개 + helper 파일 + entry 처리.
- Checks run and outcomes: 20 checks 각각의 exit code + 핵심 출력.
- Done criteria coverage: AC-01~05 별 concrete evidence.
- Assumptions:
  - axis 파일 이름 / 개수 (generator 재량 5-7개).
  - helper 파일 위치 (옵션 B `__tests__/`).
  - 사전 entry 처리 (옵션 1 제거 vs 옵션 2 smoke).
  - case 분배 axis 별 (generator 재량 ±2).
  - Sprint 195 doubly-nested describe 처리 (옵션 A vs B, 권고 B).
  - `seedRunningQueryTab` helper 위치 (axis-file outer scope vs helpers 승격).
  - `installFakeLocalStorage` helper 위치 (helper 안 통합 권고).
- Residual risk:
  - case body 의 지역 변수명 변경이 의도 안 된 의미 변경 유발 가능성 — generator cut/paste 시 textually 보존 의무.
  - tabCounter / queryCounter module-scope reset 의존 — axis 파일 worker 격리에 의존.
  - Sprint 130 `await import("./connectionStore")` dynamic import 가 module-top 으로 옮겨지면 lint 위반.
  - Sprint 195 doubly-nested 의 `seedRunningQueryTab` / `sampleResult` / `stmt` factory scope 누락 시 axis 분리 후 case fail.
  - Sprint 212 trailing comment block (L2226-2232) 누락 시 historical context 손실.
  - `vi.useFakeTimers()` + `vi.advanceTimersByTime()` 패턴 외부 leak 시 worker isolation 깨짐.

## References

- Contract: `docs/sprints/sprint-221/contract.md`
- Spec: `docs/sprints/sprint-221/spec.md`
- Findings: `docs/sprints/sprint-221/findings.md` (작성 예정)
- Sprint 216 model: `docs/sprints/sprint-216/{contract,findings,handoff}.md` (P11 step 1)
- Sprint 218 model: `docs/sprints/sprint-218/{contract,findings,handoff}.md` (P11 step 2)
- Sprint 220 model: `docs/sprints/sprint-220/{contract,findings,handoff}.md` (P11 step 3, most recent)
- Relevant files:
  - `src/stores/tabStore.test.ts` (2,234 lines, target)
  - `src/stores/tabStore.ts` (596 lines, post-Sprint 208 entry, 변경 0)
  - `src/stores/tabStore/{types,persistence,tracker}.ts` (Sprint 208 sub-files, 변경 0)
  - 9 sibling store test/source (위 Scope Boundary 참조, 모두 변경 0)
  - Sprint 216/218/220 산출물 (axis test 16 + helper 3, 변경 0)
  - `eslint.config.js` (lint rule 참조)
- 인접 sprint 문서: `docs/sprints/sprint-220/{spec,contract,handoff}.md`
- 후속 candidates: P11 step 5 (`DataGrid.test.tsx` 1,906), P10 (stores side-effects, risk 높음, Sprint 219).
