# Sprint Contract: sprint-97

## Summary
- Goal: 탭 dirty indicator(dot) + close 가드 (ConfirmDialog).
- Profile: `command`

## In Scope
- `src/components/layout/TabBar.tsx`
- `src/stores/tabStore.ts`
- `src/components/layout/TabBar.test.tsx`
- pendingEdits 정보 제공 — `useDataGridEdit` 또는 새 store/selector

## Out of Scope
- 다른 컴포넌트
- sprint-88~96 산출물 변경

## Invariants
- 회귀 0
- sprint-96 ConfirmDialog preset 사용

## Acceptance Criteria
- AC-01: `pendingEdits.size > 0 || pendingNewRows.length > 0 || pendingDeletedRowKeys.size > 0` 인 탭에 dot 마크 표시 (`data-dirty="true"` 또는 visible bullet).
- AC-02: dirty 탭 close 시도 시 ConfirmDialog 뜸. confirm 시 close, cancel 시 close 취소.
- AC-03: dirty 가 0 되면 마크 즉시 사라짐.
- AC-04: 회귀 0.

## Verification Plan
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Test Requirements
- TabBar dirty mark 단언 (dirty/clean state 전환 ≥ 2)
- close 가드 단언 (confirm + cancel 분기 각 1)

## Exit Criteria
- P1/P2 findings: 0
- All checks pass
