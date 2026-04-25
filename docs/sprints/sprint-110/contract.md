# Sprint Contract: sprint-110

## Summary
- Goal: ConnectionItem 에러 문구 폰트를 `text-3xs` → `text-xs` 로 승급. truncate + `title` (HTML tooltip) 보존. 색상 토큰 (`text-destructive`) 유지.
- Profile: `command`

## In Scope
- `src/components/connection/ConnectionItem.tsx`:
  - line 287 (collapsed view): `text-3xs` → `text-xs`. `<span>` 에 `title={errorMessage}` 추가.
  - line 295 (expanded view): `text-3xs` → `text-xs`.
- 테스트:
  - error span 이 `text-xs` 클래스 보유.
  - error span 이 `title` 속성에 errorMessage 텍스트.
  - 회귀 0.

## Out of Scope
- shadcn Tooltip 도입 (HTML title 속성으로 충분).
- 에러 텍스트 줄임 (... 외) 변경.
- expanded mode 의 break-all 제거.

## Invariants
- 회귀 0 (1797 통과 유지).
- aria-label / 클릭 동작 (showErrorDetail toggle) 변경 금지.

## Acceptance Criteria
- AC-01: collapsed error span 이 `text-xs` 클래스 보유.
- AC-02: collapsed error span 의 `title` 속성 = errorMessage.
- AC-03: expanded error span 이 `text-xs` 클래스 보유.
- AC-04: 색상 토큰 `text-destructive` 유지.
- AC-05: 회귀 0.

## Verification Plan
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Exit Criteria
- All checks pass + AC-01..05 evidence in handoff.md.
