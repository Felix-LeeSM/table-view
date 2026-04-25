# Sprint 107 Execution Brief

## Objective
SchemaTree table 노드 F2 → Rename Dialog. Input 자동 포커스 + 기존 이름 전체 선택.

## Why
키보드 사용자가 컨텍스트 메뉴 없이 rename 가능 (UI evaluation #TREE-1).

## Scope Boundary
- `src/components/schema/SchemaTree.tsx` 만 변경.
- 테스트.

## Invariants
- ContextMenu Rename 동작 회귀 0.
- 1782 통과 유지.

## Done Criteria
1. F2 on table button → Dialog 열림.
2. F2 on view/function → 무시.
3. Input autoFocus + select(): 기존 이름 전체 선택.
4. Enter 시 commit / Esc 시 close.

## Verification Plan
- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`

## Evidence To Return
- 변경 라인.
- 신규 테스트 케이스.
- 1782 → ?건 통과.
- AC-01..05 매핑.
