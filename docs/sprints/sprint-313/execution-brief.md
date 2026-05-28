# Sprint 313 Execution Brief (Slice B.1)

## Objective

`MqlOperator` 8 → 10 확장. `$in`, `$nin` 두 array-value field-level
operator 를 DocumentFilterBar 의 Structured 모드에 노출한다. Raw MQL
모드는 이미 13 ops 를 자유롭게 지원하므로 본 sprint 의 작업 범위가
아니다.

## Task Why

Phase 28 Slice B 의 grill Q7 결정 ("13 ops 빈도순") 의 첫 번째 진입.
`$in` / `$nin` 은 RDB 의 `IN (...)` 절과 의미가 동등하고, 사용 빈도가
range op (`$gte` 등) 다음으로 높은 필터다. DocumentFilterBar 의
Structured 모드에서 `$in` 이 빠지면, 사용자는 매번 Raw MQL 로
전환해 `{ field: { $in: [...] } }` 를 손으로 작성해야 한다 — RDB
parity 가 깨진다.

## Scope Boundary

수정 대상:
- `src/lib/mongo/mqlFilterBuilder.ts`
- `src/lib/mongo/mqlFilterBuilder.test.ts`
- `src/components/document/DocumentFilterBar.tsx`
- `src/components/document/DocumentFilterBar.test.tsx` (없으면 신설)
- `docs/archives/phases/retired/phase-28-decision-log.md` (D-21..D-24 append)
- `docs/sprints/sprint-313/handoff.md` (신규)

건드리지 않을 곳:
- DocumentFilterBar 의 Raw MQL editor / `useMongoAutocomplete`
- RDB FilterBar / FilterBar.test
- `useQueryExecution` / parser / IPC
- composite operator (`$or`/`$and`/`$not`) — Sprint 314 에서 처리

## Invariants

- 기존 8 ops 회귀 0 (`mqlFilterBuilder.test.ts` 의 모든 case pass).
- `MqlCondition` 모델 (id/field/operator/value) 의 shape 유지.
  composite group 모델 도입 금지.
- RDB FilterBar 동작 회귀 0.
- DocumentFilterBar 의 mode toggle, Add Filter, Clear All, Apply
  버튼 layout 변경 금지.
- 기존 aria-label (`Filter operator`, `Filter field`, `Filter value`,
  `Apply filter`) 변경 금지.

## Done Criteria

1. `$in` / `$nin` 이 `MqlOperator` union 에 추가됨.
2. `MQL_OPERATORS` 에 `IN` / `NOT IN` entry 추가 (자율 D-Q4 권장).
3. `buildMqlFilter` 가 CSV 입력을 array 로 컴파일 (`"1, 2, 3"` →
   `[1, 2, 3]`, `"a, b"` → `["a", "b"]`).
4. Whitespace-only 토큰 제외 (D-Q3).
5. Per-token numeric coercion (D-Q2).
6. operator 가 `$in`/`$nin` 일 때 placeholder hint 노출.
7. ≥ 4 신규 builder unit test + ≥ 2 신규 RTL test.
8. `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` /
   `pnpm build` exit 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run src/lib/mongo/mqlFilterBuilder.test.ts`
  2. `pnpm vitest run src/components/document/DocumentFilterBar.test.tsx`
  3. `pnpm vitest run`
  4. `pnpm tsc --noEmit && pnpm lint && pnpm build`
- Required evidence:
  - 변경 파일 + 1 줄 목적
  - 신규 테스트 이름 + assertion 요약
  - baseline (3602/10) → 신규 카운트
  - 자율 결정 (D-21..D-24) 기록 — `docs/archives/phases/retired/phase-28-decision-log.md`

## Evidence To Return

- Per-AC evidence (8 점)
- Autonomous decisions (D-21..D-24)
- Tests added (이름 + 시나리오)
- Checks run (exit codes)
- Residual risk

## 자율 결정 권장 가이드라인 (Generator 가 합리적으로 채택)

- D-Q1 CSV single input
- D-Q2 per-token numeric coercion
- D-Q3 whitespace-only 토큰 제외
- D-Q4 SQL-style label (`IN` / `NOT IN`)

다른 결정을 내리려면 phase decisions log 에 D-21..D-24 와 같은
형식으로 정확히 어떤 문제를 해결하기 위함인지 + 대안과 trade-off 명시.

## Out of Scope (Sprint 314)

`$or`, `$and`, `$not`. MqlGroup 모델, group row UI, nested condition
tree. 본 sprint 의 Generator 는 이들을 **노출하지 않고** 작업 종료.
