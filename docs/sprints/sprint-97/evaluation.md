# Sprint 97 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** | 9/10 | Dirty signal precisely matches contract formula (`pendingEdits.size > 0 || pendingNewRows.length > 0 || pendingDeletedRowKeys.size > 0`). MQL preview intentionally excluded from dirty calc with documented rationale (`useDataGridEdit.ts:867-873`) — this is the correct call, since the preview modal is itself the commit affordance. `removeTab` cleans up dirty marker (`tabStore.ts:269-278`). `setTabDirty` is idempotent and preserves Set identity (`tabStore.ts:330-344`). Cleanup function flips dirty=false on activeTabId change/unmount (`useDataGridEdit.ts:881-883`) so stale entries can't survive a tab switch. |
| **Completeness** | 9/10 | All four AC met. AC-01 dot rendering with `data-dirty="true"` + `aria-label="Unsaved changes"` (`TabBar.tsx:225-232`). AC-02 ConfirmDialog gate covers both close button (`TabBar.tsx:239-242`) and middle-click (`TabBar.tsx:112-117`); confirm/cancel branches both tested. AC-03 dirty mark clears via per-render `dirtyTabIds.has(tab.id)` evaluation (no remount needed). AC-04 regression-free — full suite passes 1726/1726. ConfirmDialog imported from `@components/ui/dialog/ConfirmDialog` — the sprint-96 path. Eight sibling test mocks updated mechanically to expose `setTabDirty`. |
| **Reliability** | 8/10 | Idempotent `setTabDirty` prevents render storms from per-keystroke effect re-runs. Cleanup effect handles activeTabId change correctly. `removeTab` lazy-allocates new Set only when entry was actually present, avoiding pointless renders for clean-tab closes. Pending close state cleared on both confirm and cancel paths so a stale `pendingClose` cannot strand the gate open. One small concern: when active tab switches mid-edit, the cleanup function fires `setTabDirty(prevActiveTabId, false)`, which means a non-active dirty tab's marker drops if the user moves away — though since the publisher only runs in the active grid and `useDataGridEdit` unmounts on tab switch, this is consistent with the documented "active tab only" assumption (sprint findings line 70-71). |
| **Verification Quality** | 9/10 | Verification profile = `command`. All three commands (`pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`) executed by orchestrator and re-run by evaluator: 1726/1726 tests pass, tsc exit 0 with no output, eslint exit 0 with no output. Test suite covers 7 sprint-97 cases including dirty mark render (AC-01), clear-on-clean (AC-03), clean-tab no-mark guard, clean-close no-dialog, dirty-confirm removes tab (AC-02), dirty-cancel preserves dirty state (AC-02), middle-click gate. Test Requirements satisfied: dirty/clean transition ≥ 2 (rendering + AC-03 clearing), close gate confirm + cancel both asserted. |
| **Overall** | **8.75/10** | |

## Verdict: PASS

All four dimensions ≥ 7/10. Profile: `command`. Required evidence present.

## Sprint Contract Status (Done Criteria)

- [x] AC-01: Dirty tab carries `data-dirty="true"` + visible bullet
  - Evidence: `src/components/layout/TabBar.tsx:225-232` renders `<span data-dirty="true" aria-label="Unsaved changes" className="size-1.5 shrink-0 rounded-full bg-primary" />` gated on `dirtyTabIds.has(tab.id)`. Test `renders a dirty mark for tabs in dirtyTabIds (AC-01)` (`TabBar.test.tsx:479-492`) asserts both attribute and label.
- [x] AC-02: Dirty close opens ConfirmDialog with confirm/cancel branches
  - Evidence: `requestCloseTab` (`TabBar.tsx:26-32`) gates close on `dirtyTabIds.has(tab.id)`, sets `pendingClose`. `<ConfirmDialog>` (`TabBar.tsx:255-268`) imported from `@components/ui/dialog/ConfirmDialog` (sprint-96 path), `danger` flag set, confirm calls `removeTab`, cancel clears state. Both branches tested at `TabBar.test.tsx:557-616`. Middle-click vector also tested at `TabBar.test.tsx:620-633`.
- [x] AC-03: Dirty 0 → mark removed immediately
  - Evidence: Mark renders via per-render `dirtyTabIds.has(tab.id)` evaluation (`TabBar.tsx:225`) — no memoisation, no remount required. Test `removes the dirty mark when dirtyTabIds clears (AC-03)` (`TabBar.test.tsx:496-514`) asserts the dot vanishes after `setTabDirty(id, false)` + rerender. The publisher effect in `useDataGridEdit.ts:874-890` depends on `pendingEdits/pendingNewRows/pendingDeletedRowKeys`, so when any of those Maps/Arrays/Sets is cleared (e.g., via `handleDiscard` or successful commit), the effect runs synchronously on next commit with `isDirty=false`.
- [x] AC-04: Regression 0
  - Evidence: `pnpm vitest run` → 1726/1726 pass across 97 files. `pnpm tsc --noEmit` → exit 0, no output. `pnpm lint` → exit 0, no output. Eight `useDataGridEdit.*.test.ts` files + `DataGrid.test.tsx` updated to expose `setTabDirty: vi.fn()` in their tabStore mock — purely mechanical, no behaviour change.

## Special Checks

### ConfirmDialog import
PASS — `TabBar.tsx:7` imports `ConfirmDialog from "@components/ui/dialog/ConfirmDialog"`. This is the sprint-96 Layer-2 preset path (`src/components/ui/dialog/ConfirmDialog.tsx` confirmed to exist with the sprint-96 header comment block). `danger` prop forwarded correctly so the destructive tone fires for the discard dialog.

### Dirty mark clears immediately when pendingEdits is cleared
PASS — Two-layer evidence:
1. Store layer: `dirtyTabIds.has(tab.id)` evaluated per render, no caching.
2. Hook layer: `useDataGridEdit`'s publisher effect (lines 874-890) re-runs when `pendingEdits` reference changes (`new Map()` from `handleDiscard` / commit success), pushing `setTabDirty(activeTabId, false)` synchronously.
The AC-03 test asserts the store-layer guarantee directly via `setTabDirty(id, false)` + rerender, which is the tightest possible assertion of "mark vanishes immediately on clean transition".

### Middle-click + close button both trigger guard
PASS — Both routes funnel through `requestCloseTab(tab)`:
- Close button: `TabBar.tsx:239-242` `onClick={(e) => { e.stopPropagation(); requestCloseTab(tab); }}`
- Middle-click: `TabBar.tsx:112-117` `onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); requestCloseTab(tab); } }}`
Both vectors tested: clean close button (`close button on a clean tab removes it without confirmation`, line 541), dirty close button confirm (`dirty close opens ConfirmDialog and removes tab on confirm (AC-02)`, line 557), dirty close button cancel (`dirty close cancel keeps the tab open (AC-02)`, line 591), dirty middle-click (`middle-click on dirty tab triggers the confirm gate`, line 620).

## Feedback for Generator

Minor polish suggestions only — none of these block PASS:

1. **AC-03 test integration coverage** — the current AC-03 test exercises the store-layer guarantee directly (`setTabDirty(id, false)`). The hook-layer guarantee (the `useDataGridEdit` publisher pushing dirty=false when `pendingEdits` becomes an empty Map after `handleDiscard`) is covered transitively but never asserted end-to-end in a single test.
   - Current: store action + render = ✓
   - Expected: optionally a hook-level test that mounts `useDataGridEdit`, sets a pending edit, calls `handleDiscard`, and asserts `dirtyTabIds.has(activeTabId) === false` on the next commit.
   - Suggestion: add a single integration test in `useDataGridEdit.test.ts` (or a new `useDataGridEdit.dirty.test.ts`) wiring `vi.unmock("@stores/tabStore")` and using the real store. Low priority — the existing coverage is contract-sufficient.

2. **MQL-preview-only dirty signal is intentionally excluded** — the findings document this clearly (line 21, 70-71), but the codebase does not. A future reader looking at `hasPendingChanges` (which DOES include `mqlPreview !== null`) vs. the dirty effect (which does NOT) might trip on the asymmetry.
   - Current: comment in `useDataGridEdit.ts:867-873` mentions the omission.
   - Expected: same.
   - Suggestion: tighten the comment to explicitly cross-reference `hasPendingChanges` and explain the divergence in one line. Cosmetic.

3. **`pendingClose` race on rapid double-close-click** — if the user clicks the close button on a dirty tab twice in rapid succession, the second click sets `pendingClose` to the same tab object reference and React renders one ConfirmDialog. This is benign (same outcome), but worth noting for completeness.
   - Current: `pendingClose` is a `useState<Tab | null>(null)` — no debouncing.
   - Expected: same.
   - Suggestion: no change required. Documented here only because the sprint contract called for race/edge-case scrutiny.

## Handoff Evidence

- `tests`: `pnpm vitest run` → 1726/1726 (97 files), 16.02s
- `typecheck`: `pnpm tsc --noEmit` → exit 0, no output
- `lint`: `pnpm lint` → exit 0, no output
- `files_modified`: `src/stores/tabStore.ts`, `src/stores/tabStore.test.ts`, `src/components/datagrid/useDataGridEdit.ts`, `src/components/layout/TabBar.tsx`, `src/components/layout/TabBar.test.tsx`, plus 8 sibling test mock updates
- `confirmdialog_path`: `@components/ui/dialog/ConfirmDialog` (sprint-96 Layer-2 preset, verified at `src/components/ui/dialog/ConfirmDialog.tsx`)
- `p1_p2_findings`: 0
