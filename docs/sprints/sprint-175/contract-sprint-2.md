# Sprint Contract: sprint-175-02

## Summary

- Goal: Attack the dominant Rust cold-start segment (`rust:entry → rust:first-ipc` = 414ms median in the Sprint 1 debug baseline, ~96% of perceived blank window). Step 1: rebaseline `launcher-cold` in release mode (debug Rust is 5–10× slower than release for CPU-bound work, so the segment may already collapse). Step 2: if the segment is still meaningful, capture a profile, identify the top 3 self-time contributors, and apply at least one shrinkage backed by the profile evidence. Step 3: re-measure and prove the segment dropped by ≥ 30% (or ≥ 15% if the release rebaseline alone reduced the segment below 100ms; or "no work needed" if the release rebaseline alone hit < 50ms).
- Audience: Generator agent (Sprint 2 of harness workflow); Evaluator agent verifying Sprint 2 deliverables; Sprint 3/4/5 sprints which will read the appended `baseline.md` rows as their numeric reference for the new target build mode (release).
- Owner: Generator (prepares release-rebaseline recipe + runnable scaffolding, captures profile, applies shrinkage, re-measures). Operator runs the interactive `pnpm tauri build` and `scripts/measure-startup.sh` passes on a real macOS host because the harness sandbox cannot drive a GUI Tauri build. Evaluator runs the deterministic checks below.
- Verification Profile: `mixed` (command + browser + static)
  - command: `cargo clippy`, `cargo fmt --check`, `pnpm test`, `pnpm tsc --noEmit`, `pnpm lint`, `pnpm build`, `cargo build --release` (or `pnpm tauri build`).
  - browser: re-running the Sprint 1 measurement protocol via `scripts/measure-startup.sh launcher-cold` against the release binary to harvest the post-shrinkage `rust:entry → rust:first-ipc` median.
  - static: profile artifact (flamegraph SVG / Instruments `.trace` screenshot / `tracing` span breakdown table) committed to the sprint folder; appended `baseline.md` rows; diff inspection of `lib.rs` / `connection.rs`.

## In Scope

- **AC-175-02-01 — Release rebaseline.** Document a release-mode build + measurement recipe; append a `launcher-cold (release-mode)` table to `docs/sprints/sprint-175/baseline.md` using the same five-trials-drop-slowest protocol from Sprint 1. The Generator may scaffold the table headers, the build recipe, and the `scripts/measure-startup.sh` invocation; numeric population requires interactive operator execution. The other three scenarios (`launcher-warm`, `workspace-cold`, `workspace-warm`) MAY be rebaselined for completeness but are not required for sprint pass/fail — `launcher-cold` is the gate.
- **AC-175-02-02 — Profile capture.** Capture profiling evidence covering the `rust:entry → rust:first-ipc` region from a release build and commit it to the sprint folder (e.g. `docs/sprints/sprint-175/rust-profile.md` plus `rust-profile.svg` / `rust-profile.trace.png` / a `tracing` breakdown table). Identify the top 3 contributors by self-time. Acceptable evidence shapes (Generator chooses based on what the operator's host can produce):
  - `cargo flamegraph` SVG (macOS may need sudo for dtrace — if unavailable, fall back to the next option).
  - `Instruments.app → Time Profiler` `.trace` screenshot or summary table.
  - `tracing::info_span!` instrumentation added inside `run()` to break the 414ms into named segments (plugin init, `AppState::new`, `generate_handler!`, `generate_context!`, window builder, etc.) plus a captured run printing per-segment deltas. This is the lightest-weight option and is acceptable when sudo / Instruments are not available.
- **AC-175-02-03 — Shrinkage.** At least one of the top-3 contributors is shrunk via a concrete code change in `src-tauri/`. Likely shapes (Generator chooses based on profile evidence): lazy-init `AppState` fields not needed before first IPC; defer non-critical plugin init (e.g. `tauri-plugin-shell` if not invoked during cold boot); reduce the `generate_handler!` macro footprint by feature-gating handlers unreachable on launcher-cold. The change must preserve every existing command's public signature and `invoke_handler!` registration list.
- **AC-175-02-04 — Re-measure and meet the target.** Re-run the Sprint 1 protocol against the release binary after the shrinkage and append a second `launcher-cold (release-mode, post-sprint-2)` row to `baseline.md`. Pass condition: the `rust:entry → rust:first-ipc` median drops by ≥ 30% vs the AC-175-02-01 release rebaseline. Relaxation: ≥ 15% if the release rebaseline alone (i.e. before any code change) reduced the segment below 100ms; the relaxation must be documented with the measured numbers in the sprint handoff (no silent re-targeting). **Exit door:** if the release rebaseline alone shows the segment < 50ms, the sprint passes by recording that fact in the handoff with the measured numbers and Sprint 3 becomes the first optimization sprint. **No code change is required in this exit-door path.** The exit door is selected by data, not by Generator preference.
- **AC-175-02-05 — Behavior preserved.** Every Tauri command in `lib.rs::run()`'s `invoke_handler!` list still works. Smoke test: mount the launcher and confirm the connection list IPC fan-out resolves (the five mount-effect actions all complete normally). Plus: `pnpm test`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo fmt --check`, `pnpm tsc --noEmit`, `pnpm lint` all pass. JS-side `T0 → app:effects-fired` is unchanged or improves vs the Sprint 1 baseline of 18.5ms median (regression-only guard per Global AC #7 — Sprint 2 must not lengthen the JS path).

## Out of Scope

- Any change to `boot()` await ordering or JS-side parallelization. That was the discarded original Sprint 3 and is not revived here.
- Any code-splitting / chunking work on the JS bundle. That was the discarded original Sprint 2 and is not revived here.
- Any pre-paint splash markup in `index.html`. That is the revised Sprint 3.
- Any change to mount-effect IPC fan-out behavior, loading-state UI, or skeleton rendering. That is Sprint 4.
- Any dependency audit or chunk-size investigation. That is Sprint 5 (stretch).
- Any change to the public Tauri command signatures. The `invoke_handler!` registration list may be reordered or have entries feature-gated, but every existing command must still be reachable on a default build.
- Any change to `tauri.conf.json` window configuration (visibility, size, label). The launcher window must remain visible-immediately so the Sprint 3 splash work can build on top of it.
- Removal or no-op replacement of the Sprint 1 instrumentation. Both `rust:entry` and `rust:first-ipc` must still emit; their delta is the very metric this sprint moves.

## Invariants

- **All `invoke_handler!`-registered commands keep working.** No command signature, parameter type, or return type changes. The smoke test in AC-175-02-05 is the contractual verification.
- **Measurement layer persists.** The Sprint 1 instrumentation in `src/main.tsx`, `src/AppRouter.tsx`, `src/App.tsx`, `src-tauri/src/lib.rs`, and `src-tauri/src/commands/connection.rs` must remain — its eight frontend milestones plus two Rust timestamps still emit in the post-sprint binary. New `tracing::info_span!` instrumentation may be added for profiling but must not displace the existing `rust:entry` / `rust:first-ipc` markers.
- **Multi-window contract preserved.** Phase 12's launcher + workspace `WebviewWindow` separation is untouched. Sprint 173's synchronous `document.title` assignment remains. Cross-window state sync (the five-store IPC bridge) is unchanged.
- **JS path is regression-only.** `T0 → app:effects-fired` median may not lengthen vs the Sprint 1 baseline of 18.5ms. Improvements are welcome but not required.
- **Build-tool invariants.** `pnpm build` still produces a `dist/` directory that `tauri.conf.json` (`frontendDist: "../dist"`) serves. `cargo clippy --all-targets --all-features -- -D warnings` and `cargo fmt --check` continue to pass.
- **No vibes-based passes.** Every claimed shrinkage must be backed by profiling evidence committed to the sprint folder. The sentence "I bet `AppState::new` is slow" without a flamegraph / Instruments screenshot / `tracing` breakdown is a hard fail per AC-175-02-02.
- **Same-host comparison.** The pre-shrinkage release rebaseline and the post-shrinkage measurement must come from the same host. Cross-host comparisons (macOS dev box vs Docker E2E container) are not valid pass/fail evidence per the spec's Edge Case 6.
- **No new IPC commands.** No new persisted state. No new Zustand stores. The shrinkage is a refactor of existing initialization, not new functionality.
- **Testing discipline.** Every code change in `src-tauri/` carries a corresponding test where one is meaningful (e.g. lazy-init refactor of an `AppState` field gets a unit test asserting the field still resolves to the expected value on first access). If a change is not unit-testable (e.g. plugin registration order), the handoff must record the justification.

## Acceptance Criteria

- `AC-175-02-01`: A release-mode rebaseline of `launcher-cold` is appended to `baseline.md` using the same five-trial-drop-slowest protocol from Sprint 1. The build recipe (`pnpm tauri build` + how to launch the resulting binary + how to capture the `[boot]` summary line and Rust log lines) is documented inline in the appended section. All four scenarios may be rebaselined for completeness, but `launcher-cold` is the only required scenario for this sprint's gate.
- `AC-175-02-02`: A profile of the `rust:entry → rust:first-ipc` region is captured from a release build and committed to the sprint folder. The profile must identify the top 3 contributors by self-time (likely candidates per the spec: `tauri::Builder::default()` plugin init, `AppState::new()`, `tauri::generate_context!()`, WKWebView spawn, bundle parse). The Generator may not "guess" — the profile artifact must back the claim. Acceptable shapes: flamegraph SVG, Instruments `.trace` screenshot, or a `tracing::info_span!`-instrumented run with per-segment deltas printed to stdout and captured in `rust-profile.md`.
- `AC-175-02-03`: At least one of the top-3 contributors identified in AC-175-02-02 is shrunk via a concrete code change in `src-tauri/`. The change preserves every command's public signature and the existing `invoke_handler!` registration list (or all reachable commands remain reachable on the default build, with feature-gating documented).
- `AC-175-02-04`: Measured against the AC-175-02-01 release rebaseline on the same host and same build mode, the `rust:entry → rust:first-ipc` median decreases by ≥ 30%. Relaxation to ≥ 15% if the release rebaseline alone reduced the segment below 100ms — the relaxation is documented in the handoff with the numbers. **Exit door:** if the release rebaseline alone shows the segment < 50ms, the sprint passes by recording that fact in the handoff with measured numbers — no code change required, AC-175-02-02 / AC-175-02-03 are auto-waived for this exit, and Sprint 3 becomes the first optimization sprint. The handoff must explicitly state which path was taken (≥ 30%, ≥ 15% relaxed, or "no work needed") with the supporting numbers.
- `AC-175-02-05`: Existing behavior preserved — every `invoke_handler!`-registered Tauri command still works (smoke-test by mounting the launcher and confirming the five mount-effect IPC actions resolve). `pnpm test`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo fmt --check`, `pnpm tsc --noEmit`, `pnpm lint` all pass. JS-side `T0 → app:effects-fired` is unchanged or improves vs the 18.5ms Sprint 1 baseline (regression-only guard per Global AC #7).

## Design Bar / Quality Bar

- Profiling evidence is committed as a checked-in artifact, not a screenshot pasted into a chat message that disappears. Acceptable file locations: `docs/sprints/sprint-175/rust-profile.md` (narrative + linked image) plus one of `rust-profile.svg`, `rust-profile.trace.png`, or `rust-profile-tracing.txt` alongside it.
- The release rebaseline appended to `baseline.md` matches the existing `launcher-cold` table shape: same milestone column, same `median (ms)` / `p95 (ms)` / `notes` columns, plus a header row identifying the build mode (`release` not `debug`) and the date. The appended section is a sibling of the existing `launcher-cold` section, not a replacement — the original debug numbers stay so future readers can reconstruct the pivot history.
- The shrinkage is the *minimum* change that moves the metric. The Generator does NOT bundle multiple optimizations into a single sprint; one well-justified shrinkage tied to one profile finding is the target. Additional opportunities are recorded in the handoff for follow-up sprints.
- The exit-door path is honored honestly. If the release rebaseline alone shows the segment under 50ms, the Generator does NOT speculatively apply a shrinkage to claim more credit. The handoff records the rebaseline numbers and declares the sprint complete; Sprint 3 picks up the next bottleneck.
- New Rust profiling instrumentation (`tracing::info_span!` calls) added solely for AC-175-02-02 may remain in the codebase if it carries ongoing diagnostic value, but the sprint handoff must call out whether it is permanent or scheduled for removal. The Sprint 1 markers (`rust:entry`, `rust:first-ipc`) are permanent regardless.
- The smoke test for AC-175-02-05 is operator-verified, not unit-test-only: a unit test of `AppState::new()` does not prove the launcher's connection list IPC fan-out actually resolves end-to-end. The handoff must record a verbatim line from the launcher's webview console showing the post-mount IPC results landing.
- No new dependencies are introduced. `cargo flamegraph` is allowed as a dev-only tool (not added to `Cargo.toml`'s runtime deps); `tracing` is already a transitive dep of Tauri so its use does not require a new direct dep.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` exits 0.
2. `pnpm lint` exits 0 with no errors.
3. `pnpm test` (Vitest) exits 0; coverage thresholds (line 40%, function 40%, branch 35%) hold.
4. `cargo clippy --all-targets --all-features -- -D warnings` exits 0 (run from `src-tauri/`).
5. `cargo fmt --check` exits 0 (run from `src-tauri/`).
6. `pnpm build` exits 0 and produces `dist/`.
7. `cargo build --release` (or `pnpm tauri build`) exits 0 — required because the AC-175-02-01 rebaseline runs against a release artifact.
8. `docs/sprints/sprint-175/baseline.md` contains an appended `launcher-cold (release-mode)` section with concrete median + p95 values for at least the `rust:entry → rust:first-ipc` row and the `T0 → app:effects-fired` row. Evaluator greps for the literal `release` token within a `launcher-cold` heading.
9. `docs/sprints/sprint-175/baseline.md` contains a second appended row or section recording the post-shrinkage `rust:entry → rust:first-ipc` median, OR (exit-door path) an explicit prose statement that the release rebaseline alone met the < 50ms exit-door threshold and no shrinkage was needed. Evaluator greps for either a `post-sprint-2` token in a table heading or the literal phrase `no work needed` (or equivalent — the handoff must use unambiguous wording).
10. **Either** a profile artifact exists at one of: `docs/sprints/sprint-175/rust-profile.md`, `docs/sprints/sprint-175/rust-profile.svg`, `docs/sprints/sprint-175/rust-profile.trace.png`, `docs/sprints/sprint-175/rust-profile-tracing.txt`. **Or** AC-175-02-02 / AC-175-02-03 are auto-waived because the exit door (AC-175-02-04, < 50ms case) was selected — in which case the handoff must explicitly state the auto-waiver. Evaluator: `ls docs/sprints/sprint-175/rust-profile*` returns at least one match unless the exit-door auto-waiver applies.
11. The shrinkage diff (if applied) is in `src-tauri/src/lib.rs` and/or `src-tauri/src/commands/connection.rs` (or another `src-tauri/src/` site justified by the profile). The diff must not remove or rename any Tauri command. Evaluator greps the post-shrinkage `lib.rs` for every command name listed in the pre-sprint `invoke_handler!` list to confirm none were dropped.
12. The post-shrinkage `T0 → app:effects-fired` median in the appended `baseline.md` row is ≤ 18.5ms × 1.10 (10% slack to account for trial noise; the Sprint 1 p95 was already 21ms). A larger increase fails AC-175-02-05's regression-only guard.
13. Diff inspection: the Sprint 1 markers `rust:entry` (in `src-tauri/src/lib.rs`) and `rust:first-ipc` (in `src-tauri/src/commands/connection.rs`) are still present and still emit at log level `info`.
14. Diff inspection: Sprint 173's `document.title` synchronous assignment in `src/main.tsx` is unchanged; no Sprint 2 work moves it behind any new await.

### Required Evidence

- Generator must provide:
  - Changed files with one-line purpose per file.
  - Outputs (or pass/fail summary) of `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build`, `cargo clippy ...`, `cargo fmt --check`, and `cargo build --release` (or `pnpm tauri build`).
  - Pointer to the appended `baseline.md` sections (release rebaseline and, if applicable, post-shrinkage).
  - Pointer to the profile artifact(s) (or explicit exit-door auto-waiver statement).
  - The pre-shrinkage and post-shrinkage `rust:entry → rust:first-ipc` medians, the computed delta percentage, and the explicit declaration of which AC-175-02-04 path was taken (≥ 30%, ≥ 15% relaxed, or "no work needed" exit door).
  - The pre-shrinkage and post-shrinkage `T0 → app:effects-fired` medians demonstrating the JS regression-only guard holds.
  - The verbatim launcher webview console line showing the connection list IPC fan-out resolved post-shrinkage (smoke-test evidence for AC-175-02-05).
  - A list of which steps were operator-required (interactive Tauri build, sudo-required profiling, GUI window measurement) vs fully automated, so future sprints know what the harness sandbox can and cannot do.
- Evaluator must cite:
  - Concrete grep / command output for each pass / fail decision in Required Checks.
  - The numeric delta between the AC-175-02-01 rebaseline median and the AC-175-02-04 post-shrinkage median (or the exit-door rebaseline-alone median), with the threshold check shown.
  - Any missing or weak evidence as a finding (e.g. profile artifact present but does not name top-3 contributors → P1; baseline rebaseline appended but `T0 → app:effects-fired` not reported, blocking the regression-only check → P1).
  - Whether the chosen AC-175-02-04 path is honestly supported by the numbers (a Generator that claims ≥ 30% via a misread baseline row is a P0 finding).

## Test Requirements

### Unit Tests (필수)

- AC-175-02-03: if the shrinkage refactors `AppState::new()` (e.g. wraps a field in `OnceCell` for lazy init), add a Rust unit test in `src-tauri/src/commands/connection.rs` (or `src-tauri/src/lib.rs`) asserting the lazy field resolves to the same value on first access as the eager path. If the shrinkage is plugin-init deferral, add a test (or recorded justification) confirming the deferred plugin still works on its first invocation.
- AC-175-02-05: a Rust unit test (or existing test surfaced) asserting `AppState::default()` (or whichever construction path the launcher uses) does not panic and exposes every field reachable from a Tauri command. The Sprint 1 IPC handler tests in `src-tauri/src/commands/connection.rs` (e.g. `get_session_id`'s test, if present) must still pass.
- Frontend regression test: an existing or new test asserting the eight Sprint 1 milestones still emit. The Sprint 1 `bootInstrumentation.test.ts` already covers this; the Generator confirms it remains green.

### Coverage Target

- New / modified Rust code: line ≥ 70% recommended.
- CI overall: line ≥ 40%, function ≥ 40%, branch ≥ 35%.

### Scenario Tests (필수)

- [ ] Happy path: post-shrinkage launcher cold-boot serves all five mount-effect IPC actions; `[boot]` summary line emits all eight milestones; Rust log lines emit `rust:entry` and `rust:first-ipc` with the new (smaller) delta.
- [ ] Error / exception: if the lazy-init field's underlying construction fails (e.g. a connection-pool builder rejects), the failure surfaces to the IPC handler with a recoverable error rather than panicking the launcher process. (If the shrinkage doesn't introduce a lazy-init path, this test slot is replaced by a recorded justification.)
- [ ] Boundary: every Tauri command in `lib.rs::run()`'s `invoke_handler!` list is still individually invocable post-shrinkage. The Generator does not have to add a new test per command; the existing command-handler tests + the launcher's mount-effect smoke test together cover this.
- [ ] No regression: existing E2E spec covering launcher → workspace handoff still passes (`e2e/connection-switch.spec.ts` or equivalent).

## Test Script / Repro Script

1. `pnpm install` (if needed).
2. From `src-tauri/`: `cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings` — both exit 0.
3. From repo root: `pnpm tsc --noEmit && pnpm lint && pnpm test && pnpm build` — all four exit 0.
4. From repo root: `pnpm tauri build` (or `cargo build --release` from `src-tauri/`) — exits 0 and produces a release artifact.
5. **Operator step:** Run `./scripts/measure-startup.sh launcher-cold` against the release artifact to harvest the AC-175-02-01 rebaseline. Append the resulting table to `baseline.md` under a `### launcher-cold (release-mode, pre-sprint-2)` section (or whatever heading the Generator scaffolded).
6. **Decision branch — Exit door check.** Read the `rust:entry → rust:first-ipc` median from step 5.
   - If < 50ms: skip steps 7–9. Record "no work needed; release mode alone met the exit-door threshold" in the handoff with the measured numbers. Skip to step 10.
   - Else: proceed to step 7.
7. **Operator step:** Capture profile evidence per AC-175-02-02. Pick one based on host capability:
   - macOS with sudo: `cargo flamegraph --release --bin table-view` (or equivalent), commit the resulting SVG.
   - macOS with Instruments.app: launch the release binary under Time Profiler, save the trace, screenshot the top-self-time view, commit.
   - No sudo / no Instruments: instrument `run()` in `src-tauri/src/lib.rs` with `tracing::info_span!` calls bracketing each phase (plugin init, `AppState::new()`, `generate_handler!`, `generate_context!`, window builder), rebuild, run once, capture stdout, commit as `rust-profile-tracing.txt`.
8. Implement the shrinkage in `src-tauri/src/lib.rs` and/or `src-tauri/src/commands/connection.rs` per the profile finding. Add the unit test required by Test Requirements.
9. Repeat steps 2–4 to confirm clippy / fmt / tsc / lint / test / build still pass. **Operator step:** Re-run `./scripts/measure-startup.sh launcher-cold` against the new release artifact and append the post-shrinkage numbers to `baseline.md` under `### launcher-cold (release-mode, post-sprint-2)`.
10. Compute the AC-175-02-04 delta. Declare the path taken in the handoff: ≥ 30% / ≥ 15% relaxed / "no work needed" exit door. Record the verbatim launcher webview console line showing the post-mount IPC fan-out resolved (AC-175-02-05 smoke-test evidence).
11. `grep -E "rust:entry|rust:first-ipc" src-tauri/src/lib.rs src-tauri/src/commands/connection.rs` — confirms the Sprint 1 markers persist.
12. `git diff src/main.tsx` — confirms `document.title` synchronous assignment is unchanged (Sprint 173 invariant).

## Ownership

- Generator: prepares the release-rebaseline recipe + appended `baseline.md` scaffolding, captures the profile artifact, implements the shrinkage in `src-tauri/`, adds the Rust unit test, drives all `cargo` / `pnpm` checks. The Generator may run profiling locally if it has the necessary host tools; otherwise it defers the interactive measurement steps to the operator and clearly labels them in the brief.
- Operator: runs `pnpm tauri build` / `cargo build --release`, runs `scripts/measure-startup.sh launcher-cold` against the release artifact (5 trials, slowest dropped), runs the chosen profiling tool (`cargo flamegraph` / Instruments / a `tracing`-instrumented run) since these all require an interactive macOS GUI session that the harness sandbox cannot drive.
- Write scope: `src-tauri/src/lib.rs`, `src-tauri/src/commands/connection.rs` (and only other `src-tauri/src/` files explicitly justified by the profile), `docs/sprints/sprint-175/baseline.md` (append-only), `docs/sprints/sprint-175/rust-profile.md` (and accompanying SVG / PNG / TXT), and at most one new Rust unit test. No changes to `src/`, `tauri.conf.json`, `vite.config.ts`, `Cargo.toml` (unless adding a dev-dep — see Design Bar), or `package.json`.
- Merge order: Sprint 2 lands as a single commit (or a small commit series) before Sprint 3 starts. Sprint 3's targets (the splash-paint AC-175-03-03) reference the post-Sprint-2 release rebaseline as their numeric reference, so this sprint must be merged and its handoff committed before Sprint 3's contract is drafted.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
- The handoff explicitly declares which AC-175-02-04 path was taken (≥ 30% / ≥ 15% relaxed / "no work needed" exit door) with the supporting numeric medians.
- The post-shrinkage `T0 → app:effects-fired` median is ≤ 18.5ms × 1.10 (regression-only guard per Global AC #7).
- The Sprint 1 instrumentation markers (`rust:entry`, `rust:first-ipc`, the eight frontend milestones) all still emit in the post-Sprint-2 binary.
- `docs/sprints/sprint-175/baseline.md` carries the appended release-mode rows, and `docs/sprints/sprint-175/rust-profile*` exists (unless the exit door auto-waiver applies, in which case the handoff says so explicitly).
