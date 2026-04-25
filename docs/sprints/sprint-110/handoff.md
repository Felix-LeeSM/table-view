# Sprint 110 → next Handoff

## Sprint 110 Result
- **PASS** (직접 적용, 1 attempt) — 1797/1797 tests, tsc/lint 0.

## 산출물
- `src/components/connection/ConnectionItem.tsx`:
  - line 287 collapsed error span: `text-3xs` → `text-xs`, `title={errorMessage}` 추가.
  - line 295 expanded error span: `text-3xs` → `text-xs`.
- `src/components/connection/ConnectionItem.test.tsx`: 두 기존 케이스에 `text-xs` + `text-destructive` + `title` 단언 추가.

## AC Coverage
- AC-01: collapsed `<span>` 의 className 에 `text-xs` 포함.
- AC-02: collapsed `<span>` 의 `title` 속성 = errorMessage.
- AC-03: expanded `<span>` 도 `text-xs`.
- AC-04: 색상 토큰 `text-destructive` 유지.
- AC-05: 1797/1797 (회귀 0).
