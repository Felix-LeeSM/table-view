# Sprint Execution Brief: sprint-156

## Objective

- Activation + preview 모든 entry point에 대한 TDD 회귀 진단 테스트를 작성하여, 사용자가 보고한 두 가지 버그(① connection 더블클릭 → workspace 미열림, ② PG sidebar preview 미동작)의 원인을 식별한다.

## Task Why

- Phase 12 multi-window split 직후 사용자 보고된 회귀. jsdom 단위 테스트는 모두 green이지만 실제 런타임에서 동작하지 않을 가능성. 진단 테스트로 버그 위치를 정확히 식별해야 후속 fix sprint의 scope가 결정됨.

## Scope Boundary

- 테스트 파일만 생성. 프로덕션 코드 수정 금지.
- E2E Playwright 테스트는 제외 (Sprint 160).

## Invariants

- 기존 테스트 모두 통과 유지
- 기존 프로덕션 코드 변경 없음

## Done Criteria

1. `src/__tests__/connection-activation.diagnostic.test.tsx` 생성 — activation chain + 엣지 케이스 단언
2. `src/components/schema/SchemaTree.preview.entrypoints.test.tsx` 생성 — 모든 preview entry point 단언
3. 기존 DocumentDatabaseTree 테스트에 누락된 엣지 케이스 보강
4. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` 모두 통과
5. 모든 테스트에 `// Reason: ... (2026-04-28)` 주석 포함

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
- Required evidence:
  - 생성된 파일 경로와 목적
  - RED/GREEN 상태 per test
  - 기존 테스트 회귀 없음

## Evidence To Return

- Changed files and purpose
- Checks run and outcomes
- Done criteria coverage with evidence
- RED 테스트 목록 (다음 sprint fix scope)
- Assumptions made during implementation

## References

- Contract: `docs/sprints/sprint-156/contract.md`
- Phase spec: `docs/phases/phase-13.md`
- Key existing tests:
  - `src/__tests__/window-transitions.test.tsx` (Sprint 154, AC-154-01~05)
  - `src/__tests__/window-lifecycle.ac141.test.tsx` (AC-141-1~5)
  - `src/components/schema/SchemaTree.preview.test.tsx` (AC-S136-01/02/04)
  - `src/stores/tabStore.test.ts` (preview tab system, lines 607-838)
- Key source files:
  - `src/lib/window-controls.ts` — seam (showWindow, focusWindow, hideWindow)
  - `src/pages/HomePage.tsx` — handleActivate (lines 95-138)
  - `src/components/schema/SchemaTree.tsx` — handleTableClick (636-649), handleTableDoubleClick (658-664), renderItemRow (1010-1141)
  - `src/stores/tabStore.ts` — addTab (267-323), promoteTab (356-361)
  - `src/components/layout/TabBar.tsx` — data-preview attribute (93-97), italic title (233)
