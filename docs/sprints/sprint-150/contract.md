# Sprint Contract: sprint-150 — Two-Window Foundation

## Summary

- **Goal**: Replace single-window Tauri config with launcher (720×560 fixed) + workspace (1280×800 resizable) pair, route the React entry by current window label, and add a TDD-first label-routing test.
- **Audience**: Generator + Evaluator
- **Owner**: harness orchestrator
- **Verification Profile**: `mixed` (command + static)

## In Scope

- `src-tauri/tauri.conf.json` — declare two `windows[]` entries (launcher / workspace) with exact dimensions and per-window flags.
- `src-tauri/src/launcher.rs` (new) + `src-tauri/src/lib.rs` — Rust commands that show/hide/focus/close windows by label, registered in `invoke_handler`. Unit tests for the new module.
- `src/main.tsx` (or new `src/AppRouter.tsx`) — read current `WebviewWindow` label at boot, mount `LauncherPage` for `launcher` label, mount existing workspace shell for `workspace`.
- `src/pages/LauncherPage.tsx` (new) — host shell rendering existing `HomePage` body inside launcher-only chrome (no Workspace siblings).
- `src/__tests__/window-bootstrap.test.tsx` (new, TDD-first) — label-routing test using mocked `getCurrentWebviewWindow()`.
- `src/App.tsx` — stop branching on `appShellStore.screen` for top-level page routing.

## Out of Scope

- Cross-window state sync (Sprint 151+).
- Connection store wiring to bridge (Sprint 152).
- Other store wiring (Sprint 153).
- Real lifecycle wiring of activate/Back/Disconnect/close (Sprint 154).
- Converting the 5 `it.todo()` in `window-lifecycle.ac141.test.tsx` (Sprint 155).
- ADR 0012 / RISK-025 closure (Sprint 155).

## Invariants

- Existing 2244 vitest tests continue to pass — no regression.
- `connection-sot.ac142.test.tsx` AC-142-* invariants unchanged (Disconnect = pool eviction).
- ADR 0011 body is frozen — no edits to its body.
- macOS e2e remains deferred (RISK-020) — vitest + WebviewWindow mock is the verification surface.
- All 5 single-window stub `it()` in `window-lifecycle.ac141.test.tsx` continue passing throughout this sprint (the deprecation/replacement happens in 155).
- TDD: the new `window-bootstrap.test.tsx` MUST be authored and observed failing before the routing change is implemented.

## Acceptance Criteria

- `AC-150-01` — `src-tauri/tauri.conf.json` declares two `windows[]` entries: `{ label: "launcher", width: 720, height: 560, resizable: false, maximizable: false, center: true, visible: true, ... }` and `{ label: "workspace", width: 1280, height: 800, resizable: true, minWidth, minHeight, visible: false, ... }`.
- `AC-150-02` — A new Rust module (`src-tauri/src/launcher.rs`) exposes Tauri commands keyed by window label that show / hide / focus / close the target window. Module is registered in `lib.rs` and its commands are added to `invoke_handler`. `cargo build` exits 0; `cargo test` for the new module's unit tests passes.
- `AC-150-03` — React entrypoint mounts `LauncherPage` when current window label is `launcher` and the existing workspace shell when it is `workspace`. `pnpm tsc --noEmit` exits 0; `pnpm vitest run` exits 0 (no regressions).
- `AC-150-04` — `src/__tests__/window-bootstrap.test.tsx` exists, was authored BEFORE the routing change (verifiable by git history showing the test commit precedes the production code commit, OR by the test failing against `git stash` of the production change), and asserts label-driven routing for both `launcher` and `workspace` labels.
- `AC-150-05` — `src/App.tsx` no longer routes top-level pages based on `appShellStore.screen`. Grep `useAppShellStore.*screen` in `App.tsx` returns no top-level routing usage (test seams may remain pending Sprint 154).
- `AC-150-06` — Phase 11 sprint-149's `window-lifecycle.ac141.test.tsx` (5 active `it()` + 5 `it.todo()` inside `describe.skip`) is unchanged. Counts: 5 passing + 5 todo, matching Sprint 149.

## Design Bar / Quality Bar

- Minimal scope cut: this sprint creates the WINDOW SHAPE only — no real navigation behavior or store sync.
- Workspace remains hidden at boot. Launcher is the only visible window after `pnpm tauri dev`.
- `LauncherPage` reuses the existing `HomePage` body — no UI redesign in this sprint.
- All new code paths have unit tests; no production code merges without a corresponding test.

## Verification Plan

### Required Checks

1. `pnpm vitest run` — exit 0; total ≥ 2244 + new tests added in this sprint; 5 todos retained.
2. `pnpm tsc --noEmit` — exit 0.
3. `pnpm lint` — exit 0.
4. `cargo build --manifest-path src-tauri/Cargo.toml` — exit 0.
5. `cargo test --manifest-path src-tauri/Cargo.toml` — exit 0.
6. Static inspection of `src-tauri/tauri.conf.json` — confirm both window entries with exact dimensions and resizable/maximizable/visible flags.
7. Grep verification of `src/App.tsx` — no top-level page routing on `appShellStore.screen`.

### Required Evidence

- Generator must provide:
  - Changed files with one-line purpose for each.
  - All commands above with their PASS/FAIL outcome and selected output (test counts, error if any).
  - Per-AC mapping: each AC line backed by a concrete artifact (file path + line, command output, or grep result).
  - Confirmation that `window-bootstrap.test.tsx` was authored before the routing change (commit ordering or red-then-green note).
- Evaluator must cite:
  - Concrete evidence per pass/fail decision (file path + lines or command output).
  - Any missing/weak evidence as a finding.

## Test Requirements

### Unit Tests (필수)
- `window-bootstrap.test.tsx`: at minimum 3 `it()` cases — (a) label `launcher` mounts launcher; (b) label `workspace` mounts workspace; (c) unknown label fallback (defensive — logs warning and falls back to launcher).
- Rust module: at least 2 `#[test]` cases for the new launcher commands (e.g. happy path + missing label error).

### Coverage Target
- New code: line coverage ≥ 70%.
- Existing thresholds (line 40 / func 40 / branch 35) unchanged.

### Scenario Tests (필수)
- [x] Happy path — launcher boot + workspace label routing.
- [x] 에러/예외 — unknown window label.
- [x] 경계 조건 — `getCurrentWebviewWindow()` returns null/undefined fallback.
- [x] 기존 기능 회귀 없음 — existing 2244 tests + 5 todos preserved.

## Test Script / Repro Script

1. `pnpm vitest run src/__tests__/window-bootstrap.test.tsx` — new test passes.
2. `pnpm vitest run` — full suite green; total ≥ 2244 + N new.
3. `pnpm tsc --noEmit` && `pnpm lint` — both 0.
4. `cargo test --manifest-path src-tauri/Cargo.toml` — green.
5. `grep -n "screen" src/App.tsx` — no top-level page routing references.
6. `cat src-tauri/tauri.conf.json | jq '.app.windows'` — two entries with correct dimensions.

## Ownership

- Generator: general-purpose Agent (single-attempt, foreground).
- Write scope: paths listed in "In Scope" only.
- Merge order: Sprint 150 must precede Sprint 151–155 (foundation).

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- All 7 required checks passing: `yes`.
- Per-AC evidence linked in `findings.md`.
- No new `it.skip` / `it.todo` introduced in this sprint.
