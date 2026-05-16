# Sprint Contract: sprint-363

## Summary

- Goal: Phase 3 Q13 — 같은 connection 두 번째 클릭 시 기존 `workspace-{conn_id}` window focus, 새 window 안 뜸. Launcher lifecycle (strategy line 773 정합): connection 열어도 launcher 는 hide/show 사이클로 살아있고 close button 누르면 hide (process 안 죽음).
- Audience: state-management-strategy Q13 — TablePlus 패턴, conn 당 1 workspace.
- Owner: Generator (sprint-363)
- Verification Profile: `mixed` (cargo test + cargo clippy + e2e + pnpm tsc + pnpm lint)

## In Scope

- `src-tauri/src/commands/open_workspace_window.rs` (sprint-361 에서 도입) — idempotency 강화: callback 으로 focus event emit + frontend Side toast/log.
- `src-tauri/src/launcher.rs` — launcher window close 핸들러 → `Window::hide()` (Tauri close-requested event 가로채기).
- `src/components/connection/ConnectionList.tsx` — connection double-click 시 `openWorkspaceWindow(connId)` 호출 (이미 sprint-361 에 wrapper 있음).
- e2e: `e2e/q13-same-conn-focus.e2e.ts`.
- 단위: `src-tauri/tests/open_workspace_window_focus_event.rs`.

## Out of Scope

- single-instance plugin (sprint-362).
- Workspace window 의 close 정책 (별 sprint).
- 다른 conn 동시 검증 (sprint-361 의 `AC-361-03` 이 이미 cover).

## Invariants

- Launcher 는 hide 만 — process 는 살아있음.
- 같은 conn 두 번째 클릭 → 새 window 0, 기존 focus.
- 새 conn 클릭 → 새 workspace window 생성 (sprint-361 의 idempotent 분기).
- close 후 system tray 또는 dock icon 클릭 시 launcher show.

## Acceptance Criteria

- `AC-363-01` 같은 conn 두 번 클릭 (5 초 간격) → workspace window count 1. Test: e2e + assertion.
- `AC-363-02` 기존 workspace window 가 minimized 상태에서 같은 conn 클릭 → restore + focus. Test: e2e.
- `AC-363-03` 다른 OS 의 second instance (sprint-362) 와 충돌 0 — 2nd launch 가 launcher focus 하고 conn 클릭 시 normal flow. Test: e2e 시나리오.
- `AC-363-04` Launcher window close button (X) → 프로세스 종료 0, launcher 만 hide. Workspace window 는 그대로 살아있음. Test: e2e — close 후 dock icon 클릭 → launcher show.
- `AC-363-05` 모든 window (launcher + workspaces) close → 프로세스 quit (macOS 외) / dock 만 남음 (macOS). Test: 플랫폼별 e2e.

## Design Bar / Quality Bar

- TDD: e2e 시나리오 먼저 — 같은 conn 두 번 클릭 후 window count assert.
- Tauri `close-requested` event 가로채서 `event.prevent_default()` + `Window::hide()`.
- macOS 의 dock-only-app 패턴: 모든 window close 해도 quit 안 함 (default Tauri 동작).
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test open_workspace_window_focus_event`
3. `pnpm test:e2e:docker -- e2e/q13-same-conn-focus.e2e.ts`
4. `pnpm tsc --noEmit && pnpm lint`

### Required Evidence

- e2e 시나리오 video + driver assertions.
- Window count log (1 vs 2).
- close button 동작 platform matrix raw.

## Test Requirements

- e2e: 2 시나리오 (idempotent focus + close hide).
- Cargo: focus event emit.
- Coverage: `commands/open_workspace_window.rs` + `launcher.rs` close handler 70%.

## Test Script / Repro Script

1. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test open_workspace_window_focus_event`
3. `pnpm test:e2e:docker -- e2e/q13-same-conn-focus.e2e.ts`
4. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope.
- Merge order: 361 + 362 이후. 365 본 sprint 의존.

## Exit Criteria

- Open P1/P2: 0
- AC 5/5 PASS
- macOS / Windows / Linux platform matrix green
