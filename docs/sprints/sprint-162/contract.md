# Sprint Contract: sprint-162

## Summary

- Goal: Cmd+Shift+L 키보드 단축키로 theme toggle + Phase 14 closure
- Verification Profile: `command`

## In Scope

- App.tsx 또는 WorkspacePage.tsx에 Cmd+Shift+L 단축키 등록
- 단축키 동작 단위 테스트
- Phase 14 exit gate 검증

## Out of Scope

- E2E Playwright (tauri-driver 미설치)
- ThemePicker 컴포넌트 수정

## Invariants

- 기존 단축키 동작 회귀 없음
- ThemePicker 마운트 위치 불변

## Acceptance Criteria

- `AC-162-01`: Cmd+Shift+L 누르면 theme mode가 순환 (dark → light → system → dark).
- `AC-162-02`: launcher와 workspace 모두에서 단축키 동작.
- `AC-162-03`: Phase 14 exit gate — skip-zero, AC-14-01~05 잠금.

## Verification Plan

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm tsc --noEmit` — 타입 체크 통과
3. `pnpm lint` — ESLint 에러 0건
