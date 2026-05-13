# Sprint 295 Slice A — Contract

## Scope

`sqlCompletionLevel3.test.ts` 신규. lang-sql built-in + sprint-292 +
sprint-294 source 의 합산 상태에서 CTE / derived subquery alias 가 어디까지
풀리는지 baseline 캡처. Slice B 의 보강 표적을 RED 로 명시.

## Done Criteria

1. `src/lib/sql/sqlCompletionLevel3.test.ts` 신규 — 헤더에 `Sprint 295
   (2026-05-14)` + 작성 이유.
2. `callAll` 헬퍼 = sprint-294 의 `sqlCompletionLevel2.test.ts` 패턴 그대로
   복제 (lang-sql built-in + `updateColumnCompletionSource` +
   `aliasColumnCompletionSource` 합산).
3. spec 의 8 baseline 시나리오 (a–h) 가 모두 `it(...)` 으로 존재 + expected
   명시.
4. 통과 / 실패 RED/GREEN 명확. Slice B 의 보강 표적이 1 개 이상 RED.
5. `pnpm test -- sqlCompletionLevel3 sqlCompletionLevel2 sqlCompletionLevel1
   updateColumnCompletion aliasColumnCompletion` exit 0 — sprint-292 / 294
   무회귀.
6. `pnpm tsc --noEmit` exit 0.

## Out of Scope

- 새 source 작성 (Slice B).
- Wire (Slice C).
- Edge case (Slice D).
- Dedup 단언 (Slice E).

## Invariants

- sprint-292 / 294 무회귀.
- 외부 dep 없음.
- `callAll` 헬퍼 = sprint-294 패턴.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `grep -q "Sprint 295 (2026-05-14)" src/lib/sql/sqlCompletionLevel3.test.ts`
  2. `pnpm vitest run src/lib/sql/sqlCompletionLevel3.test.ts`
  3. `pnpm vitest run src/lib/sql/sqlCompletionLevel2.test.ts
     src/lib/sql/sqlCompletionLevel1.test.ts
     src/lib/sql/updateColumnCompletion.test.ts
     src/lib/sql/aliasColumnCompletion.test.ts`
  4. `pnpm tsc --noEmit`
- Required evidence: 변경 파일 목록, 8 시나리오 각각의 GREEN/RED, Slice B
  표적 명시, 무회귀 확인.
