# Sprint 97 — Generator Findings

## Changed Files

- `src/stores/tabStore.ts` — added `dirtyTabIds: Set<string>` field + `setTabDirty(tabId, dirty)` action; `removeTab` now drops the dirty marker for the closed tab. Idempotent semantics preserve Set identity when the requested membership already matches.
- `src/stores/tabStore.test.ts` — extended `beforeEach` to reset `dirtyTabIds`; new `setTabDirty / dirtyTabIds` describe block covering empty start, add/remove transitions, idempotent no-op (referential equality), independent multi-tab tracking, `removeTab` cleanup.
- `src/components/datagrid/useDataGridEdit.ts` — read `setTabDirty` off the store and publish active-tab dirty state via `useEffect` derived from `pendingEdits.size + pendingNewRows.length + pendingDeletedRowKeys.size`. Cleanup function flips dirty=false on unmount / activeTabId change. Hook signature unchanged.
- `src/components/layout/TabBar.tsx` — read `dirtyTabIds`; render dirty dot (`data-dirty="true"`, `aria-label="Unsaved changes"`, primary-coloured 6px bullet) when the tab is in the set; route close attempts (X button + middle-click) through a new `requestCloseTab(tab)` helper that gates on dirty state and surfaces `ConfirmDialog` from `@components/ui/dialog/ConfirmDialog` (sprint-96 preset). Confirm → `removeTab`; Cancel → state cleared, tab survives.
- `src/components/layout/TabBar.test.tsx` — extended `beforeEach` for `dirtyTabIds`; new sprint-97 block: dirty mark renders (AC-01), dirty mark clears on `setTabDirty(false)` (AC-03), clean tab never sprouts a mark (AC-04), clean close has no dialog, dirty close confirm removes tab (AC-02), dirty close cancel keeps tab + dirty state (AC-02), middle-click dirty also routes through gate.
- `src/components/datagrid/useDataGridEdit.{paradigm,promote,unchanged-pending,document,commit-error,commit-shortcut,validation,multi-select}.test.ts` — added `setTabDirty: vi.fn()` to the `vi.mock("@stores/tabStore")` view so the new dependency resolves under test mocks.
- `src/components/DataGrid.test.tsx` — added `setTabDirty: mockSetTabDirty` to `mockTabStoreView()` so the integration test resolves the new store slot.

## Dirty State Routing Decision

Routed through **tabStore** as the execution-brief recommended:
- `useDataGridEdit` (one per mounted grid, hence one per active tab) reads `pendingEdits / pendingNewRows / pendingDeletedRowKeys` and pushes the OR-reduced boolean to `setTabDirty(activeTabId, isDirty)` from a `useEffect`.
- The store owns `dirtyTabIds: Set<string>`. `TabBar` subscribes via a Zustand selector and reads `dirtyTabIds.has(tab.id)` for both the dot and the close-gate decision.
- `removeTab` is responsible for cleanup so a stale dirty marker never survives a closed tab.
- `setTabDirty` is idempotent: calling with the already-current value is a no-op and preserves Set identity, which avoids re-rendering all tab subscribers on every keystroke during editing.

Note: the dirty signal is intentionally narrowed to the three pending-diff fields. The MQL preview branch (`mqlPreview !== null`) is omitted from the dirty calculation because the preview modal itself is the user's commit affordance for that path; treating an open MQL preview as "dirty" would cause the tab to show a dot while the user is actively confirming the commit.

## Verification

### `pnpm vitest run`
```
 Test Files  97 passed (97)
      Tests  1726 passed (1726)
```
- Sprint 97 specific suites: `src/stores/tabStore.test.ts` (97 tests pass) + `src/components/layout/TabBar.test.tsx` (24 tests including 7 new sprint-97 cases).

### `pnpm tsc --noEmit`
Exit code 0, no output.

### `pnpm lint`
Exit code 0, no output.

## AC Coverage

### AC-01 — dirty tab carries `data-dirty="true"` / visible bullet
- `src/components/layout/TabBar.tsx:225-232` renders the dot element:
  ```tsx
  {dirtyTabIds.has(tab.id) && (
    <span
      aria-label="Unsaved changes"
      data-dirty="true"
      title="Unsaved changes"
      className="size-1.5 shrink-0 rounded-full bg-primary"
    />
  )}
  ```
- Test `renders a dirty mark for tabs in dirtyTabIds (AC-01)` (TabBar.test.tsx) asserts the `data-dirty="true"` element exists and carries the `aria-label="Unsaved changes"` attribute.

### AC-02 — dirty close opens ConfirmDialog with confirm/cancel branches
- `src/components/layout/TabBar.tsx:26-32` `requestCloseTab` gates the close.
- `src/components/layout/TabBar.tsx:255-268` mounts `<ConfirmDialog>` with `danger=true`, confirm → `removeTab`, cancel → state cleared.
- Tests `dirty close opens ConfirmDialog and removes tab on confirm (AC-02)` and `dirty close cancel keeps the tab open (AC-02)` assert each branch.
- Tests `close button on a clean tab removes it without confirmation` and `middle-click on dirty tab triggers the confirm gate` ensure the gate is opt-in on dirty state and covers both close vectors (X button + middle-click).

### AC-03 — dirty 0 → mark removed immediately
- `src/components/layout/TabBar.tsx:225` evaluates `dirtyTabIds.has(tab.id)` per render so a `setTabDirty(id, false)` clears the mark on the next subscriber render.
- Test `removes the dirty mark when dirtyTabIds clears (AC-03)` proves the mark vanishes after the dirty flag clears + a rerender, with no remount needed.

### AC-04 — regression 0
- All 1726 tests pass after updating eight existing `useDataGridEdit` test mocks + `DataGrid.test.tsx` to expose `setTabDirty`. No production paths beyond the explicit in-scope files were modified.
- `tsc --noEmit` and `eslint` are both clean.

## Assumptions

- The dirty signal is the OR-reduce of `pendingEdits.size + pendingNewRows.length + pendingDeletedRowKeys.size`. The contract spells these three fields out explicitly, so the MQL preview branch in `useDataGridEdit` (which keeps changes alive in `mqlPreview` after a `handleCommit`) is intentionally excluded. The MQL preview modal is its own commit gate; the user is already in the commit dialog when that state is non-empty.
- The dirty marker is the three-pending-diff signal of the *active* tab only. The hook only mounts for the active tab's grid, so other open tabs never publish dirty=true. This matches existing TablePlus behaviour where a non-active tab's dirty state is preserved by the hook re-mounting when the user switches back (the pending state is grid-local — when the grid unmounts, the state is gone, and the cleanup function flips dirty=false). Cross-tab persistence of pending edits is out of scope per the sprint-97 contract.
- `removeTab` discarding a dirty tab is acceptable because the user has confirmed via `ConfirmDialog`. The grid's pending state is local to the grid component and is GC'd alongside the tab — there is no separate persistence layer to drain.
- Test infrastructure (the existing `vi.mock("@stores/tabStore")` views in eight `useDataGridEdit.*.test.ts` files + `DataGrid.test.tsx`) had to grow a `setTabDirty` slot. This is mechanical (one new property in each mock), strictly required by the new `useEffect` dependency, and contained to the eight files originally co-mocking the hook's tabStore reads.

## Risks

- None known. The dirty publisher's cleanup function flips `setTabDirty(activeTabId, false)` on unmount, so a quick tab-switch sequence cannot leave a stale entry behind. The store action's idempotent check guarantees no extra renders even if React invokes the effect multiple times in dev StrictMode.
