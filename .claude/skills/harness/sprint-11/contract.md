# Sprint Contract: sprint-11

## Summary

- Goal: Residual risk 기반 프로덕션 버그 수정 + 누락 테스트 보강
- Audience: Generator, Evaluator
- Owner: Claude Code
- Verification Profile: `command`

## In Scope

- SchemaTree.tsx: `loadTables`/`loadSchemas` 실패 시 loading 상태 미해제 버그 수정
- SchemaTree.tsx: `handleRefresh`에 `.finally()` 적용
- 누락 테스트 보강:
  - connectionId 변경 시나리오 (Sprint 7 risk)
  - row_count: 0 엣지 케이스 (Sprint 7 risk)
  - loadTables 실패 시 loading 상태 정리 테스트 (신규)

## Out of Scope

- fetchData 경쟁 조건 (별도 분석 필요)
- 오버레이 pointer-events (P3)
- CSS class 의존성 (리팩토링 시 개선)
- ConnectionDialog 테스트

## Invariants

- 기존 317개 테스트 모두 통과
- 기존 기능 회귀 없음

## Acceptance Criteria

- AC-01: `loadTables` 실패 시 `loadingTables`에서 해당 스키마 제거 (spinner 사라짐)
- AC-02: `handleRefresh`에서 `loadSchemas` 실패 시 `loadingSchemas` false로 복원
- AC-03: connectionId 변경 시 새 connectionId로 `loadSchemas` 재호출 테스트 추가
- AC-04: row_count가 0인 테이블에 "0" 표시 테스트 추가
- AC-05: `loadTables` 실패 시 loading 상태 정리 테스트 추가
- AC-06: 모든 기존 테스트 통과, 타입 체크 통과

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm tsc --noEmit` — 타입 체크

## Ownership

- Generator: general-purpose
- Write scope: `src/components/SchemaTree.tsx`, `src/components/SchemaTree.test.tsx`
- Merge order: 단일 커밋

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
