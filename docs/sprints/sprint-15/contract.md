# Sprint Contract: Sprint 15

## Summary

- Goal: Set up Tauri v2 official E2E test infrastructure using WebDriver (WebdriverIO + tauri-driver)
- Audience: Generator / Evaluator
- Owner: Orchestrator
- Verification Profile: `command`

## In Scope

1. Remove existing Playwright E2E setup (playwright.config.ts, e2e/, @playwright/test)
2. Install `tauri-driver` via cargo
3. Add WebdriverIO dependencies (webdriverio, @wdio/cli, @wdio/mocha-framework, @wdio/spec-reporter)
4. Create `wdio.conf.ts` that builds Tauri debug binary and spawns tauri-driver
5. Create `e2e/` directory with WebdriverIO test specs
6. Write smoke tests: app launches, sidebar visible, theme toggle, connection list

## Out of Scope

- Full user flow E2E tests (connection creation, query execution) — deferred
- CI pipeline for E2E tests — separate sprint
- macOS testing (not supported by tauri-driver)
- Frontend unit test changes (already using @tauri-apps/api/mocks correctly)

## Invariants

- All existing unit tests pass (376 frontend + 84 Rust)
- No changes to production code
- `pnpm lint`, `pnpm tsc --noEmit` still pass
- Tauri debug binary must exist at `src-tauri/target/debug/table-view`

## Acceptance Criteria

- `AC-01`: Playwright removed, WebdriverIO installed
- `AC-02`: `wdio.conf.ts` exists with tauri-driver configuration
- `AC-03`: `tauri-driver` spawns correctly and connects to debug binary
- `AC-04`: Smoke test verifies app launches with sidebar
- `AC-05`: Smoke test verifies theme toggle works
- `AC-06`: Smoke test verifies connection list empty state
- `AC-07`: Existing unit tests unaffected

## Design Bar / Quality Bar

- Follow Tauri v2 official testing documentation (https://v2.tauri.app/develop/tests/)
- Use WebdriverIO + Mocha (BDD) framework, matching official Tauri example
- `tauri-driver` proxies WebDriver requests to native WebKit (Linux) / Edge Driver (Windows)
- Tests should be runnable locally and in CI (headless where supported)
- Debug binary built via `pnpm tauri build --debug --no-bundle`

## System Dependencies

### Linux (WSL2)
- `webkit2gtk-driver` package: `sudo apt install webkit2gtk-driver`
- `tauri-driver`: `cargo install tauri-driver --locked`
- Display server (X11/Wayland) required for GTK app rendering

### Windows
- Microsoft Edge Driver matching Edge version
- `tauri-driver`: `cargo install tauri-driver --locked`

## Verification Plan

### Required Checks

1. `npx wdio run wdio.conf.ts` — E2E tests pass (requires tauri-driver + display)
2. `pnpm vitest run` — unit tests still pass
3. `pnpm lint` — clean
4. `pnpm tsc --noEmit` — type check passes

## Ownership

- Generator: Sprint 15 Generator Agent
- Write scope: `wdio.conf.ts` (new), `e2e/` (replaced), `package.json` (update deps)
- Merge order: direct to main

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
