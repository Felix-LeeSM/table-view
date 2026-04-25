# Sprint Contract: sprint-102

## Summary
- Goal: ColumnsEditor 의 Save / Confirm 아이콘 Eye → Check. 텍스트 라벨 정합성 보존. 회귀 0.
- Profile: `command`

## In Scope
- `src/components/structure/ColumnsEditor.tsx`:
  - line 2 `import` 에서 `Eye` 제거, `Check` 추가.
  - line 164 `<Eye />` (Save) → `<Check />`.
  - line 289 `<Eye />` (Confirm add column) → `<Check />`.
- 관련 테스트 (있으면 갱신).

## Out of Scope
- 다른 컴포넌트.
- aria-label/title 전면 재설계.
- sprint-88~101 산출물 추가 변경.

## Invariants
- 회귀 0.
- 기존 aria-label / title (Save / Confirm) 보존.

## Acceptance Criteria
- AC-01: Save 버튼이 Check 아이콘 (Eye 아님).
- AC-02: aria-label / title 이 "Save" / "Confirm" 등 의미 일치.
- AC-03: 레이아웃 회귀 없음.
- AC-04: 회귀 0.

## Verification Plan
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Exit Criteria
- All checks pass
