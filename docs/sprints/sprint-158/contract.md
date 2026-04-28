# Sprint Contract: sprint-158

## Summary

- Goal: addTab의 exact match 로직에 subView를 포함하여 같은 테이블의 Data/Structure 탭이 별개로 열리도록 한다.
- Verification Profile: `command`

## In Scope

- `src/stores/tabStore.ts` addTab exact match 조건에 subView 포함
- addTab 관련 테스트 보강
- SchemaTree에서 "View Structure" 호출 경로 검증

## Out of Scope

- E2E 테스트 (Sprint 160)
- activation 수정 (이미 Sprint 157에서 완료)
- MongoDB 관련 (Sprint 159)

## Invariants

- 기존 preview swap 동작 유지 (같은 테이블 + 같은 subView에서만 swap)
- 다른 connection의 탭은 독립성 유지
- 기존 테스트 회귀 없음

## Acceptance Criteria

- `AC-158-01`: addTab에서 같은 table + 다른 subView("records" vs "structure") → 기존 탭 활성화가 아닌 새 탭 생성.
- `AC-158-02`: addTab에서 같은 table + 같은 subView → 기존과 동일하게 해당 탭 활성화 (회귀 보장).
- `AC-158-03`: Preview swap도 같은 subView인 경우에만 발생 (Data preview → 다른 Data preview는 swap, Data preview → Structure는 새 탭).

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm tsc --noEmit` — 타입 체크 통과
3. `pnpm lint` — ESLint 에러 0건
