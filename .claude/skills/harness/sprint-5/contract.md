# Sprint Contract: sprint-5

## Summary

- Goal: DataGrid 로딩 깜빡임 수정 + 회귀 테스트 추가
- Audience: Generator, Evaluator
- Owner: Claude Code
- Verification Profile: `command`

## In Scope

- DataGrid 로딩 시 기존 테이블 데이터 유지 (깜빡임 방지)
- 리패치 중 로딩 인디케이터를 오버레이로 표시
- DataGrid 회귀 테스트 추가
- P1 사용자 피드백 해결 (#1)

## Out of Scope

- QueryEditor, MainArea, SchemaTree 테스트 (Sprint 2-4)
- 커버리지 임계값 상향 (Sprint 종료 후 별도)

## Invariants

- 기존 DataGrid 동작 (정렬, 필터, 페이지네이션) 변경 없음
- 기존 124개 테스트 모두 통과
- 초기 로딩 시 여전히 중앙 스피너 표시
- 에러 상태 표시 방식 변경 없음

## Acceptance Criteria

- `AC-01`: 기존 데이터가 표시된 상태에서 리패치(페이지 전환, 정렬, 필터) 시, 기존 테이블(헤더+행)이 DOM에 유지됨
- `AC-02`: 리패치 중 로딩 인디케이터가 테이블 위에 오버레이로 표시됨 (기존 테이블 대체하지 않음)
- `AC-03`: 초기 로딩(이전 데이터 없음)은 기존과 동일하게 중앙 스피너 표시
- `AC-04`: 에러 상태 표시 변경 없음
- `AC-05`: 기존 DataGrid 테스트 회귀 없음
- `AC-06`: 새 테스트: 리패치 시 테이블 요소가 DOM에 유지됨을 검증

## Design Bar / Quality Bar

- 오버레이는 기존 스피너 스타일(Loader2 + animate-spin) 재사용
- 반투명 배경으로 테이블 위에 겹쳐 표시

## Test Requirements

### Unit Tests (필수)
- AC-01, AC-02, AC-03, AC-06 각각 대응하는 테스트
- 에러 상태에서 리패치 시나리오 테스트

### Coverage Target
- DataGrid.tsx: 66% → 75%+

### Scenario Tests (필수)
- [x] Happy path: 페이지 전환 시 기존 데이터 유지
- [x] 에러/예외: 리패치 실패 후 에러 표시
- [x] 경계 조건: 빈 데이터, 초기 로딩
- [x] 기존 기능 회귀 없음

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm vitest run --coverage` — DataGrid.tsx 75%+ lines
3. `pnpm tsc --noEmit` — 타입 체크 통과

### Required Evidence

- Generator must provide:
  - changed files with purpose
  - checks run and outcomes
  - acceptance criteria coverage with concrete evidence
- Evaluator must cite:
  - concrete evidence for each pass/fail decision
  - any missing or weak evidence as a finding

## Test Script / Repro Script

1. `pnpm vitest run src/components/DataGrid.test.tsx`
2. `pnpm vitest run --coverage 2>&1 | grep DataGrid`

## Ownership

- Generator: general-purpose
- Write scope: `src/components/DataGrid.tsx`, `src/components/DataGrid.test.tsx`
- Merge order: 단일 커밋

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
