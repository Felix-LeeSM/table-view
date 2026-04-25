# Sprint 105 Execution Brief

## Objective
Quick Look 리사이저 키보드 조작 (Shift+↑/↓ 8px) + ARIA 노출.

## Why
키보드-only 사용자가 리사이저를 조작할 수 없는 접근성 결함 (UI evaluation #QL-1).

## Scope Boundary
- `src/components/shared/QuickLookPanel.tsx` 리사이저 핸들 (RDB/Document 양쪽).
- 테스트 추가.

## Invariants
- 마우스 드래그 동작 변경 금지.
- 외부 props 변경 금지.

## Done Criteria
1. Shift+ArrowUp/Down 으로 8px 단위 조정.
2. ARIA: `role="separator"`, `aria-orientation`, `aria-label`, `aria-valuemin/max/now`.
3. clamp MIN_HEIGHT(120) / MAX_HEIGHT(600).
4. RDB / Document 양쪽 동일 동작.

## Verification Plan
- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`

## Evidence To Return
- 변경 라인 + 신규 테스트 케이스.
- 1766 → ?건 통과.
- AC-01..07 매핑.
