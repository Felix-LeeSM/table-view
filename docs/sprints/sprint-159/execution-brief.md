# Sprint Execution Brief: sprint-159

## Objective

- Phase 13의 P1/P2 항목 메우기: cross-paradigm 통합 테스트, DocumentDatabaseTree preview 엣지 케이스, TabBar preview cue 검증 보강.

## Task Why

- Phase 13의 AC-13-06(MongoDB 동일 단일/더블클릭), AC-13-07(TabBar preview cue), AC-13-04/05(context menu 등 모든 entry point)를 완전히 잠그기 위함.

## Scope Boundary

- 테스트 파일 위주. TabBar.tsx의 aria 속성 누락 시에만 프로덕션 코드 수정 허용.
- SchemaTree.tsx, DocumentDatabaseTree.tsx 프로덕션 수정 금지.

## Invariants

- 기존 테스트 회귀 없음
- TabBar 스타일링 불변 (italic + opacity-70)

## Done Criteria

1. Cross-paradigm 통합 테스트 파일 생성 또는 기존 파일에 추가
2. DocumentDatabaseTree cross-database swap 테스트 추가
3. TabBar preview cue 접근성 테스트 보강
4. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` 통과

## References

- `src/components/schema/DocumentDatabaseTree.test.tsx` — 기존 3 preview 테스트
- `src/components/layout/TabBar.test.tsx` — 기존 preview cue 테스트 (lines 760-822)
- `src/stores/tabStore.test.ts` — cross-connection 독립성 테스트 (line 686)
