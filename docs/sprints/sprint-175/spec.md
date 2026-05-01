# Feature Spec: Cold-Startup Measurement and Optimization

## Description

The Table View desktop app currently presents a blank launcher window for several seconds on cold boot before the connection list paints. This feature instruments the boot path end-to-end (Rust entry → Tauri window create → JS `boot()` → React first paint → first interactive), captures a numeric baseline, and then applies a sequence of targeted optimizations whose success is judged exclusively against that baseline. The work matters because the launcher is the single entry surface for every user workflow — its time-to-interactive is the user's first impression of the product, and a regression here is a regression in every downstream task. Optimization without measurement is forbidden in this spec: every performance sprint after Sprint 1 must cite a baseline number from Sprint 1's report and declare a target delta.

## Sprint Breakdown

### Sprint 1: Boot-time instrumentation and baseline capture

**Goal**: Add a permanent, low-overhead measurement layer to the boot path so every later sprint can prove (or fail to prove) it improved cold-boot time. Capture a baseline report — cold and warm, launcher and workspace — that all subsequent acceptance criteria reference.

**Verification Profile**: `mixed` (command + static)

**Acceptance Criteria**:

1. `AC-175-01-01`: A reproducible measurement protocol exists, runnable on the developer's macOS dev box and inside the Docker E2E container. The protocol defines: (a) what counts as "cold" vs "warm" (e.g. cold = first launch after a reboot or after killing all `tauri-driver`/app processes and clearing the OS file cache where feasible; warm = launch immediately after a previous clean exit), (b) the exact command(s) to invoke per scenario, (c) at least 5 trials per scenario discarding the slowest and reporting median + p95.
2. `AC-175-01-02`: The frontend boot path emits a named milestone for each of the following stages, observable via `performance.getEntriesByType("measure")` and via a single one-line console summary at the end of `boot()`: T0 (script entry), `theme:applied`, `session:initialized`, `connectionStore:imported`, `connectionStore:hydrated`, `react:render-called`, `react:first-paint` (first commit), and `app:effects-fired` (the launcher/workspace mount-effect IPC fan-out has been triggered). Each stage records a duration relative to T0; missing milestones are visible as gaps in the summary, not silent.
3. `AC-175-01-03`: The Rust side emits at least two timestamps observable from logs or a single `info!` summary line: `rust:entry` (top of `run()` in `src-tauri/src/lib.rs`) and `rust:first-ipc` (the moment the first frontend `invoke()` is served — `get_session_id` is the natural candidate). The delta between these is the "Tauri startup overhead" line item in the report.
4. `AC-175-01-04`: A baseline report committed to `docs/sprints/sprint-175/baseline.md` reports per-stage timings for four scenarios — `launcher-cold`, `launcher-warm`, `workspace-cold`, `workspace-warm` — with median and p95 values for each milestone and for end-to-end (T0 → first interactive). The report names the host (OS/CPU/RAM), the build (commit SHA, debug vs release), and the date. This report is the contractual reference for every later sprint's "≤ X ms" target.
5. `AC-175-01-05`: The instrumentation overhead is itself measured and bounded: a build with the instrumentation enabled is within 2% of a build with it disabled on the warm-boot scenario, or the overhead cost is reported alongside the baseline numbers so future sprints don't conflate instrumentation with regressions.

**Components to Create/Modify**:
- `src/main.tsx`: wraps each `boot()` stage with named performance marks/measures and emits a final summary; preserves the existing await-order behavior unchanged.
- `src/AppRouter.tsx` and `src/App.tsx`: emit the `react:first-paint` and `app:effects-fired` milestones at their natural points (a render-time mark and a mount-effect mark) without altering the mount tree.
- `src-tauri/src/lib.rs` and `src-tauri/src/commands/connection.rs`: emit the two Rust-side timestamps; the second is recorded inside the first IPC handler invocation (or the Tauri command dispatch path) without changing the public command signature.
- `docs/sprints/sprint-175/baseline.md`: the committed baseline report.
- `scripts/measure-startup.*` (or equivalent): a small repeatable script the developer runs to produce one trial; the protocol can be a documented manual loop if scripting it is non-trivial, but the protocol document itself must be deterministic.

---

### Sprint 2 (REVISED 2026-04-30): Profile and shrink Rust cold start

**Goal**: The Sprint 1 baseline showed `rust:entry → rust:first-ipc` is **414ms median (debug build)** — ~96% of the user-perceived blank window — versus 18.5ms for the entire JS-side path. The original Sprint 2 (JS code-split chasing a ≥20% improvement on `T0 → react:first-paint`) targeted ~3ms savings on an 18ms path, which is below noise floor. Pivot to attacking the Rust cold-start segment directly: rebaseline in release mode (debug Rust is 5–10× slower than release for CPU-bound code), profile the actual hot spots, and apply the 1–2 highest-leverage shrinkages.

**Verification Profile**: `mixed` (command + browser via the Sprint 1 measurement protocol)

**Acceptance Criteria**:

1. `AC-175-02-01`: A release-mode rebaseline of `launcher-cold` is appended to `baseline.md` using the same five-trial-drop-slowest protocol from Sprint 1. The build recipe is documented (likely `pnpm tauri build` then run the bundled binary). All four scenarios may be rebaselined for completeness, but `launcher-cold` is the only required one for this sprint's pass/fail.
2. `AC-175-02-02`: A profile of the `rust:entry → rust:first-ipc` region is captured and committed (e.g. `docs/sprints/sprint-175/rust-profile.md` or a screenshot/SVG from `cargo flamegraph` / `Instruments.app → Time Profiler` checked into the sprint folder). The profile must identify the top 3 contributors by self-time within that 414ms (or the release-rebaselined equivalent) — likely candidates: `tauri::Builder::default()` plugin init, `AppState::new()` (connection pool / cache build), `tauri::generate_context!()` window creation, WKWebView spawn, bundle parse. The Generator may not "guess" — the profile must back the claim.
3. `AC-175-02-03`: At least one of the top-3 contributors is shrunk via a concrete code change. Likely shapes (Generator chooses based on profile evidence): lazy-init `AppState` fields that aren't needed before the first IPC; defer non-critical plugin init (e.g. `tauri-plugin-shell` if not invoked during cold boot); reduce the `generate_handler!` macro footprint by feature-gating handlers that aren't reachable on launcher-cold. The change must preserve every command's public signature.
4. `AC-175-02-04`: Measured against the **release-mode rebaseline from AC-175-02-01** on the same host and same build mode, the `rust:entry → rust:first-ipc` median decreases by **at least 30%**. The target may be relaxed to **15%** if the release rebaseline alone (i.e. before any Sprint 2 code change) already shows the segment dropped below 100ms — in which case the relaxation must be documented in the sprint handoff with the measured numbers (no silent re-targeting). If the release rebaseline shows the segment under 50ms, this sprint may be declared "no work needed; release mode solves it" and Sprint 3 becomes the first optimization sprint.
5. `AC-175-02-05`: Existing behavior is preserved: every Tauri `invoke_handler!` command in `lib.rs` still works (smoke-test by mounting the launcher and confirming the connection list IPC fan-out resolves). `pnpm test`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo fmt --check`, `pnpm tsc --noEmit`, and `pnpm lint` all pass. JS-side `T0 → app:effects-fired` is unchanged or improves (regression-only guard — Sprint 2 must not lengthen the JS path).

**Components to Create/Modify**:
- `src-tauri/src/lib.rs`: `run()` body — plugin registration, `AppState::new()` call, command handler list. Touched only as needed to apply the shrinkage selected from the profile.
- `src-tauri/src/commands/connection.rs`: `AppState::new()` and `Default for AppState` — likely site for lazy-init refactor, only if profile shows this is a top contributor.
- `docs/sprints/sprint-175/rust-profile.md` (or sibling): the committed profile evidence.
- `docs/sprints/sprint-175/baseline.md`: appended with release-rebaselined launcher-cold rows.

---

### Sprint 3 (REVISED 2026-04-30): Pre-paint splash HTML

**Goal**: Even after Sprint 2 shrinks the Rust segment, there will be a residual gap between window-show and React's first commit during which WKWebView is downloading and parsing the Vite bundle. The original Sprint 3 (parallelize the JS `boot()` chain) targeted savings on a 3ms `await initSession()` — nothing meaningful to parallelize. Pivot to ensuring the window paints something — a themed splash with the app name and a spinner — within the first frame so the user never sees a blank rectangle, regardless of how long the bundle takes.

**Verification Profile**: `mixed` (browser + command via the Sprint 1 measurement protocol)

**Acceptance Criteria**:

1. `AC-175-03-01`: `index.html` contains a self-contained splash region (inline `<style>` + minimal markup, no external CSS or font dependency) that is visible before any JS executes. The splash respects the persisted theme (light/dark) by reading from `localStorage` synchronously in a small inline script (no Tailwind, no React) so there is no light/dark flash. The splash does NOT block JS execution — it sits behind / underneath the `<div id="root">` and is removed by React's first commit (CSS rule that hides splash when `body[data-app-mounted="true"]` is set, or equivalent).
2. `AC-175-03-02`: A new performance milestone `splash:painted` is added to `BOOT_MILESTONES`. It is recorded by an inline `<script>` in `index.html` immediately after the splash markup so the mark fires before the bundled JS even starts. The Sprint 1 summary line includes it; missing/skipped renders as `<missing>` per the existing convention. The Sprint 1 milestone test (`bootInstrumentation.test.ts`) is updated for the nine-milestone list — note this is a deliberate break of the "exactly eight contractual milestones" assertion from Sprint 1, justified by the spec pivot and recorded in the sprint handoff.
3. `AC-175-03-03`: Measured `rust:entry → splash:painted` median is **≤ 200ms** on the launcher-cold scenario in release mode. (For reference: the post-Sprint-2 baseline gives the upper bound. If Sprint 2 shrunk the Rust segment to ~100ms in release, this AC means the splash paints within 100ms of the IPC-ready signal — which is realistic because WKWebView begins streaming the HTML before the bundle is parsed.)
4. `AC-175-03-04`: User-visible verification: launching the app shows a non-blank window immediately. Captured by a 5-trial screen recording or a `Stage` test that takes a screenshot ~50ms after the binary launches and asserts non-default-color pixels are present at the launcher coordinates. The Generator chooses the verification mechanism — a documented manual screen-recording protocol is acceptable as long as the result is committed to the sprint handoff.
5. `AC-175-03-05`: Existing behavior preserved: theme application after React mounts is unchanged; the splash is removed cleanly with no flash; `pnpm test`, `pnpm tsc --noEmit`, `pnpm lint` all pass; the launcher↔workspace E2E spec passes. JS-side `T0 → app:effects-fired` is unchanged or improves.

**Components to Create/Modify**:
- `index.html`: splash markup + inline theme-detection script + `splash:painted` mark + a CSS rule that hides the splash once React signals first commit.
- `src/lib/perf/bootInstrumentation.ts`: extend `BOOT_MILESTONES` with `splash:painted` (inserted after `T0`); ensure `summarizeBoot` and `findMilestoneDelta` handle it.
- `src/lib/perf/bootInstrumentation.test.ts`: update the "exactly eight milestone names in order" test for the new list (now nine), and add coverage for `splash:painted` behaving like the others.
- `src/AppRouter.tsx` (or equivalent first-commit site): add the `body[data-app-mounted="true"]` flip so the splash hides cleanly via CSS without a React render flash.

---

### Sprint 4: Mount-effect IPC fan-out hygiene

**Goal**: Both `App.tsx` (workspace) and `AppRouter.tsx`'s `LauncherShell` (launcher) currently fire the same five actions in mount effects: `loadConnections`, `loadGroups`, `initEventListeners`, `loadPersistedFavorites`, `loadPersistedMru`. Verify they are genuinely concurrent (none of them awaits another), confirm the UI does not block on `initEventListeners`, and ensure each list surface has a sensible loading/empty state so first paint is not "blank rectangle waiting on IPC."

**Verification Profile**: `mixed` (browser + command)

**Acceptance Criteria**:

1. `AC-175-04-01`: The five mount-effect actions in both `App.tsx` and `AppRouter.tsx`'s launcher branch are dispatched without serial `await` between them — verified by reading the source, by the Sprint 1 timeline (their start marks should be within the same microtask), and by a unit test that asserts none of them is awaited before the next is called.
2. `AC-175-04-02`: First paint of the launcher does NOT block on any of the five IPC calls. A skeleton or empty state for the connection list and the Recent Connections section is observable on the screen before the IPC results land. Verified visually in the running app and by a render-output snapshot in a unit test that replaces all five actions with never-resolving promises and asserts the launcher still renders a frame with skeleton/empty UI (not a blank background).
3. `AC-175-04-03`: `initEventListeners` is non-blocking with respect to UI paint — the registration call does not await any cross-window or filesystem IPC before returning control to the render path. Verified by inspection plus an instrumentation point that records the call's synchronous return time.
4. `AC-175-04-04`: Error states are observable: if any of `loadConnections` / `loadGroups` / `loadPersistedFavorites` / `loadPersistedMru` rejects, the corresponding UI surface shows a recoverable error affordance (e.g. an inline message with a retry) rather than remaining indefinitely in skeleton state. The Generator may reuse the existing connection-store `error` field if it already supports this.
5. `AC-175-04-05`: Measured against the post-Sprint-3 timeline, the launcher's `T0 → app:effects-fired` median is unchanged or improves, and `T0 → first-content-painted` (skeleton or real content, whichever is first) is no later than `react:first-paint` (i.e. there is no regression of perceived TTI introduced by the loading-state changes).

**Components to Create/Modify**:
- `src/App.tsx`: workspace-side mount effect; loading/empty/error surfacing for the workspace's first-paint state, only if a regression is found.
- `src/AppRouter.tsx` (`LauncherShell`): launcher-side mount effect; same.
- `src/pages/LauncherPage.tsx`: skeleton/empty/error states for the connection list and Recent Connections sections.
- A unit test (`src/AppRouter.test.tsx` or sibling): asserts the mount effect fans out concurrently and the page renders with skeleton when the actions are pending.

---

### Sprint 5 (REVISED 2026-04-30 — Stretch): Release-mode full rebaseline + conditional dep audit

**Goal**: Close the loop on the spec by rebaselining all four scenarios (`launcher-cold`, `launcher-warm`, `workspace-cold`, `workspace-warm`) in release mode after Sprints 2/3/4 land, and conditionally run a JS bundle dependency audit only if the JS-parse share of the post-Sprint-3 timeline is still meaningful (>200ms remaining in `splash:painted → react:first-paint`). The original Sprint 5 (heavy-dep audit gated on JS parse being "meaningful") is preserved in spirit, but with a numeric gate grounded in the new measurements rather than the discarded JS-side targets.

**Verification Profile**: `mixed` (command + browser)

**Acceptance Criteria**:

1. `AC-175-05-01`: All four scenarios are rebaselined in release mode using the Sprint 1 protocol; the `baseline.md` document gains a "Final (post-sprint-175)" section listing per-stage medians + p95 alongside the original cold-baseline numbers, with the delta column showing the cumulative improvement across Sprints 2/3/4. Host, build SHA, and date are recorded.
2. `AC-175-05-02`: A go/no-go decision on the dep audit is committed to the sprint handoff: if `splash:painted → react:first-paint` median > 200ms in launcher-cold release rebaseline, the audit runs; otherwise it's skipped with a justification line. If skipped, that's a legitimate pass — this is a stretch sprint.
3. `AC-175-05-03`: If the audit runs: a bundle inventory committed to the sprint handoff lists every dependency over 30 KB gzipped present in the launcher-reachable code path. For each, the inventory documents either "needed for launcher render" or "leaked from workspace tree, fixed by …". The audit results in either a fix commit (with a measured ≥10% chunk-size reduction) or a documented "no leak found, audit was a no-op investigation."
4. `AC-175-05-04`: `pnpm test`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo fmt --check`, `pnpm tsc --noEmit`, `pnpm lint`, and at least one launcher↔workspace E2E spec all pass. No regression in `T0 → react:first-paint` or `T0 → app:effects-fired` in either launcher-cold or workspace-cold scenarios.
5. `AC-175-05-05`: A short retrospective lands in `docs/sprints/sprint-175/handoff.md` summarizing: (a) original assumption (JS path dominates), (b) what the measurement showed (Rust path dominates 96%), (c) the resulting pivot and which sprints landed which gains, (d) any remaining headroom and where the next investigation should start.

**Components to Create/Modify**:
- `docs/sprints/sprint-175/baseline.md`: appended with the "Final" section.
- `docs/sprints/sprint-175/handoff.md`: appended retrospective.
- `docs/sprints/sprint-175/dep-audit.md`: only if the audit runs.
- Source touched only if the audit runs and finds a leak; most likely a `lib/` utility or shared component bridging launcher-only and workspace-only code.

---

## Pivot history (2026-04-30)

The original Sprint 1 baseline (committed in `baseline.md`) revealed that the JS-side boot path is **18.5ms median end-to-end** while the Rust-side `rust:entry → rust:first-ipc` segment is **414ms median (debug)** — ~96% of the perceived blank window. The original Sprint 2/3 ACs targeted single-digit-ms improvements on the 18ms slice, which was below noise floor. Sprints 2, 3, and 5 were rewritten to attack the Rust segment and the WKWebView paint gap directly. Sprint 1 and Sprint 4 are preserved verbatim. This table records the original-vs-revised shape for future readers:

| sprint | original goal | revised goal | reason |
|---|---|---|---|
| 1 | Boot instrumentation + baseline | (unchanged) | Foundational; produced the data that triggered the pivot. |
| 2 | Code-split launcher vs workspace bundles, ≥20% faster `T0 → react:first-paint` | Profile + shrink Rust cold start, ≥30% faster `rust:entry → rust:first-ipc` (release-rebaselined; relaxable to 15%) | JS bundle was 5% of perceived blank; Rust was 96%. |
| 3 | Parallelize the JS `boot()` chain, ≥10% faster `T0 → react:render-called` | Pre-paint splash HTML with `splash:painted` milestone, `rust:entry → splash:painted` ≤ 200ms median | Nothing meaningful to parallelize on the JS side (3ms `await initSession`). User-perceived gain is hiding the WKWebView paint gap. |
| 4 | Mount-effect IPC fan-out hygiene | (unchanged) | Still valid for *content* TTI even after the window-paint gain. |
| 5 | Heavy-dep audit gated on JS parse being meaningful | Release-mode full rebaseline + dep audit gated on `splash:painted → react:first-paint` > 200ms | Same intent (gated audit), but the gate is grounded in the new measurements. |

## Global Acceptance Criteria

1. **No vibes-based passes.** Every performance acceptance criterion (`AC-175-02-04`, `AC-175-03-03`, `AC-175-04-05`, `AC-175-05-04`) cites a number from the Sprint 1 baseline (or its Sprint 2 release rebaseline) and declares whether the target was met. A sprint handoff that says "feels faster" without numbers is a fail.
2. **No regression on existing functionality.** The launcher must still mount its connection list and Recent Connections section. The workspace must still mount the schema sidebar, the tab strip, and the editor surface. All currently-green Vitest tests, all currently-green E2E specs in `e2e/`, `pnpm tsc --noEmit`, and `pnpm lint` continue to pass at the end of every sprint.
3. **Multi-window contract preserved.** Phase 12's launcher+workspace `WebviewWindow` separation is untouched. The Sprint 173 alignment of the OS window title and `document.title` (so `tauri-driver`'s `getTitle()` can distinguish windows) is preserved — `document.title` is still set synchronously before React mounts in both windows. Cross-window state sync (the five-store IPC bridge from Phase 12) is unchanged.
4. **Measurement persists.** The Sprint 1 instrumentation is NOT removed at the end of the feature. Per-stage timings remain emitted in production builds (gated to a low-overhead path) so future regressions are observable, not "we'll re-run the benchmark." Any regression in the production timeline is detectable from the running app's console without rebuilding with debug instrumentation.
5. **Build-tool invariants.** `pnpm build` still produces a `dist/` directory the existing `tauri.conf.json` (`frontendDist: "../dist"`) can serve. Chunk filenames may change (they're hashed), but no `index.html`-level reference is broken. `cargo clippy --all-targets --all-features -- -D warnings` and `cargo fmt --check` continue to pass after any Sprint 2 Rust change.
6. **Testing discipline.** Every code change carries a corresponding test or a recorded justification for why a test is not applicable (e.g. "this change is an `index.html` splash markup verified by the screen-recording protocol in AC-175-03-04"). The repo's standing rule — no untested feature commits — applies.
7. **JS path is regression-only after the pivot.** Sprints 2/3/5 must not lengthen `T0 → app:effects-fired` from its Sprint 1 baseline of 18.5ms median. Improvements are welcome but not required. This guard prevents the Rust-side optimizations from accidentally bloating the JS bundle (e.g. by adding a heavy splash dependency).

## Data Flow

This is a **non-UI / performance-infrastructure feature**, so the relevant flow is the boot pipeline rather than user data. The boot pipeline before this feature is:

1. Tauri Rust side starts, registers commands, manages `AppState`, opens both windows (launcher visible, workspace hidden).
2. Each window loads `index.html`, which executes `src/main.tsx`.
3. `main.tsx` runs `boot()`: `bootTheme()` → `await initSession()` (which calls the Rust `get_session_id` command) → `await import("@stores/connectionStore")` → `hydrateFromSession()` → fire-and-forget `bootWindowLifecycle()` → `ReactDOM.createRoot().render(<AppRouter />)`.
4. `AppRouter` reads the window label, picks `LauncherShell` or `WorkspaceShell`, mounts the page.
5. The page's mount `useEffect` fires the five IPC actions (`loadConnections`, `loadGroups`, `initEventListeners`, `loadPersistedFavorites`, `loadPersistedMru`); each of them invokes one or more Rust commands.
6. As each action's IPC resolves, the relevant Zustand store updates and the UI re-renders.

The post-feature flow is the same shape, with three structural changes: (a) the Rust startup segment is shrunk via Sprint 2's profile-driven changes, (b) `index.html` paints a themed splash before any bundle JS runs (Sprint 3), and (c) every transition between these steps is a measured milestone visible in `performance.measure` and the console summary.

No new IPC commands are introduced. No new Zustand stores are introduced. No new persisted state is introduced. The only new persisted artifacts are the `baseline.md` document and (Sprint 2) the Rust profile capture.

## UI States

This feature does not introduce a new user-facing surface, but it touches existing surfaces' loading behavior:

- **Splash (both windows, Sprint 3)**: themed background + app name + spinner, painted in the first browser frame from `index.html`. Removed by React's first commit. No flash of unstyled content.
- **Loading (launcher)**: connection list and Recent Connections both show skeleton rows or an indeterminate progress indicator while the mount-effect IPC actions are in flight. Visible after the splash hides and before any IPC resolves.
- **Loading (workspace)**: between Tauri's `workspace_show` and the workspace chunk's evaluation, the window displays the same themed splash — no white flash.
- **Empty (launcher)**: existing empty states preserved (e.g. "no connections yet", "no recent connections"); no new copy.
- **Error**: if any of the five mount-effect IPC actions rejects, the affected list surface shows an inline error with a retry affordance; the rest of the launcher remains usable.
- **Success**: identical to the pre-feature state — connections and recent items render in their lists.

## Edge Cases

- **First-ever launch (no localStorage, no stored connections).** `hydrateFromSession()` returns nulls; the launcher must paint its empty state immediately rather than waiting on a non-existent IPC result. Sprint 4 covers this directly. The Sprint 3 splash respects `localStorage` theme but must not crash when it's absent — default to system theme.
- **`get_session_id` IPC slow or rejecting.** Today this blocks `boot()` indefinitely or fails the entire boot. The Sprint 2 Rust changes must not regress this — if `initSession` rejects, the failure is logged and the user sees an error UI rather than an indefinite blank window. (The exact UX for this failure mode is a follow-up; this spec only requires that it not be made worse.)
- **Window opened before the renderer is ready (launcher visible immediately, workspace hidden).** Tauri's launcher window is `visible: true` per `tauri.conf.json`, so the user sees the OS window before any JS runs. This is the exact scenario Sprint 3's splash addresses — the window's first frame must be themed, not the WKWebView default.
- **Workspace cold-shown for the first time after a launcher boot.** The workspace window has `visible: false` and is shown later via `workspace_show`. Its boot timeline is distinct from the launcher's; both must be measured independently in Sprint 1 (`workspace-cold` scenario) and rebaselined in Sprint 5.
- **Hash-mismatched cached session.** If `sessionGet()` finds a stale session ID, it returns null. The hydration path must handle this without throwing; Sprint 2's Rust changes must not introduce a new code path that bypasses this null check.
- **macOS dev box vs Docker E2E container.** Cold-boot timings differ dramatically between hosts (xvfb-run + WebKitWebDriver inside a container has different overhead than native macOS). Sprint 1 must measure both and the optimization sprints' targets must be evaluated on the same host they were baselined on. Cross-host comparisons are not valid pass/fail evidence.
- **Debug vs release.** The Sprint 1 baseline was captured in debug mode (`tauri build --debug --no-bundle` so devtools stay enabled). Sprint 2's first task is a release rebaseline because debug Rust is 5–10× slower than release for CPU-bound code. All Sprint 2/3/4/5 targets reference the release rebaseline.
- **HMR vs production.** Vite dev-server HMR loads modules differently from a production build. All Sprint 2/3/4/5 acceptance numbers must be reported against `pnpm build` output running under Tauri's production webview, not against `pnpm dev`.

## Verification Hints

- **Sprint 1**: run the documented measurement protocol; commit `baseline.md`. Open the launcher, confirm one console-summary line appears at the end of `boot()` listing every milestone with a millisecond delta. Inspect Rust logs (or stdout) for the two timestamp lines. Re-run with instrumentation disabled to bound the overhead.
- **Sprint 2**: capture a `cargo flamegraph` (or Instruments.app Time Profiler) of the launcher process from `tauri build --release` start to first-IPC; commit the SVG/screenshot. Apply one shrinkage from the top-3 contributors. Re-run the Sprint 1 protocol with the released binary; the `rust:entry → rust:first-ipc` median improves by ≥30% (or ≥15% if release alone solved it; or "no work needed" if release alone hit <50ms).
- **Sprint 3**: launch the binary; the window paints a themed splash within the first visible frame. Verify with a screen-recording or by `getEntriesByName("splash:painted")`. Re-run Sprint 1 protocol; `rust:entry → splash:painted` ≤ 200ms median.
- **Sprint 4**: in a unit test, mock the five mount actions to never resolve and assert the launcher still renders skeleton UI. Visually launch the app and confirm there is no blank rectangle between window-show and skeleton paint.
- **Sprint 5**: re-run the Sprint 1 protocol on all four scenarios in release mode; commit the "Final" section of `baseline.md` showing per-stage deltas across the feature. Run the dep audit only if the gate (>200ms `splash:painted → react:first-paint`) fires.
- **Cross-cutting**: `pnpm test`, `pnpm tsc --noEmit`, `pnpm lint`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo fmt --check`, and at least one launcher↔workspace E2E spec must remain green at every sprint boundary.
