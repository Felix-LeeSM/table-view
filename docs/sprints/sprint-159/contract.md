# Sprint Contract: sprint-159

## Summary

- Goal: MongoDB preview 테스트 보강, cross-paradigm 통합 테스트, preview cue UI 검증
- Verification Profile: `command`

## In Scope

- DocumentDatabaseTree preview 테스트 보강 (cross-database preview swap 등)
- Cross-paradigm 통합 테스트 (RDB + Document 동치성)
- TabBar preview cue 시각 검증 보강 (italic, opacity, data-preview, aria)
- preview cue의 키보드 접근성 (aria-pressed/aria-current 등)

## Out of Scope

- E2E Playwright (Sprint 160)
- activation 수정 (Sprint 157 완료)
- addTab subView 수정 (Sprint 158 완료)

## Invariants

- 기존 테스트 회귀 없음
- 프로덕션 코드는 preview cue 접근성 개선만 허용

## Acceptance Criteria

- `AC-159-01`: Cross-paradigm 테스트 — RDB 테이블 클릭 후 Document 컬렉션 클릭 → 서로 다른 connection이므로 독립 탭 생성.
- `AC-159-02`: TabBar에 preview tab이 italic + opacity-70 스타일과 data-preview="true" 속성 보유 단언.
- `AC-159-03`: Preview tab에 aria 속성 적절히 설정 (role, aria-selected 등).
- `AC-159-04`: DocumentDatabaseTree cross-database preview swap — DB1.collection1 → DB2.collection2 전환 시 탭 수 1 유지 (같은 connection일 때).

## Verification Plan

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm tsc --noEmit` — 타입 체크 통과
3. `pnpm lint` — ESLint 에러 0건
