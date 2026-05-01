# Sprint 176 — Generator Findings

Sprint goal: Selective-Attention overlay hardening (AC-176-01, AC-176-02, AC-176-04) + first-render flash gate on `StructurePanel` (AC-176-03), plus RISKS register transitions for RISK-009 and RISK-035 (AC-176-05).

Date: 2026-04-30

## Overlay Audit

Cross-reference for the Evaluator. `grep -RnE 'absolute inset-0' /Users/felix/Desktop/study/view-table/src/components` returns the following matches.

| File | Line | Element | Classification | Notes |
|------|------|---------|----------------|-------|
| `src/components/datagrid/DataGridTable.tsx` | 844 | refetch loading overlay (`<div role="status" aria-label="Loading">`) | hardened by sprint-176 | AC-176-01. Added explicit `onMouseDown` / `onClick` / `onDoubleClick` / `onContextMenu` handlers that call `e.preventDefault()` + `e.stopPropagation()`. |
| `src/components/document/DocumentDataGrid.tsx` | 334 | refetch loading overlay (`<div role="status" aria-label="Loading">`) | hardened by sprint-176 | AC-176-02. Identical handler set as DataGridTable for symmetry. |
| `src/components/datagrid/DataGridTable.refetch-overlay.test.tsx` | ~169 | comment-only string match in a doc comment (literal text: `// (\`absolute inset-0 z-20 flex items-center justify-center` followed on the next line by `// bg-background/60\`) and the Loader2 child carries`) | excluded — test file | Not a runtime overlay; only the literal class name appears in a doc comment block describing the AC-176-04 wrapper-class invariant. The comment is part of the Reason-comment block above the AC-176-04 spinner DOM test. |

**Note on `StructurePanel.tsx` lines 130-134.** The `grep -RnE 'absolute inset-0' src/components` audit does NOT match this region — `StructurePanel.tsx:130-134` contains the inline first-render spinner (`<div className="flex items-center justify-center py-8">` with a `Loader2` child) which is a flow-layout spinner, not an absolute-positioned full-bleed overlay. It cannot be clicked-through because it occupies its own layout box rather than overlapping cells underneath. The AC-176-02 audit ("every full-bleed loading overlay") therefore correctly excludes it. AC-176-03 is a separate concern handled by the `hasFetched*` gates and is unrelated to pointer-event blocking; this spinner is the visible signal that the gate is closed, and never overlaps any clickable region.

Re-run command for the Evaluator:

```
grep -RnE 'absolute inset-0' /Users/felix/Desktop/study/view-table/src/components
```

Expected output: 3 lines — the two production overlays above plus the comment line in the new test file. No other full-bleed overlays exist in `src/components` at the time of writing.

## Mechanism Note

### AC-176-01 / AC-176-02 — pointer-event blocking

**Choice**: explicit React event handlers (`onMouseDown` / `onClick` / `onDoubleClick` / `onContextMenu`) on the overlay `<div>` calling `e.preventDefault()` + `e.stopPropagation()`.

**Why not Tailwind `pointer-events-auto` / `pointer-events-none`**:
- `pointer-events: none` on the overlay would let clicks pass through to the rows underneath — the exact failure mode RISK-009 names.
- `pointer-events: auto` on the overlay alone is the default for a positioned `<div>`. The overlay already receives the click; the bug pre-176 was that React still bubbled it to the parent grid handlers via the React event tree (synthetic-event capture). `stopPropagation` is the right primitive here, not a CSS toggle.
- A capture-phase listener on the parent table region was considered and rejected: it would require the overlay's existence to be known at the parent boundary, increasing coupling. Local handlers on the overlay are the smaller surface.

**Why these four gestures**:
- `mouseDown` — selection start in DataGridTable's row handlers.
- `click` — row selection toggle / single-click navigation.
- `doubleClick` — cell-edit entry on both grids.
- `contextMenu` — right-click menu on rows / cells.

The contract names exactly these four (spec §AC-176-01 lists "no row selection, no double-click cell-edit entry, no context menu"; mouseDown is added because some grid selection paths fire on mousedown rather than click).

### AC-176-04 — spinner visuals unchanged

Both overlays preserve the pre-176 wrapper class string verbatim:

```
absolute inset-0 z-20 flex items-center justify-center bg-background/60
```

and the inner spinner verbatim:

```tsx
<Loader2 className="animate-spin text-muted-foreground" size={24} />
```

Two new attributes were added to the wrapper — `role="status"`, `aria-live="polite"`, `aria-label="Loading"` — none of which affect layout/paint. The handlers are JS attributes, not classes; they cannot move pixels.

DOM-class assertions in the new tests pin this contract:

- `expect(overlay).toHaveClass("absolute", "inset-0", "z-20", "flex", "items-center", "justify-center", "bg-background/60")`
- `expect(spinner).toHaveClass("animate-spin", "text-muted-foreground")`
- `expect(spinner).toHaveAttribute("width", "24")` / `"height", "24"`

A serialized snapshot would lock the same contract but at higher maintenance cost (any unrelated child-tree change in the grid would invalidate it). Class assertion matches the contract's "snapshot OR DOM-class assertion" wording.

### AC-176-03 — first-render flash gate

**Shape**: three boolean state flags on `StructurePanel`:

- `hasFetchedColumns`
- `hasFetchedIndexes`
- `hasFetchedConstraints`

initialized to `false`. Each is flipped to `true` immediately after the corresponding `setColumns` / `setIndexes` / `setConstraints` call inside `fetchData`'s success path, and also inside the catch branch (so a retry that returns `[]` after a transient error reaches the empty-state copy instead of staying hidden forever).

**Render gate**: the editor branches now require `hasFetched*` to be true:

```tsx
{!loading && !error && activeSubTab === "columns" && hasFetchedColumns && (<ColumnsEditor ... />)}
{!loading && !error && activeSubTab === "indexes" && hasFetchedIndexes && (<IndexesEditor ... />)}
{!loading && !error && activeSubTab === "constraints" && hasFetchedConstraints && (<ConstraintsEditor ... />)}
```

**Why per-tab and not a single `hasFetched`**: the user can switch from `Columns` (already settled) to `Indexes` (never fetched). A single flag would let `IndexesEditor` mount with `indexes=[]` and surface "No indexes found" before its first fetch settled. Per-tab gates close that hole — see test `[AC-176-03] tab switch: 'No indexes found' is hidden until indexes fetch settles`.

**Loading-spinner interplay**: the spinner row at `StructurePanel.tsx:130-134` already covers the in-flight window. The gate is *additional*: even when `loading` flips `false` for a tick (e.g. between `setX` and `setLoading(false)` in the same render commit), the editor branch is still hidden until `hasFetched*` is true. In practice React batches both updates, but the gate is the explicit invariant.

## Manual Smoke

This sprint is unit-test-led; the AC-176-01 / AC-176-02 contract is fully observable in jsdom (mouseDown/click/doubleClick/contextmenu firing on the overlay and the row's selection state remaining unchanged). The contract Verification Plan §6 still asks for a `pnpm tauri dev` smoke run for the Evaluator.

Operator steps (for the Evaluator's manual replay):

1. `pnpm tauri dev`
2. Open an RDB connection (PG seed is fine).
3. Open a table with > 1k rows so the refetch perceptibly hangs (or use the Network tab's slow-3G to extend the window).
4. Click the refresh affordance.
5. While the spinner overlay is visible, attempt the following four gestures on a row underneath the spinner:
   - Single click
   - Double click
   - Right click
   - Click-and-drag (mouseDown + move)
6. Expect: no row selection, no cell-edit entry, no context menu, no drag-select.
7. Compare spinner pixels against `main` (a `git stash` toggle on the workspace works).

The Generator did not run this smoke from the sandbox (no interactive Tauri shell available to the agent). The unit tests cover the four gestures explicitly and the AC-176-04 DOM-class assertion locks the visual contract.

## Test Coverage

16 tests across 3 sibling test files (attempt 2 expansion: was 13 tests in attempt 1), all green. AC-tagged via `[AC-176-0X]` prefix per the contract guidance. Attempt-2 changes:
- DataGridTable: split the AC-176-01 mouseDown+click test into two `it` blocks (per Evaluator F-3) for finer diagnostics. Net: 5→6 tests.
- DocumentDataGrid: added missing AC-176-02 mouseDown + contextmenu tests (per Evaluator F-2). Net: 3→5 tests.
- All AC-176-01/02 negative tests now use `createEvent` + `defaultPrevented === true` as the load-bearing assertion (per Evaluator F-1) — proving the production handler ran rather than relying on a vacuous "spy was not called" check (which would pass even if the production handler were stripped, because in jsdom the overlay <div> is a sibling of <table>).
- AC-176-04 DOM-class tests now also assert `aria-hidden="true"` on the Loader2 SVG (per Evaluator F-5).

| AC | File | Test name |
|----|------|-----------|
| AC-176-01 | `src/components/datagrid/DataGridTable.refetch-overlay.test.tsx` | `[AC-176-01] overlay calls preventDefault on mouseDown` |
| AC-176-01 | `src/components/datagrid/DataGridTable.refetch-overlay.test.tsx` | `[AC-176-01] overlay calls preventDefault on click` |
| AC-176-01 | `src/components/datagrid/DataGridTable.refetch-overlay.test.tsx` | `[AC-176-01] overlay calls preventDefault on doubleClick` |
| AC-176-01 | `src/components/datagrid/DataGridTable.refetch-overlay.test.tsx` | `[AC-176-01] overlay calls preventDefault on contextmenu` |
| AC-176-04 | `src/components/datagrid/DataGridTable.refetch-overlay.test.tsx` | `[AC-176-04] spinner DOM (classes, size, position) is unchanged` |
| regression | `src/components/datagrid/DataGridTable.refetch-overlay.test.tsx` | `regression: with loading=false overlay is absent and clicks reach the row` |
| AC-176-02 | `src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` | `[AC-176-02] overlay blocks mouseDown from reaching row` |
| AC-176-02 | `src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` | `[AC-176-02] overlay blocks click on rows during refetch` |
| AC-176-02 | `src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` | `[AC-176-02] overlay blocks doubleClick from opening cell editor` |
| AC-176-02 | `src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` | `[AC-176-02] overlay blocks contextmenu from opening menu` |
| AC-176-04 | `src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` | `[AC-176-04] spinner DOM (classes, size, position) is unchanged` |
| AC-176-03 | `src/components/schema/StructurePanel.first-render-gate.test.tsx` | `[AC-176-03] does not render empty-state copy before first fetch settles` |
| AC-176-03 | `src/components/schema/StructurePanel.first-render-gate.test.tsx` | `[AC-176-03] empty-state copy appears after first fetch resolves with []` |
| AC-176-03 | `src/components/schema/StructurePanel.first-render-gate.test.tsx` | `[AC-176-03] tab switch: 'No indexes found' is hidden until indexes fetch settles` |
| AC-176-03 | `src/components/schema/StructurePanel.first-render-gate.test.tsx` | `[AC-176-03] rejected fetch shows error but no empty-state flash` |
| AC-176-03 | `src/components/schema/StructurePanel.first-render-gate.test.tsx` | `[AC-176-03] tab switch: 'No constraints found' is hidden until constraints fetch settles` |

AC-176-05 is a docs transition (`docs/RISKS.md`) — verified by Evaluator inspection of the diff (not unit-test-coverable).

## Verification Run Summary

| Check | Command | Result |
|-------|---------|--------|
| Sprint-scope vitest | `pnpm vitest run src/components/datagrid/DataGridTable src/components/document/DocumentDataGrid src/components/schema/StructurePanel` | PASS — 220/220 (attempt 2; +3 vs attempt 1's 217 — split AC-176-01 mouseDown/click and added DocumentDataGrid mouseDown + contextmenu tests) |
| Full vitest | `pnpm vitest run` | PASS — 2426/2427 (1 pre-existing failure in `window-lifecycle.ac141.test.tsx` confirmed on `main` before this sprint's changes; unrelated to RISK-009/RISK-035 surface) |
| TypeScript | `pnpm tsc --noEmit` | PASS — 0 errors |
| ESLint | `pnpm lint` | PASS — 0 errors |
| Audit grep | `grep -RnE 'absolute inset-0' src/components` | 3 lines (2 hardened overlays + 1 comment-only test docstring) |
| RISKS grep | `grep -nE 'RISK-009\|RISK-035' docs/RISKS.md` | both rows in `resolved`; Resolution Log entries appended naming sprint-176 |

## Attempt-2 Changelog (Evaluator feedback)

Attempt 1 was a borderline FAIL on Reliability (6/10 < 7) because the AC-176-01 / AC-176-02 negative tests fired pointer events on the overlay `<div>` and asserted `expect(spy).not.toHaveBeenCalled()` on the row-level handler. In jsdom the overlay is a sibling of `<table>`, so the event never bubbles to a `<tr>` regardless of `stopPropagation` — the assertion would pass even if the production `e.preventDefault()` line were removed. Attempt 2 addresses this without touching the (verified-correct) production handler logic.

| Finding | Severity | Action taken |
|---------|----------|--------------|
| F-1 | P2 | Switched all AC-176-01 / AC-176-02 negative tests to the `createEvent` + `fireEvent` + `event.defaultPrevented === true` pattern. Load-bearing assertion now PROVES `e.preventDefault()` ran inside the React handler. Old `expect(spy).not.toHaveBeenCalled()` lines remain as secondary user-visible checks. |
| F-2 | P2 | Added missing `[AC-176-02] overlay blocks mouseDown from reaching row` + `[AC-176-02] overlay blocks contextmenu from opening menu` tests to `DocumentDataGrid.refetch-overlay.test.tsx`. Now mirrors DataGridTable's four-gesture coverage. |
| F-3 | P3 | Split `[AC-176-01] overlay blocks click from reaching row select handler` into two `it` blocks (`preventDefault on mouseDown`, `preventDefault on click`) for finer diagnostics on regression. |
| F-5 | P3 | Added `aria-hidden="true"` to the `Loader2` SVG inside both production overlays (`DataGridTable.tsx`, `DocumentDataGrid.tsx`). Updated AC-176-04 DOM-class tests in both files to also assert this attribute is present. Pure a11y polish — assistive tech reads the wrapper's `aria-label="Loading"` and ignores the decorative SVG. No visual change. |
| F-4 | P3 | Updated the audit-table comment-only row above with the literal class-string text from the test docstring (the comment text matches `// (\`absolute inset-0 z-20 flex items-center justify-center` continued on the next line as `// bg-background/60\`) and the Loader2 child carries`). |
| F-6 | P3 | Added an explicit note above explaining `StructurePanel.tsx:130-134` is correctly out-of-audit because its inline spinner is a flow-layout box, not a `absolute inset-0` full-bleed overlay. |

Production code touched in attempt 2: only the addition of `aria-hidden="true"` on the `Loader2` element in two files (DataGridTable.tsx, DocumentDataGrid.tsx). Attempt-1 production logic (the four event handlers + StructurePanel hasFetched gates) is unchanged.

## Residual Risk

- The pre-existing `window-lifecycle.ac141.test.tsx` failure was confirmed on `main` (via `git stash` toggle) before this sprint's changes were made. It is unrelated to the overlay surface and not in this sprint's contract write scope.
- Manual `pnpm tauri dev` smoke was not run from the sandbox (Generator had no interactive Tauri shell). Operator follow-up step listed in §Manual Smoke.
- AC-176-04 is locked by DOM-class + attribute assertions (per the contract's "snapshot OR class assertion" wording); a serialized snapshot was not added because it would couple to unrelated grid-tree internals and create maintenance cost without additional safety.
