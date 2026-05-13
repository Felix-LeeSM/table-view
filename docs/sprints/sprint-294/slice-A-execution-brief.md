# Sprint 294 Slice A — Execution Brief

## Objective

`sqlCompletionLevel2.test.ts` 를 신규 작성해 lang-sql 의 alias-aware
자동완성 baseline 을 캡처한다. 통과 / 실패 시나리오를 명시적으로 구분해서
Slice B 의 보강 표적이 코드로 드러나게 만든다.

## Task Why

사용자 요구는 외부 IDE 수준의 alias-aware 자동완성. 보강이 진짜 필요한
케이스를 코드(테스트)로 먼저 캡처해야 Slice B 의 source 가 정확히 그 gap 만
채울 수 있다. 가로 슬라이스 (전부 RED 후 전부 구현) 를 피하는 tdd 원칙
준수.

## Scope Boundary

- 새 source (`aliasColumnCompletion.ts`) 작성 금지.
- `SqlQueryEditor.tsx` 수정 금지.
- 기존 source (`updateColumnCompletion.ts`) 수정 금지.
- 기존 테스트 파일 (`sqlCompletionLevel1.test.ts`,
  `updateColumnCompletion.test.ts`) 수정 금지.

## Invariants

- sprint-292 회귀 가드 통과.
- 외부 dep 추가 없음.
- `callAll` 헬퍼는 sprint-292 의 패턴 그대로.

## Done Criteria

1. `src/lib/sql/sqlCompletionLevel2.test.ts` 신규 — 헤더에
   `Sprint 294 (2026-05-14) — Level-2 alias-aware JOIN` + 작성 이유.
2. 6 baseline 시나리오 it 모두 존재 + RED/GREEN 명확.
3. 적어도 1 개 시나리오가 RED (Slice B 표적).
4. `pnpm test` 실행 시 sprint-292 4 시나리오 + 기존 12 케이스 GREEN.
5. `pnpm tsc --noEmit` exit 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `grep -q "Sprint 294 (2026-05-14)" src/lib/sql/sqlCompletionLevel2.test.ts`
  2. `pnpm vitest run src/lib/sql/sqlCompletionLevel2.test.ts`
  3. `pnpm vitest run src/lib/sql/sqlCompletionLevel1.test.ts
     src/lib/sql/updateColumnCompletion.test.ts`
  4. `pnpm tsc --noEmit`

## Evidence To Return

- 변경 파일: `src/lib/sql/sqlCompletionLevel2.test.ts` (신규).
- 6 it 의 expected vs actual (어느 시나리오가 GREEN / RED).
- sprint-292 무회귀 확인 vitest 출력.
- `pnpm tsc --noEmit` exit code.
- 어느 시나리오가 RED 인지 Slice B 의 표적으로 명시.

## Assumptions / Risks

- lang-sql 의 `getAliases` 가 동기 호출에서 작동할 수도 / 안 할 수도 있다.
  Generator 는 그 결과를 RED/GREEN 으로 코드화하는 것이 미션 — 어느 쪽이든
  Slice A 의 deliverable 자체는 동일.
- 6 시나리오 모두 GREEN 으로 나오면 Slice B 의 보강 필요가 사라짐 — 그
  경우 Slice B 는 "no-op + 코멘트로 deferred" 로 축소. Slice A 의 deliverable
  과 무관.
