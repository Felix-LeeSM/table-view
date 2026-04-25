# Sprint Contract: sprint-105

## Summary
- Goal: Quick Look 패널 리사이저를 키보드(`Shift+↑/↓` 8px)로 조작 가능. ARIA 노출 (`role="separator"` + `aria-orientation="horizontal"` + aria-label/valuenow/min/max).
- Profile: `command`

## In Scope
- `src/components/shared/QuickLookPanel.tsx`:
  - 리사이저 핸들 (RDB body line 303-309, Document body line 411-417):
    - `tabIndex={0}` 추가.
    - `role="separator"` + `aria-orientation="horizontal"` + `aria-label="Resize Quick Look panel"` + `aria-valuemin={MIN_HEIGHT}` + `aria-valuemax={MAX_HEIGHT}` + `aria-valuenow={height}`.
    - `aria-hidden="true"` 제거.
    - `onKeyDown` 핸들러: `Shift + ArrowUp` → height + 8 (clamp MAX_HEIGHT), `Shift + ArrowDown` → height - 8 (clamp MIN_HEIGHT). 다른 키는 무시.
    - 키 핸들러는 마우스 드래그와 동일한 setState 함수 사용.
- 핸들러를 RDB/Document 양쪽 body 에 동일 적용 (공통 prop `onResizeKeyDown` 추가).
- 테스트 추가:
  - Shift+ArrowUp → height +8 적용.
  - Shift+ArrowDown → height -8 적용.
  - Shift+ArrowDown 가 MIN_HEIGHT 미만으로 안 가는 clamp.
  - Shift+ArrowUp 가 MAX_HEIGHT 초과 안 하는 clamp.
  - non-Shift ArrowUp → no-op.
  - 핸들이 `role="separator"` + `tabIndex=0` + aria 속성 보유.

## Out of Scope
- 마우스 드래그 동작 변경.
- 양 패널 다른 step (8px 통일).
- focus ring 디자인 시스템 변경.

## Invariants
- 회귀 0 (1766 통과 유지).
- 마우스 드래그 동작 (handleMouseDown) 동일 유지.
- 외부 props (Props 타입) 변경 금지.

## Acceptance Criteria
- AC-01: 리사이저 handle 이 `tabIndex=0` + `role="separator"` + `aria-orientation="horizontal"` + `aria-label="Resize Quick Look panel"` 보유.
- AC-02: Shift+ArrowUp → 높이 +8 (clamp MAX_HEIGHT).
- AC-03: Shift+ArrowDown → 높이 -8 (clamp MIN_HEIGHT).
- AC-04: 일반 ArrowUp/Down (Shift 없음) → no-op.
- AC-05: `aria-valuenow` 가 현재 height 와 동기화.
- AC-06: RDB / Document 양쪽 body 모두 동일 동작.
- AC-07: 회귀 0.

## Verification Plan
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Exit Criteria
- All checks pass + AC-01..07 evidence in handoff.md.
