# Sprint Contract: sprint-175-01

## Summary

- Goal: Instrument the Tauri + React boot path end-to-end and commit a numeric baseline report (`baseline.md`) that every later optimization sprint will cite. No optimizations land in this sprint — only measurement infrastructure and the recorded baseline.
- Audience: Generator agent (Sprint 1 of harness workflow); Evaluator agent verifying Sprint 1 deliverables; Sprint 2/3/4/5 sprints which will read `baseline.md` as their numeric reference.
- Owner: Generator (implements instrumentation + protocol + baseline). Evaluator runs the deterministic checks below.
- Verification Profile: `mixed` (command + static)

## In Scope

- Add named `performance.mark` / `performance.measure` calls for the eight frontend milestones at the points named in AC-175-01-02:
  - `T0` (script entry, top of `src/main.tsx`)
  - `theme:applied` (after `bootTheme()` returns)
  - `session:initialized` (after `await initSession()` resolves)
  - `connectionStore:imported` (after `await import("@stores/connectionStore")` resolves)
  - `connectionStore:hydrated` (after `hydrateFromSession()` returns)
  - `react:render-called` (immediately before `ReactDOM.createRoot().render(...)`)
  - `react:first-paint` (first commit — emitted from `AppRouter.tsx` via a render-time mark or `useLayoutEffect`)
  - `app:effects-fired` (emitted from `App.tsx`'s workspace mount-effect and `LauncherShell`'s launcher mount-effect once the five IPC actions have been dispatched)
- Emit a single one-line console summary at the end of `boot()` listing every milestone with a millisecond delta from `T0`. Missing milestones must be visible as gaps (literal token, not silent omission).
- Add two Rust-side timestamps in `src-tauri/src/lib.rs` (`rust:entry` at the top of `run()`) and inside the first IPC handler served (`rust:first-ipc` — the natural site is `commands::connection::get_session_id`). Emit via `info!` (or equivalent log line that survives a release build's stdout) so the delta is computable from logs.
- Author a deterministic measurement protocol document (either in `baseline.md` itself or in `scripts/measure-startup.*`) that defines cold vs warm, the exact invocation per scenario, the trial count (5), the slowest-trial drop rule, and the metrics reported (median + p95).
- Run the protocol on the developer's macOS dev box and inside the Docker E2E container. Commit `docs/sprints/sprint-175/baseline.md` with four scenario tables: `launcher-cold`, `launcher-warm`, `workspace-cold`, `workspace-warm`. Each table reports per-milestone median + p95, plus end-to-end (`T0 → app:effects-fired`).
- Bound instrumentation overhead per AC-175-01-05: report a measured delta vs an instrumentation-disabled build on the warm-boot scenario, OR record the overhead alongside the baseline numbers so future sprints can subtract it.

## Out of Scope

- Any change to `boot()` await order, parallelization, or dynamic-import elimination. Those are Sprint 3.
- Any chunking / code-splitting work. That is Sprint 2.
- Any change to mount-effect IPC fan-out behavior, loading-state UI, or skeleton rendering. That is Sprint 4.
- Any dependency audit or chunk-size investigation. That is Sprint 5 (stretch).
- Any change to the public Tauri command signatures. The `rust:first-ipc` mark is recorded inside the existing `get_session_id` body; the command's parameters and return type stay untouched.
- Any change to `tauri.conf.json` window configuration (visibility, size, label). The instrumentation must report `T0` from script entry, NOT from window creation, so the user-visible blank period is honestly attributed to "Tauri startup overhead".

## Invariants

- **No regression on existing functionality.** All currently-green Vitest tests, all currently-green E2E specs in `e2e/`, `pnpm tsc --noEmit`, and `pnpm lint` continue to pass at the end of this sprint.
- **Multi-window contract preserved.** Phase 12's launcher + workspace `WebviewWindow` separation is untouched. The Sprint 173 alignment of the OS window title and `document.title` is preserved — `document.title` is still set synchronously in `src/main.tsx` *before* React mounts, *before* any new instrumentation can defer it. Cross-window state sync is unchanged.
- **Measurement persists in production builds.** Per-stage timings remain emitted in production builds (gated to a low-overhead path — `performance.mark` is acceptable; `console.log`-spam per milestone is not). Future regressions must be observable from the running app's console without rebuilding with debug flags.
- **Build-tool invariants.** `pnpm build` still produces a `dist/` directory the existing `tauri.conf.json` can serve. Chunk filenames may differ but no `index.html`-level reference is broken.
- **Boot semantics unchanged.** The await ordering in `boot()` is identical before and after this sprint. Adding a `performance.mark` is the only permitted shape of change inside `boot()`. No await is removed, added, or reordered.
- **Testing discipline.** Every code change carries a corresponding test or a recorded justification in the handoff for why a test is not applicable.

## Acceptance Criteria

- `AC-175-01-01`: Reproducible measurement protocol exists, runnable on macOS dev box and Docker E2E container; defines cold vs warm, exact commands per scenario, ≥ 5 trials per scenario, slowest dropped, median + p95 reported.
- `AC-175-01-02`: Frontend boot path emits the eight named milestones (`T0`, `theme:applied`, `session:initialized`, `connectionStore:imported`, `connectionStore:hydrated`, `react:render-called`, `react:first-paint`, `app:effects-fired`) observable via `performance.getEntriesByType("measure")` and via a single one-line `boot()` summary; missing milestones are visible as gaps, not silent.
- `AC-175-01-03`: Rust side emits at least two timestamps — `rust:entry` (top of `run()` in `src-tauri/src/lib.rs`) and `rust:first-ipc` (inside the first IPC handler served, natural candidate `get_session_id`) — with the delta reported as the "Tauri startup overhead" line item.
- `AC-175-01-04`: `docs/sprints/sprint-175/baseline.md` exists and reports per-milestone median + p95 timings for four scenarios (`launcher-cold`, `launcher-warm`, `workspace-cold`, `workspace-warm`); names the host (OS / CPU / RAM), the build (commit SHA, debug vs release), and the date. This is the contractual reference for Sprints 2 / 3 / 4 / 5.
- `AC-175-01-05`: Instrumentation overhead is itself measured and bounded: an instrumentation-enabled build is within 2% of an instrumentation-disabled build on warm boot, OR the overhead cost is reported alongside the baseline numbers so future sprints don't conflate instrumentation with regression.

## Design Bar / Quality Bar

- Instrumentation primitives use the platform's standard APIs: `performance.mark` and `performance.measure` on the JS side; `std::time::Instant` (or equivalent) plus the existing `tauri` log facade on the Rust side. No new dependencies introduced.
- The single `boot()` summary is one log line. It is structured (e.g. `[boot] T0=0 theme:applied=2 session:initialized=140 ...`) so a future regression-detection script can parse it without HTML scraping.
- The Rust side's two timestamps are emitted at log level `info` (NOT `debug`) so they survive a release build's default log filter.
- `baseline.md` is a markdown document with one table per scenario. Each table has columns: `milestone`, `median (ms)`, `p95 (ms)`, optional `notes`. The host / build / date fields are listed as a header block above the tables and are NOT empty placeholders — Generator must fill them.
- `baseline.md` explicitly states that its numbers are the contractual reference for Sprints 2 / 3 / 4 / 5. The host fields that must be filled are: `OS`, `CPU`, `RAM`, `commit SHA`, `build mode` (`debug` or `release`), `date`. A baseline missing any of these fields fails AC-175-01-04.
- Instrumentation code is not gated behind a feature flag. It must run in production builds (Invariant: measurement persists). The "instrumentation-disabled" build referenced in AC-175-01-05 may be produced by a temporary local revert for the overhead measurement; it is not a permanent code path.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` exits 0.
2. `pnpm lint` exits 0 with no errors.
3. `pnpm test` (Vitest) exits 0; coverage thresholds (line 40%, function 40%, branch 35%) hold.
4. `pnpm build` exits 0 and produces `dist/`.
5. `docs/sprints/sprint-175/baseline.md` exists.
6. `baseline.md` contains four scenario tables. Evaluator greps for the literal scenario labels: `launcher-cold`, `launcher-warm`, `workspace-cold`, `workspace-warm` — each must appear at least once.
7. `baseline.md` contains the host metadata fields: `OS`, `CPU`, `RAM`, `commit SHA` (or `commit`), `build mode` (or `build`), `date`. Evaluator greps for each label.
8. `src/main.tsx` contains the literal milestone strings: `theme:applied`, `session:initialized`, `connectionStore:imported`, `connectionStore:hydrated`, `react:render-called`. Evaluator runs `grep -n "<milestone>" src/main.tsx` for each.
9. `src/AppRouter.tsx` contains the literal milestone string `react:first-paint` and dispatches `app:effects-fired` from `LauncherShell`'s mount effect (grep for both literals in `src/AppRouter.tsx`).
10. `src/App.tsx` contains the literal milestone string `app:effects-fired` (grep `src/App.tsx`).
11. `src-tauri/src/lib.rs` contains the literal token `rust:entry` (grep).
12. A Tauri command file (the natural candidate is `src-tauri/src/commands/connection.rs`, where `get_session_id` lives) contains the literal token `rust:first-ipc` (grep).
13. Static check that `boot()` await order in `src/main.tsx` is preserved: `bootTheme` precedes `await initSession`, which precedes `await import("@stores/connectionStore")`, which precedes `hydrateFromSession()`, which precedes `ReactDOM.createRoot(...).render(...)`. Evaluator inspects diff.
14. Static check that `document.title` is still assigned synchronously in `src/main.tsx` before any new awaits or React mount calls (Sprint 173 invariant).

### Required Evidence

- Generator must provide:
  - Changed files with one-line purpose per file.
  - Outputs (or pass/fail summary) of `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build`.
  - A pointer to `docs/sprints/sprint-175/baseline.md` and confirmation that all four scenarios' tables are populated and all six host metadata fields are filled.
  - The console summary line copied verbatim from one launcher cold-boot trial and one workspace cold-boot trial, demonstrating the eight milestones are present.
  - The two Rust log lines (`rust:entry` and `rust:first-ipc`) copied verbatim from one trial, demonstrating both timestamps emit.
  - The instrumentation-overhead measurement: a number (or band) representing the warm-boot delta with vs without instrumentation, OR a recorded justification per AC-175-01-05's second clause.
- Evaluator must cite:
  - Concrete grep / command output for each pass / fail decision in Required Checks.
  - Any missing or weak evidence as a finding (e.g. only three of four scenario tables filled → P1 finding).
  - Whether `baseline.md`'s host fields are filled with concrete values or placeholder strings (placeholders fail AC-175-01-04).

## Test Requirements

### Unit Tests (필수)
- One test per AC where a unit test is meaningful:
  - AC-175-01-02: a test that mounts `<AppRouter />` in a JSDOM harness with `performance.mark` stubbed, asserts the `react:first-paint` mark is recorded, and asserts the eight milestone names appear in `performance.getEntriesByName(...)` after `boot()`-equivalent setup runs. (If full `boot()` is hard to drive in JSDOM, split into per-component assertions.)
  - AC-175-01-03 is exercised by an integration check (Rust unit test of the timestamp emission point or a recorded log capture in the baseline evidence).
- Error / exception case: a test asserting that a missing milestone is surfaced as a gap token in the summary line (not a silent skip).

### Coverage Target
- New / modified code: line ≥ 70% recommended.
- CI overall: line ≥ 40%, function ≥ 40%, branch ≥ 35%.

### Scenario Tests (필수)
- [ ] Happy path: launcher cold-boot produces all eight milestones in order; summary line is parseable.
- [ ] Error / exception: if `initSession()` rejects, the existing `console.error("[main] boot failed")` path still fires and any milestones emitted before the rejection are still observable in `performance.getEntriesByType("measure")`.
- [ ] Boundary: `performance.mark` called twice with the same name does not throw and the latest entry is used (or the first — either is acceptable, but the behavior is documented).
- [ ] No regression: existing E2E spec covering launcher → workspace handoff still passes (`e2e/connection-switch.spec.ts` or `e2e/home-workspace-swap.spec.ts`).

## Test Script / Repro Script

1. `pnpm install` (if needed).
2. `pnpm tsc --noEmit && pnpm lint && pnpm test && pnpm build` — all four exit 0.
3. `ls docs/sprints/sprint-175/baseline.md` — file exists.
4. `grep -E "launcher-cold|launcher-warm|workspace-cold|workspace-warm" docs/sprints/sprint-175/baseline.md` — at least four matches.
5. `grep -E "OS|CPU|RAM|commit|build mode|date" docs/sprints/sprint-175/baseline.md` — at least six matches with concrete values, not placeholder strings.
6. `grep -n "theme:applied\|session:initialized\|connectionStore:imported\|connectionStore:hydrated\|react:render-called" src/main.tsx` — five matches.
7. `grep -n "react:first-paint\|app:effects-fired" src/AppRouter.tsx` — two matches.
8. `grep -n "app:effects-fired" src/App.tsx` — one match.
9. `grep -n "rust:entry" src-tauri/src/lib.rs` — one match.
10. `grep -rn "rust:first-ipc" src-tauri/src/commands/` — one match.
11. Manually launch the app under macOS (`pnpm tauri dev` for sanity, then a `pnpm tauri build` artifact for the official numbers) and confirm one console summary line appears at end of `boot()` with all eight milestones.
12. Re-run inside the Docker E2E container per `e2e/run-e2e-docker.sh` and confirm the same summary structure prints (numbers will differ — that is expected and is exactly why both hosts are baselined).

## Ownership

- Generator: implements instrumentation across `src/main.tsx`, `src/AppRouter.tsx`, `src/App.tsx`, `src-tauri/src/lib.rs`, and one Tauri command file (`src-tauri/src/commands/connection.rs` for `rust:first-ipc`). Authors `docs/sprints/sprint-175/baseline.md` and (optionally) `scripts/measure-startup.*`. Adds unit test(s) per Test Requirements.
- Write scope: the files listed above plus `docs/sprints/sprint-175/baseline.md`. No changes to `tauri.conf.json`, `vite.config.ts`, store implementations, or page components. No changes to `boot()` await ordering.
- Merge order: Sprint 1 lands as a single commit (or a small commit series) before any Sprint 2 work begins. Sprints 2 / 3 / 4 / 5 read `baseline.md` as their numeric reference and may not start until this sprint's Exit Criteria are met.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
- `docs/sprints/sprint-175/baseline.md` is committed with all four scenario tables populated and all six host metadata fields (OS, CPU, RAM, commit SHA, build mode, date) filled with concrete values. These numbers are the contractual reference for Sprints 2 / 3 / 4 / 5; downstream sprints will fail their performance ACs if they cannot cite a row from this file.
