# Feature Spec: Phase 12 — Multi-Window Split (Launcher / Workspace)

## Description

Phase 12 supersedes ADR 0011's single-window stub by splitting the app into two real Tauri windows: a fixed-size 720×560 Launcher window hosting the Home screen, and a resizable 1280×800 Workspace window hosting the per-connection work surface. Activating a connection swaps the launcher out for the workspace while preserving the Rust connection pool; "Back to connections" reverses the swap without disconnecting; "Disconnect" remains the only path that evicts the pool. This phase converts the 5 deferred `it.todo()` invariants into live tests, retires RISK-025, and registers a new ADR that supersedes 0011.

## Sprint Breakdown

### Sprint 150: Two-Window Foundation

**Goal**: Replace the single-window Tauri config with a launcher + workspace pair, route the React entrypoint to the correct page based on which window is mounting it, and prove (in a failing test first) that boot lands on the launcher window with the right geometry.

**Verification Profile**: mixed (command + static)

**Acceptance Criteria**:
1. `src-tauri/tauri.conf.json` declares two `windows[]` entries with labels `launcher` (720×560, `resizable: false`, `maximizable: false`, centered, visible at startup) and `workspace` (1280×800, `resizable: true`, `minWidth`/`minHeight` defined, hidden at startup). File inspection confirms exact dimensions and flags.
2. A new Rust module under `src-tauri/src/` (e.g. `launcher.rs` plus mod registration in `lib.rs`) exposes Tauri commands the frontend can call to show/hide/focus the two windows by label. `cargo build` succeeds and `cargo test` for the new module's unit tests passes.
3. The React entrypoint (e.g. `src/main.tsx` or a new `src/AppRouter.tsx`) reads the current `WebviewWindow` label at boot and mounts `LauncherPage` (new) when the label is `launcher` and the existing workspace shell when the label is `workspace`. `pnpm tsc --noEmit` and `pnpm vitest run` succeed.
4. A new test file (e.g. `src/__tests__/window-bootstrap.test.tsx`) authored BEFORE the code change asserts: when the active window label is `launcher`, the launcher page renders; when the label is `workspace`, the workspace shell renders. Test runs red against pre-sprint code and green after.
5. The previously single-window `App.tsx` no longer reads `appShellStore.screen` for screen routing; that field is retained only for backward-compatible test seams (see Sprint 154 for full deprecation).

**Components to Create/Modify**:
- `src-tauri/tauri.conf.json`: redefine `windows[]` with launcher + workspace entries and per-window flags.
- `src-tauri/src/launcher.rs` (new): module that owns window lifecycle commands (show/hide/focus/close) addressed by label.
- `src-tauri/src/lib.rs`: register the new module and the new commands in `invoke_handler`.
- `src/main.tsx` (or a new `src/AppRouter.tsx`): label-aware mount that picks Launcher vs Workspace.
- `src/pages/LauncherPage.tsx` (new): host shell that renders the existing `HomePage` body inside a launcher-only chrome.
- `src/__tests__/window-bootstrap.test.tsx` (new, TDD-first): label-routing test using a mocked `getCurrentWebviewWindow()`.
- `src/App.tsx`: stop branching on `appShellStore.screen` for the top-level page; keep keyboard shortcut handlers under window-appropriate guards.

---

### Sprint 151: Cross-Window State Bridge

**Goal**: Introduce a generic Zustand-over-Tauri-events bridge so a state mutation in one window propagates to the other, without committing to which stores it ultimately wraps. Lock the bridge contract via tests authored before the implementation.

**Verification Profile**: command

**Acceptance Criteria**:
1. A new module (e.g. `src/lib/zustand-ipc-bridge.ts`) exposes a function that, given a Zustand store and a stable channel name, broadcasts state diffs over Tauri events and applies inbound events without re-broadcasting (loop guard).
2. A new test file (e.g. `src/lib/zustand-ipc-bridge.test.ts`) authored BEFORE the implementation asserts: (a) local `setState` triggers a single outbound emit; (b) inbound emit applies state and does NOT re-emit; (c) bridges respect a per-key allowlist so transient/window-local fields are not synced; (d) two stores attached to the same channel name in different "windows" (simulated via mocked event bus) converge.
3. `pnpm vitest run` shows the new file's tests passing; `pnpm tsc --noEmit` clean.
4. No production store is wired to the bridge yet — Sprint 151 only ships the harness and its tests. Grep confirms zero call sites in `src/stores/`.
5. The bridge module documents (via JSDoc) which keys are sync-safe vs. window-local so Sprints 152–153 can apply per-key allowlists without re-deriving the contract.

**Components to Create/Modify**:
- `src/lib/zustand-ipc-bridge.ts` (new): broadcast-and-listen primitive with loop guard and per-key allowlist.
- `src/lib/zustand-ipc-bridge.test.ts` (new, TDD-first): contract tests including loop-guard, allowlist filter, and two-store convergence.
- `src/test-setup.ts` (modify if needed): provide a shared mock for `@tauri-apps/api/event` that lets multiple stores in the same test process exchange events.

---

### Sprint 152: Sync Connection State Across Windows

**Goal**: Wire the bridge into the connection-related stores so the launcher and workspace observe the same `connections`, `groups`, `activeStatuses`, and `focusedConnId`. Load-bearing for AC-141-3 (Back preserves pool).

**Verification Profile**: mixed (command + browser via vitest harness)

**Acceptance Criteria**:
1. A new test file (e.g. `src/__tests__/cross-window-connection-sync.test.tsx`) authored BEFORE the wiring asserts: (a) mutating `activeStatuses` in the simulated workspace window propagates to the launcher window's store within the same tick of the mocked event bus; (b) `focusedConnId` writes from the launcher reach the workspace; (c) password fields and other sensitive payload keys are NOT broadcast (allowlist enforcement).
2. `connectionStore.ts` opts into the bridge with an explicit allowlist for synced keys; the test from AC-1 passes, all existing `connectionStore.test.ts` tests still pass, and `connection-sot.ac142.test.tsx` invariants remain green.
3. AC-141-3 invariant — when the workspace fires "Back to connections", the launcher's view of `activeStatuses["c1"].type` is observed as `connected` (no `disconnect` Tauri call recorded) — has a passing live test in either the new cross-window file or an updated `window-lifecycle.ac141.test.tsx`.
4. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` exit 0. No new `it.skip` / `it.todo`.

**Components to Create/Modify**:
- `src/stores/connectionStore.ts`: opt into the Sprint 151 bridge with a documented allowlist.
- `src/__tests__/cross-window-connection-sync.test.tsx` (new, TDD-first).
- `src/stores/connectionStore.test.ts`: extend with a per-key allowlist regression.

---

### Sprint 153: Sync Remaining Shared Stores (Tabs, MRU, Theme, Favorites, AppShell)

**Goal**: Apply the bridge to `tabStore`, `mruStore`, `themeStore`, `favoritesStore`, and either deprecate or window-scope `appShellStore.screen`. Lock test parity for each store.

**Verification Profile**: command

**Acceptance Criteria**:
1. A new test file authored BEFORE wiring asserts: (a) `tabStore` mutations from the workspace window NEVER bleed into the launcher's runtime; (b) `mruStore` updates triggered by either window converge in both; (c) `themeStore` updates apply to both windows; (d) `favoritesStore` syncs both directions.
2. `appShellStore.screen` is either removed entirely or narrowed to a window-scoped sentinel that no longer drives top-level routing.
3. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` exit 0. Suite total ≥ Sprint 149's 2244, with new sync tests added; no `it.skip` / `it.todo` introduced.

**Components to Create/Modify**:
- `src/stores/tabStore.ts`, `src/stores/mruStore.ts`, `src/stores/themeStore.ts`, `src/stores/favoritesStore.ts`: opt into bridge with per-store allowlists.
- `src/stores/appShellStore.ts`: deprecate `screen` or scope it window-locally.
- `src/__tests__/cross-window-store-sync.test.tsx` (new, TDD-first).

---

### Sprint 154: Window Lifecycle Wiring (Activate / Back / Disconnect / Close Semantics)

**Goal**: Wire the user-facing transitions to real `WebviewWindow.show/hide/focus/close` calls.

**Verification Profile**: mixed (command + browser via vitest harness)

**Acceptance Criteria**:
1. A new test file (e.g. `src/__tests__/window-transitions.test.tsx`) authored BEFORE wiring asserts via a `WebviewWindow` mock: (a) launcher activation flow calls `workspace.show()` then `workspace.setFocus()` then `launcher.hide()` in that order; (b) workspace "Back to connections" calls `workspace.hide()` then `launcher.show()` and never invokes `disconnectFromDatabase`; (c) workspace toolbar Disconnect invokes `disconnectFromDatabase(id)` with the focused id and does NOT hide the workspace solely as a side effect of the disconnect; (d) the launcher close event triggers app-exit; (e) the workspace close event recovers the launcher (workspace hides, launcher shows) without disconnecting.
2. Production wiring lives in `LauncherPage.tsx`, `WorkspacePage.tsx`, and the existing Disconnect button surface; pre-Sprint 154 `appShellStore.setScreen` calls are replaced with bridge-aware lifecycle calls.
3. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` exit 0.
4. `connection-sot.ac142.test.tsx` invariants for AC-142-* remain green.

**Components to Create/Modify**:
- `src/pages/LauncherPage.tsx`: wire connection activation to workspace show/focus + launcher hide.
- `src/pages/WorkspacePage.tsx`: replace Back's `setScreen("home")` with workspace.hide + launcher.show; add `tauri://close-requested` handler.
- `src/main.tsx`: register launcher close handler that triggers app exit.
- `src/__tests__/window-transitions.test.tsx` (new, TDD-first).

---

### Sprint 155: Test Conversion, ADR, and Risk Closure

**Goal**: Convert the 5 `it.todo()` placeholders into real `it()` assertions, retire ADR 0011 with a successor ADR, and flip RISK-025 from `deferred` to `resolved`. Phase-exit gate sprint.

**Verification Profile**: mixed (command + static)

**Acceptance Criteria**:
1. `src/__tests__/window-lifecycle.ac141.test.tsx` no longer contains any `describe.skip` / `it.todo` / `it.skip` / `xit` / `this.skip()`. The 5 deferred AC-141-* (real) cases are now live `it(...)` and pass against the Sprint 150–154 implementation.
2. `grep -rE "it\.skip|this\.skip\(\)|it\.todo|xit\(" src/__tests__/window-lifecycle.ac141.test.tsx` returns empty.
3. A new ADR file (`memory/decisions/0012-multi-window-launcher-workspace/memory.md`) is created with `supersedes: 0011`. ADR 0011 front-matter `superseded_by` is updated to `0012`. ADR 0011 body is NOT edited (frozen).
4. `docs/RISKS.md` shows RISK-025 status as `resolved` with a resolution log entry citing Sprint 150–155, and the summary counters are recomputed.
5. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` exit 0. Test counts ≥ Sprint 149's 2244 with the 5 todos now active.

**Components to Create/Modify**:
- `src/__tests__/window-lifecycle.ac141.test.tsx`: convert 5 todos into live tests, remove `describe.skip`, prune dead stub cases or repoint them at the real harness.
- `memory/decisions/0012-multi-window-launcher-workspace/memory.md` (new).
- `memory/decisions/0011-single-window-stub-for-launcher-workspace/memory.md`: front-matter `superseded_by` only.
- `memory/decisions/memory.md`: index updated.
- `docs/RISKS.md`: RISK-025 status flip + resolution log entry.

---

## Global Acceptance Criteria

1. **Two real windows**: 720×560 fixed launcher + 1280×800 resizable workspace as distinct `WebviewWindow` instances.
2. **Pool-preserving Back**: every code path that returns user from workspace to launcher leaves `activeStatuses` untouched and never invokes `disconnectFromDatabase`.
3. **Pool-evicting Disconnect**: workspace toolbar Disconnect remains the only user-facing path that calls `disconnectFromDatabase`.
4. **Cross-window state coherence**: the 5–6 designated stores propagate broadcast-allowed keys; sensitive/transient keys remain window-local.
5. **TDD-first**: every sprint introduces a failing test BEFORE implementation.
6. **Skip-zero gate at phase exit**: no `it.skip`, `it.todo`, `xit(`, `this.skip()`, or `describe.skip` remain in the touched test files.
7. **No regression**: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` all exit 0 every sprint; total ≥ 2244.
8. **macOS e2e remains deferred** (RISK-020): vitest + WebviewWindow mock is the verification surface.

## Data Flow

- **Frontend → Backend (existing)**: `connectToDatabase(id)`, `disconnectFromDatabase(id)`, schema/query commands — unchanged.
- **Frontend → Backend (new in Sprint 150)**: small surface of show/hide/focus/close commands keyed by window label, plus app-exit command for launcher close.
- **Frontend → Frontend (new in Sprints 151–153)**: Tauri event channels carrying Zustand state diffs between launcher and workspace; loop-guarded; per-key allowlisted; passwords excluded.
- **State ownership map**:
  - Synced cross-window: `connections`, `groups`, `activeStatuses`, `focusedConnId`, `mruStore.entries`, `themeStore.themeId`/`mode`, `favoritesStore.entries`.
  - Workspace-local: `tabStore.tabs`, `tabStore.activeTabId`, `dirtyTabIds`, schema-tree caches.
  - Launcher-local: connection picker UI ephemera.
  - Deprecated: `appShellStore.screen`.

## UI States (per sprint where relevant)

- **Boot (Sprint 150)**: only launcher visible. Workspace exists but hidden.
- **Activation (Sprint 154)**: workspace appears at 1280×800 with focus; launcher hides.
- **Back (Sprint 154)**: launcher reappears; workspace hides; connection list shows still `connected`.
- **Reactivate (Sprint 154)**: second activation re-shows workspace instantly (no reconnect cost).
- **Disconnect (Sprint 154)**: `activeStatuses` becomes `disconnected`; pool evicted.
- **Launcher close**: app exits cleanly.
- **Workspace close**: same as Back.
- **Error**: failed `workspace.show()` or backend command surfaces toast in originating window.

## Edge Cases

- Rapid double activation of two different connections (race between `workspace.show()` + state-diff broadcasts) — workspace ends focused on last activation; launcher hides exactly once.
- Closing workspace while query running — Back semantics; query keeps running on backend; reactivate restores in-progress state.
- `Cmd+Q` while only workspace visible — hidden launcher must not block exit.
- Theme change from launcher mid-session must reach hidden workspace.
- Disconnect race vs Back click — Disconnect wins (final state `disconnected`, launcher visible, pool gone).
- Two events arrive for same store key in same tick — loop guard preserves local mutation; inbound doesn't re-emit.

## Verification Hints

- **Per-sprint command sweep**: `pnpm vitest run`; `pnpm tsc --noEmit`; `pnpm lint`.
- **Skip-zero gate (Sprint 155)**: `grep -rE "it\.skip|this\.skip\(\)|it\.todo|xit\(|describe\.skip" src/__tests__/window-lifecycle.ac141.test.tsx` empty.
- **Static config inspection (Sprint 150)**: `tauri.conf.json` shows two `windows[]` with exact dimensions and flags.
- **ADR + Risk closure (Sprint 155)**: ADR 0012 exists with `supersedes: 0011`; ADR 0011 front-matter `superseded_by: 0012`; RISK-025 row reads `resolved`.

---

## Phase Exit Gate

Before declaring Phase 12 complete, the orchestrator MUST confirm:

1. **Skip-zero in touched files**: grep on `src/__tests__/window-lifecycle.ac141.test.tsx` empty for `it.skip|this.skip()|it.todo|xit(|describe.skip`.
2. **Suite parity or growth**: `pnpm vitest run` ≥ 2244 with 0 todo; `pnpm tsc --noEmit` exit 0; `pnpm lint` exit 0.
3. **ADR transition recorded**: ADR 0012 file exists with `supersedes: 0011`; ADR 0011 front-matter `superseded_by: 0012` (body unchanged — `git diff` shows only frontmatter line); index updated.
4. **Risk register updated**: RISK-025 status `resolved`; resolution log entry citing Sprints 150–155; counters recomputed.
5. **Backend command surface**: `cargo build` and `cargo test` exit 0; `lib.rs` `invoke_handler` registers new launcher commands.
6. **Cross-window store contract**: all 5–6 target stores opt into bridge with explicit allowlists; allowlist tests prevent broadcast of password/sensitive fields.

If any of (1)–(6) fails, Phase 12 does not exit and the responsible sprint is reopened.
