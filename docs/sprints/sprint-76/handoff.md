# Handoff: Sprint 76 — Per-Tab Sort State

## Outcome

- Status: complete (Generator)
- Summary: `TableTab.sorts?: SortInfo[]` added; `tabStore.updateTabSorts(tabId, sorts)` exposed; `DataGrid` now reads/writes sort state through the active tab so sort indicators + `orderBy` string survive tab switches; `loadPersistedTabs` migrates legacy tabs (`sorts` key absent) to `sorts: []`; 17 new unit/integration tests.

## Verification Profile

- Profile: mixed (command gates run; browser smoke not executed in this harness)
- Overall score: n/a (Generator only)
- Final evaluator verdict: pending

## Evidence Packet

### Checks Run

- `pnpm tsc --noEmit`: pass — 0 errors (empty output).
- `pnpm lint`: pass — 0 warnings / 0 errors.
- `pnpm vitest run`: pass — **Test Files 72 passed (72), Tests 1407 passed (1407)** (baseline 1389 → 1407, net +18 new tests; all pre-existing tests still green).
- `pnpm vitest run src/stores/tabStore.test.ts`: pass — **55 tests** including the new `per-tab sort state` (9) and `per-tab sort persistence` (4) describe blocks.
- `pnpm vitest run src/components/DataGrid.test.tsx`: pass — **71 tests** including 5 new Sprint 76 tests (`routes handleSort through updateTabSorts`, `renders the indicator + orderBy from the persisted tab.sorts on mount`, `restores multi-column sorts with ranks + joined orderBy`, `isolates sort state between tabs — tab A's sort does not leak into tab B`, `tolerates a tab whose sorts field is missing`).
- Browser smoke: not executed (harness mixed-profile optional step).

### Acceptance Criteria Coverage

- **AC-01** — `TableTab.sorts?: SortInfo[]` field.
  - Source: `src/stores/tabStore.ts:58` (field definition), `src/stores/tabStore.ts:3` (SortInfo import).
  - Tests: `src/stores/tabStore.test.ts:842` (`addTab does not pre-seed sorts; new tab's sorts is undefined`), `src/stores/tabStore.test.ts:851` (`addTab preserves sorts when the caller provides them`).

- **AC-02** — `updateTabSorts` action exposed + isolated per tab.
  - Source: `src/stores/tabStore.ts:137` (interface), `src/stores/tabStore.ts:274` (implementation — mirrors `setSubView` shape, only mutates matching `type === "table"` entry).
  - Tests: `src/stores/tabStore.test.ts:868` (writes target), `src/stores/tabStore.test.ts:881` (sibling isolation), `src/stores/tabStore.test.ts:913` (no-op on ghost id), `src/stores/tabStore.test.ts:924` (ignores QueryTabs), `src/stores/tabStore.test.ts:978` (empty array clears sort), `src/components/DataGrid.test.tsx:1512` (handleSort routes through store action).

- **AC-03** — `DataGrid` reads `tab.sorts` as source of truth; tab switch restores sort indicator + `orderBy`.
  - Source: `src/components/DataGrid.tsx:44` (`updateTabSorts` selector), `src/components/DataGrid.tsx:50-59` (`activeTabSorts` selector + stable fallback), `src/components/DataGrid.tsx:60-74` (`setSorts` wrapper — reads live store state to compose synchronous updates), `src/components/DataGrid.tsx:155` (existing `fetchData` now consumes tab-scoped `sorts`). Local `useState<SortInfo[]>([])` on legacy line ~49 removed.
  - Tests: `src/components/DataGrid.test.tsx:1531` (single-column restore on mount), `src/components/DataGrid.test.tsx:1557` (multi-column ranks + `orderBy` joined), `src/components/DataGrid.test.tsx:1587` (tab A↔B isolation + remount preserves A's state), `src/stores/tabStore.test.ts:938` (setActiveTab round-trip preserves sort).

- **AC-04** — `loadPersistedTabs` migrates legacy persisted tab (no `sorts`) without throwing.
  - Source: `src/stores/tabStore.ts:395` (migration line `sorts: t.sorts ?? []`) together with surrounding comment block at 383-393.
  - Tests: `src/stores/tabStore.test.ts:1034` (missing `sorts` → `[]` without throw), `src/stores/tabStore.test.ts:1064` (persisted non-empty `sorts` preserved verbatim), `src/stores/tabStore.test.ts:1097` (round-trip persist + reload), `src/stores/tabStore.test.ts:1122` (reopenLastClosedTab retains sort), `src/components/DataGrid.test.tsx:1633` (DataGrid tolerates a tab literal with no `sorts` key).

- **AC-05** — new tests per above in both `tabStore.test.ts` (13 new cases across two new describes) and `DataGrid.test.tsx` (5 new cases). Coverage for new lines stays comfortably > 70% (every new branch in `updateTabSorts` and the migration line is exercised).

### Screenshots / Links / Artifacts

- None (no UI surface changes visible beyond the existing `▲/▼ + rank` chrome from Sprint 44).

## Changed Areas

- `src/stores/tabStore.ts`:
  - Added `SortInfo` import.
  - Added `TableTab.sorts?: SortInfo[]` field (documented inline).
  - Added `updateTabSorts(tabId, sorts)` to the `TabState` interface + its implementation (mirrors `setSubView`: no-op for non-table tabs / unknown ids).
  - Extended `loadPersistedTabs` migration to normalise missing `sorts` to `[]` on legacy TableTabs.
- `src/components/DataGrid.tsx`:
  - Removed the local `useState<SortInfo[]>([])` that had been the source of the bug.
  - Added `updateTabSorts` + `activeTabSorts` selectors; derived stable `sorts` via `useMemo`-backed empty fallback so `fetchData` doesn't rebuild each render.
  - Rewrote `setSorts` to read the live store value via `useTabStore.getState()` inside the callback so successive synchronous updaters compose correctly.
  - Kept `handleSort`'s shift/no-shift cycle logic byte-for-byte identical; only the upstream `setSorts` target changed.
- `src/stores/tabStore.test.ts`:
  - Added `per-tab sort state` describe (9 cases covering AC-01 / AC-02 + edge cases: non-existent id, QueryTab guard, 5+ multi-column, empty clear).
  - Added `per-tab sort persistence` describe (4 cases covering AC-04 + persistence round-trip + reopenLastClosedTab retention).
  - Added `SortInfo` import + new subject-specific `localStorage` stub setup (mirrors the prior persistence describe to preserve patterns).
- `src/components/DataGrid.test.tsx`:
  - Reworked the `useTabStore` mock from a frozen object into a minimal reactive mock (subscribers notified via `updateTabSorts`; `getState()` returns the same shape the selector hook uses). No change to the public test surface — existing 66 cases still pass unmodified.
  - Added 5 Sprint 76 tests at the bottom (store-action routing, mount-time restore, multi-column restore, cross-tab isolation via remount, missing-sorts tolerance).

## Assumptions

- **Migration default `[]` vs `undefined`**: chose `[]` — `loadPersistedTabs` normalises missing `sorts` to an empty array even though the TS type allows `undefined`. Rationale: `DataGrid` and anything that maps `sorts.map(s => ...)` for `orderBy` would otherwise need an `?? []` spread at every touchpoint, and the existing Sprint 66 migration already normalises `paradigm`/`isPreview` in the same pass, so defaulting here is consistent with that pattern. `addTab` still accepts `undefined` (legacy call sites without sort preference don't have to change), and `DataGrid`'s read path still uses `?? EMPTY_SORTS` as a belt-and-braces fallback.
- **Action name**: `updateTabSorts(tabId, sorts)` — follows the naming/verb form the planner suggested and matches the level of specificity used by `setSubView`, `promoteTab`, etc. A generic `updateTab(patch)` was considered and rejected: Sprint 77 is about to touch this store (ephemeral tabs), and a fine-grained verb is easier to merge without a conflict.
- **Reactive DataGrid mock**: the test mock for `useTabStore` had to gain a simple subscribe/notify loop so React re-renders on `updateTabSorts`. This preserves the existing test isolation (no real zustand import in tests) while keeping the component's real-world behaviour intact.
- **QueryTabs are unaffected**: `updateTabSorts` explicitly guards `t.type === "table"`, and a test asserts it doesn't leak a `sorts` field onto a QueryTab even if the id collides.

## Residual Risk

- **Browser smoke not executed** in harness. The tests cover the mount-time restore and tab-switch-by-remount paths, but a human smoke ("two tabs, two sorts, switch back and forth in the running app") is still recommended before user release — especially for the debounced persistence interacting with rapid clicks.
- **Column width / order not yet tab-scoped**: out of scope per contract. The existing `useEffect` at `src/components/DataGrid.tsx:88-91` still resets `columnWidths` / `columnOrder` on `connectionId/table/schema` changes; this is intentionally orthogonal to sort and was explicitly left out of this sprint.
- **QueryTab sort** is out of scope (contract line 28 / invariants 4 & 6). `QueryExecutionState` owns its own result ordering.
- **Fetch identity on tab switch**: `DataGrid` still unmounts/remounts on tab change (an upstream behaviour of `MainArea`), so the grid re-fetches when the user returns. This is correct (fresh indicator + fresh data) but does mean the network round-trip happens on each switch — a caching layer would be a separate future sprint.

## Next Sprint Candidates

- Sprint 77 (ephemeral tabs + tab bar visuals) — now builds on a stable `tabStore` shape.
- Tab-scoped `columnWidths` / `columnOrder` (symmetric to this sprint; same pattern with a `updateTabColumnWidths` action).
- Optional: in-memory result cache keyed by `(tabId, page, sorts, filters)` so repeat tab switches don't re-query.
