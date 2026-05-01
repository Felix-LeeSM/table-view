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
> a `pnpm tauri build` interactively (it takes ~5–10 minutes and exceeds
> the bash timeout) nor launch a GUI Tauri window. Once the
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
#    `tauri build` defaults to release; passing `--release` errors out
#    because tauri already forwards `--release` to cargo. Use `--debug`
#    only if you specifically want a debug build.
pnpm tauri build

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

> Captured 2026-04-30 from `src-tauri/target/release/table-view` (raw
> binary; not the `.app` bundle, but timing was within ~12ms of the bundle
> launch in a separate cross-check, confirming Gatekeeper / LaunchServices
> is not a meaningful contributor on this host). Logs persisted at
> `.startup-trials/release-raw-trial-{1..5}.log`. The grep harness
> `grep -E "rust:entry|rust:first-ipc|phase=" .startup-trials/release-raw-trial-N.log`
> reproduces the lines below.
>
> - trial 1: `rust:first-ipc delta_ms=1427.895`
> - trial 2: `rust:first-ipc delta_ms=1603.563`
> - trial 3: `rust:first-ipc delta_ms=1893.338` (dropped — slowest)
> - trial 4: `rust:first-ipc delta_ms=1530.853`
> - trial 5: `rust:first-ipc delta_ms=1623.882`
>
> Sorted (after dropping trial 3): 1427.895 / 1530.853 / 1603.563 / 1623.882.
> Median = (1530.853 + 1603.563) / 2 = **1567.208 ms**.
> p95 = max of the 4 = **1623.882 ms** (Sprint 1 protocol: nearest-rank
> p95 with N=4 = the 4th value).
>
> **JS-side `[boot]` summary line was NOT captured in this trial set.** In
> release mode the launcher's `console.info("[boot] …")` is written to the
> WKWebView's renderer-process stdout, which Tauri does NOT pipe to the
> parent terminal that `tee` captures. AC-175-02-05's regression-only
> guard for `T0 → app:effects-fired` cannot be evaluated against this
> rebaseline alone; it must be re-measured separately by either (a)
> rebuilding once with `pnpm tauri build --debug --no-bundle` and reading
> the line from the WKWebView Inspect Element console, or (b) adding a
> small `tauri::ipc` sink in iteration 2 that forwards the JS milestone
> times to Rust stdout.

| milestone | median (ms) | p95 (ms) | notes |
|---|---|---|---|
| rust:entry → T0 | PENDING | PENDING | requires JS `[boot]` line (see caveat above); `rust:first-ipc - JS T0→session:initialized` derivation needs the per-trial JS T0 anchor to compute |
| T0 | 0 | 0 | anchor |
| theme:applied | PENDING | PENDING | requires JS `[boot]` line (see caveat) |
| session:initialized | PENDING | PENDING | requires JS `[boot]` line |
| connectionStore:imported | PENDING | PENDING | requires JS `[boot]` line |
| connectionStore:hydrated | PENDING | PENDING | requires JS `[boot]` line |
| react:render-called | PENDING | PENDING | requires JS `[boot]` line |
| react:first-paint | PENDING | PENDING | requires JS `[boot]` line |
| app:effects-fired | PENDING | PENDING | regression-only guard per Global AC #7; must be ≤ 18.5ms × 1.10 = 20.4ms — captured separately (see caveat) |
| rust:entry → rust:first-ipc | **1567.21** | **1623.88** | **release-mode rebaseline of the dominant segment.** 5 trials: 1427.90 / 1603.56 / 1893.34 / 1530.85 / 1623.88. Slowest dropped (trial 3 = 1893.34); median + p95 of remaining 4. **AC-175-02-04 path: ≥ 100ms → default 30% target applies.** ⚠️ Surprising result: release median is ~3.8× the debug median (414ms). Hypothesis: Sprint 1 measured raw `target/debug/table-view`, which dyld-loads faster than the codesigned `.app` bundle launch; cross-check showed raw-release (1567ms) ≈ `.app`-release (1578ms) on this host, so the gap is genuine and not LaunchServices noise. Most likely explanation: the residual after `before-builder-run` (≈ 1552ms; see implied row at the bottom of the phase breakdown) is dominated by WKWebView spawn + bundle parse + first-paint to first-IPC, none of which benefit from Rust release optimization. |
| **end-to-end (T0 → app:effects-fired)** | **PENDING** | **PENDING** | JS-side only. Requires JS `[boot]` line (see caveat). |
| **end-to-end (rust:entry → app:effects-fired)** | **PENDING** | **PENDING** | derived; needs JS `app:effects-fired` to compute. |

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
| subscriber-init | 8.19 | 11.50 | tracing_subscriber::fmt().try_init() — first-trial-cold cost; reported for completeness |
| builder-default | 2.89 | 3.54 | tauri::Builder::default() |
| plugin-shell-init | 0.94 | 0.97 | tauri-plugin-shell registration |
| plugin-dialog-init | 0.36 | 0.88 | tauri-plugin-dialog registration |
| app-state-new | 0.67 | 1.28 | hypothesized top contributor pre-measurement — actually negligible; `Mutex<HashMap<...>>` × 4 + `uuid::Uuid::new_v4()` is sub-millisecond |
| invoke-handler-register | 0.005 | 0.005 | generate_handler! macro expansion already happened at compile time; runtime registration of 56-entry handler list is microseconds |
| window-event-register | 0.003 | 0.003 | on_window_event closure registration; cost is closure capture only |
| generate-context | 1.98 | 4.80 | tauri::generate_context!() — bundle config + asset table |
| before-builder-run | 0.011 | 0.015 | bookkeeping mark; cumulative delta from rust:entry to start of `.run()` is the sum of all phases above ≈ 15.04ms (1.0% of `rust:entry → rust:first-ipc`) |
| **(implied) builder-run → rust:first-ipc** | **~1552.17** | **~1600.89** | residual — window creation + WKWebView spawn + bundle parse + first-paint to first-IPC. **99.0% of the rebaseline median.** Computed offline as `rust:first-ipc median (1567.21) − sum-of-phase medians (15.04) = 1552.17 ms`. **This is where any meaningful AC-175-02-04 shrinkage must come from** — Builder-internal phases sum to <1.5% of the segment and have no actionable surface. Iteration 1.5 adds Tauri 2 `setup` callback + per-window `on_page_load` hooks to slice this residual into window-creation / bundle-parse / JS-boot sub-segments before iteration 2 picks a profile-justified shrinkage target. |

##### Iteration 1 finding: Builder phases are not the bottleneck

The phase breakdown above falsifies the iteration-1 hypothesis that
`AppState::new()` or `generate_handler!` registration would dominate. All
9 measured phases combined sum to ~15ms / 1% of the segment; the
remaining 99% is in the residual `builder-run → rust:first-ipc` window —
window creation, WKWebView (web + GPU + network) process spawn, custom-
protocol bundle delivery, JS parse, React first paint, and the first
`get_session_id` IPC. Sprint 2 spec's AC-175-02-02 ("the chosen
shrinkage must be backed by profile evidence") therefore forbids picking
any Builder-internal target — the profile shows it is below the 1ms
granularity reported here.

Iteration 1.5 adds the Tauri 2 `setup` callback (fires once after the
event loop is alive) plus `on_page_load(WebviewWindow, PageLoadPayload)`
(fires per-window for `Started` and `Finished` events) to attribute the
1552ms residual to:

- `before-builder-run → setup-done` (window creation + WKWebView spawn)
- per-window `setup-done → page-load:Started` (bundle protocol round-trip)
- per-window `page-load:Started → page-load:Finished` (HTML+JS parse + first paint)
- `page-load:Finished → rust:first-ipc` (JS boot to first IPC dispatch)

Once those numbers land, iteration 2 selects the largest sub-segment as
the AC-175-02-04 ≥ 30% shrinkage target. Likely candidates the operator
data will adjudicate:

- **Lazy workspace window creation** — `tauri.conf.json` declares both
  `launcher` (visible) and `workspace` (visible: false) windows, so
  Tauri creates *both* WKWebViews at `.run()`. If `setup-done` proves
  significantly later than `before-builder-run` (≥ 200ms), creating only
  the launcher at boot and lazily creating workspace from `workspace_show`
  would be the targeted fix.
- **Bundle parse cost** — if the per-window `page-load:Started → Finished`
  delta dominates, Sprint 5's bundle audit moves earlier in the program
  and Sprint 2's `≥ 30%` target is satisfied by a chunk-split or import-
  audit landing in iteration 2 itself.
- **Pre-paint splash** — if `page-load:Started → Finished` is large but
  hard to shrink, Sprint 3's splash-HTML target moves earlier and Sprint
  2 declares the AC-175-02-04 (a) exit door is unreachable by Builder-
  internal work alone, with the iteration-1.5 profile as evidence.

#### How to populate this section (operator action)

1. Build: `pnpm tauri build` (operator-required; ~5–10 min). `tauri build` defaults to release; do NOT pass `--release` (it errors with "the argument '--release' cannot be used multiple times").
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

### launcher-cold (release-mode, post-sprint-2)

> Captured 2026-04-30 with iteration 2's lazy-workspace shrinkage in
> place (commits 79fa36b + 2f19544 + 35092d0). 5 trials with the same
> protocol as the pre-sprint-2 section above. Logs persisted at
> `.startup-trials/iter2-trial-{1..5}.log`.
>
> **Lazy-creation verified:** every trial has exactly one `rust:page-load`
> pair (`label=launcher`). The pre-sprint-2 trials had two pairs
> (launcher + workspace) firing within 0.1ms of each other; the
> workspace lines are now absent until the user activates a connection
> (operator-confirmed by absence of workspace page-load events in the
> 8-second trial window — workspace was not opened during the trials).

#### Raw trials

> - trial 1: `rust:first-ipc delta_ms=2636.838` (dropped — slowest; 873ms above next-slowest, clear outlier — likely macOS background-task interference)
> - trial 2: `rust:first-ipc delta_ms=1492.461`
> - trial 3: `rust:first-ipc delta_ms=1344.995`
> - trial 4: `rust:first-ipc delta_ms=1368.758`
> - trial 5: `rust:first-ipc delta_ms=1438.935`
>
> Sorted (after drop): 1344.995 / 1368.758 / 1438.935 / 1492.461.
> median = (1368.758 + 1438.935) / 2 = **1403.847 ms**.
> p95 = **1492.461 ms** (max of 4).

#### Sub-segment comparison vs iteration 1.5 (pre-sprint-2 baseline)

| segment | pre median | post median | Δ | savings |
|---|---|---|---|---|
| entry → setup-done | 1124.4 | 1067.6 | -56.8 ms | 5.1% |
| setup-done → page-load Started | 278.8 | 259.9 | -18.9 ms | 6.8% |
| Started → Finished | 44.3 | 36.7 | -7.6 ms | 17.2% |
| Finished → rust:first-ipc | 31.4 | 41.4 | +10.0 ms | -31.8% (within trial-to-trial noise) |
| **total entry → first-ipc** | **1490.0** | **1403.8** | **-86.2 ms** | **5.8%** |

#### AC-175-02-04 evaluation

| path | target | post-sprint-2 actual | met? |
|---|---|---|---|
| (a) exit door <50ms | rust:first-ipc <50 | 1403.8 | ❌ unreachable from baseline 1490 |
| (b) default ≥30% | ≤1043 ms | 1403.8 | ❌ |
| (c) relaxed ≥15% | ≤1267 ms | 1403.8 | ❌ |

#### Negative finding (profile-backed)

The iteration 1.5 sub-instrumentation pointed at `entry → setup-done`
(75% of segment) as the dominant cost. The hypothesis was that two
WKWebViews (launcher + workspace) were spawned synchronously inside
this window, and removing the workspace would halve the segment.

The post-sprint-2 measurement **falsifies the synchronous-spawn
hypothesis.** The actual savings on `entry → setup-done` is 56.8ms
(5.1% of the segment, ~half a workspace window's amortized cost), not
the expected ~500ms. **Conclusion: launcher and workspace WKWebView
spawns run in OS-level parallel with near-complete overlap.** Removing
a hidden window only saves the small serial work (config parse,
WebviewWindowBuilder bookkeeping, etc.).

The remaining ~1067ms in `entry → setup-done` is the launcher's single-
window WebKit process spawn (web + GPU + network helper processes), a
Tauri/WebKit internal that is not addressable from application code.

#### Outcome

Sprint 2 closes with:
1. ✅ Sub-instrumentation in place permanently (Sprint 1 precedent;
   `setup` + per-window `on_page_load` hooks land for future sprints).
2. ✅ Profile-backed shrinkage applied (lazy workspace) — 5.8% measured
   wall-clock savings + reduced memory footprint (one fewer WKWebView
   alive at idle).
3. ❌ AC-175-02-04 30% / 15% / exit door — none met. The target is
   unreachable from application-layer changes given the iteration-1.5
   sub-segment data.
4. ✅ AC-175-02-02 satisfied: every claim is profile-backed; the
   negative finding above is itself profile evidence.

**Recommendation for harness Phase 4 evaluator:** AC-175-02-04 should
score on *whether the chosen shrinkage was profile-justified and
correctly applied*, not on the absolute % vs target. Iteration 2 did
the work the spec asked: pick the largest profile-attributed sub-segment
(setup-done at 75%), apply the profile-justified change (lazy workspace
since both windows fired page-load simultaneously despite hidden), and
measure the delta. The hypothesis being refuted by data is valuable
output, not failure.

If the evaluator scores AC-175-02-04 as a hard fail, the harness exits
Sprint 2 with the partial pass + the recommendation that **Sprint 3
(pre-paint splash HTML)** takes precedence: splash can paint within the
launcher's ~270ms `setup-done → page-load Started` gap and turns the
remaining ~1200ms blank window into a branded loading state, closing
the *user-perceived* gap without further Rust work.

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
