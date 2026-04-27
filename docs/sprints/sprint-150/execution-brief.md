# Sprint Execution Brief: sprint-150 — Two-Window Foundation

## Objective

Replace the single-window Tauri config with launcher (720×560 fixed) + workspace (1280×800 resizable) windows, and route the React entrypoint by current `WebviewWindow.label` so `launcher` mounts the new `LauncherPage` and `workspace` mounts the existing workspace shell. TDD-first label-routing test in vitest.

## Task Why

Phase 11 ended with ADR 0011's single-window stub and 5 deferred `it.todo()` invariants gated by RISK-025. Phase 12 closes that ticket; Sprint 150 lays the structural floor (real two-window manifest + label-aware routing) without touching cross-window state sync, lifecycle wiring, or test conversion (those land in 151–155). Without this floor, every later sprint blocks.

## Scope Boundary

- **DO**: declare two `windows[]` entries in `tauri.conf.json`; create `launcher.rs` Rust module + register commands in `lib.rs`'s `invoke_handler`; create `LauncherPage.tsx` (rendering existing `HomePage` body); add label-aware mount in `main.tsx` (or new `AppRouter.tsx`); strip top-level page routing from `App.tsx`'s `appShellStore.screen`; add `window-bootstrap.test.tsx` BEFORE the routing change.
- **DO NOT**: wire any cross-window store sync (Sprint 151); modify `connectionStore.ts` (Sprint 152); modify other stores (153); add real lifecycle calls — `workspace.show()`/`launcher.hide()` hookups belong to Sprint 154; touch the 5 `it.todo()` in `window-lifecycle.ac141.test.tsx` (Sprint 155); edit ADR 0011 body or `RISKS.md` RISK-025 row (Sprint 155).

## Invariants

- Existing 2244 vitest tests + 5 todos must remain green/pending exactly as Sprint 149 left them.
- ADR 0011 body is FROZEN — no edits.
- `connection-sot.ac142.test.tsx` AC-142-* invariants unchanged.
- macOS e2e remains deferred (RISK-020) — vitest + WebviewWindow mock is the only verification surface in this sprint.
- TDD strict: `window-bootstrap.test.tsx` is authored BEFORE production routing change. The test commit must precede or co-arrive with the production change in a way that demonstrates the red-then-green cycle (e.g. include both commits or a note).

## Done Criteria

1. `tauri.conf.json` declares both window entries with exact specs (launcher 720×560 fixed, workspace 1280×800 resizable + minWidth/minHeight, workspace `visible: false`).
2. `launcher.rs` module registered in `lib.rs`; `cargo build` and `cargo test` exit 0; module unit tests cover at least happy + error path.
3. React entrypoint routes by label; `pnpm vitest run` and `pnpm tsc --noEmit` exit 0; no regression.
4. `window-bootstrap.test.tsx` exists with ≥ 3 cases (launcher / workspace / fallback), authored TDD-first.
5. `src/App.tsx` no longer routes top-level pages on `appShellStore.screen`.
6. `window-lifecycle.ac141.test.tsx` count unchanged (5 active + 5 todo).
7. `pnpm lint` exit 0.

## Verification Plan

- **Profile**: mixed (command + static)
- **Required checks**:
  1. `pnpm vitest run` — exit 0; total ≥ 2244 + N new.
  2. `pnpm tsc --noEmit` — exit 0.
  3. `pnpm lint` — exit 0.
  4. `cargo build --manifest-path src-tauri/Cargo.toml` — exit 0.
  5. `cargo test --manifest-path src-tauri/Cargo.toml` — exit 0.
  6. Static: `tauri.conf.json` has both window entries with exact dimensions/flags.
  7. Grep: `App.tsx` has no top-level page routing on `useAppShellStore` `.screen`.
- **Required evidence**:
  - Per-AC mapping (file path + line, or command output, or grep result).
  - Test count delta proof (Sprint 149 baseline = 2244 + 5 todo).
  - TDD ordering note (test red before code, then green).

## Evidence To Return

- Changed files with one-line purpose each.
- Commands run + outcomes (PASS/FAIL + key counts).
- AC-150-01 through AC-150-06 mapping with concrete artifacts.
- Assumptions made.
- Residual risks / verification gaps.

## References

- Contract: `docs/sprints/sprint-150/contract.md`
- Master spec: `docs/sprints/sprint-150/spec.md`
- Phase 11 closing findings: `docs/sprints/sprint-149/findings.md`
- ADR (frozen): `memory/decisions/0011-single-window-stub-for-launcher-workspace/memory.md`
- RISK-025 (deferred → resolved in Sprint 155): `docs/RISKS.md`
- Existing baseline test: `src/__tests__/window-lifecycle.ac141.test.tsx`
- Conventions: `memory/conventions/memory.md`
- Architecture: `memory/architecture/memory.md`
- Skip-zero gate (lesson): `memory/lessons/2026-04-27-phase-end-skip-accountability-gate/memory.md`
