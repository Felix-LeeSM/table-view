# Sprint Contract: sprint-42

## Summary

- Goal: SchemaTree 헤더에 UUID 대신 연결 이름 표시, 테이블 검색 버그 수정
- Audience: Generator → Evaluator
- Owner: harness
- Verification Profile: `mixed`

## In Scope

- SchemaTree 헤더에 connectionId(UUID) 대신 연결 이름(connection name) 표시
- 테이블 검색(Filter tables...) 기능이 정상적으로 동작하도록 수정

## Out of Scope

- QueryTab toolbar UI 변경 (Sprint 45)
- Preview tab 시스템 (Sprint 43)
- 데이터 그리드 UX 개선 (Sprint 44)
- Cmd+Shift+T 단축키 (Sprint 45)

## Invariants

- "New Query" 버튼 기능 유지
- 스키마 확장/축소 동작 유지
- 연결 색상 점 유지
- 기존 테스트 모두 통과

## Acceptance Criteria

- `AC-01`: SchemaTree 헤더에 연결 이름(예: "My PostgreSQL")이 표시되고 UUID는 표시되지 않음
- `AC-02`: SchemaTree의 "Filter tables..." 입력으로 테이블이 정상적으로 필터링됨
- `AC-03`: 필터 결과가 없을 때 "No matching tables" 메시지가 표시됨
- `AC-04`: 필터 clear 버튼(X)이 정상 동작함

## Design Bar / Quality Bar

- 기존 코드 패턴 준수
- 에러 케이스 테스트 포함

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 전체 테스트 통과
2. `pnpm tsc --noEmit` — 타입 에러 0건
3. `pnpm lint` — ESLint 에러 0건

### Required Evidence

- Generator must provide:
  - changed files with purpose
  - checks run and outcomes
  - acceptance criteria coverage with concrete evidence

## Test Requirements

### Unit Tests (필수)
- 연결 이름 표시에 대한 테스트
- 테이블 필터 동작에 대한 테스트

### Scenario Tests (필수)
- [x] Happy path: 연결 이름 표시, 테이블 검색
- [x] 에러/예외: 빈 검색어, 매칭 없음
- [x] 기존 기능 회귀 없음

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
