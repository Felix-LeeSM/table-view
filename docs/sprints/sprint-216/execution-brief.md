# Sprint Execution Brief: sprint-216

## Objective

`src/components/schema/SchemaTree.test.tsx` (2891 lines, 1 root describe, 104 cases) 를 4-6 behavior-axis test 파일 (`SchemaTree.{lifecycle,expand,refresh,search,actions,highlight}.test.tsx`) + 1 shared helper 파일 (`__tests__/schemaTreeTestHelpers.ts`) 로 분해. 사전 case axis-별 재배치만; case 추가/제거 0; 행동 변경 0. P11 first step.

## Task Why

- post-209 cycle 의 P11. `refactoring-candidates.md` §P11 명시.
- 1,900-2,900 라인 mega test 5건 중 가장 큰 (2891) — 의도 탐색 비용 + merge conflict 위험 + fixture coupling 누적.
- 사전 5 axis 파일 (`dbms-shape` / `preview` / `preview.entrypoints` / `rowcount` / `virtualization`) 가 split convention 확립 — 새 axis 분리 자연스러움.
- AC-XX label 그룹핑이 axis 추출 명확.
- P10 risk 높아 P11 다음으로 미룸 — 사용자 hooks/lib 작업 안정 후 진입.
- test-only — risk 낮음.

## Scope Boundary

- 신규 axis test 파일 4-7개 + 신규 shared helper 파일 1 + 사전 entry 처리만.
- `SchemaTree.tsx` + sub-file 5개 (Sprint 199) 변경 금지.
- 사전 5 axis test 파일 변경 금지.
- Sibling test 파일 변경 금지.
- store / hook / 외부 importer / 모든 src/ component 변경 금지.
- case 1건 추가/제거 금지. case 텍스트 / matcher / fixture / mock / store seed 변경 금지.
- AC label 변경 금지 (axis context comment 추가는 허용).

## Invariants

- 사전 104 case 모두 사후 통과.
- 사전 5 axis 35 case 그대로.
- 23 verbatim string 사후 axis 파일 안 1건 이상.
- 사전 import / mock / fixture / store seed pattern 보존.
- ARIA label / verbatim text 보존.
- public surface (SchemaTreeProps) 동결.
- 새 `eslint-disable*` / silent `catch{}` 0.
- helper 파일 외부 import 0.
- axis 파일 안 `it.only` / `it.skip` / nested describe 추가 0.

## Done Criteria

1. `pnpm vitest run src/components/schema/SchemaTree*.test.tsx` exit 0 + 139 cases pass.
2. 신규 axis 파일 4-7개 + 각 5-35 case + 사전 axis 와 충돌 0.
3. 사전 entry 처리: 옵션 1 (제거) 또는 옵션 2 (smoke ≤ 5).
4. 23 verbatim string 사후 axis 파일 안 1건 이상.
5. `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` 모두 exit 0. `SchemaTree.tsx` + sub-file + 사전 5 axis + sibling test 모두 변경 0.

## Verification Plan

- Profile: `command`
- Required checks: contract.md 의 17 checks 동일.
- Required evidence:
  - 변경 파일 목록 (신규 axis + helper + entry 처리)
  - check 1-17 실행 결과
  - AC-01..AC-05 별 evidence
  - 23 verbatim string 매치 결과

## Evidence To Return

- Changed files and purpose: 신규 axis 파일 4-7개 + helper 파일 + entry 처리.
- Checks run and outcomes: 17 checks 각각의 exit code + 핵심 출력.
- Done criteria coverage: AC-01~05 별 concrete evidence.
- Assumptions:
  - axis 파일 이름 / 개수 (generator 재량 4-7개).
  - helper 파일 위치 (옵션 B `__tests__/` vs sibling).
  - 사전 entry 처리 (옵션 1 제거 vs 옵션 2 smoke 잔존).
  - case 분배 axis 별 (generator 재량 ±2).
  - shared async helper (expandSchemaWith*) 위치 (helpers.ts 승격 vs 각 axis inline).
- Residual risk:
  - case body 의 지역 변수명 변경이 의도 안 된 의미 변경 유발 가능성 — generator cut/paste 시 textually 보존 의무.
  - shared helper 의 mockResolvedValue reassign 패턴 누락 시 mock 격리 깨짐.
  - axis 파일 worker 격리에 의존 — test 간 store leakage 발견 시 후속 sprint candidate.

## References

- Contract: `docs/sprints/sprint-216/contract.md`
- Findings: `docs/sprints/sprint-216/findings.md` (작성 예정)
- Relevant files:
  - `src/components/schema/SchemaTree.test.tsx` (2891, target)
  - `src/components/schema/SchemaTree.tsx` (Sprint 199 entry, 변경 0)
  - `src/components/schema/SchemaTree/{body,dialogs,rows,treeRows,useSchemaTreeActions}.{tsx,ts}` (Sprint 199 sub-file, 변경 0)
  - `src/components/schema/SchemaTree.dbms-shape.test.tsx` (10 cases, 변경 0)
  - `src/components/schema/SchemaTree.preview.test.tsx` (5 cases, 변경 0)
  - `src/components/schema/SchemaTree.preview.entrypoints.test.tsx` (9 cases, 변경 0)
  - `src/components/schema/SchemaTree.rowcount.test.tsx` (4 cases, 변경 0)
  - `src/components/schema/SchemaTree.virtualization.test.tsx` (7 cases, 변경 0)
- 인접 sprint 문서: `docs/sprints/sprint-215/{contract,findings,handoff}.md`
- 후속 candidates: P11 step 2-5 (4 mega test 잔여 — `tabStore.test.ts` / `QueryTab.test.tsx` / `StructurePanel.test.tsx` / `DataGrid.test.tsx`), P10 (stores side-effects, risk 높음).
