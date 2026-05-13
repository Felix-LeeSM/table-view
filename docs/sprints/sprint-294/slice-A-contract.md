# Sprint 294 Slice A — Contract

## Scope

Master spec (`spec.md`) 의 Slice A 만. lang-sql built-in 의 `<alias>.<cursor>`
처리 baseline 을 코드(테스트)로 캡처한다. 보강 (Slice B) 은 별도 cycle.

## Done Criteria

Generator 와 Evaluator 둘 다 다음을 만족할 때만 Slice A 가 DONE 으로 본다:

1. 파일 `src/lib/sql/sqlCompletionLevel2.test.ts` 가 신규로 존재.
2. 헤더 코멘트에 `Sprint 294 (2026-05-14) — Level-2 alias-aware JOIN` 와
   작성 이유 (왜 baseline 테스트가 회귀 가드여야 하는지) 가 포함.
3. 다음 6 baseline 시나리오 각각에 대해 `it(...)` 가 존재:
   - (a) `SELECT u.<cursor> FROM users u`
   - (b) `SELECT u.<cursor> FROM users u WHERE …`
   - (c) `FROM users u JOIN orders o ON o.<cursor>`
   - (d) `FROM users u JOIN orders o ON u.<cursor>`
   - (e) `SELECT o.<cursor> FROM users u JOIN orders o ON …`
   - (f) `SELECT u.<cursor>, o.<cursor> FROM users u JOIN orders o ON …`
4. 6 시나리오 중 통과 / 실패가 RED/GREEN 마커 (`it.fails` 또는 통과 it) 로
   명확히 구분. 실패 케이스가 1 개 이상 (Slice B 의 보강 대상으로 남음).
5. `pnpm test -- sqlCompletionLevel2 sqlCompletionLevel1
   updateColumnCompletion` exit 0 — sprint-292 회귀 없음.
6. `pnpm tsc --noEmit` exit 0.

## Out of Scope

- `aliasColumnCompletion.ts` source 의 신규 작성 (= Slice B).
- `SqlQueryEditor.tsx` wire (= Slice C).
- edge-case (multi-join 3+, schema-qualified, AS, 중복 alias) — Slice D.
- 중복 후보 단언 (= Slice E).
- CTE / derived subquery (= sprint-295).

## Invariants

- `sqlCompletionLevel1.test.ts` (sprint-292 의 4 시나리오) 가 변경되지 않고
  그대로 GREEN.
- `updateColumnCompletion.test.ts` (sprint-292 의 12 케이스) 가 변경되지
  않고 그대로 GREEN.
- 외부 dep 추가 없음.
- `callAll` 헬퍼는 Sprint 292 의 패턴 (async + `languageDataAt
  <CompletionSource>("autocomplete")` + `updateColumnCompletionSource`
  합산) 을 그대로 복제 — 추가 source 호출 없음.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `grep -q "Sprint 294 (2026-05-14)" src/lib/sql/sqlCompletionLevel2.test.ts`
  2. `pnpm test -- sqlCompletionLevel2.test.ts` exit 0 — 모든 it 실행됨.
  3. `pnpm test -- sqlCompletionLevel1.test.ts updateColumnCompletion.test.ts`
     exit 0 — 회귀 없음.
  4. `pnpm tsc --noEmit` exit 0.
- Required evidence:
  - Generator: 변경 파일 목록 + 추가된 it 의 expected/actual + 실패한
    시나리오 (Slice B 의 표적).
  - Evaluator: 6 it 실행 결과 (어느 시나리오가 GREEN/RED 인지) + sprint-292
    무회귀 확인 transcript.
