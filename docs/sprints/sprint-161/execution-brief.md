# Sprint Execution Brief: sprint-161

## Objective

- Workspace의 헤더 영역에 ThemePicker 컴포넌트를 마운트하여, 사용자가 workspace에서 작업 중에도 다크/라이트 테마를 전환할 수 있도록 한다.

## Task Why

- 현재 ThemePicker는 launcher(Sidebar, HomePage)에만 마운트되어 있음. Workspace에서 테마 전환을 위해 launcher로 돌아가야 하는 워크플로우 단절.

## Scope Boundary

- `src/pages/WorkspacePage.tsx`에 ThemePicker 마운트 추가
- WorkspacePage.test.tsx에 테스트 추가
- ThemePicker 컴포넌트 자체는 수정하지 않음

## Invariants

- 기존 ThemePicker 기능 불변
- Cross-window IPC bridge 불변

## Done Criteria

1. WorkspacePage에 ThemePicker 렌더링
2. 단위 테스트 — ThemePicker가 workspace에서 visible
3. 단위 테스트 — theme 변경 시 store.setMode 호출
4. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` 통과

## References

- `src/pages/WorkspacePage.tsx` — Workspace 페이지
- `src/pages/WorkspacePage.test.tsx` — 기존 테스트
- `src/components/theme/ThemePicker.tsx` — ThemePicker 컴포넌트
- `src/components/theme/ThemePicker.test.tsx` — ThemePicker 테스트
- `src/stores/themeStore.ts` — theme 상태 관리
- `src/components/layout/Sidebar.tsx` line 215 — 기존 Sidebar ThemePicker 마운트 참고
