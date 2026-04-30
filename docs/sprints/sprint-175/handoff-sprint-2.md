# Sprint 2 Handoff (iteration 1)

> Iteration 1 of Sprint 2. Iteration 2 begins after the operator populates
> the `launcher-cold (release-mode, pre-sprint-2)` table in `baseline.md`
> with the new `phase=…` breakdown. Whether iteration 2 lands a shrinkage
> or declares the AC-175-02-04 exit door (release rebaseline alone <50ms)
> is decided from those numbers.

## Sprint
- ID: sprint-175 (internal Sprint 2 — REVISED 2026-04-30)
- Date: 2026-04-30
- Generator: Claude Opus 4.7 (Auto Mode, single-agent)

## Outcome
- Status: iteration 1 complete; **operator-blocked on release rebaseline**
- Score: deferred (Evaluator runs after iteration 2 closes)

## Changed Files
- `src-tauri/src/lib.rs`: `run()` body refactored to break `tauri::Builder`
  into named phases. Added a `record_phase(cursor, name)` helper emitting
  one `info!(target: "boot", "phase=<name> delta_ms=<ms>")` line per
  segment using `std::time::Instant`. Phases: `subscriber-init`,
  `builder-default`, `plugin-shell-init`, `plugin-dialog-init`,
  `app-state-new`, `invoke-handler-register`, `window-event-register`,
  `generate-context`, `before-builder-run`. Sprint 1 markers
  (`rust:entry`, `rust:first-ipc`) preserved verbatim. `invoke_handler!`
  registration list, `on_window_event`, `tauri::generate_context!()` all
  unchanged. No new Cargo deps.
- `docs/sprints/sprint-175/baseline.md`: appended
  `### launcher-cold (release-mode, pre-sprint-2)` section with operator
  build/launch recipe, raw-trials placeholder block, 5-trial milestone
  table (PENDING placeholders), "Phase breakdown" subsection wired to
  the new `phase=…` markers, and a step-by-step operator-action runbook.

## Commits Made
- `bd06678` perf(boot): add tracing phase breakdown for rust:entry → rust:first-ipc
- `d8af148` docs(sprint-175): scaffold launcher-cold release-mode pre-sprint-2 section

## Checks Run (Generator-side)
- `cargo fmt --check` (in src-tauri): pass
- `cargo clippy --all-targets --all-features -- -D warnings`: pass
- `cargo build` (debug): pass
- `cargo test --lib`: pass (293/293)
- `pnpm tsc --noEmit`: pass
- `pnpm lint`: pass
- `pnpm test`: pass (159 files, 2,414 tests; bootInstrumentation.test.ts green)
- `pnpm build`: pass (`dist/` emitted)
- Sprint 1 marker grep: both `rust:entry` and `rust:first-ipc` still emit
- **DEFERRED** to operator: `pnpm tauri build` (release is the default;
  ~5–10 min) and `scripts/measure-startup.sh launcher-cold` against
  the bundled binary

## Done Criteria Coverage (iteration 1)
| AC | Status | Notes |
|---|---|---|
| AC-175-02-01 release rebaseline | scaffolded | Build recipe + table shape + raw-trials block + operator runbook inline. Numeric population is the operator action below. |
| AC-175-02-02 profile capture | mechanism shipped | `tracing::info!` phase-breakdown is the lightweight option the contract endorses for sandboxes without sudo / Instruments. Concrete deltas captured at iteration 2. |
| AC-175-02-03 shrinkage | deferred | Per the brief — "profile-backed claims only." Iteration 2 selects the shrinkage target from the highest `phase=…` median. |
| AC-175-02-04 threshold met | deferred | Path (a/b/c) selection is data-driven from the AC-175-02-01 numbers. |
| AC-175-02-05 behavior preserved | partial pass | All static checks pass; Sprint 1 markers persist; `invoke_handler!` list unchanged. Live mount-effect IPC fan-out smoke test is operator-required. |

## Operator Action — Required for Iteration 2

Run on the same macOS host as the Sprint 1 baseline (Apple M4):

```bash
cd /Users/felix/Desktop/study/view-table

# 1. Release build (5–10 minutes — DO NOT run in the harness sandbox)
# `tauri build` defaults to release mode. Passing `--release` errors with
# "the argument '--release' cannot be used multiple times" because tauri
# already forwards `--release` to cargo. Use `--debug` only if you want
# a debug build.
pnpm tauri build

# 2. Confirm the binary path
ls "src-tauri/target/release/bundle/macos/Table View.app/Contents/MacOS/"
# expect: table-view

# 3. Run 5 cold trials, capturing stdout per trial
BIN="src-tauri/target/release/bundle/macos/Table View.app/Contents/MacOS/table-view"
mkdir -p .startup-trials
for i in 1 2 3 4 5; do
  pkill -f "table-view" 2>/dev/null
  pkill -f "Table View" 2>/dev/null
  sudo purge 2>/dev/null || echo "purge skipped (no sudo)"
  echo "=== trial $i ==="
  "$BIN" 2>&1 | tee ".startup-trials/launcher-cold-release-trial-$i.log" &
  APP_PID=$!
  sleep 8
  kill $APP_PID 2>/dev/null
  wait $APP_PID 2>/dev/null
done

# 4. Extract the relevant lines per trial
for i in 1 2 3 4 5; do
  echo "=== trial $i ==="
  grep -E "rust:entry|rust:first-ipc|phase=" ".startup-trials/launcher-cold-release-trial-$i.log"
done
```

Then:
1. Paste the verbatim captured lines into the `Raw trials` block of
   `### launcher-cold (release-mode, pre-sprint-2)` in `baseline.md`.
2. Identify the slowest of 5 by `rust:first-ipc` delta_ms.
3. Compute median + p95 of the remaining 4 per row.
4. Replace every `PENDING` cell.
5. Read the resulting `rust:entry → rust:first-ipc` median and select the
   AC-175-02-04 path:
   - **< 50ms** → exit door (a). Iteration 2 records the rebaseline only;
     Sprint 3 becomes the first optimization sprint.
   - **50–100ms** → 15% relaxed (c). Iteration 2 picks the highest
     `phase=…` median as the shrinkage target.
   - **≥ 100ms** → 30% default (b). Same iteration-2 plan.

**Release-mode `[boot]` capture caveat.** The launcher's `console.info`
in `src/lib/perf/bootInstrumentation.ts` does not always pipe through
Tauri's parent-process stdout in release mode. If the JS-side `[boot]`
summary line is missing from the `tee`'d log, rebuild ONCE with
`pnpm tauri build --debug --no-bundle` to capture the JS milestones via
the WKWebView Inspect Element console while still using the release
build for the Rust `phase=` deltas. Document the deviation in the
`notes` column.

## Assumptions
- New `phase=…` instrumentation is permanent (matches Sprint 1
  precedent); cost is single-digit microseconds per phase, well below
  the 1ms granularity of the scenario tables.
- macOS bundle path derived from `tauri.conf.json` `productName: "Table View"`
  + crate `name = "table-view"`. Recipe parameterizes for non-macOS.
- No iteration-1 unit test for instrumentation — `record_phase` is a
  free function emitting `tracing::info!`, not unit-testable without a
  subscriber capture, which the JS-side `bootInstrumentation.test.ts`
  already establishes as disproportionate complexity for this surface.
  If iteration 2's shrinkage is `OnceCell`-wrapped lazy-init on
  `AppState`, that surface IS unit-testable and will gain a test.

## Residual Risks
- AC-175-02-05 mount-effect IPC smoke test cannot be exercised in the
  sandbox; static evidence (unchanged `invoke_handler!` list + byte-for-
  byte preserved command signatures) is the iteration-1 substitute.
- New `phase=…` overhead is argued small but not formally measured
  against an instrumentation-disabled build (Sprint 1 took the same
  shape). If operator data shows >1ms cumulative overhead, gate the
  emissions behind `RUST_LOG=boot=info` in iteration 2.
- Release-mode JS `[boot]` capture path is brittle (see caveat above).
  If iteration-2 measurement proves it consistently lossy, consider
  emitting the JS milestones via a Rust IPC sink in iteration 2.
- Iteration boundary is internal to Sprint 2. The harness contract's
  "Sprint 2 lands before Sprint 3 starts" still holds — iteration 1 is
  not a sprint pass on its own.

## Next Steps
1. Operator runs the runbook above and pastes results.
2. Iteration 2 (Generator): selects path (a/b/c) from data; if (b/c),
   applies the profile-justified shrinkage in `src-tauri/src/lib.rs`
   and/or `src-tauri/src/commands/connection.rs`, adds a unit test if
   the shrinkage is `AppState::new()`-style, re-runs the runbook, and
   appends `### launcher-cold (release-mode, post-sprint-2)` to
   `baseline.md` with the post-shrinkage numbers.
3. Sprint 2 Evaluator (Phase 4): scores the closed iteration-2 work
   against AC-175-02-01..05 with concrete numbers.
4. On pass, harness moves to Sprint 3 (pre-paint splash HTML).
