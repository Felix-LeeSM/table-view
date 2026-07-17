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

계약은 test 방식(unit/integration/component)을 강제하지 않는다 — scope/profile 만
선언한다. Evidence 기준은 sprint 의 `review-profile` 을 따른다. SOT:
`memory/workflow/tdd/memory.md` (예: `review-profile: code` 는 push 전 RED commit
evidence 를 요구, non-code profile 은 불요).

### Coverage Target
- 커버리지 임계값을 하드코딩하지 않는다. SOT는 `scripts/coverage-ratchet-targets.json`
  (frontend / Rust tier별 statements·lines·functions·branches 목표). ratchet으로
  계속 상승하므로 숫자를 복사하지 말고 SOT를 직접 참조한다.
- 신규/수정 코드는 해당 tier의 ratchet 목표를 회귀시키지 않는다.

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
