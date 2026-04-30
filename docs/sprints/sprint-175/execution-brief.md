# Sprint Execution Brief: sprint-175-01

## Objective

- Add a permanent, low-overhead boot-time instrumentation layer (frontend `performance.mark/measure` + Rust `info!` timestamps) and commit a numeric baseline report at `docs/sprints/sprint-175/baseline.md` covering four scenarios (`launcher-cold`, `launcher-warm`, `workspace-cold`, `workspace-warm`). No optimization in this sprint — instrumentation + baseline only.

## Task Why

- Every later sprint in this feature (Sprints 2 / 3 / 4 / 5) has performance acceptance criteria of the form "≥ X% improvement vs Sprint 1 baseline". Without the numbers committed in this sprint, those sprints cannot pass — they would devolve into "feels faster" claims, which the master spec explicitly forbids ("No vibes-based passes"). The instrumentation also persists in production so future regressions are observable from the running app's console, not "we'll re-run the benchmark".

## Scope Boundary

- IN: emit eight frontend milestones in `src/main.tsx` / `src/AppRouter.tsx` / `src/App.tsx`; emit two Rust timestamps in `src-tauri/src/lib.rs` and `src-tauri/src/commands/connection.rs`; one-line `boot()` summary log; deterministic measurement protocol; `baseline.md` with four scenario tables; instrumentation-overhead measurement.
- OUT: any change to `boot()` await ordering, any code-splitting or chunking, any change to mount-effect IPC fan-out, any change to loading-state UI, any dependency audit, any change to public Tauri command signatures, any change to `tauri.conf.json` window configuration.

## Invariants

- `boot()` await order in `src/main.tsx` is preserved exactly: `document.title` synchronous assignment → `bootTheme()` → `await initSession()` → `await import("@stores/connectionStore")` → `hydrateFromSession()` → fire-and-forget `bootWindowLifecycle()` → `ReactDOM.createRoot(...).render(...)`. The only permitted change inside `boot()` is wrapping each step with `performance.mark` calls.
- Sprint 173 alignment is preserved: `document.title` is still set synchronously in `src/main.tsx` before React mounts; no new await may move ahead of it.
- Multi-window contract (Phase 12) is untouched: launcher window remains visible from `tauri.conf.json`; workspace window remains hidden until `workspace_show`. Cross-window state sync (the five-store IPC bridge) is unchanged.
- Instrumentation persists in production builds. No feature flag gating it off in release.
- All currently-green Vitest tests, all currently-green E2E specs in `e2e/`, `pnpm tsc --noEmit`, and `pnpm lint` continue to pass.
- No new dependencies; only `performance.mark` / `performance.measure` on JS side and `std::time::Instant` + existing `tauri` log facade on Rust side.

## Done Criteria

1. `src/main.tsx` emits the milestones `theme:applied`, `session:initialized`, `connectionStore:imported`, `connectionStore:hydrated`, `react:render-called` at the natural points in `boot()`. T0 is captured at the top of `boot()` (before `bootTheme()`). A single structured one-line console summary is logged at end of `boot()` listing all milestones with millisecond deltas from T0; missing milestones appear as a literal gap token (e.g. `<missing>`), not silent omission.
2. `src/AppRouter.tsx` emits `react:first-paint` (from a render-time mark or `useLayoutEffect`) and `app:effects-fired` from `LauncherShell`'s mount effect after the five IPC actions have been dispatched.
3. `src/App.tsx` emits `app:effects-fired` from the workspace's mount effect after the same five IPC actions have been dispatched.
4. `src-tauri/src/lib.rs` emits an `info!` log line containing `rust:entry` at the top of `run()`.
5. `src-tauri/src/commands/connection.rs` (in `get_session_id`) emits an `info!` log line containing `rust:first-ipc` once, on the first invocation served. The delta `rust:first-ipc - rust:entry` is the "Tauri startup overhead" line item.
6. `docs/sprints/sprint-175/baseline.md` exists and contains:
   - A header block naming the host (`OS`, `CPU`, `RAM`), the build (`commit SHA`, `build mode` ∈ {`debug`, `release`}), and the `date`. All six fields filled with concrete values.
   - Four scenario sections: `launcher-cold`, `launcher-warm`, `workspace-cold`, `workspace-warm`. Each has a table with rows = milestones (the eight frontend milestones + the two Rust timestamps + end-to-end `T0 → app:effects-fired`) and columns = `median (ms)`, `p95 (ms)`, optional `notes`.
   - The protocol: cold = first launch after a reboot or after killing all `tauri-driver`/app processes and clearing the OS file cache where feasible; warm = launch immediately after a previous clean exit. Exact command per scenario. 5 trials, slowest dropped, median + p95 reported.
   - An "Instrumentation overhead" section reporting the warm-boot delta with vs without instrumentation, OR an explicit statement that the overhead is reported per-milestone so future sprints can subtract it.
   - A statement that these numbers are the contractual reference for Sprints 2 / 3 / 4 / 5.
7. Either `scripts/measure-startup.*` exists with a runnable trial harness, OR the protocol document inside `baseline.md` is itself deterministic enough to drive manually (the master spec allows the latter).
8. Unit test(s) added per the contract's Test Requirements: at minimum, one test that asserts the named milestones are recorded in `performance.getEntriesByName(...)` and one error-case test where a milestone is intentionally skipped and the gap token appears.

## Verification Plan

- Profile: `mixed` (command + static)
- Required checks:
  1. `pnpm tsc --noEmit` exits 0.
  2. `pnpm lint` exits 0.
  3. `pnpm test` exits 0; coverage thresholds hold.
  4. `pnpm build` exits 0 and emits `dist/`.
  5. `ls docs/sprints/sprint-175/baseline.md` succeeds.
  6. `grep -E "launcher-cold|launcher-warm|workspace-cold|workspace-warm" docs/sprints/sprint-175/baseline.md` returns ≥ 4 matches.
  7. `grep -E "OS|CPU|RAM|commit|build mode|date" docs/sprints/sprint-175/baseline.md` returns concrete values for all six (no placeholder strings).
  8. `grep` confirms each of the eight milestone strings appears in the file the contract assigns it to (`src/main.tsx`, `src/AppRouter.tsx`, `src/App.tsx`).
  9. `grep` confirms `rust:entry` in `src-tauri/src/lib.rs` and `rust:first-ipc` in `src-tauri/src/commands/connection.rs`.
  10. Diff inspection confirms `boot()` await ordering is unchanged.
- Required evidence:
  - Console summary line copied verbatim from one launcher-cold trial and one workspace-cold trial.
  - The two Rust log lines copied verbatim from one trial.
  - Instrumentation overhead number (or recorded justification per AC-175-01-05).

## Evidence To Return

- Changed files and purpose (one line per file).
- Outputs or pass/fail summary for `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Pointer to `docs/sprints/sprint-175/baseline.md` with confirmation all four scenario tables and all six host metadata fields are filled.
- Verbatim console summary line from a launcher-cold and a workspace-cold trial.
- Verbatim Rust `rust:entry` and `rust:first-ipc` log lines.
- Instrumentation-overhead measurement (or recorded alternative per AC-175-01-05).
- Done criteria coverage with cited evidence.
- Assumptions made during implementation (e.g. choice of `get_session_id` as the `rust:first-ipc` site, choice of `useLayoutEffect` vs render-time mark for `react:first-paint`).
- Residual risk or verification gaps (e.g. cold-boot file-cache clearing on macOS may require sudo `purge` — the protocol must document the workaround).

## References

- Contract: `docs/sprints/sprint-175/contract.md`
- Master spec: `docs/sprints/sprint-175/spec.md` (Sprint 1 section + Global Acceptance Criteria + Edge Cases)
- Frontend boot path: `src/main.tsx`, `src/AppRouter.tsx`, `src/App.tsx`
- Rust entry: `src-tauri/src/lib.rs`
- Rust IPC handler for `rust:first-ipc`: `src-tauri/src/commands/connection.rs` (function `get_session_id`)
- Docker E2E harness (for the cold-boot inside-container scenario): `e2e/run-e2e-docker.sh`, `Dockerfile.e2e`
- Testing convention: `.claude/rules/testing.md`, `memory/conventions/testing-scenarios/memory.md`
- Findings: (none — this is the opening sprint)
