# Sprint Execution Brief: sprint-154 — Window Lifecycle Wiring

## Objective

5개 사용자 전환(Activate / Back / Disconnect / Launcher-close / Workspace-close)을 실제 `WebviewWindow.show/hide/setFocus/close` 호출 + `app_exit` 명령에 연결한다. `appShellStore.screen`은 완전히 제거하고, Back ≠ Disconnect 구분을 코드와 테스트 양쪽에서 명확히 못박는다.

## Task Why

Sprint 150~153은 두 창 인프라 + 크로스-윈도우 sync까지만 깔아두고 실제 lifecycle은 전혀 묶지 않았다. 지금 사용자가 connection을 더블클릭하면 여전히 `appShellStore.setScreen("workspace")`로 한 창 내부에서만 화면이 바뀐다 — launcher 창은 그대로 떠 있고 workspace 창은 hidden으로 남아 있다. 이 sprint가 두 창을 진짜로 사용자에게 노출시키는 첫 sprint이므로, AC-141-* 가족이 요구한 "Back은 pool 보존, Disconnect는 pool eviction" 분리도 여기서 강제된다.

## Scope Boundary

- **DO**: `LauncherPage.tsx` activation 핸들러 wiring; `WorkspacePage.tsx` Back 핸들러 + `tauri://close-requested` 핸들러; `main.tsx` launcher close → `app_exit`; `src/__tests__/window-transitions.test.tsx` (TDD-first); `appShellStore.screen` 필드 완전 제거 + 잔여 caller 정리; 얇은 testable seam (`src/lib/window-controls.ts` 권장).
- **DO NOT**: `window-lifecycle.ac141.test.tsx` 변환(Sprint 155); ADR 0011 본문 / RISKS.md RISK-025 row 수정(Sprint 155); `zustand-ipc-bridge.ts` 또는 store SYNCED_KEYS 변경; `connectionStore.ts` 비즈니스 로직 재손질; Tauri Rust 명령 신규 추가.

## Invariants

- Sprint 150/151/152/153 outputs 동결: `tauri.conf.json`, `launcher.rs`, `lib.rs`, `zustand-ipc-bridge.ts/.test.ts`, `connectionStore.ts`, `connectionStore.test.ts`, `cross-window-connection-sync.test.tsx`, `cross-window-store-sync.test.tsx`, `tabStore.ts`, `mruStore.ts`, `themeStore.ts`, `favoritesStore.ts`, 모든 per-store SYNCED_KEYS regression.
- `window-lifecycle.ac141.test.tsx` 미변경 (Sprint 155 변환 예정).
- `connection-sot.ac142.test.tsx` AC-142-* invariants green.
- vitest 총합 ≥ Sprint 153의 2293 + N new; 5 todos 유지; 새 `it.skip` / `it.todo` 0.
- ADR 0011 본문 동결.
- TDD strict — `window-transitions.test.tsx`가 wiring 직전에 red 상태로 작성/관찰됨.

## Done Criteria

1. 5개 전환 모두 wired:
   - Activate: `workspace.show()` → `setFocus()` → `launcher.hide()` 순서
   - Back: `workspace.hide()` → `launcher.show()` (disconnectFromDatabase 호출 없음)
   - Disconnect: `disconnectFromDatabase(focusedConnId)` 호출, workspace hide는 별도 사이드 이펙트로 발생하지 않음
   - Launcher close (`tauri://close-requested`): `app_exit` 호출
   - Workspace close (`tauri://close-requested`): preventDefault + Back 동치 (`workspace.hide()` → `launcher.show()`, no disconnect)
2. Pages는 Tauri API를 직접 호출하지 않고 seam (`src/lib/window-controls.ts` 또는 `window-label.ts` 확장)을 통해 호출. 테스트는 seam을 모킹.
3. Back과 Disconnect는 production 코드에서 **별도 핸들러**로 분리. flag 분기 금지.
4. `appShellStore.screen` 필드 + 모든 production caller 제거. `grep -rE "useAppShellStore.*screen|appShellStore.*screen|setScreen" src/` → production 코드 0 hit (test seam만 잔존 허용 — Sprint 153 deprecation 시점에 이미 정리됨).
5. `src/__tests__/window-transitions.test.tsx` 신규 — 5개 AC + 1개 error path (`workspace.show()` rejection). `WebviewWindow` mock call ordering 단언.
6. TDD red-state proof: `docs/sprints/sprint-154/tdd-evidence/red-state.log` 또는 commit 순서.
7. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` 모두 exit 0; total ≥ 2293 + N new; 5 todos retained.
8. `git diff HEAD <Sprint 150/151/152/153 protected scope>` empty.

## Verification Plan

- **Profile**: command
- **Required checks**:
  1. `pnpm vitest run src/__tests__/window-transitions.test.tsx` — green.
  2. `pnpm vitest run src/__tests__/connection-sot.ac142.test.tsx` — green.
  3. `pnpm vitest run` — green; total ≥ 2293 + N new; 5 todos.
  4. `pnpm tsc --noEmit` — exit 0.
  5. `pnpm lint` — exit 0.
  6. `cargo build --manifest-path src-tauri/Cargo.toml` — exit 0 (Rust 무변경 sanity).
  7. `grep -rE "appShellStore.*screen|setScreen|useAppShellStore.*screen" src/ --include="*.ts" --include="*.tsx"` — production 코드 hit 0.
  8. `grep -rE "it\.skip|this\.skip\(\)|it\.todo|xit\(|describe\.skip"` on touched files — empty.
  9. `git diff HEAD <Sprint 150/151/152/153 protected scope>` — empty.
- **Required evidence**: per-AC mapping + TDD red-state proof.

## Evidence To Return

- 변경 파일 + 한 줄 purpose.
- 실행한 명령 + 결과.
- AC-154-01..11 매핑 (구체적 artifact 인용).
- TDD ordering proof (red-state.log 또는 commit 순서).
- 가정 / 잔여 위험.

## References

- Contract: `docs/sprints/sprint-154/contract.md`
- Master spec: `docs/sprints/sprint-150/spec.md` (Sprint 154 section)
- Sprint 150 Tauri commands: `src-tauri/src/launcher.rs` — `launcher_show/hide/focus`, `workspace_show/hide/focus`, `app_exit`
- Sprint 153 deprecation: `src/stores/appShellStore.ts` — `@deprecated screen` 필드 제거 대상
- Sprint 153 cross-window sync 베이스라인: `src/__tests__/cross-window-store-sync.test.tsx`
- Window label resolver: `src/lib/window-label.ts`
- AC-141 라이프사이클 todo: `src/__tests__/window-lifecycle.ac141.test.tsx` (Sprint 155에서 변환)
- AC-142 invariant: `src/__tests__/connection-sot.ac142.test.tsx`
- Conventions: `memory/conventions/memory.md`
- Skip-zero gate: `memory/lessons/2026-04-27-phase-end-skip-accountability-gate/memory.md`
