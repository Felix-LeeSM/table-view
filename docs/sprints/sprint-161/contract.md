# Sprint Contract: sprint-161

## Summary

- Goal: Workspace 헤더/툴바에 ThemeToggle(ThemePicker) 컴포넌트를 마운트하고 cross-window propagation을 검증
- Verification Profile: `command`

## In Scope

- Workspace에 ThemePicker 컴포넌트 마운트
- ThemePicker workspace 마운트 단위 테스트
- Cross-window propagation 단위 테스트 (이미 존재하지만 workspace에서의 동작 보강)

## Out of Scope

- 키보드 단축키 (Sprint 162)
- E2E Playwright (Sprint 162)
- ThemePicker 자체 기능 변경

## Invariants

- 기존 ThemePicker 동작 불변
- Cross-window IPC bridge 동작 불변
- Sidebar/HomePage의 기존 ThemePicker 마운트 유지

## Acceptance Criteria

- `AC-161-01`: Workspace 페이지에 ThemePicker 컴포넌트가 렌더링됨 (visible, aria-label 포함).
- `AC-161-02`: Workspace에서 ThemePicker로 mode 변경 시 `themeStore.setMode` 호출.
- `AC-161-03`: Workspace에서 theme 변경 시 IPC bridge emit 발생 (cross-window sync).
- `AC-161-04`: 기존 Sidebar/HomePage ThemePicker 동작 회귀 없음.

## Verification Plan

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm tsc --noEmit` — 타입 체크 통과
3. `pnpm lint` — ESLint 에러 0건
