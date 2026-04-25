# Sprint 125 — Generator Handoff

## Changed Files

### New
- `src/stores/appShellStore.ts` — Zustand store with `screen: "home" | "workspace"` + idempotent `setScreen` (returns same reference on no-op so React subscribers don't re-render).
- `src/stores/appShellStore.test.ts` — 5 tests: initial value is `home`, `setScreen` flips, idempotent no-op preserves reference, does not touch `tabStore`.
- `src/pages/HomePage.tsx` — Paradigm-agnostic Home screen: header (Import/Export, New Group, New Connection), `ConnectionList` body with `onSelect` (focus only) + `onActivate` (focus + `setScreen("workspace")`), Recent placeholder, theme picker footer. Mounts ConnectionDialog/GroupDialog/ImportExportDialog. Listens to `new-connection` window event for Cmd+N parity.
- `src/pages/HomePage.test.tsx` — 11 tests covering ConnectionList render, button presence, dialog open, no `SidebarModeToggle`, onSelect/onActivate semantics, Recent placeholder.
- `src/pages/WorkspacePage.tsx` — Renders `[← Connections]` back button (`aria-label="Back to connections"`) above existing `Sidebar`, with `MainArea` to the right. Back click → `setScreen("home")`; tabStore untouched.
- `src/pages/WorkspacePage.test.tsx` — 5 tests: renders Sidebar+MainArea, back button present + a11y label, no `SidebarModeToggle`, back click flips screen, back click does NOT clear tabStore.
- `e2e/_helpers.ts` — Helpers shared by all e2e specs: `isWorkspaceMounted`, `ensureHomeScreen`, `ensureTestPgConnection`, `openTestPgWorkspace`, `backToHome`. Uses `[aria-label="Back to connections"]` as Workspace sentinel and `[aria-label="New Connection"]` as Home sentinel.
- `e2e/home-workspace-swap.spec.ts` — Sprint-125 contract regression: 4 tests covering boot→Home, Open→Workspace, back→Home, re-Open→tab persists.

### Modified
- `src/App.tsx` — Replaced direct `<Sidebar /> + <MainArea />` with `screen === "home" ? <HomePage /> : <WorkspacePage />` driven by `useAppShellStore`.
- `src/App.test.tsx` — Mock targets switched from `./components/layout/Sidebar` + `./components/layout/MainArea` to `./pages/HomePage` + `./pages/WorkspacePage`; new test asserts the correct page mounts per `appShellStore.screen`.
- `src/components/layout/Sidebar.tsx` — Stripped connections-mode logic: removed `SidebarModeToggle` import+mount, removed `mode` state, removed `ConnectionList`/`GroupDialog`/`ImportExportDialog` imports, removed `connection-added` listener (focus healing handles new connections). Body is now exclusively `<SchemaPanel selectedId={focusedConnId} />`. Kept theme picker, resize handle, New Query Tab button, focus-healing effect, active-tab focus-sync effect, `new-connection` event listener.
- `src/components/layout/Sidebar.test.tsx` — Rewritten to 13 tests for the schemas-only Sidebar.
- `e2e/app.spec.ts`, `e2e/connection.spec.ts`, `e2e/data-grid.spec.ts`, `e2e/import-export.spec.ts`, `e2e/raw-query-edit.spec.ts`, `e2e/schema-tree.spec.ts`, `e2e/paradigm-and-shortcuts.spec.ts` — Each updated to import from `./_helpers` and call the appropriate `openTestPgWorkspace()` / `ensureHomeScreen()` helper in `beforeEach`, so flow always passes through Home → Open before touching Workspace UI.

## Checks Run
- `pnpm vitest run` — **PASS**, 1887 tests passing (1882 baseline + 5 new from `appShellStore.test.ts`; HomePage/WorkspacePage/Sidebar tests replace pre-existing tests).
- `pnpm tsc --noEmit` — **PASS**, 0 errors.
- `pnpm lint` — **PASS**, 0 errors.
- `pnpm contrast:check` — **PASS**, 0 new violations.
- `pnpm exec tsc --noEmit e2e/*.ts` — only baseline missing-types errors (`@wdio/globals` not found, `Cannot find name 'browser'`, etc.) — none introduced by this sprint. Per contract these baseline errors are acceptable.

## Done Criteria Coverage

- **AC-01 — Boot lands on Home with ConnectionList**: covered by `e2e/home-workspace-swap.spec.ts:24-44` ("boots into the Home screen with the ConnectionList rendered") + unit `src/App.test.tsx` Home-by-default + `src/stores/appShellStore.test.ts` (initial = `home`).
- **AC-02 — Open swaps to Workspace**: covered by `e2e/home-workspace-swap.spec.ts:46-72` and `src/pages/HomePage.test.tsx` `onActivate` test (asserts `setScreen("workspace")`).
- **AC-03 — Workspace mounts Sidebar+MainArea+Back button**: `src/pages/WorkspacePage.test.tsx` (renders both, back button has correct aria-label) + `e2e/home-workspace-swap.spec.ts:46-72`.
- **AC-04 — Back button returns to Home**: `e2e/home-workspace-swap.spec.ts:74-94` + `src/pages/WorkspacePage.test.tsx` (click → `setScreen("home")`).
- **AC-05 — Tab state persists across back/forward**: `e2e/home-workspace-swap.spec.ts:96-115` (re-Open Test PG asserts `tabs.length > 0`) + `src/pages/WorkspacePage.test.tsx` (back-click does NOT call any tabStore mutator).
- **AC-06 — SidebarModeToggle does not mount inside Workspace**: `src/pages/WorkspacePage.test.tsx` (`queryByLabelText` for the toggle returns null) + `src/components/layout/Sidebar.test.tsx` (no toggle rendered).
- **AC-07 — Backend untouched**: no changes under `src-tauri/`. `git status` confirms only TypeScript/TSX/MD edits.
- **AC-08 — All existing vitest tests still pass**: `pnpm vitest run` passes 1887/1887.

## Assumptions
- `ConnectionList` already exposes `onSelect` (focus) vs `onActivate` (open) split — Home wires Open to `onActivate`. If older callers depended on a single `onSelect=open` shape we did not regress them; only `HomePage` overrides activation.
- The Back button is stacked **above** the Sidebar inside the sidebar column (not over MainArea) so layout/resize logic in Sidebar continues to work without modification.
- `tabStore` already persists to localStorage — we did not add new persistence; we only verified back-click does not call any mutator that would clear it.
- `appShellStore` is intentionally **not** persisted: every fresh app boot returns to Home, matching the contract's "boot → Home" scenario.
- e2e helpers assume the Test PG fixture password (`testpass`) and the existing seeded fixture; they re-use the connection if already present.

## Residual Risk
- **Recent section is a placeholder** (`data-testid="home-recent"`); it renders the empty-state copy only. Wiring real recency data is deferred — no AC in sprint-125 mandates contents, only that the slot exists.
- **e2e baseline static-compile errors** (`@wdio/globals not found`) remain because pnpm hoisting hides the types from a top-level `tsc` invocation. Real e2e runs via `wdio.conf.ts` resolve them; we did not add a new e2e tsconfig because adding one revealed the same baseline.
- **No live browser smoke** was performed in this session — verification relies on unit + static checks. `e2e/home-workspace-swap.spec.ts` is the smoke harness; it should be run in CI before merge.
- **Multi-window edge case**: if a future feature opens multiple Tauri windows, each will share `appShellStore` only within its own renderer process. This matches existing store behaviour but is worth flagging if multi-window lands.

## Generator Handoff

```
Sprint: 125
Status: READY_FOR_EVALUATION

Changed Files:
  NEW   src/stores/appShellStore.ts                — screen store ('home'|'workspace'), idempotent setScreen
  NEW   src/stores/appShellStore.test.ts           — 5 tests, all pass
  NEW   src/pages/HomePage.tsx                     — paradigm-agnostic Home (ConnectionList + Import/Export + Group + New)
  NEW   src/pages/HomePage.test.tsx                — 11 tests
  NEW   src/pages/WorkspacePage.tsx                — Sidebar+MainArea + [← Connections] back button
  NEW   src/pages/WorkspacePage.test.tsx           — 5 tests
  NEW   e2e/_helpers.ts                            — shared Home/Workspace navigation helpers
  NEW   e2e/home-workspace-swap.spec.ts            — sprint-125 contract regression (4 scenarios)
  EDIT  src/App.tsx                                — render HomePage|WorkspacePage from appShellStore.screen
  EDIT  src/App.test.tsx                           — mocks switched to HomePage/WorkspacePage
  EDIT  src/components/layout/Sidebar.tsx          — stripped connections-mode; SchemaPanel-only body
  EDIT  src/components/layout/Sidebar.test.tsx     — rewritten for schemas-only Sidebar (13 tests)
  EDIT  e2e/app.spec.ts                            — Home→Open via _helpers
  EDIT  e2e/connection.spec.ts                     — Home→Open via _helpers
  EDIT  e2e/data-grid.spec.ts                      — Home→Open via _helpers
  EDIT  e2e/import-export.spec.ts                  — ensureHomeScreen before opening I/E dialog
  EDIT  e2e/raw-query-edit.spec.ts                 — Home→Open via _helpers
  EDIT  e2e/schema-tree.spec.ts                    — Home→Open via _helpers
  EDIT  e2e/paradigm-and-shortcuts.spec.ts         — Home→Open via _helpers

Checks Run:
  pnpm vitest run                  PASS (1887 passing — 1882 baseline + 5 new)
  pnpm tsc --noEmit                PASS (0 errors)
  pnpm lint                        PASS (0 errors)
  pnpm contrast:check              PASS (0 new violations)
  e2e static-compile               BASELINE-ONLY (@wdio/globals + browser/$ globals; no new errors introduced)

Done Criteria Coverage:
  AC-01 boot=Home + ConnectionList     e2e/home-workspace-swap.spec.ts:24, src/stores/appShellStore.test.ts (initial=home)
  AC-02 Open → Workspace               e2e/home-workspace-swap.spec.ts:46, src/pages/HomePage.test.tsx (onActivate→setScreen)
  AC-03 Workspace mounts Sidebar+MA+Back  src/pages/WorkspacePage.test.tsx, e2e/home-workspace-swap.spec.ts:46
  AC-04 Back returns to Home           e2e/home-workspace-swap.spec.ts:74, src/pages/WorkspacePage.test.tsx (back→setScreen home)
  AC-05 Tabs persist across swap       e2e/home-workspace-swap.spec.ts:96, src/pages/WorkspacePage.test.tsx (no tabStore mutation)
  AC-06 No SidebarModeToggle inside    src/pages/WorkspacePage.test.tsx, src/components/layout/Sidebar.test.tsx
  AC-07 Backend untouched              git status: 0 src-tauri/ changes
  AC-08 Existing tests still green     pnpm vitest run = 1887/1887

Assumptions:
  - ConnectionList onSelect/onActivate split already exists (focus vs open).
  - Back button lives in the sidebar column, above Sidebar — preserves Sidebar's resize logic.
  - appShellStore deliberately NOT persisted; every app boot starts on Home (matches contract).
  - e2e helpers assume Test PG seed (password 'testpass') and idempotent re-use.

Residual Risk:
  - Home "Recent" section is a placeholder slot only (data-testid='home-recent'); contents deferred.
  - Live browser smoke not run this session — relies on CI to execute home-workspace-swap.spec.ts.
  - e2e baseline static-compile errors (@wdio types) remain; resolved at runtime via wdio.conf.ts.
```
