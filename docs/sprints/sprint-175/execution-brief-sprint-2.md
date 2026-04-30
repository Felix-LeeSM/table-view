# Sprint Execution Brief: sprint-175-02

## Objective

- Attack the dominant Rust cold-start segment. The Sprint 1 baseline showed `rust:entry → rust:first-ipc` is **414ms median (debug build)** — about **96%** of the user-perceived blank window — versus only **18.5ms** for the entire JS-side path. Three sub-objectives, executed in this order:
  1. **Release-mode rebaseline** of `launcher-cold` (debug Rust runs 5–10× slower than release for CPU-bound code; the segment may collapse on its own).
  2. **Profile capture** of the `rust:entry → rust:first-ipc` region, identifying the top-3 self-time contributors.
  3. **Shrink** at least one top-3 contributor and re-measure to prove ≥ 30% (or ≥ 15% relaxed) improvement vs the release rebaseline — unless the rebaseline alone hit < 50ms, in which case the sprint passes via the explicit exit door without any code change.

## Task Why

- The original Sprint 2 (JS code-split chasing ≥ 20% on `T0 → react:first-paint`) targeted ~3ms savings on an 18ms path — below the noise floor. The Sprint 1 baseline document made the pivot explicit: 96% of perceived blank lives in Rust + WKWebView startup, so any sprint that does not move Rust startup is not moving the user-visible problem. This sprint is the first one where actual user-perceived TTI improves; Sprints 3/4/5 build on top of its post-shrinkage release rebaseline as their numeric reference.
- The exit door (AC-175-02-04, < 50ms case) exists because the debug→release multiplier is genuinely large for Tauri startup work. If a clean release build alone collapses the segment, the right answer is to record that fact and move on, not to invent a shrinkage to claim credit. The harness explicitly accepts "no code change required" as a valid sprint outcome here.

## Scope Boundary

- IN: append a `launcher-cold (release-mode, pre-sprint-2)` section to `baseline.md`; capture profile evidence (flamegraph SVG / Instruments `.trace` screenshot / `tracing::info_span!` breakdown) and commit it under `docs/sprints/sprint-175/rust-profile*`; apply at most one shrinkage in `src-tauri/src/lib.rs` and/or `src-tauri/src/commands/connection.rs` justified by the profile; append a `launcher-cold (release-mode, post-sprint-2)` section to `baseline.md`; add a Rust unit test for the shrinkage where meaningful.
- OUT: any change to `boot()` await ordering, JS-side parallelization, code-splitting / chunking, splash markup in `index.html`, mount-effect IPC fan-out behavior, loading-state UI, dependency audits, public Tauri command signatures, the existing `invoke_handler!` registration list (entries may be feature-gated but every command must remain reachable on a default build), `tauri.conf.json` window configuration, and the Sprint 1 instrumentation markers (which must still emit).

## Invariants

- **Every Tauri command in `lib.rs::run()`'s `invoke_handler!` list still works.** No command signature, parameter type, or return type changes. Smoke-test by mounting the launcher and confirming the five mount-effect IPC actions resolve.
- **Sprint 1 instrumentation persists.** `rust:entry` (in `src-tauri/src/lib.rs`) and `rust:first-ipc` (in `src-tauri/src/commands/connection.rs`) still emit at log level `info` post-shrinkage. The eight frontend milestones still emit.
- **Multi-window contract preserved.** Phase 12 launcher + workspace separation untouched. Sprint 173 `document.title` synchronous assignment in `src/main.tsx` unchanged.
- **JS path is regression-only.** `T0 → app:effects-fired` median may not lengthen vs the Sprint 1 baseline of 18.5ms (10% slack acceptable for trial noise; the Sprint 1 p95 was 21ms).
- **Build-tool invariants.** `pnpm build` produces `dist/`. `cargo clippy --all-targets --all-features -- -D warnings` passes. `cargo fmt --check` passes.
- **Profile-backed claims only.** Pure speculation ("I bet `AppState::new` is slow") without a flamegraph / Instruments screenshot / `tracing` breakdown is a hard fail per AC-175-02-02. Any claimed shrinkage cites a specific row from a committed profile artifact.
- **No new dependencies.** `cargo flamegraph` is dev-only and not added to `Cargo.toml`'s runtime deps. `tracing` is a transitive Tauri dep so its use is fine.
- **Same-host comparison only.** The pre-shrinkage release rebaseline and the post-shrinkage measurement come from the same host. Cross-host comparisons fail the spec's Edge Case 6.

## Done Criteria

1. **AC-175-02-01 satisfied.** `docs/sprints/sprint-175/baseline.md` carries an appended `launcher-cold (release-mode, pre-sprint-2)` section with concrete median + p95 values for at least the `rust:entry → rust:first-ipc` row and the `T0 → app:effects-fired` row, captured via `pnpm tauri build` + `scripts/measure-startup.sh launcher-cold` (5 trials, slowest dropped). The build recipe and the launch command are documented inline. Operator-required step; Generator scaffolds the section header + recipe text.
2. **AC-175-02-04 exit-door check.** The handoff explicitly states which path was taken:
   - **(a) "No work needed" exit door:** the release rebaseline `rust:entry → rust:first-ipc` median is < 50ms. Done criteria 3 and 4 are auto-waived. The handoff records the rebaseline numbers and declares the sprint complete; Sprint 3 becomes the first optimization sprint. **No code change required.** Skip to Done criterion 5.
   - **(b) ≥ 30% target:** the release rebaseline median is ≥ 100ms. Sprint 2 must shrink the segment by ≥ 30% from that baseline.
   - **(c) ≥ 15% relaxed target:** the release rebaseline median is between 50ms and 100ms. The relaxation is documented in the handoff with the rebaseline number; Sprint 2 must shrink the segment by ≥ 15% from that baseline.
3. **AC-175-02-02 satisfied (paths b and c only).** A profile artifact is committed at one of: `docs/sprints/sprint-175/rust-profile.md` (with linked SVG / PNG / TXT), `docs/sprints/sprint-175/rust-profile.svg`, `docs/sprints/sprint-175/rust-profile.trace.png`, or `docs/sprints/sprint-175/rust-profile-tracing.txt`. The artifact identifies the top 3 contributors by self-time within the `rust:entry → rust:first-ipc` region. Acceptable evidence shapes:
   - `cargo flamegraph` SVG (macOS may need sudo for dtrace).
   - Instruments.app Time Profiler `.trace` screenshot or summary table.
   - A `tracing::info_span!`-instrumented run with named segments (plugin init, `AppState::new()`, `generate_handler!`, `generate_context!`, window builder, etc.) and per-segment wall-clock deltas printed to stdout. **This is the lightest-weight option and is acceptable when sudo / Instruments are not available** — the spec explicitly permits it.
4. **AC-175-02-03 + AC-175-02-04 satisfied (paths b and c only).** A concrete shrinkage is applied in `src-tauri/src/lib.rs` and/or `src-tauri/src/commands/connection.rs` (or another `src-tauri/src/` site explicitly justified by the profile). The change preserves every command's public signature and the existing `invoke_handler!` registration list. A re-run of `scripts/measure-startup.sh launcher-cold` against the new release artifact appends a `launcher-cold (release-mode, post-sprint-2)` section to `baseline.md`, and the post-shrinkage `rust:entry → rust:first-ipc` median meets the threshold declared in Done criterion 2 (≥ 30% or ≥ 15%).
5. **AC-175-02-05 satisfied (all paths).**
   - Smoke test: a verbatim launcher webview console line is captured showing the five mount-effect IPC actions resolved post-shrinkage (or post-rebaseline for the exit-door path).
   - `pnpm test`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo fmt --check`, `pnpm tsc --noEmit`, `pnpm lint` all pass.
   - The post-shrinkage `T0 → app:effects-fired` median is ≤ 18.5ms × 1.10 (regression-only guard per Global AC #7).
   - The Sprint 1 markers (`rust:entry`, `rust:first-ipc`, the eight frontend milestones) all still emit.
6. A unit test covers the shrinkage where meaningful (paths b and c only). Example: if `AppState::new()` was refactored to lazy-init a field, a Rust unit test asserts the lazy field resolves to the same value as the eager path. If the change is plugin-init deferral that is not unit-testable, the handoff records the justification.

## Verification Plan

- Profile: `mixed` (command + browser + static)
- Required checks:
  1. `pnpm tsc --noEmit` exits 0.
  2. `pnpm lint` exits 0.
  3. `pnpm test` exits 0; coverage thresholds hold.
  4. `cargo clippy --all-targets --all-features -- -D warnings` exits 0 (from `src-tauri/`).
  5. `cargo fmt --check` exits 0 (from `src-tauri/`).
  6. `pnpm build` exits 0 and emits `dist/`.
  7. `pnpm tauri build` (or `cargo build --release`) exits 0. **Operator-required** — the harness sandbox cannot drive a `tauri build`.
  8. `docs/sprints/sprint-175/baseline.md` contains an appended `launcher-cold (release-mode, pre-sprint-2)` section with concrete values (not PENDING). Evaluator greps for the literal `release` token within a `launcher-cold` heading and inspects the table cells.
  9. Either (paths b/c) a profile artifact at `docs/sprints/sprint-175/rust-profile*` plus an appended `launcher-cold (release-mode, post-sprint-2)` section to `baseline.md`, OR (path a) an explicit handoff statement declaring the "no work needed" exit door with the rebaseline numbers shown.
  10. The post-shrinkage `rust:entry → rust:first-ipc` median meets the declared threshold (≥ 30% reduction from the AC-175-02-01 release rebaseline, or ≥ 15% relaxed, or "no work needed" exit door). Evaluator computes the delta percentage from the appended table cells.
  11. The post-shrinkage `T0 → app:effects-fired` median is ≤ 20.4ms (18.5ms × 1.10, the regression-only slack).
  12. `grep -E "rust:entry|rust:first-ipc"` in `src-tauri/src/lib.rs` and `src-tauri/src/commands/connection.rs` returns matches (Sprint 1 markers persist).
  13. `git diff src/main.tsx` shows `document.title` synchronous assignment is unchanged (Sprint 173 invariant).
  14. The launcher's mount-effect IPC fan-out smoke test resolved successfully — Generator provides a verbatim console line.
- Required evidence:
  - The pre-shrinkage release-rebaseline `rust:entry → rust:first-ipc` median (with all five trial values listed and the slowest declared dropped, matching the Sprint 1 protocol).
  - The post-shrinkage release `rust:entry → rust:first-ipc` median (same protocol) — unless exit-door path (a).
  - The computed delta percentage and the explicit declaration of which AC-175-02-04 path was taken.
  - The pre- and post-shrinkage `T0 → app:effects-fired` medians (regression-only guard evidence).
  - The profile artifact (committed file path) — unless exit-door path (a).
  - The shrinkage diff scope (changed files + a one-line summary of what was shrunk and why) — unless exit-door path (a).
  - A verbatim launcher webview console line showing the post-mount IPC fan-out resolved.
  - A clear labeling of which steps were operator-required (interactive Tauri build, sudo-required profiling, GUI window measurement) vs fully automatable.

## Evidence To Return

- Changed files and purpose (one line per file).
- Outputs or pass/fail summary for `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build`, `cargo clippy ...`, `cargo fmt --check`, and `cargo build --release` (or `pnpm tauri build`).
- Pointer to the appended `baseline.md` sections (release rebaseline pre and, if applicable, post-shrinkage).
- Pointer to the profile artifact(s) — unless exit-door path.
- Numeric medians: pre-shrinkage (release rebaseline) and post-shrinkage `rust:entry → rust:first-ipc`, plus pre- and post `T0 → app:effects-fired` (the JS regression-only guard).
- The computed AC-175-02-04 delta percentage and the declared path (≥ 30% / ≥ 15% relaxed / "no work needed").
- The verbatim launcher webview console line showing the connection list IPC fan-out resolved post-shrinkage (smoke-test evidence for AC-175-02-05).
- Done criteria coverage with cited evidence, including which Done criteria were auto-waived in the exit-door path.
- Assumptions made during implementation (e.g. choice of profiling tool, choice of which top-3 contributor to shrink, whether new `tracing::info_span!` calls are permanent or scheduled for removal in a follow-up sprint).
- Operator-vs-automatable step labeling so future sprints know which parts of this work are fully scriptable.
- Residual risk or verification gaps (e.g. "operator could only capture 3 trials instead of 5 — re-run with TRIALS=5 before Sprint 3 lands its handoff if the post-Sprint-2 delta is within noise"; the Sprint 1 baseline already set this precedent for `launcher-cold`).

## References

- Contract: `docs/sprints/sprint-175/contract-sprint-2.md`
- Master spec: `docs/sprints/sprint-175/spec.md` (Sprint 2 REVISED 2026-04-30 section + Global Acceptance Criteria + Edge Cases on debug-vs-release)
- Sprint 1 baseline (numeric reference): `docs/sprints/sprint-175/baseline.md` (especially the `launcher-cold` section, the "Key finding from launcher-cold" subsection, and the "Recommended spec pivot" subsection)
- Sprint 1 contract (for shape consistency): `docs/sprints/sprint-175/contract.md`
- Sprint 1 brief (for shape consistency): `docs/sprints/sprint-175/execution-brief.md`
- Rust entry: `src-tauri/src/lib.rs` (the `run()` function — primary shrinkage site)
- Rust first-IPC marker: `src-tauri/src/commands/connection.rs` (`get_session_id` — also a likely shrinkage site if `AppState::new()` is the bottleneck)
- Measurement script: `scripts/measure-startup.sh` (drives the five-trials-drop-slowest protocol)
- Frontend instrumentation (regression-guard surface): `src/lib/perf/bootInstrumentation.ts`, `src/main.tsx`, `src/AppRouter.tsx`, `src/App.tsx`
- Findings: (none — Sprint 1 closed clean; this is the first optimization sprint)
