# Sprint Execution Brief: sprint-217 (retroactive)

## Objective

`DocumentDatabaseTree.tsx` (582) 를 entry-pattern 으로 분해 — entry < 300 + 4 sub-file. 행동 변경 0.

## Task Why

- post-209 cycle 의 P9 후보. Sprint 199-211 entry-pattern 답습.
- 7 concern (databases load / 검색 필터 / row rendering / drop chain / dialog / tab-open / activeDb 추적) 단일 파일 동거 → grok cost ↑.
- 21 regression test 가 source-of-truth.
- **Retroactive**: 본 작업은 Sprint 212 (P3 tabStore) 와 동일 commit. Generator 가 함께 수행.

## Scope Boundary

- 위 5 파일만 수정.
- DocumentDatabaseTree.test.tsx 변경 금지.
- 새 feature, 새 동작, 새 테스트 작성 금지.

## Invariants

- Entry path / props 보존.
- 21 regression 통과.
- Safe Mode gate / drop history / toast copy 동일.
- 새 `eslint-disable*` / silent `catch{}` 0.

## Done Criteria

1. 5 파일 모두 존재.
2. entry < 300, 단일 sub-file < 300.
3. 21 regression 통과.
4. `pnpm vitest run` / `tsc` / `lint` exit 0.

## Verification Plan

위 contract.md 의 10 checks 동일.

## Evidence To Return

- Diff stat (5 파일).
- check 1-10 outcomes.
- AC-01..AC-05 evidence.
- Sprint 212 같은 commit 안에 통합됨 (single hash).

## References

- Contract: `docs/sprints/sprint-217/contract.md`.
- Findings: `docs/sprints/sprint-217/findings.md`.
- Master: `docs/sprints/sprint-212/handoff.md` (sub-section "Sprint 217 (P9 DocumentDatabaseTree) — 사전 처리 통합 commit").
