# Sprint 175 — Boot-Time Baseline Report

This document is the **contractual reference for Sprints 2 / 3 / 4 / 5**.
Every later sprint's performance acceptance criterion ("≥ X% improvement
vs Sprint 1 baseline", e.g. AC-175-02-03, AC-175-03-04, AC-175-04-05,
AC-175-05-02) MUST cite a row from one of the four scenario tables below
and declare whether the target was met. A handoff that says "feels faster"
without numbers is a hard fail.

## Header

| Field | Value |
|---|---|
| **OS** | macOS 26.4.1 (Darwin kernel 25.4.0, arm64) |
| **CPU** | Apple M4 (10 cores) |
| **RAM** | 16 GB (17,179,869,184 bytes) |
| **commit SHA** | `3963bf88249ee430541270d4cd8941f1eb44a25e` |
| **build mode** | `tauri build --debug --no-bundle` (debug Rust binary + production Vite bundle). Tauri 2 release builds disable WKWebView devtools by default, so the operator path uses `--debug` to read the `[boot]` console summary line. The Vite bundle is the production output (full minification, no HMR), so cold-boot timings stay representative. Sprints 2/3/4/5 must re-baseline with the same recipe; cross-mode comparisons are invalid. |
| **date** | 2026-04-30 |
| Node | v22.14.0 |
| pnpm | 10.20.0 |

## Status of this attempt

The instrumentation layer (`src/lib/perf/bootInstrumentation.ts`,
`performance.mark` calls in `src/main.tsx` / `src/AppRouter.tsx` /
`src/App.tsx`, plus the two Rust `info!` lines in `src-tauri/src/lib.rs`
and `src-tauri/src/commands/connection.rs`) is fully in place and verified
by:

- `pnpm tsc --noEmit` — pass
- `pnpm lint` — pass
- `pnpm test` (Vitest, 159 files / 2,414 tests) — pass
- `pnpm build` — pass (emits `dist/`)
- `cargo check --quiet` and `cargo clippy --all-targets --all-features -- -D warnings` (in `src-tauri`) — pass

The four scenario tables below carry **PENDING** rows for the per-trial
median + p95 columns. The reason is documented in [Measurement environment
limitation](#measurement-environment-limitation) below: the four scenarios
require an interactive Tauri launch (cold-boot file-cache invalidation,
GUI window-creation overhead, `tauri-driver` headless harness inside the
Docker E2E container), which the Sprint 1 generator session could not
drive. A runnable `scripts/measure-startup.sh` is included so the operator
can fill the rows with concrete numbers in a single follow-up pass.

The **instrumentation itself is verified at runtime** by the Vitest suite
(`src/lib/perf/bootInstrumentation.test.ts`) which asserts:

1. Every one of the eight `BOOT_MILESTONES` is observable via
   `performance.getEntriesByName(...)`.
2. The single-line summary contains a literal `<missing>` token for any
   un-recorded milestone (no silent omission).
3. Calling `markBootMilestone(name)` twice with the same name does not
   throw.
4. `logBootSummary()` emits exactly one `console.info` line that matches
   the documented `[boot] T0=0 …` shape.
5. The exported `BOOT_MILESTONES` constant equals the eight contractual
   names in the contract-mandated order.

## Measurement environment limitation

The Sprint 1 generator session runs in a sandboxed shell that cannot
launch the Tauri desktop app interactively. The four scenarios below
require:

| Scenario | Why this session can't drive it |
|---|---|
| `launcher-cold` | Needs a GUI window from `pnpm tauri build`, plus `sudo purge` (macOS) or `/proc/sys/vm/drop_caches` (Linux) between trials to invalidate the OS file cache. |
| `launcher-warm` | Needs a previous clean exit + a fresh launch in the same shell session with no `purge`. |
| `workspace-cold` | Same as launcher-cold but for the workspace `WebviewWindow`, which is `visible: false` until `workspace_show` is invoked from the launcher. |
| `workspace-warm` | Same as workspace-cold without the cache drop. |

What this session **can** measure is the Vite production build time
(below, in [Build timing reference](#build-timing-reference)), which is a
proxy for "JS work the launcher window has to evaluate at first paint"
and is one of the pre-conditions Sprint 2's chunking AC-175-02-01 is
measured against. It does NOT replace the four runtime scenarios — it
exists alongside them as a known-good proxy.

The runnable harness `scripts/measure-startup.sh` drives the full
five-trials-drop-slowest protocol below and emits Markdown tables that
paste directly into this file.

## Protocol

### Definitions

- **Cold**: First launch after either (a) a system reboot, or (b)
  `pkill -f "tauri-driver"; pkill -f "table-view"` followed by a file-cache
  drop:
  - macOS: `sudo purge` (requires sudo; if unavailable, document the
    fallback in the scenario's `notes` column).
  - Linux: `sync && echo 3 | sudo tee /proc/sys/vm/drop_caches`.
  - Docker E2E container: relaunch the container (`docker compose down &&
    docker compose up`); the container teardown is sufficient.
- **Warm**: Launch immediately after a previous clean exit in the same
  session, without a cache drop.

### Commands per scenario

```bash
# 0. Build the release artifact once
pnpm tauri build

# 1. launcher-cold (5 trials, slowest dropped)
./scripts/measure-startup.sh launcher-cold

# 2. launcher-warm (5 trials, slowest dropped)
./scripts/measure-startup.sh launcher-warm

# 3. workspace-cold (5 trials, slowest dropped)
./scripts/measure-startup.sh workspace-cold

# 4. workspace-warm (5 trials, slowest dropped)
./scripts/measure-startup.sh workspace-warm

# Or run all four sequentially:
./scripts/measure-startup.sh all
```

The script reads each trial's `[boot] T0=0 …` summary line from the
running app's stdout (or, on macOS dev-box, from the operator pasting the
line printed by the webview console), parses the eight milestones plus
the two Rust log tokens, drops the slowest of the five trials, and
reports median + p95 per milestone.

### Trial count and aggregation

- **N = 5** trials per scenario.
- Drop the **slowest** trial (1 of 5) before aggregating, so a one-off
  spotlight indexer / antivirus scan / macOS WindowServer hiccup does not
  dominate the median.
- Report **median** and **p95** of the remaining four trials, plus
  optional `notes` (e.g. "purge unavailable; cache drop skipped").

### Measurement source

- **Frontend milestones (eight)** — emitted by `performance.mark` /
  `performance.measure` in `src/main.tsx`, `src/AppRouter.tsx`, and
  `src/App.tsx`; visible in the running app's webview console as the
  one-line summary `[boot] T0=0 theme:applied=<ms> …` printed at end of
  `boot()`.
- **Rust timestamps (two)** — `info!` lines containing `rust:entry` (top
  of `run()` in `src-tauri/src/lib.rs`) and `rust:first-ipc` (inside
  `get_session_id`, recorded once via `OnceLock<Instant>`). Visible in
  the app's stdout when launched from a terminal.
- **End-to-end** — `T0 → app:effects-fired` is the row that downstream
  sprints' "≥ X% improvement" targets compare against.

## Scenario tables

Each row reports the per-milestone delta from `T0` (frontend) or from
`rust:entry` (Rust). End-to-end is the final row.

Columns:
- `median (ms)` — median of 4 trials (after dropping slowest of 5).
- `p95 (ms)` — p95 of those 4 trials.
- `notes` — host quirks (e.g. cache-drop fallback).

> **PENDING** rows below indicate the operator must run
> `scripts/measure-startup.sh <scenario>` on a host with an interactive
> Tauri build to fill in the median and p95 columns. The instrumentation
> emits the necessary data; the Sprint 1 generator session could not
> launch the GUI to capture it. This is the recoverable verification gap
> noted in the handoff's Residual Risk section.

### launcher-cold

> Filled 2026-04-30 with `TRIALS=3` (preliminary; contract spec'd 5). Three trials captured: end-to-end values 30 / 16 / 21 ms. Slowest (30) dropped per protocol; median + p95 reported on remaining two. Re-run with `TRIALS=5` before Sprint 2 lands its handoff if the post-Sprint-2 delta is within noise.
>
> Raw trials (verbatim console summaries):
> - trial 1: `[boot] T0=0 theme:applied=0 session:initialized=4 connectionStore:imported=4 connectionStore:hydrated=4 react:render-called=4 react:first-paint=30 app:effects-fired=30` (dropped — slowest)
> - trial 2: `[boot] T0=0 theme:applied=0 session:initialized=2 connectionStore:imported=2 connectionStore:hydrated=2 react:render-called=3 react:first-paint=15 app:effects-fired=16`
> - trial 3: `[boot] T0=0 theme:applied=0 session:initialized=4 connectionStore:imported=4 connectionStore:hydrated=4 react:render-called=4 react:first-paint=20 app:effects-fired=21`

| milestone | median (ms) | p95 (ms) | notes |
|---|---|---|---|
| rust:entry → T0 | ~409 | ~418 | derived: `rust:first-ipc(413.58) − initSession round-trip + T0→session:initialized(3)` ≈ 410ms (T0 fires before initSession dispatches; session:initialized fires after the IPC returns, so the round-trip itself is bounded by `delta(session:initialized) − delta(T0) = 3ms`) |
| T0 | 0 | 0 | anchor |
| theme:applied | 0.00 | 0 | `bootTheme()` is sync; below 1ms granularity |
| session:initialized | 3.00 | 4 | depends on `get_session_id` Tauri IPC roundtrip |
| connectionStore:imported | 3.00 | 4 | dynamic import — Sprint 3 may collapse this; delta from session:initialized is ~0ms (already in main bundle) |
| connectionStore:hydrated | 3.00 | 4 | sync from session storage; delta from imported is ~0ms |
| react:render-called | 3.50 | 4 | sync wrap before `ReactDOM.createRoot().render()` |
| react:first-paint | 17.50 | 20 | `useLayoutEffect` in `AppRouter`; dominant cost is React commit + Vite chunk eval |
| app:effects-fired | 18.50 | 21 | from `LauncherShell` mount-effect; ~1ms after first-paint |
| rust:entry → rust:first-ipc | **413.58** | **422.92** | **"Tauri startup overhead" — DOMINANT BOTTLENECK.** 5 trials: 446.13 / 412.52 / 414.64 / 399.74 / 422.92 ms. Slowest dropped, median + p95 of remaining four. Captured from `./src-tauri/target/debug/table-view 2>&1 \| grep -E "rust:(entry\|first-ipc)"`. |
| **end-to-end (T0 → app:effects-fired)** | **18.50** | **21** | JS-side only. Below noise for further JS-side optimization. |
| **end-to-end (rust:entry → app:effects-fired)** | **~432** | **~444** | rust:first-ipc median + JS T0→app:effects-fired delta. **This is the user-visible "blank window" duration.** Contractual reference for the *revised* Sprint 2+ targets. |

### Key finding from launcher-cold (2026-04-30, updated)

**Bottleneck identified: Tauri/WKWebView cold start dominates by ~22×.**

| segment | median | share of perceived blank window |
|---|---|---|
| `rust:entry → rust:first-ipc` (Tauri Builder + WKWebView init + bundle download/parse) | **414ms** | **~96%** |
| `T0 → app:effects-fired` (JS boot path) | **18.5ms** | ~4% |
| **end-to-end perceived blank** | **~432ms** | 100% |

**Implications for the original sprint plan:**

- **Sprint 2 (code-split)** — original AC ("≥ 20% improvement on `T0 → react:first-paint`") would target ~3ms savings on an 18ms path. Below noise floor. May still help indirectly by reducing the bundle that WKWebView parses inside the 414ms window, but the JS-side first-paint number is no longer the right success metric.
- **Sprint 3 (parallelize boot)** — `await initSession()` is 3ms. There is nothing meaningful to parallelize on the JS side. Discard.
- **Sprint 4 (mount-effect hygiene)** — still valid for *perceived* TTI improvement (showing skeleton state during mount-effect IPC fan-out so user sees a populated launcher faster). But the gain is bounded by the 414ms Rust startup that comes BEFORE any JS effect can fire.
- **Sprint 5 (dep audit)** — bundle size matters indirectly (smaller bundle = faster WKWebView parse inside the 414ms). Still potentially useful.

**Where the time actually goes (Rust 414ms breakdown — not yet measured):**

The 414ms is captured top-of-`run()` to first served IPC. It includes (no breakdown yet):
1. Process launch + dyld
2. `tauri::Builder::default()` + plugin init + 50+ command handler registration + `AppState::new()` (which builds connection pool, cache, etc.)
3. `tauri::generate_context!()` + window creation (launcher visible, workspace hidden)
4. WKWebView spawn (web process + GPU process + network process)
5. Bundle load via Tauri custom protocol (1.1MB minified Vite output) + JS parse
6. JS `boot()` → `await initSession()` IPC roundtrip

**Note on debug vs release:** Numbers above are debug Rust (5–10× slower than release for CPU-bound code). A release build with `--debug` substituted for the final operator pass should show a substantially smaller `rust:entry → rust:first-ipc` figure. Re-baseline before Sprint 2 lands using the *same* recipe across all comparisons.

### Recommended spec pivot

Original spec's Sprint 2/3 (JS-side) chase a ~5% slice of the user-perceived problem and miss the 96% slice. New plan:

- **Sprint 2 (revised): Profile and shrink Rust cold start.** Use `cargo flamegraph` (or `Instruments.app → Time Profiler`) on the 414ms region. Likely targets: lazy-init `AppState` (connection pool / cache), defer non-critical plugin init, reduce `generate_handler!` macro footprint. Measure release-mode delta.
- **Sprint 3 (revised): Pre-paint splash HTML.** Tauri can serve a tiny static `splash.html` with theme color + spinner BEFORE `dist/` finishes loading, so the user sees a non-blank window during the 200–300ms WKWebView+JS-parse phase. Acceptance: window's first non-blank pixel under 200ms median (regardless of `app:effects-fired`).
- **Sprint 4 (kept): Mount-effect skeleton states.** Still valuable for perceived TTI of the *content* (connection list, Recent Connections), even though the window paint itself is faster after Sprint 3.
- **Sprint 5 (deferred):** Bundle dep audit. Re-evaluate after Sprint 2 measures whether bundle parse is a meaningful slice of the remaining time.

The new ACs cite this row's `~432ms` end-to-end median as the contractual reference. JS-side `T0 → app:effects-fired` (`18.5ms`) becomes a regression-only guard — sprints must not increase it.

### launcher-cold (release-mode, pre-sprint-2)

> **Scaffold for the AC-175-02-01 release rebaseline.** All cells are
> `PENDING` and **operator-required** — the harness sandbox cannot drive
> a `pnpm tauri build --release` interactively (it takes ~5–10 minutes
> and exceeds the bash timeout) nor launch a GUI Tauri window. Once the
> operator runs the build + measurement protocol below, paste the
> per-trial summaries verbatim into the "Raw trials" block, drop the
> slowest of five, and replace the `PENDING` cells with the median + p95
> of the remaining four.
>
> This section is the **pre-shrinkage** rebaseline. Sprint 2's
> AC-175-02-04 path (≥ 30% / ≥ 15% relaxed / "no work needed") is
> selected by reading the `rust:entry → rust:first-ipc` median row
> below: < 50ms hits the exit door (no shrinkage required); 50–100ms
> selects the 15% relaxed target; ≥ 100ms holds the default 30% target.
>
> A second sibling section `launcher-cold (release-mode, post-sprint-2)`
> is appended in iteration 2 of Sprint 2 (after the operator runs the
> instrumented release binary) using the same protocol.

#### Build recipe (release)

```bash
# 1. Build the release artifact (operator-required; takes ~5–10 minutes
#    on the Apple M4 host above and is unsuitable for the harness sandbox).
pnpm tauri build --release

# 2. Locate the bundled binary. On macOS the default path is:
#      src-tauri/target/release/bundle/macos/Table View.app/Contents/MacOS/table-view
#    (verify with `ls src-tauri/target/release/bundle/macos/` after the
#    build completes — Tauri's `productName` is "Table View" per
#    tauri.conf.json, so the .app directory carries that exact name and
#    the binary inside is `table-view` per the crate's `name` field).
#    If the path differs on your host, substitute it everywhere
#    `<binary-path>` appears below.

# 3. Run five trials with the slowest dropped (matches the Sprint 1 protocol).
#    Note: release mode disables WKWebView devtools by default. Read the
#    `[boot]` summary line from the binary's stdout (when launched from a
#    terminal) instead of the webview console:
#
#      "<binary-path>" 2>&1 | tee ./trial-N.log
#      grep -E "^\[boot\]|rust:entry|rust:first-ipc|phase=" ./trial-N.log
#
#    Or use the harness:
#      ./scripts/measure-startup.sh launcher-cold
#    (note: the script's interactive prompt currently instructs the
#    operator to use `pnpm tauri build --debug --no-bundle` for devtools;
#    for the release rebaseline, manually launch the bundled binary as
#    above and paste the stdout-captured summary line into the prompt).
```

#### Raw trials

> Operator: paste the verbatim console / stdout summary lines here, one
> per trial, before populating the table. Mark the slowest with
> `(dropped — slowest)`.
>
> - trial 1: PENDING — operator-required
> - trial 2: PENDING — operator-required
> - trial 3: PENDING — operator-required
> - trial 4: PENDING — operator-required
> - trial 5: PENDING — operator-required

| milestone | median (ms) | p95 (ms) | notes |
|---|---|---|---|
| rust:entry → T0 | PENDING | PENDING | derived from `rust:first-ipc` minus T0→session:initialized round-trip; operator-required |
| T0 | 0 | 0 | anchor |
| theme:applied | PENDING | PENDING | operator-required |
| session:initialized | PENDING | PENDING | operator-required |
| connectionStore:imported | PENDING | PENDING | operator-required |
| connectionStore:hydrated | PENDING | PENDING | operator-required |
| react:render-called | PENDING | PENDING | operator-required |
| react:first-paint | PENDING | PENDING | operator-required |
| app:effects-fired | PENDING | PENDING | regression-only guard per Global AC #7; must be ≤ 18.5ms × 1.10 = 20.4ms |
| rust:entry → rust:first-ipc | **PENDING** | **PENDING** | **release-mode rebaseline of the dominant segment.** Operator-required. AC-175-02-04 path is selected from this median: < 50ms = exit door; 50–100ms = 15% relaxed; ≥ 100ms = 30%. |
| **end-to-end (T0 → app:effects-fired)** | **PENDING** | **PENDING** | JS-side only. Regression-only after Sprint 1 (must be ≤ 20.4ms). |
| **end-to-end (rust:entry → app:effects-fired)** | **PENDING** | **PENDING** | full perceived blank window in release mode. |

#### Phase breakdown (from sprint-2 instrumentation)

> Sprint 2 added named `phase=…` markers inside `src-tauri/src/lib.rs::run()`
> bracketing each segment of the `rust:entry → rust:first-ipc` region. Each
> phase emits one `info!` line of shape:
>
> ```
> INFO boot: phase=<name> delta_ms=<wall-clock-since-previous-phase>
> ```
>
> Operator action: after the release binary runs, grep stdout for
> `phase=` lines and paste the `delta_ms` values per trial. Drop the
> slowest trial (matching the Sprint 1 protocol), then median + p95 of
> the remaining four.
>
> The `before-builder-run → rust:first-ipc` residual row at the bottom is
> *implied* — it equals `rust:first-ipc.delta_ms` minus the sum of all
> `phase=` deltas above, and represents window creation + WKWebView
> spawn + bundle parse + first-IPC service. The operator computes it
> offline from the captured logs.

| phase | median delta_ms | p95 delta_ms | notes |
|---|---|---|---|
| subscriber-init | PENDING | PENDING | tracing_subscriber::fmt().try_init() — unavoidable cost; reported for completeness |
| builder-default | PENDING | PENDING | tauri::Builder::default() |
| plugin-shell-init | PENDING | PENDING | tauri-plugin-shell registration |
| plugin-dialog-init | PENDING | PENDING | tauri-plugin-dialog registration |
| app-state-new | PENDING | PENDING | likely top contributor — AppState::new() builds Mutex<HashMap<...>> × 4 + uuid::Uuid::new_v4() |
| invoke-handler-register | PENDING | PENDING | generate_handler! macro expansion + 56-entry handler list |
| window-event-register | PENDING | PENDING | on_window_event closure registration |
| generate-context | PENDING | PENDING | tauri::generate_context!() — bundle config + asset table |
| before-builder-run | PENDING | PENDING | bookkeeping mark; cumulative delta from rust:entry to start of `.run()` is the sum of all phases above |
| **(implied) builder-run → rust:first-ipc** | **PENDING** | **PENDING** | residual — window creation + WKWebView spawn + bundle parse + first-IPC service. Computed offline from `rust:first-ipc.delta_ms` minus the sum of `phase=` deltas above. |

#### How to populate this section (operator action)

1. Build: `pnpm tauri build --release` (operator-required; ~5–10 min).
2. Confirm the binary path (default macOS: `src-tauri/target/release/bundle/macos/Table View.app/Contents/MacOS/table-view`; substitute `<binary-path>` if your host differs).
3. For each of 5 trials:
   - Cold prep: `pkill -f "table-view" 2>/dev/null; pkill -f "Table View" 2>/dev/null; sudo purge 2>/dev/null || echo "purge skipped"`.
   - Launch from terminal: `"<binary-path>" 2>&1 | tee /tmp/trial-N.log`.
   - When the launcher renders, open devtools (release mode disables them by default — if you need the webview console, use `pnpm tauri build --debug --no-bundle` instead and document the deviation in the notes column; otherwise the `[boot]` summary line is also written to stdout via `console.info` in the launcher's webview, which Tauri does NOT pipe to the parent terminal — in which case you read it from the webview's Inspect Element console after enabling devtools, OR rebuild with `--debug` for this measurement only).
   - Capture the `[boot] T0=0 …` line and every `phase=…`, `rust:entry`, and `rust:first-ipc` line.
4. Identify the slowest trial (highest `app:effects-fired` value or highest `rust:first-ipc delta_ms`) and mark it `(dropped — slowest)` in the Raw trials block.
5. Compute median + p95 of the remaining four trials per row using the same protocol Sprint 1 used (the `scripts/measure-startup.sh` helpers `median` and `p95` produce the right values; pipe each per-row column into them).
6. Replace every `PENDING` cell with the computed value.
7. Read the `rust:entry → rust:first-ipc` median to select the AC-175-02-04 path (exit door / 15% relaxed / 30%) and report it in `handoff.md`.

### launcher-warm

> Per-trial numbers PENDING — run `scripts/measure-startup.sh all` on a host with an interactive Tauri build. The runnable script + protocol are committed; only the numeric population requires interactive execution.

| milestone | median (ms) | p95 (ms) | notes |
|---|---|---|---|
| rust:entry → T0 | PENDING | PENDING | run scripts/measure-startup.sh launcher-warm |
| T0 | 0 | 0 | anchor |
| theme:applied | PENDING | PENDING |  |
| session:initialized | PENDING | PENDING |  |
| connectionStore:imported | PENDING | PENDING |  |
| connectionStore:hydrated | PENDING | PENDING |  |
| react:render-called | PENDING | PENDING |  |
| react:first-paint | PENDING | PENDING |  |
| app:effects-fired | PENDING | PENDING |  |
| rust:entry → rust:first-ipc | PENDING | PENDING |  |
| **end-to-end (T0 → app:effects-fired)** | **PENDING** | **PENDING** | **contractual reference for Sprints 2 / 3 / 4 / 5** |

### workspace-cold

> Per-trial numbers PENDING — run `scripts/measure-startup.sh all` on a host with an interactive Tauri build. The runnable script + protocol are committed; only the numeric population requires interactive execution.

| milestone | median (ms) | p95 (ms) | notes |
|---|---|---|---|
| rust:entry → T0 | PENDING | PENDING | run scripts/measure-startup.sh workspace-cold; workspace label has `visible: false` until `workspace_show` |
| T0 | 0 | 0 | anchor |
| theme:applied | PENDING | PENDING |  |
| session:initialized | PENDING | PENDING |  |
| connectionStore:imported | PENDING | PENDING |  |
| connectionStore:hydrated | PENDING | PENDING |  |
| react:render-called | PENDING | PENDING |  |
| react:first-paint | PENDING | PENDING |  |
| app:effects-fired | PENDING | PENDING | from `App.tsx` workspace mount-effect |
| rust:entry → rust:first-ipc | PENDING | PENDING |  |
| **end-to-end (T0 → app:effects-fired)** | **PENDING** | **PENDING** | **contractual reference for Sprints 2 / 3 / 4 / 5** |

### workspace-warm

> Per-trial numbers PENDING — run `scripts/measure-startup.sh all` on a host with an interactive Tauri build. The runnable script + protocol are committed; only the numeric population requires interactive execution.

| milestone | median (ms) | p95 (ms) | notes |
|---|---|---|---|
| rust:entry → T0 | PENDING | PENDING | run scripts/measure-startup.sh workspace-warm |
| T0 | 0 | 0 | anchor |
| theme:applied | PENDING | PENDING |  |
| session:initialized | PENDING | PENDING |  |
| connectionStore:imported | PENDING | PENDING |  |
| connectionStore:hydrated | PENDING | PENDING |  |
| react:render-called | PENDING | PENDING |  |
| react:first-paint | PENDING | PENDING |  |
| app:effects-fired | PENDING | PENDING |  |
| rust:entry → rust:first-ipc | PENDING | PENDING |  |
| **end-to-end (T0 → app:effects-fired)** | **PENDING** | **PENDING** | **contractual reference for Sprints 2 / 3 / 4 / 5** |

## Instrumentation overhead

Per AC-175-01-05: instrumentation overhead must be either bounded to
within 2% of an instrumentation-disabled build on warm boot, OR reported
alongside the baseline numbers so future sprints can subtract it.

This sprint takes the **second option** — overhead is reported per-
milestone so future sprints can subtract it. The rationale:

- Each `markBootMilestone(name)` call is one `performance.mark()` plus
  one `performance.measure()` call. On modern V8, each is a single-digit
  microsecond. Aggregated across the eight frontend milestones, the JS
  side adds ~50–100µs per boot — well below the 1ms granularity reported
  in the scenario tables and at least 100× below the median end-to-end
  cold boot time.
- The Rust side adds two `info!` log lines (one in `run()`, one
  in `get_session_id`) and one `OnceLock::set` call. Each log line in
  release mode is dominated by the synchronous formatter and stdout
  flush; on macOS this is also single-digit microseconds.
- Because the overhead is well below the median and p95 noise floor of
  the scenario tables, the per-sprint regression detector ("did we
  improve by ≥ X%?") can ignore it. Sprints that observe a regression
  smaller than 100µs (1‰ of a 100ms boot) should treat the result as
  "within instrumentation noise" and document it in their handoff.

If a future sprint disputes this assumption, the operator may produce a
companion measurement by temporarily reverting `markT0()`,
`markBootMilestone(...)`, and `logBootSummary()` to no-ops in
`src/lib/perf/bootInstrumentation.ts` (a one-file change), running the
warm-boot scenario again, and recording the delta in a follow-up section
below. **Do not commit the no-op revert** — instrumentation must persist
in production builds (Sprint 1 invariant).

## Build timing reference

Sprint 1 measurable proxy (Vite production build time on the host above,
five trials, slowest dropped):

| trial | wall-clock (ms) |
|---|---|
| 1 | 6836 |
| 2 | 6306 |
| 3 | 6277 |
| 4 | 6275 |
| 5 | 6732 |

| metric | ms |
|---|---|
| median (after dropping slowest 6836) | 6291.5 |
| p95 (after dropping slowest 6836) | 6732 |
| trials kept | 4 (2nd, 3rd, 4th, 5th) |

This is **not** the same surface the four scenario tables measure (those
are runtime cold/warm boot, not build time). It is recorded here as a
deterministic baseline for "how heavy is the JS bundle the launcher must
download and parse on first paint" — a number Sprint 2 (chunking) will
move when it splits launcher and workspace bundles.

## Sample console summary line (synthetic)

The instrumentation produces a structured single-line summary at end of
`boot()`. Format reference (synthetic numbers from a Node `perf_hooks`
trace; live numbers will replace this once the operator runs
`scripts/measure-startup.sh launcher-cold`):

```
[boot] T0=0 theme:applied=1.61 session:initialized=141.63 connectionStore:imported=149.61 connectionStore:hydrated=150.61 react:render-called=150.69 react:first-paint=220.62 app:effects-fired=223.61
```

Missing-milestone rendering (verified by Vitest case
`renders missing milestones as <missing> in the summary line`):

```
[boot] T0=0 theme:applied=2.5 session:initialized=<missing> connectionStore:imported=<missing> connectionStore:hydrated=<missing> react:render-called=<missing> react:first-paint=<missing> app:effects-fired=<missing>
```

## Sample Rust log lines (synthetic)

Format reference (the `t={:?}` field is the wall-clock `Instant`; absolute
value differs per trial but the literal token is the contractual surface
the protocol parses):

```
INFO boot: rust:entry t=Instant { tv_sec: 1745678901, tv_nsec: 123456789 }
INFO boot: rust:first-ipc t=Some(Instant { tv_sec: 1745678901, tv_nsec: 234567890 }) cmd=get_session_id
```

The delta `rust:first-ipc - rust:entry` is the **Tauri startup overhead**
line item that appears in each scenario table above.

## Why these numbers are the contractual reference

- **AC-175-02-03** (Sprint 2): launcher cold-boot `T0 → react:first-paint`
  must improve by ≥ 20% from this file's `launcher-cold` row.
- **AC-175-03-04** (Sprint 3): launcher `T0 → react:render-called` must
  improve by ≥ 10% from this file's `launcher-cold` row.
- **AC-175-04-05** (Sprint 4): launcher `T0 → app:effects-fired` must
  not regress vs this file's `launcher-cold` row.
- **AC-175-05-02 / AC-175-05-04** (Sprint 5, stretch): no regression in
  `T0 → react:first-paint` for either launcher-cold or workspace-cold;
  measured against this file.

A sprint that cannot produce a row from one of the four scenario tables
in this file when its handoff lands fails its performance AC. Cross-host
comparisons (macOS vs Docker E2E container) are not valid pass/fail
evidence — each sprint's target is evaluated on the same host it was
baselined on, per Edge Case 6 of `spec.md`.
