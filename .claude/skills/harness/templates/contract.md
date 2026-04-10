# Sprint Contract: <sprint-id>

## Summary

- Goal:
- Audience:
- Owner:
- Verification Profile: `browser | command | api | static | mixed`

## In Scope

- 

## Out of Scope

- 

## Invariants

- 

## Acceptance Criteria

- `AC-01`
- `AC-02`
- `AC-03`

## Design Bar / Quality Bar

- 

## Verification Plan

### Required Checks

1. 
2. 

### Required Evidence

- Generator must provide:
  - changed files with purpose
  - checks run and outcomes
  - acceptance criteria coverage with concrete evidence
- Evaluator must cite:
  - concrete evidence for each pass/fail decision
  - any missing or weak evidence as a finding

## Test Requirements

### Unit Tests (필수)
- 각 AC 항목에 대응하는 최소 1개 테스트 작성
- 에러/예외 케이스 최소 1개 테스트 작성

### Coverage Target
- 신규/수정 코드: 라인 70% 이상 권장
- CI 전체 기준: 라인 40%, 함수 40%, 브랜치 35%

### Scenario Tests (필수)
- [ ] Happy path
- [ ] 에러/예외 상황
- [ ] 경계 조건 (빈 입력, 동시성, 대용량)
- [ ] 기존 기능 회귀 없음

## Test Script / Repro Script

1. 
2. 
3. 

## Ownership

- Generator:
- Write scope:
- Merge order:

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
