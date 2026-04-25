# Sprint Execution Brief: sprint-116

## Objective

`docs/ui-evaluation-results.md` §8 의 9 개 ⚠️ 실측 필요 항목을 별도 운영 문서 `docs/ui-evaluation-followup.md` 로 외화 + RISKS.md 또는 master index 에서 참조. 신규 항목 추가 절차 명시.

## Task Why

§8 항목들은 "코드만 봐서는 판정 불가, 실제 측정이 필요" 한 것들 — 가만 두면 다음 평가 사이클에서도 잊혀진다. 추적 문서로 외화해 (a) 종결 조건이 명확해지고 (b) 누가/언제 검증했는지 메타데이터가 남아 (c) 잊힘 방지.

## Scope Boundary

- **건드리지 말 것**:
  - `ui-evaluation-results.md` §8 자체.
  - 코드 (src/, scripts/, ...).
  - 기존 RISKS.md 항목 본문.
  - `memory/` 트리.
- **반드시 보존**:
  - 1822 baseline tests.
  - 기존 master index / RISKS.md 항목 본문.

## Invariants

- 1822 tests pass.
- `pnpm tsc --noEmit` / `pnpm lint` 0.
- 신규 추가는 `docs/ui-evaluation-followup.md` 1 개 + RISKS.md 참조 1 줄 + sprint artifact 3 개.

## Done Criteria

1. `docs/ui-evaluation-followup.md` 존재. 9 개 ⚠️ 항목 누락 0.
2. 각 항목 = (id, 요약, 출처, 절차, 담당, 종결 조건, 상태) 7 필드.
3. 모든 항목 초기 상태 `active` 가능. 어휘 정의 머리말에 명시.
4. RISKS.md 에 신규 문서 참조 1 줄.
5. 문서 끝 신규 ⚠️ 추가 절차 명시.
6. `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` 모두 통과.

## Verification Plan

- Profile: `static`
- Required checks:
  1. `cat docs/ui-evaluation-followup.md`
  2. `grep -nE 'UI-FU-0[1-9]' docs/ui-evaluation-followup.md` → 9 줄.
  3. `grep -nE 'ui-evaluation-followup' docs/RISKS.md` → 1 줄 이상.
  4. `pnpm vitest run`
  5. `pnpm tsc --noEmit`
  6. `pnpm lint`
- Required evidence:
  - 변경 / 신규 파일 + 목적.
  - 9 개 항목 ID + 요약 매핑.
  - RISKS.md 참조 라인.
  - 검증 명령 결과.

## Evidence To Return

- 변경 / 신규 파일 + 목적.
- 9 개 ⚠️ 항목 → ID 매핑 + 종결 조건 한 줄씩.
- 명령어 결과 (vitest pass count, tsc/lint 0).
- 가정 / 리스크 (담당 미배정 등).
