# Sprint Contract: sprint-217 (retroactive)

## Summary

- Goal: `DocumentDatabaseTree.tsx` (582) 를 entry-pattern (entry + 4 sub-file) 으로 분해. 행동 변경 0; 외부 import path 보존.
- Audience: Generator + Evaluator (post-209 cycle).
- Owner: harness skill orchestrator.
- Verification Profile: `command`
- **Retroactive**: 본 sprint 의 작업 commit 은 Sprint 212 commit 과 동일 — Generator 가 P9 사전 처리로 함께 수행 + atomic 분리 build 무결성 비용으로 단일 commit 채택.

## In Scope

- `DocumentDatabaseTree.tsx` (entry, 582 → 263).
- `DocumentDatabaseTree/useDocumentDatabaseTreeData.ts` (create, 205).
- `DocumentDatabaseTree/useDocumentDatabaseDrop.ts` (create, 109).
- `DocumentDatabaseTree/rows.tsx` (create, 130).
- `DocumentDatabaseTree/dialogs.tsx` (create, 67).

## Out of Scope

- 행동 변경, 새 feature 추가.
- `DocumentDatabaseTree.test.tsx` 변경.
- `useDocumentStore` / `useSafeModeGate` / `dropCollection` / `useTabStore` API 변경.
- Sidebar 의 import 경로 변경.

## Invariants

- 외부 import path: `@components/schema/DocumentDatabaseTree` default export = React 컴포넌트, props = `{ connectionId: string }`.
- 4 sub-file 은 entry 로부터만 import.
- DocumentDatabaseTree.test.tsx 21건 통과.
- Safe Mode gate / drop history record / toast copy 동일.
- 새 `eslint-disable*` / 새 silent `catch{}` 0.

## Acceptance Criteria

- `AC-01`: entry path + props 보존.
- `AC-02`: 5 파일 모두 존재 + 비어있지 않음.
- `AC-03`: entry < 300, 단일 sub-file < 300.
- `AC-04`: regression test 21건 통과 (test 파일 변경 0).
- `AC-05`: 프로젝트 회귀 0 (`pnpm vitest run` / `tsc` / `lint` exit 0; 새 eslint-disable 0).

## Verification Plan

### Required Checks

1. `wc -l src/components/schema/DocumentDatabaseTree.tsx` < 300 (실제 263).
2. `ls src/components/schema/DocumentDatabaseTree/{useDocumentDatabaseTreeData.ts,useDocumentDatabaseDrop.ts,rows.tsx,dialogs.tsx}` 4 파일.
3. `wc -l` sub-file 단일 max < 300 (실제 max 205).
4. `git diff --stat src/components/schema/DocumentDatabaseTree.test.tsx` 변경 0.
5. `pnpm vitest run src/components/schema/DocumentDatabaseTree.test.tsx` exit 0 (21건).
6. `pnpm vitest run` exit 0.
7. `pnpm tsc --noEmit` exit 0.
8. `pnpm lint` exit 0.
9. `grep -rn "from \"@components/schema/DocumentDatabaseTree/" src/ e2e/` 0 매치.
10. `git diff src/components/schema/DocumentDatabaseTree.tsx src/components/schema/DocumentDatabaseTree/` grep `^+.*eslint-disable` 0.

## Test Requirements

- 신규 unit test 작성 0.
- 기존 21건 regression 이 source-of-truth.

## Ownership

- Generator: general-purpose agent (Sprint 212 통합 진행).
- Write scope: 위 5 파일만.
- Merge: Sprint 212 commit 과 동일 hash.

## Exit Criteria

- Open `P1`/`P2` findings: `0` (P9 사전 처리 자체는 행동 변경 0, F-002 P2 는 audit trail 차원으로 본 retroactive 문서 + Sprint 212 handoff 반영으로 해소).
- Required checks passing: `yes`.
- Acceptance criteria evidence linked.
