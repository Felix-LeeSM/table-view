# Sprint Execution Brief: sprint-158

## Objective

- addTab의 exact match와 preview swap 로직에 subView 필드를 포함하여, 같은 테이블의 Data 탭과 Structure 탭이 별개로 관리되도록 한다.

## Task Why

- Sprint 156 진단에서 "View Structure" 클릭 시 기존 Data 탭이 활성화될 뿐 새 Structure 탭이 열리지 않는 버그를 발견. addTab이 exact match에서 subView를 무시하기 때문.

## Scope Boundary

- `src/stores/tabStore.ts` addTab 함수만 수정
- `src/stores/tabStore.test.ts` 테스트만 보강
- `src/components/schema/SchemaTree.preview.entrypoints.test.tsx`의 AC-156-04b 테스트 업데이트 (subView 구분 검증)

## Invariants

- 같은 table + 같은 subView → 기존 탭 활성화 (회귀 불변)
- 다른 connection → 독립 탭 (회귀 불변)
- preview swap → 같은 subView인 경우에만

## Done Criteria

1. addTab exact match 조건에 `subView` 포함
2. preview swap 조건에 `subView` 포함
3. subView 구분 테스트 3개 이상 추가
4. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` 통과

## References

- `src/stores/tabStore.ts` — addTab (lines 267-323), promoteTab (356-361)
- `src/stores/tabStore.test.ts` — preview tab system tests (lines 607-838)
- `src/components/schema/SchemaTree.preview.entrypoints.test.tsx` — AC-156-04b test
