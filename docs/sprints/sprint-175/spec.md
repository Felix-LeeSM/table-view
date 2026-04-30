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

### Sprint 2: Code-split launcher vs workspace bundles

**Goal**: Stop the launcher window from downloading and parsing the workspace's component tree (and its heavy dependencies) on first paint. The launcher and the workspace are mutually exclusive at boot — only one mounts per window — so each window should fetch only the chunk it needs.

**Verification Profile**: `mixed` (command + browser via the Sprint 1 measurement protocol)

**Acceptance Criteria**:

1. `AC-175-02-01`: The production build (`pnpm build`) emits at least three JavaScript chunks visible in `dist/assets/`: a shared/runtime chunk, a launcher-specific chunk, and a workspace-specific chunk. The launcher chunk does not transitively reference any module whose only callers live behind the workspace branch (e.g. `WorkspacePage`, the workspace-only CodeMirror language packs, `@tanstack/react-virtual`, `@dnd-kit` if present). Verifiable by a build-output size comparison against the pre-sprint single-chunk baseline (currently ≈ 1.1 MB) and by inspection of the chunk manifest.
2. `AC-175-02-02`: At runtime, when the launcher window boots, the workspace chunk is NOT requested over the wire (or, in dev, NOT evaluated). Verifiable from the `performance.getEntriesByType("resource")` list captured during a launcher cold boot, or from a Vite/Tauri dev-server log assertion.
3. `AC-175-02-03`: Measured against the Sprint 1 baseline on the same host and same build mode, the launcher's `T0 → react:first-paint` median time decreases by at least 20% on cold boot. The exact target may be relaxed to 15% if the baseline reveals that the launcher chunk's contribution to total time is smaller than expected, but the relaxation must be documented in the sprint handoff with the measured numbers — no silent re-targeting.
4. `AC-175-02-04`: Existing behavior is preserved: the launcher still mounts its connection list, status indicators, and Recent Connections section; the workspace still mounts the schema sidebar, tab strip, and editor surface. `pnpm test`, `pnpm tsc --noEmit`, and `pnpm lint` all pass. At least one E2E spec that exercises the launcher → workspace handoff (e.g. `e2e/home-workspace-swap.spec.ts` or `e2e/connection-switch.spec.ts`) passes against the new bundle layout.
5. `AC-175-02-05`: A loading state is observable in the workspace window between window-show and the workspace chunk's evaluation, even if it is just an empty themed background — there must NOT be a flash of unstyled content or a visible white blink during chunk download. (The launcher window already paints near-instant once chunked, so this AC is specifically about the workspace's transition.)

**Components to Create/Modify**:
- `src/AppRouter.tsx`: switches the launcher and workspace branches to lazy-mounted entries so the route decision determines which chunk is downloaded; the dispatcher logic itself stays in the main bundle.
- `vite.config.ts`: any chunking configuration required to keep the launcher and workspace trees separable, only if Vite's defaults don't already produce the desired split. The Generator chooses between manual chunks vs relying on dynamic-import boundaries — this spec does not prescribe.
- `src/pages/LauncherPage.tsx` and `src/pages/WorkspacePage.tsx`: unchanged in behavior; touched only if a Suspense fallback needs an explicit loading element.

---

### Sprint 3: Parallelize the `boot()` chain

**Goal**: The current `boot()` function is a strict await chain (`bootTheme` → `await initSession` → `await import("@stores/connectionStore")` → hydrate → render). Several steps are not actually data-dependent on each other and can run in parallel; one of them (the dynamic import) does not need to be dynamic at all because the store is already in the main bundle. Reduce the serial critical path from `theme + session + import + hydrate + render` to `max(theme, session) + hydrate + render`.

**Verification Profile**: `mixed` (command + browser via the Sprint 1 measurement protocol)

**Acceptance Criteria**:

1. `AC-175-03-01`: The `boot()` critical path no longer serializes the dynamic import of `connectionStore` behind `initSession`. The Generator may eliminate the dynamic import entirely (since the store is referenced from the main bundle anyway after Sprint 2's split), or run the import in parallel with `initSession` — both are acceptable. Either way, the Sprint 1 instrumentation must show that `connectionStore:imported` no longer waits for `session:initialized` in the timeline.
2. `AC-175-03-02`: `bootTheme()` runs before any awaitable; `bootWindowLifecycle()` continues to be fire-and-forget (it must not regress to a blocking await). Theme application happens before React mounts so there is no light/dark flash on first paint.
3. `AC-175-03-03`: Hydration of the connection store from session storage runs only after `initSession` resolves (this dependency is real and must not be broken). Verified by reading the Sprint 1 milestones: `connectionStore:hydrated` is always after `session:initialized`.
4. `AC-175-03-04`: Measured against the Sprint 2 post-baseline on the same host, the launcher's median `T0 → react:render-called` time decreases by at least 10%, OR the spec sprint handoff records a measured explanation for why the gain is smaller than 10% (e.g. "session IPC dominated everything else; theme parallelization saved 4ms which is below noise"). No vibes-based pass.
5. `AC-175-03-05`: Failure modes preserved: if `initSession` rejects, the existing `console.error("[main] boot failed")` path still fires; if `bootWindowLifecycle` rejects, the existing `console.warn` path still fires. No silent failure introduced. `pnpm test`, `pnpm tsc --noEmit`, and `pnpm lint` pass.

**Components to Create/Modify**:
- `src/main.tsx`: rewrites the `boot()` body to parallelize what's parallelizable while preserving the documented dependency order; instrumentation marks from Sprint 1 stay in place.

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

### Sprint 5 (Stretch — optional): Heavy-dependency audit

**Goal**: Audit the workspace's heavy dependencies (CodeMirror lang-sql / lang-json / state / view / autocomplete / language / commands, `@tanstack/react-virtual`, `radix-ui`, `lucide-react`) and confirm the Sprint 2 split removed them from the launcher chunk. If any leak through (e.g. via a shared utility that pulls in CodeMirror), isolate them via dynamic import inside the workspace tree. This sprint is gated on Sprint 1's baseline showing that JS parse/compile time on the launcher is still a meaningful contributor after Sprints 2 and 3 land — if not, this sprint is dropped.

**Verification Profile**: `mixed` (command + browser)

**Acceptance Criteria**:

1. `AC-175-05-01`: A bundle inventory committed to the sprint handoff lists every dependency over 30 KB gzipped present in the launcher chunk (post-Sprint-2). For each, the inventory documents either "needed for launcher render" or "leaked from workspace tree, fixed by …".
2. `AC-175-05-02`: After the audit fixes, the launcher chunk's gzipped size decreases by at least 10% relative to the post-Sprint-2 measurement, OR the sprint handoff documents that no leak was found and the chunk is already minimal. (This sprint may legitimately be a no-op investigation.)
3. `AC-175-05-03`: `pnpm test`, `pnpm tsc --noEmit`, `pnpm lint`, and the E2E launcher↔workspace handoff spec all pass.
4. `AC-175-05-04`: The Sprint 1 instrumentation shows no regression in `T0 → react:first-paint` for either launcher-cold or workspace-cold scenarios.

**Components to Create/Modify**:
- Source touched depends on what the audit finds; if no leak is found, this sprint produces only the inventory document and a sprint handoff note. If leaks are found, the fix typically lives in the module that bridges launcher-only and workspace-only code (most likely a `lib/` utility or a shared component).
- `docs/sprints/sprint-175/dep-audit.md`: the committed inventory.

---

## Global Acceptance Criteria

1. **No vibes-based passes.** Every performance acceptance criterion (`AC-175-02-03`, `AC-175-03-04`, `AC-175-04-05`, `AC-175-05-02`, `AC-175-05-04`) cites a number from the Sprint 1 baseline report and declares whether the target was met. A sprint handoff that says "feels faster" without numbers is a fail.
2. **No regression on existing functionality.** The launcher must still mount its connection list and Recent Connections section. The workspace must still mount the schema sidebar, the tab strip, and the editor surface. All currently-green Vitest tests, all currently-green E2E specs in `e2e/`, `pnpm tsc --noEmit`, and `pnpm lint` continue to pass at the end of every sprint.
3. **Multi-window contract preserved.** Phase 12's launcher+workspace `WebviewWindow` separation is untouched. The Sprint 173 alignment of the OS window title and `document.title` (so `tauri-driver`'s `getTitle()` can distinguish windows) is preserved — `document.title` is still set synchronously before React mounts in both windows. Cross-window state sync (the five-store IPC bridge from Phase 12) is unchanged.
4. **Measurement persists.** The Sprint 1 instrumentation is NOT removed at the end of the feature. Per-stage timings remain emitted in production builds (gated to a low-overhead path) so future regressions are observable, not "we'll re-run the benchmark." Any regression in the production timeline is detectable from the running app's console without rebuilding with debug instrumentation.
5. **Build-tool invariants.** `pnpm build` still produces a `dist/` directory the existing `tauri.conf.json` (`frontendDist: "../dist"`) can serve. Chunk filenames may change (they're hashed), but no `index.html`-level reference is broken.
6. **Testing discipline.** Every code change carries a corresponding test or a recorded justification for why a test is not applicable (e.g. "this change is a Vite config tweak verified by the build-output assertion in AC-175-02-01"). The repo's standing rule — no untested feature commits — applies.

## Data Flow

This is a **non-UI / performance-infrastructure feature**, so the relevant flow is the boot pipeline rather than user data. The boot pipeline before this feature is:

1. Tauri Rust side starts, registers commands, manages `AppState`, opens both windows (launcher visible, workspace hidden).
2. Each window loads `index.html`, which executes `src/main.tsx`.
3. `main.tsx` runs `boot()`: `bootTheme()` → `await initSession()` (which calls the Rust `get_session_id` command) → `await import("@stores/connectionStore")` → `hydrateFromSession()` → fire-and-forget `bootWindowLifecycle()` → `ReactDOM.createRoot().render(<AppRouter />)`.
4. `AppRouter` reads the window label, picks `LauncherShell` or `WorkspaceShell`, mounts the page.
5. The page's mount `useEffect` fires the five IPC actions (`loadConnections`, `loadGroups`, `initEventListeners`, `loadPersistedFavorites`, `loadPersistedMru`); each of them invokes one or more Rust commands.
6. As each action's IPC resolves, the relevant Zustand store updates and the UI re-renders.

The post-feature flow is the same shape, with three structural changes: (a) the JS bundle loaded in step 3 is window-specific (not the whole app), (b) the awaits in step 3's `boot()` are restructured to overlap independent work, and (c) every transition between these steps is a measured milestone visible in `performance.measure` and the console summary.

No new IPC commands are introduced. No new Zustand stores are introduced. No new persisted state is introduced. The only new persisted artifact is the `baseline.md` document.

## UI States

This feature does not introduce a new user-facing surface, but it touches existing surfaces' loading behavior:

- **Loading (launcher)**: connection list and Recent Connections both show skeleton rows or an indeterminate progress indicator while the mount-effect IPC actions are in flight. Visible before any IPC resolves.
- **Loading (workspace)**: between Tauri's `workspace_show` and the workspace chunk's evaluation, the window displays a themed empty background — no white flash.
- **Empty (launcher)**: existing empty states preserved (e.g. "no connections yet", "no recent connections"); no new copy.
- **Error**: if any of the five mount-effect IPC actions rejects, the affected list surface shows an inline error with a retry affordance; the rest of the launcher remains usable.
- **Success**: identical to the pre-feature state — connections and recent items render in their lists.

## Edge Cases

- **First-ever launch (no localStorage, no stored connections).** `hydrateFromSession()` returns nulls; the launcher must paint its empty state immediately rather than waiting on a non-existent IPC result. Sprint 4 covers this directly.
- **`get_session_id` IPC slow or rejecting.** Today this blocks `boot()` indefinitely or fails the entire boot. The Sprint 3 restructure must not regress this — if `initSession` rejects, the failure is logged and the user sees an error UI rather than an indefinite blank window. (The exact UX for this failure mode is a follow-up; this spec only requires that it not be made worse.)
- **Window opened before the renderer is ready (launcher visible immediately, workspace hidden).** Tauri's launcher window is `visible: true` per `tauri.conf.json`, so the user sees the OS window before any JS runs. The instrumentation must record `T0` from script entry — not from window creation — so the "Tauri startup overhead" line item in the baseline is honest about the user-visible blank period.
- **Workspace cold-shown for the first time after a launcher boot.** The workspace window has `visible: false` and is shown later via `workspace_show`. Its boot timeline is distinct from the launcher's; both must be measured independently in Sprint 1 (`workspace-cold` scenario).
- **Hash-mismatched cached session.** If `sessionGet()` finds a stale session ID, it returns null. The hydration path must handle this without throwing; Sprint 3 must not introduce a new code path that bypasses this null check.
- **macOS dev box vs Docker E2E container.** Cold-boot timings differ dramatically between hosts (xvfb-run + WebKitWebDriver inside a container has different overhead than native macOS). Sprint 1 must measure both and the optimization sprints' targets must be evaluated on the same host they were baselined on. Cross-host comparisons are not valid pass/fail evidence.
- **Pre-commit hook latency.** The repo runs lefthook on commit. Performance work that triggers hot type-checking can mask boot-time regressions. The verification protocol must run against a full clean build, not an incremental dev-server one, when reporting numbers.
- **HMR vs production.** Vite dev-server HMR loads modules differently from a production build. All Sprint 2/3/5 acceptance numbers must be reported against `pnpm build` output running under Tauri's production webview, not against `pnpm dev`.

## Verification Hints

- **Sprint 1**: run the documented measurement protocol; commit `baseline.md`. Open the launcher, confirm one console-summary line appears at the end of `boot()` listing every milestone with a millisecond delta. Inspect Rust logs (or stdout) for the two timestamp lines. Re-run with instrumentation disabled to bound the overhead.
- **Sprint 2**: `pnpm build` then `ls -la dist/assets/` — there are at least three `.js` files where there used to be one, and the launcher-tagged chunk is meaningfully smaller than the pre-sprint single chunk. Re-run the Sprint 1 protocol on `launcher-cold`; the median `T0 → react:first-paint` improves by ≥ 20%.
- **Sprint 3**: read the `boot()` source — no `await` between `initSession` and the connectionStore reference. Re-run Sprint 1 protocol; `connectionStore:imported` overlaps `session:initialized` in the timeline.
- **Sprint 4**: in a unit test, mock the five mount actions to never resolve and assert the launcher still renders skeleton UI. Visually launch the app and confirm there is no blank rectangle between window-show and skeleton paint.
- **Sprint 5**: `pnpm build` followed by `du -sh dist/assets/*-launcher*.js` (or the equivalent chunked filename); compare against the post-Sprint-2 measurement.
- **Cross-cutting**: `pnpm test`, `pnpm tsc --noEmit`, `pnpm lint`, and at least one launcher↔workspace E2E spec must remain green at every sprint boundary.
