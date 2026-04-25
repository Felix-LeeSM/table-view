## Sprint 125 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness (35%) | 8/10 | All 8 ACs are demonstrably satisfied by code+tests (see AC-by-AC mapping below). `appShellStore` is correctly non-persisted and idempotent (`src/stores/appShellStore.ts:38`). Home wires double-click → `setScreen("workspace")` correctly via `ConnectionItem.onActivate` (`src/components/connection/ConnectionItem.tsx:128, 133`). Workspace back-click flips screen but does not touch tabStore (verified by `src/pages/WorkspacePage.test.tsx:60-88`). One small drift: handoff claims "AC-07 Backend untouched" but contract's AC-07 is the new e2e spec — pure label drift, both criteria are met. |
| Completeness (25%) | 8/10 | 13 new tests (5 store + 11 Home + 5 Workspace − 8 redistributed in Sidebar rewrite); vitest count grew from 1882 → 1887 as claimed. Every existing e2e spec in contract scope (`app.spec.ts`, `connection.spec.ts`, `data-grid.spec.ts`, `import-export.spec.ts`, `raw-query-edit.spec.ts`, `schema-tree.spec.ts`, `paradigm-and-shortcuts.spec.ts`) is updated. Legacy `ensureConnectionsMode()` helpers are fully removed (Grep shows no `[aria-label="Connections mode"]` in e2e/ except in textual comments in `app.spec.ts`). New `e2e/home-workspace-swap.spec.ts` covers all 4 scenarios listed in the contract. SidebarModeToggle file remains on disk but is not imported by any production component (only by its own test file) — contract said "컴포넌트는 보존, mount만 안 함", which matches. **Minor gap**: Sidebar still mounts its own `LogoWordmark` brand header (`src/components/layout/Sidebar.tsx:144-147`), so Workspace ends up with two stacked headers (back-button row + brand row). The contract's design bar permits this but it's visually heavy. |
| Reliability (20%) | 7/10 | Idempotent `setScreen` is the right call to absorb fast Open→Back races (`src/stores/appShellStore.ts:38`). Edge-case test for unknown connection_id exists (`src/pages/HomePage.test.tsx:221-234`). Helpers in `e2e/_helpers.ts:41-50, 102-120` short-circuit when already in target state — random spec ordering won't break flow. **Caveats**: (a) the back button row in `src/pages/WorkspacePage.tsx:32-45` lives outside the Sidebar's resizable column and has no explicit width — it inherits its width from the resized Sidebar child via flex, which is a fragile arrangement on first mount but works in practice. (b) Focus is not managed across the screen swap — clicking Back leaves focus on a button that unmounts; Workspace re-mount lands focus nowhere specific. Contract didn't mandate this but it's the kind of detail the user asked for. |
| Verification Quality (20%) | 9/10 | All 5 required local checks executed and verified by evaluator (not just trusted from handoff): `pnpm vitest run` 1887/1887 PASS, `pnpm tsc --noEmit` 0 errors, `pnpm lint` 0 errors, `pnpm contrast:check` 0 new violations (864 pairs, 64 allowlisted), `git diff --stat src-tauri/` empty. Browser smoke is correctly deferred to CI per Generator note + contract verification profile. Direct DOM verification of `SidebarModeToggle` non-mount: `Grep` confirms no production import outside its own test file, and `WorkspacePage.test.tsx:39-45` + `Sidebar.test.tsx:99-105` assert via `queryByRole("radio", {name: /mode/i})` returning null. |
| **Overall** | **8/10** | Scope cleanly hit, plumbing is sturdy, evidence is thorough. Two cosmetic details (double brand header, focus loss on swap) keep this short of 9. |

## Verdict: PASS

All four dimensions ≥ 7. No P1/P2 findings. Two P3 details for the next sprint to clean up.

## Sprint Contract Status (Done Criteria)

- [x] **AC-01 — Boot defaults to Home with ConnectionList + Import/Export + New Connection**:
  - Initial state `screen: "home"` at `src/stores/appShellStore.ts:36`.
  - Asserted by `src/stores/appShellStore.test.ts:15-17` ("initial screen is 'home'").
  - `App.tsx:286` renders `screen === "home" ? <HomePage /> : <WorkspacePage />` — `appShellStore` is not persisted, so every boot lands on Home.
  - HomePage renders Import/Export (`src/pages/HomePage.tsx:115-124`), New Group (`125-134`), New Connection (`135-144`) with explicit aria-labels.
  - e2e: `e2e/home-workspace-swap.spec.ts:24-44` ("boots into the Home screen with the ConnectionList rendered").
- [x] **AC-02 — Open swaps to Workspace, schema tree visible**:
  - `HomePage.handleActivate` at `src/pages/HomePage.tsx:84-87` calls `setScreen("workspace")`.
  - `ConnectionItem.handleDoubleClick` at `src/components/connection/ConnectionItem.tsx:122-135` fires `onActivate` after a successful connect.
  - Unit asserted at `src/pages/HomePage.test.tsx:204-219` ("onActivate from ConnectionList swaps to workspace screen").
  - e2e: `e2e/home-workspace-swap.spec.ts:46-72`.
- [x] **AC-03 — `[← Connections]` button (aria-label "Back to connections") returns to Home, tabs preserved**:
  - Button rendered at `src/pages/WorkspacePage.tsx:34-44` with `aria-label="Back to connections"`.
  - Click handler `setScreen("home")` at `src/pages/WorkspacePage.tsx:40` — does not invoke any tabStore mutator.
  - Unit asserted at `src/pages/WorkspacePage.test.tsx:47-58` (back click flips screen) and `60-88` (back click does NOT clear tabStore — tab survives).
  - Cross-store independence asserted at `src/stores/appShellStore.test.ts:39-65` (3 swaps in a row, tab is still there).
  - e2e: `e2e/home-workspace-swap.spec.ts:74-94` (back button → Home) + `96-115` (re-Open keeps tab count > 0).
- [x] **AC-04 — SidebarModeToggle is NOT mounted in Workspace**:
  - Removed from `src/components/layout/Sidebar.tsx` (Grep confirms only doc-comment mentions remain at `:42`).
  - Production import scan (`Grep -p "import.*SidebarModeToggle"`) returns ONLY `src/components/layout/SidebarModeToggle.test.tsx:3` — its own test. Component file is preserved on disk per the contract directive ("컴포넌트는 보존, mount만 안 함").
  - `WorkspacePage.test.tsx:39-45` and `Sidebar.test.tsx:99-105` both assert `queryByRole("radio", {name: /(connections|schemas) mode/i})` returns null.
- [x] **AC-05 — Import/Export visible in Home, working**:
  - Home renders the Import/Export button at `src/pages/HomePage.tsx:115-124`. Sidebar no longer imports `ImportExportDialog` (verified in `git diff src/components/layout/Sidebar.tsx`).
  - `e2e/import-export.spec.ts:43-51` updated to call `ensureHomeScreen()` + `ensureTestPgConnection()` in `beforeEach`; the legacy `ensureConnectionsMode` helper is deleted.
  - Unit assertion at `src/pages/HomePage.test.tsx:157-166` (clicking Import/Export opens `ImportExportDialog`).
- [x] **AC-06 — All existing e2e specs updated to Home→Open flow**:
  - All 7 specs verified via `git diff`:
    - `e2e/app.spec.ts` — uses `ensureHomeScreen` / `openTestPgWorkspace` helpers, asserts `home-header` data-testid.
    - `e2e/connection.spec.ts` — `ensureHomeScreen` before opening dialog.
    - `e2e/data-grid.spec.ts:33-35` — `openTestPgWorkspace()` in `beforeEach`.
    - `e2e/import-export.spec.ts:43-51` — `ensureHomeScreen + ensureTestPgConnection`.
    - `e2e/raw-query-edit.spec.ts` — `openTestPgWorkspace` import + use.
    - `e2e/schema-tree.spec.ts` — `openTestPgWorkspace` in `beforeEach`.
    - `e2e/paradigm-and-shortcuts.spec.ts` — `openTestPgWorkspace` import + use.
  - Static compile: same baseline `@wdio/globals` typing errors as pre-sprint; nothing new introduced (matches handoff note).
- [x] **AC-07 — New `e2e/home-workspace-swap.spec.ts`** covers all four scenarios:
  - Boot → Home (`:24-44`).
  - Open → Workspace (`:46-72`).
  - Back → Home (`:74-94`).
  - Re-Open keeps tab (`:96-115`).
- [x] **AC-08 — Unit tests for appShellStore + HomePage + WorkspacePage**:
  - `src/stores/appShellStore.test.ts`: 5 tests (initial = home, setScreen flips, can swap back, idempotent no-op preserves reference, does NOT reset tabStore).
  - `src/pages/HomePage.test.tsx`: 11 tests (ConnectionList render, Import/Export/New Group/New Connection buttons, Recent placeholder, no SidebarModeToggle, dialog opens, Cmd+N event, onSelect vs onActivate split, unknown id graceful).
  - `src/pages/WorkspacePage.test.tsx`: 5 tests (Sidebar+MainArea render, back button + aria-label, no SidebarModeToggle, back click → home, back click does NOT clear tabStore).

## Verification Command Output (executed by evaluator)

| Command | Result | Evidence |
|---------|--------|----------|
| `pnpm vitest run` | **PASS** | 1887/1887 across 115 test files (handoff claim 1887 confirmed; baseline 1882 + 5 net new from `appShellStore.test.ts` + redistributed Home/Workspace/Sidebar tests). |
| `pnpm tsc --noEmit` | **PASS** | exit code 0, 0 errors. |
| `pnpm lint` | **PASS** | exit code 0. |
| `pnpm contrast:check` | **PASS** | "WCAG AA contrast: 72 themes / 144 theme-modes / 864 pairs — 0 new violations (64 allowlisted)". |
| `git diff --stat src-tauri/` | **EMPTY** | Backend untouched per scope boundary. |
| `git status -s` | **CLEAN MATCH** | Modified: `src/App.tsx`, `src/App.test.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/layout/Sidebar.test.tsx`, 7 e2e specs. New: `src/pages/`, `src/stores/appShellStore.ts(.test.ts)`, `e2e/_helpers.ts`, `e2e/home-workspace-swap.spec.ts`, `docs/sprints/sprint-125/`. No backend, no other unrelated edits. |

## Code Review Notes

- **Production-grade**: 0 `console.*`, 0 `TODO/FIXME/XXX/HACK`, 0 `any` types in new files (verified via `grep`).
- **React conventions**: Function components only, named props interfaces, Tailwind utility classes, `useEffect` cleanup correctly returned (`HomePage.tsx:69-73`, store subscription handlers properly cleaned up). React Query / state isolation respected.
- **TypeScript strict**: `AppShellScreen = "home" | "workspace"` is a discriminated string union; `setScreen` parameter typed against it; idempotent guard returns `prev` reference (avoids spurious `===` re-renders for selectors).
- **Idiomatic Zustand**: Plain `create<AppShellState>` with no middleware (no `persist` — by design for sessionwide state). Same pattern as the project's other ephemeral stores.
- **a11y on `[← Connections]`**: `aria-label="Back to connections"` ✓, `title="Back to connections"` ✓, semantic `<Button>` (renders `<button>`) ✓, focus-visible inherited from button variant. Visible label "Connections" with leading `ArrowLeft` icon — readable.
- **HomePage layout match**: Reuses the same primitives (`Popover`, `Button`, theme picker pattern, `LogoWordmark`) as the legacy Sidebar. No naked Tailwind drift; classes match existing tokens (`bg-secondary`, `border-border`, `text-muted-foreground`).

## Detail Audit (the user asked for "아주 작은 디테일")

### Items the implementation got right
- ✔ `home-recent` placeholder has `data-testid` so future MRU-wiring can target it (`src/pages/HomePage.tsx:165`). Also has visible "Recent" copy + `Clock` icon so the empty state is obviously reserved space, not an accidental gap.
- ✔ `setScreen` on identical value returns same reference (`src/stores/appShellStore.ts:38`) — Zustand selector consumers won't re-render on a no-op back-click.
- ✔ Edge-case test for unknown `connectionId` in `HomePage.test.tsx:221-234`.
- ✔ `e2e/_helpers.ts` is fully idempotent (all `ensure*` helpers short-circuit when state already matches), so test ordering doesn't flake.
- ✔ Reset patterns in tests (`useTabStore.setState`, `useAppShellStore.setState`) match the project-wide convention from `tabStore.test.ts`.
- ✔ Cmd+N event listener is mirrored on Home (`HomePage.tsx:69-73`) so the global shortcut works regardless of screen.

### Items missing or fragile (P3 — non-blocking, queue for S126+)

1. **Double header in Sidebar column on Workspace**: The `<Sidebar />` (`src/components/layout/Sidebar.tsx:144-147`) still mounts its own `<LogoWordmark>` brand header. Combined with the new `[← Connections]` row above it (`WorkspacePage.tsx:32-45`), Workspace shows TWO stacked headers in the sidebar column. Contract permits "옆 또는 그 자리 대체" but the cleaner choice would be to drop the brand header from Sidebar (since HomePage already renders it) and let the Back button row be the single header. Cosmetic only; vertical space ~28-32px wasted on every Workspace mount.

2. **Back-button row width binding is fragile**: `src/pages/WorkspacePage.tsx:32` wraps Back+Sidebar in `<div className="flex h-full flex-col">` with no explicit width. The Sidebar child has `style={{ width: sidebarWidth }}` from `useResizablePanel`. The wrapper inherits that width through flex — works in practice but means the back button row is implicitly width-bound by the resized Sidebar. If a future sprint moves the Back button into MainArea instead, the layout assumption silently breaks. Consider giving the wrapper an explicit width matching `sidebarWidth` or moving the row INSIDE Sidebar.

3. **Focus is lost across the swap**: After `[← Connections]` click, focus lands on `<body>` because the button it was on just unmounted (HomePage replaces WorkspacePage). HomePage doesn't restore focus to e.g. the New Connection button or the previously focused list item. Same mirror-image issue when Open swaps to Workspace. Contract doesn't mandate this, but the user asked specifically about focus landing sensibly. Suggest: store a `focusReturn` token on swap, then `useEffect` on mount focuses the right element.

4. **Recent slot has no `role="region"`**: `data-testid="home-recent"` is enough for tests but for a screen-reader user the placeholder copy reads as a loose paragraph. A `role="region"` + `aria-label="Recent connections"` would future-proof this slot before sprint 127 wires real data.

5. **Handoff AC numbering drift**: Generator's handoff calls "AC-07 Backend untouched" and "AC-08 Existing tests still green" which doesn't match the contract's AC-07 (new e2e spec) and AC-08 (unit tests for stores/pages). Both contract criteria are *actually* met — Generator just labelled them wrong in the handoff matrix. Cosmetic doc bug.

## Feedback for Generator

(All items are P3 — none block the sprint PASS verdict.)

1. **Layout (Workspace header stacking)**: drop the `LogoWordmark` brand row from `Sidebar.tsx` when running in Workspace, OR move the Back button into the existing `border-b` strip that holds the connection-name + "+ Query" button.
   - Current: Workspace shows `[← Connections]` + brand wordmark + connection-name strip = three stacked rows.
   - Expected: one consolidated header strip per the contract's "헤더 영역" guidance.
   - Suggestion: move `<Button aria-label="Back to connections">` to the LEFT of the connection-name `<span>` inside `Sidebar.tsx`'s existing `<div className="flex items-center justify-between border-b ... ">` row — same row, no extra height.

2. **Reliability (focus management)**: persist focused-element token across screen swaps so keyboard users don't lose place.
   - Current: clicking Back leaves `document.activeElement === document.body`.
   - Expected: focus lands on the connection that was just open (or on the first focusable item in HomePage's header on first boot).
   - Suggestion: in `appShellStore`, add a `focusReturn?: string` slot updated on every `setScreen`; consume it in HomePage / WorkspacePage `useEffect(() => focusEl?.focus(), [])`.

3. **a11y (Recent slot)**: add `role="region"` + `aria-label="Recent connections"` to `data-testid="home-recent"`. Cheap, future-proofs sprint 127.

4. **Handoff doc**: realign the AC mapping in `handoff.md` so AC-07 references the new e2e spec and AC-08 references the unit tests, matching contract.md numbering.

## Generator Handoff Acknowledgement

```
Sprint: 125
Evaluator Status: PASS
Open P1/P2 Findings: 0
Open P3 Findings: 4 (cosmetic / a11y polish; queued for S126+)

Verified Locally:
  pnpm vitest run                  PASS  1887/1887 (115 files)
  pnpm tsc --noEmit                PASS  0 errors
  pnpm lint                        PASS  0 errors
  pnpm contrast:check              PASS  864 pairs, 0 new violations
  git diff --stat src-tauri/       EMPTY (backend untouched, scope boundary respected)

AC coverage matches contract.md AC-01..AC-08 (handoff.md numbering drift is cosmetic; 
all eight contract criteria are demonstrably met by code + tests).

Browser smoke deferred to CI per contract verification profile. The new
e2e/home-workspace-swap.spec.ts is the smoke harness and must run green
before merge.
```
