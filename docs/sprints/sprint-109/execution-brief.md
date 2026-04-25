# Sprint 109 Execution Brief

## Objective
SqlPreviewDialog 의 SQL 블록을 SqlSyntax 컴포넌트로 syntax-highlight.

## Why
가독성 (UI evaluation #STRUCT-2).

## Scope Boundary
- `src/components/structure/SqlPreviewDialog.tsx` 만 변경.
- 테스트.

## Invariants
- 회귀 0.
- PreviewDialog API 동일.

## Done Criteria
1. SqlSyntax 사용 — keyword span 존재.
2. 빈 sql 시 placeholder 유지.
3. onConfirm/onCancel 회귀 없음.

## Verification Plan
- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`

## Evidence To Return
- 변경 라인.
- 신규/갱신 테스트.
- 1792 → ?건 통과.
- AC-01..04 매핑.
