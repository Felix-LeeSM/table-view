# Sprint Contract: sprint-154 — Window Lifecycle Wiring

## Summary

- **Goal**: Wire the user-facing transitions (Activate / Back / Disconnect / Window close) to real `WebviewWindow.show/hide/focus/close` calls. `appShellStore.screen` is finally retired. The Back-vs-Disconnect distinction (Back preserves pool, Disconnect evicts pool) is enforced.
- **Audience**: Generator + Evaluator
- **Owner**: harness orchestrator
- **Verification Profile**: `command`

## In Scope

- `src/pages/LauncherPage.tsx` — wire connection activation to `workspace.show()` + `workspace.setFocus()` + `launcher.hide()`.
- `src/pages/WorkspacePage.tsx` — replace Back's `setScreen("home")` with `workspace.hide()` + `launcher.show()`; add `tauri://close-requested` handler with same Back semantics.
- `src/main.tsx` — register a launcher close handler that triggers app exit.
- `src/__tests__/window-transitions.test.tsx` (new, TDD-first) — assert `WebviewWindow` mock call ordering for all 5 transitions: activate / back / disconnect / launcher-close / workspace-close.
- `src/stores/appShellStore.ts` — fully retire `screen` field (the `@deprecated` from Sprint 153 becomes removal); update remaining callers.
- Any small follow-ups in `src/App.tsx`, `src/AppRouter.tsx`, `HomePage.tsx`, or test seams that referenced `appShellStore.screen`.

## Out of Scope

- Converting `it.todo()` in `window-lifecycle.ac141.test.tsx` (Sprint 155).
- Editing ADR 0011 body or `RISKS.md` RISK-025 row (Sprint 155).
- Changing the bridge primitive (`zustand-ipc-bridge.ts`) or any store's `SYNCED_KEYS`.
- Re-touching `connectionStore.ts` business logic (only call-site updates if needed).
- Modifying Tauri Rust commands beyond what Sprint 150's `launcher.rs` already exposes (use existing `launcher_show`, `launcher_hide`, `workspace_show`, `workspace_hide`, `workspace_focus`, `app_exit`).

## Invariants

- Sprint 150/151/152/153 outputs unchanged for: `tauri.conf.json`, `launcher.rs`, `lib.rs`, `zustand-ipc-bridge.ts/.test.ts`, `connectionStore.ts`, `connectionStore.test.ts`, `cross-window-connection-sync.test.tsx`, `cross-window-store-sync.test.tsx`, `tabStore.ts`, `mruStore.ts`, `themeStore.ts`, `favoritesStore.ts`, all per-store SYNCED_KEYS regressions.
- `window-lifecycle.ac141.test.tsx` remains untouched (Sprint 155 converts it).
- `connection-sot.ac142.test.tsx` AC-142-* invariants remain green.
- Total vitest count ≥ Sprint 153's 2293 + N new; 5 todos retained; no new `it.skip` / `it.todo`.
- ADR 0011 body frozen.
- TDD strict: window-transitions test authored BEFORE the lifecycle wirings.

## Acceptance Criteria

- `AC-154-01` — `LauncherPage.tsx` activation flow (the existing connection double-click / Enter handler) calls in order: `workspace.show()` → `workspace.setFocus()` → `launcher.hide()`. Asserted via `WebviewWindow` mock call ordering in `window-transitions.test.tsx`.
- `AC-154-02` — `WorkspacePage.tsx` "Back to connections" handler calls in order: `workspace.hide()` → `launcher.show()`. **Crucially: `disconnectFromDatabase` is NOT invoked.**
- `AC-154-03` — Workspace toolbar Disconnect (existing — added in Phase 11) invokes `disconnectFromDatabase(focusedConnId)` and does NOT hide the workspace solely as a side effect of disconnect (pool eviction ≠ window hide). Asserted via `WebviewWindow` mock + `disconnectFromDatabase` mock.
- `AC-154-04` — Launcher close event (`tauri://close-requested` on the launcher window) triggers app exit (calls `app_exit` Tauri command or equivalent). Workspace must not be visible during exit.
- `AC-154-05` — Workspace close event (`tauri://close-requested` on the workspace window) is treated identically to Back: `workspace.hide()` + `launcher.show()`, NO `disconnectFromDatabase`. The default close behaviour (which would close the window) is prevented.
- `AC-154-06` — `appShellStore.screen` is removed from the store. Grep `useAppShellStore.*screen` and `appShellStore.*screen` in `src/` (excluding test seams that already track removal) returns no matches in production code.
- `AC-154-07` — `src/__tests__/window-transitions.test.tsx` exists, was authored BEFORE the wirings, and covers all 5 transitions (AC-154-01..05) with `WebviewWindow` mocks asserting call ordering and the Back-vs-Disconnect distinction.
- `AC-154-08` — TDD ordering: red-state proof captured at `docs/sprints/sprint-154/tdd-evidence/red-state.log` (or commit ordering).
- `AC-154-09` — `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` exit 0; total ≥ 2293 + N new; 5 todos retained.
- `AC-154-10` — `connection-sot.ac142.test.tsx` reports same number of passing AC-142-* cases as before.
- `AC-154-11` — No new `it.skip` / `this.skip()` / `it.todo` / `xit` / `describe.skip` introduced.

## Design Bar / Quality Bar

- All `WebviewWindow` accesses go through a thin testable seam (e.g. extend `src/lib/window-label.ts` to also expose `getWindowByLabel(label)`, or add `src/lib/window-controls.ts` with `showWindow(label)`, `hideWindow(label)`, `focusWindow(label)`, `exitApp()`). Pages call the seam, not the Tauri API directly. Tests mock the seam.
- The Back vs Disconnect distinction MUST be unmistakable in the test names AND in the production code: separate handlers, not a flag. If both go through one handler, the test must assert the branch chosen for each user signal.
- `tauri://close-requested` listeners are registered with `preventDefault()` semantics so the OS-level close becomes the recovery action, not a true close.
- `app_exit` (or equivalent) is invoked through the Tauri command bridge — not via `window.close()` on launcher (which would just close the launcher window without exiting the workspace process).

## Verification Plan

### Required Checks

1. `pnpm vitest run src/__tests__/window-transitions.test.tsx` — green.
2. `pnpm vitest run src/__tests__/connection-sot.ac142.test.tsx` — green.
3. `pnpm vitest run` — full suite green; total ≥ 2293 + N new; 5 todos retained.
4. `pnpm tsc --noEmit` — exit 0.
5. `pnpm lint` — exit 0.
6. `cargo build --manifest-path src-tauri/Cargo.toml` — exit 0 (sanity, no Rust changes expected).
7. `grep -rE "appShellStore.*screen|setScreen|useAppShellStore.*screen" src/ --include="*.ts" --include="*.tsx"` — only test seams remain, no production routing.
8. `grep -rE "it\.skip|this\.skip\(\)|it\.todo|xit\(|describe\.skip"` on touched files — empty.
9. `git diff HEAD -- <Sprint 150/151/152/153 protected scope>` — empty.

### Required Evidence

- Generator must provide:
  - Changed files with one-line purpose.
  - Commands run + outcomes.
  - Per-AC mapping with concrete artifacts.
  - TDD red-state proof.
- Evaluator must cite:
  - Concrete evidence per pass/fail.
  - Any missing/weak evidence as a finding.

## Test Requirements

### Unit Tests (필수)
- `window-transitions.test.tsx`: 1 case per AC-154-01..05 + at least 1 error path (e.g. `workspace.show()` rejects → user surfaces a toast OR launcher remains visible — pick one and lock it).

### Coverage Target
- Modified pages: line coverage ≥ 70% on touched code.

### Scenario Tests (필수)
- [x] Happy path — activate / back / disconnect / launcher-close / workspace-close.
- [x] 에러/예외 — `WebviewWindow.show()` rejection.
- [x] 경계 조건 — Back race vs Disconnect race; close on hidden window.
- [x] 기존 기능 회귀 없음 — AC-142-* preserved.

## Test Script / Repro Script

1. `pnpm vitest run src/__tests__/window-transitions.test.tsx` — green.
2. `pnpm vitest run` && `pnpm tsc --noEmit` && `pnpm lint` — all 0.
3. `cargo build` — 0.
4. `grep` checks above.

## Ownership

- Generator: general-purpose Agent.
- Write scope: only In Scope paths.
- Merge order: 154 must precede 155.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- All 9 required checks passing.
- TDD red-state proof captured.
- No new `it.skip` / `it.todo`.
