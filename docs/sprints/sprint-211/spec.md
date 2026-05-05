# Feature Spec: QuickLookPanel god-file split (Sprint 211)

## Description

`src/components/shared/QuickLookPanel.tsx` (868 lines) is the single-file Quick Look surface that powers Cmd+L for both RDB rows (`DataGrid`) and Mongo documents (`DocumentDataGrid`). It mixes seven concerns: value formatting (RDB type-aware + Mongo BSON-aware), edit field rendering (textarea / number / boolean / null / Set NULL), the resize shell (mouse drag + keyboard step + min/max + accessibility roles), the RDB body (RDB header + per-column FieldRow layout + BLOB viewer wiring), the document body (BSON namespace header + read-only BSON tree + edit-mode FieldRows over synthesized columns), the dirty-pill computation, and the close/edit/resize header chrome. Sprint 211 splits this god component behavior-preserving into a thin entry plus four co-located sub-files under `src/components/shared/QuickLookPanel/` (`QuickLookShell` + `RdbQuickLookBody` + `DocumentQuickLookBody` + `helpers.ts`), while preserving the entry path, the public default export, the three exported props types, and every behavior covered by the existing 980-line `QuickLookPanel.test.tsx`. Both importers (`DataGrid.tsx`, `DocumentDataGrid.tsx`) continue to import from `@components/shared/QuickLookPanel` unchanged.

## Sprint Breakdown

### Sprint 211: QuickLookPanel entry-pattern split
**Goal**: Decompose `QuickLookPanel.tsx` into a thin entry file plus 4 co-located sub-files (1 shared shell + 2 paradigm-specific body components + 1 helpers module) under `src/components/shared/QuickLookPanel/`, while preserving the entry path, the default export, the three exported props types, and every observable behavior currently covered by `QuickLookPanel.test.tsx`.

**Verification Profile**: command

**Acceptance Criteria**:

1. **Entry path + public surface preserved.** `src/components/shared/QuickLookPanel.tsx` continues to exist and remains importable as `QuickLookPanel from "@components/shared/QuickLookPanel"`. The default export is a React component whose runtime props equal the existing `QuickLookPanelProps` discriminated union (`QuickLookPanelRdbProps | QuickLookPanelDocumentProps`) — neither props type loses or gains a field. All three of `QuickLookPanelProps`, `QuickLookPanelRdbProps`, `QuickLookPanelDocumentProps` continue to be **named exports of the entry file** (`grep -n "export interface QuickLookPanelRdbProps\|export interface QuickLookPanelDocumentProps\|export type QuickLookPanelProps" src/components/shared/QuickLookPanel.tsx` returns three matches). `grep -rn "from \"@components/shared/QuickLookPanel\"" src/ e2e/` matches at least the existing two importers (`src/components/rdb/DataGrid.tsx`, `src/components/document/DocumentDataGrid.tsx`) unchanged.

2. **Sub-file layout exists.** All five of the following files exist after the sprint and have non-empty content: `src/components/shared/QuickLookPanel.tsx` (entry), `src/components/shared/QuickLookPanel/QuickLookShell.tsx`, `src/components/shared/QuickLookPanel/RdbQuickLookBody.tsx`, `src/components/shared/QuickLookPanel/DocumentQuickLookBody.tsx`, `src/components/shared/QuickLookPanel/helpers.ts`. Each sub-file exports at least one symbol that the entry (or another sub-file) imports — verifiable by grepping each path for `export` and confirming the entry imports the corresponding identifiers.

3. **Entry shrinks meaningfully.** `wc -l src/components/shared/QuickLookPanel.tsx` reports a line count strictly less than 250 (down from 868 — at least a 70 % reduction). The four sub-files together cover the extracted concerns, and no single sub-file exceeds 400 lines (`wc -l src/components/shared/QuickLookPanel/*.{ts,tsx}` highest row < 400).

4. **Existing tests pass unchanged.** `pnpm vitest run src/components/shared/QuickLookPanel.test.tsx` exits 0. The test file itself is not modified by this sprint (`git diff --stat src/components/shared/QuickLookPanel.test.tsx` reports zero changes).

5. **Project-wide regression bar.** `pnpm vitest run` exits 0 with file/test totals at least matching the post-Sprint-210 baseline. `pnpm tsc --noEmit` exits 0. `pnpm lint` exits 0. No new `eslint-disable*` directives appear under `src/components/shared/QuickLookPanel.tsx` or `src/components/shared/QuickLookPanel/` compared to the pre-sprint entry file (`git diff` on the touched paths shows no added `eslint-disable*` lines).

**Components to Create/Modify**:

- `src/components/shared/QuickLookPanel.tsx` (modify): entry file. Re-exports the three public props types (`QuickLookPanelProps`, `QuickLookPanelRdbProps`, `QuickLookPanelDocumentProps`) and continues to provide the default export — a React component that owns the cross-paradigm state shared between bodies (panel `height`, `editing` toggle, the `firstSelectedId` derivation), wires shared resize handlers for both bodies via the shared shell, and chooses between `RdbQuickLookBody` and `DocumentQuickLookBody` based on the `mode` discriminator. Holds no per-paradigm rendering, no per-cell formatting, no per-field edit rendering, and no resize-handle JSX inline.
- `src/components/shared/QuickLookPanel/QuickLookShell.tsx` (create): presentational shell that renders the outer panel container (`role="region"`, the configurable `aria-label`, `border-t border-border bg-background` chrome, the `style={{ height }}` wrapper), the resize handle (`role="separator"`, `tabIndex=0`, `aria-orientation="horizontal"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, the `GripHorizontal` icon, `cursor-row-resize` styling and `hover:bg-muted` / `focus-visible:outline-1 focus-visible:outline-ring` interactions, plus the `dark:bg-muted/20` variant currently present on the document-mode handle is preserved on whichever mode currently uses it), the header bar with title slot + the existing `HeaderControls` chrome (Modified pill + Edit toggle + Close button — including the `aria-pressed`, `title`, and per-mode close `aria-label` strings), and a children/body slot. Receives `height`, `onResizeMouseDown`, `onResizeKeyDown`, `aria-label` for the region, the title node, the close button label, the dirty flag, the editing flag, `editState`, `onToggleEdit`, `onClose`, and the body content. The shared `MIN_HEIGHT`, `MAX_HEIGHT`, `DEFAULT_HEIGHT`, and `KEYBOARD_RESIZE_STEP` constants live with the shell (or in `helpers.ts`) and continue to evaluate to `120 / 600 / 280 / 8` so the resizer test continues to read those exact values via `aria-valuemin/max/now`.
- `src/components/shared/QuickLookPanel/RdbQuickLookBody.tsx` (create): RDB-specific body. Renders the RDB title (`Row Details — schema.table`, with the `({n} selected, showing first)` suffix when `selectedRowIds.size > 1`), the per-column `FieldRow` list iterated over `data.columns`, the BLOB viewer dialog wiring (local `blobViewer` state mirroring the current `useState<{data, columnName} | null>`, mounting `BlobViewerDialog` when set, dismissing on `onOpenChange(false)`), and returns `null` when the selected row index is out of bounds or selection is empty (so the existing "renders nothing when out of bounds / empty" tests continue to pass). The close button `aria-label` stays `"Close row details"` and the region `aria-label` stays `"Row Details"`.
- `src/components/shared/QuickLookPanel/DocumentQuickLookBody.tsx` (create): document-specific body. Renders the namespace title (`Document Details — database.collection`, with the same multi-select suffix), and decides between the read-only path (mounts `BsonTreeViewer` with the selected document or the empty-state value when out of bounds / empty `rawDocuments`) and the edit path (renders `FieldRow` per synthesized column from `data.columns` with `_id`/PK and BLOB columns staying read-only via the same `isEditableColumn` helper, and wires a no-op `onBlobView` because document mode has no BLOB columns in V1). The region `aria-label` stays `"Document Details"`, the close button `aria-label` stays `"Close document details"`, and the BSON tree's `role="tree"` + `aria-label` matching `/BSON document tree/i` continues to be produced by `BsonTreeViewer` unmodified.
- `src/components/shared/QuickLookPanel/helpers.ts` (create): pure helpers + per-cell renderers shared across bodies. Houses `formatCellValue`, `isBlobColumn`, `isJsonColumn`, `isBoolColumn`, `looksLikeJson`, `isEditableColumn`, `selectedRowIsDirty`, `clampHeight`, the four height constants (`MIN_HEIGHT = 120`, `MAX_HEIGHT = 600`, `DEFAULT_HEIGHT = 280`, `KEYBOARD_RESIZE_STEP = 8`), and the `FieldRow` + `EditableValue` components (since both bodies render them and they depend on the helpers). No JSX outside `FieldRow` / `EditableValue`. No store mutations. May import from `@components/datagrid/useDataGridEdit` (`cellToEditValue`, `editKey`, `getInputTypeForColumn`, `DataGridEditState`) exactly as today.

## Global Acceptance Criteria

1. **Behavior change = 0.** Every behavior currently exercised by `src/components/shared/QuickLookPanel.test.tsx` (980 lines, all 50+ assertions across RDB mode, document mode, Sprint 194 edit mode (RDB + document), Sprint 90 #QL-2 column-header layout, Sprint 105 #QL-1 keyboard-accessible resizer) must remain identical. The test file itself is **not modified**.

2. **Public import path stays a single barrel.** External code (`src/components/rdb/DataGrid.tsx`, `src/components/document/DocumentDataGrid.tsx`) continues to import `QuickLookPanel` only from `@components/shared/QuickLookPanel`. The new sub-files under `src/components/shared/QuickLookPanel/` are internal to the entry — `grep -rn "from \"@components/shared/QuickLookPanel/" src/ e2e/` returns 0 matches outside `src/components/shared/QuickLookPanel.tsx`.

3. **Accessibility roles + ARIA preserved.** The resize handle continues to expose `role="separator"`, `tabIndex=0`, `aria-orientation="horizontal"`, `aria-valuemin="120"`, `aria-valuemax="600"`, `aria-valuenow` reflecting the current height (default `280`), `aria-label="Resize Quick Look panel"`, and no `aria-hidden`. The RDB body region has `role="region"` + `aria-label="Row Details"`; the document body region has `role="region"` + `aria-label="Document Details"`. The close button labels remain `"Close row details"` / `"Close document details"`. The edit toggle remains labelled `/Toggle edit mode/i` with `aria-pressed` reflecting the editing state. Per-cell labels remain `"Edit value for {column.name}"` (input/textarea/select), `"Set NULL for {column.name}"` (button), `"Value for {column.name}"` (read-only large-text textarea), `"View BLOB data for {column.name}"` (BLOB button).

4. **Resize semantics preserved.** Mouse drag (down on the handle, drag up = grow, drag down = shrink, releasing on document `mouseup`, restoring `cursor` and `userSelect` on the body) still works exactly as today. `Shift+ArrowUp` grows by 8px; `Shift+ArrowDown` shrinks by 8px; both clamp to `[120, 600]`. Plain `ArrowUp` / `ArrowDown` (no Shift) and `Shift+Enter` are no-ops. `aria-valuenow` updates synchronously after each step.

5. **Edit-mode dispatch ordering preserved.** Saving an RDB or document field through Enter, blur, or `Set NULL` continues to dispatch `editState.handleStartEdit(rowIdx, colIdx, originalEditValue)` then `editState.setEditValue(next)` then `editState.saveCurrentEdit()` in that order, with `next === null` only for the `Set NULL` and boolean-`NULL` paths. Boolean fields remain a three-way `Select` (`true` / `false` / `NULL`). `jsonb` / large-text / object / json-string cells continue to render a `<textarea>` where plain Enter inserts a newline (no save) and `Cmd/Ctrl+Enter` saves. Esc reverts the local draft without dispatching.

6. **PK / BLOB / `_id` read-only invariants preserved.** Primary-key columns (`is_primary_key === true`) and BLOB-family columns (`bytea`, `blob`, `binary`, `varbinary`, `image`) remain non-editable in edit mode (no `Edit value for ...` input rendered, `(read-only)` marker still emitted in their cell when `editing && editState`). The Mongo `_id` column (`is_primary_key: true` in the synthesized document `data.columns`) follows the same gate and stays non-editable.

7. **Dirty-pill propagation preserved.** The `● Modified` pill renders iff `editState.pendingEdits` contains at least one key with the prefix `${firstSelectedId}-` for the currently-displayed first selected row. It does not render in the read-only call-site (no `editState`) and does not render when only other rows have pending edits. Multi-select keeps showing the first (smallest-index) row's data and dirty state.

8. **BLOB viewer wiring preserved.** Clicking the BLOB button in the RDB body still mounts `BlobViewerDialog` with the same `data` and `columnName`, with `open` toggling via local component state and `onOpenChange(false)` clearing it. Document mode does **not** mount `BlobViewerDialog` (verified by the existing assertion that `data-testid="blob-viewer-dialog"` is absent in document mode).

9. **Document read-only-tree vs. edit-FieldRows toggle preserved.** With `mode: "document"` and an `editState`: when not editing, `BsonTreeViewer` is rendered; when editing **and** `data` is supplied, the tree disappears and per-field `FieldRow` rows render over the synthesized columns. With `mode: "document"` and no `editState`, the tree stays mounted at all times and no Edit toggle appears in the header. Out-of-bounds or empty `rawDocuments` produce the BSON empty state (`/No document selected/i`) without unmounting the panel.

10. **No silent error swallowing added.** Any `catch` clause in the moved helpers (`formatCellValue` already swallows `JSON.stringify` cycle errors and `JSON.parse` failures with inline justification comments) keeps its existing inline justification; no new untyped `catch {}` is introduced.

## Data Flow

- **Open / close:** the two grids own the Cmd+L → `selectedRowIds` → mount decision (Sprint 194 contract). `QuickLookPanel` continues to receive `selectedRowIds` and `onClose` and continues to return `null` (RDB) or render the BSON empty state (document) when the selection is out of bounds, exactly as today. The split does not move this contract.
- **Resize flow:** entry holds `height` state, builds the `onResizeMouseDown` and `onResizeKeyDown` handlers, and passes both handlers + `height` into the chosen body (which forwards them to `QuickLookShell`'s resize handle).
- **Edit flow:** entry holds the `editing` toggle and forwards `editState` into the body. The body delegates per-cell rendering to the `FieldRow` / `EditableValue` components in `helpers.ts`. Save dispatches still go straight to the `editState` methods unchanged.
- **BLOB flow:** RDB body holds local `{data, columnName} | null` and mounts `BlobViewerDialog` with that pair; the document body never opens this dialog.
- **Dirty-state flow:** each body computes `selectedRowIsDirty(firstSelectedId, editState?.pendingEdits ?? new Map())` (helper relocated to `helpers.ts`) and passes the result into the shared `HeaderControls` for the `● Modified` pill.

## UI States

- **No selection / out-of-bounds (RDB mode):** entry returns `null` (panel does not mount). Existing tests `renders nothing when selected row index is out of bounds` and `renders nothing when selection is empty` continue to pass.
- **No selection / out-of-bounds (document mode):** panel stays mounted; `BsonTreeViewer` renders its empty state `/No document selected/i`.
- **Read-only call-site:** no Edit toggle in the header chrome; no `(read-only)` markers in cells; no Modified pill ever.
- **Editable call-site, editing off:** Edit toggle visible (`aria-pressed=false`), no inputs rendered, BSON tree still mounted (document mode), `displayValue` formatting unchanged (RDB mode).
- **Editable call-site, editing on:** Edit toggle `aria-pressed=true`, inputs rendered for editable columns, `(read-only)` marker on PK/BLOB/_id columns, BSON tree replaced by FieldRows in document mode (only when `data` is supplied), Modified pill appears iff `pendingEdits` has a key for the selected row.
- **Resize at min/max:** `aria-valuenow` clamps to `120` / `600`; further `Shift+Arrow` presses do not change it.
- **BLOB viewer open:** `BlobViewerDialog` mounted in RDB mode with the cell value and column name; closing the dialog clears the local state.

## Edge Cases

- Multi-select with mixed indices → the smallest-index row is treated as "first selected" and the suffix `({n} selected, showing first)` appears in the header (existing tests `shows first row when multiple rows are selected` + `indicates multiple selection in header`).
- Long column name + long data type → header cell is `flex flex-col` with `font-mono text-xs` on the name span and `text-3xs opacity-60` on the type span; both spans use `whitespace-normal break-words` and have no `truncate` / `text-ellipsis` utility (existing `sprint-90 #QL-2` tests).
- `jsonb` / object / array / json-string value with `editing=false` → renders as a `<pre>` with pretty-printed JSON; with `editing=true` swaps to a `<textarea>` whose initial value is the same pretty-printed JSON.
- `bytea` / blob value with `editing=false` → renders the BLOB button; with `editing=true` keeps the BLOB button **and** appends the `(read-only)` marker; no `Edit value for ...` input is rendered.
- Boolean cell with `editing=true` → three-way `Select` whose current option matches `true` / `false` / `NULL` based on `pendingValue ?? value`.
- `Set NULL` button click → dispatches `handleStartEdit(rowIdx, colIdx, original) → setEditValue(null) → saveCurrentEdit()` and clears the local draft to empty string.
- Esc inside an input/textarea → reverts local draft to its initial string; no dispatch.
- Mouse drag past max height upward / past min height downward → `clampHeight` keeps the height inside `[120, 600]`.
- Document mode with no `data` prop and `editState` provided → Edit toggle is visible but toggling on still falls back to the BSON tree (because `showFieldRows` requires both `editState` and `data`).

## Verification Hints

- Primary regression command: `pnpm vitest run src/components/shared/QuickLookPanel.test.tsx` — must exit 0 with no test-file edits.
- File-shape checks:
  - `wc -l src/components/shared/QuickLookPanel.tsx` reports < 250.
  - `ls src/components/shared/QuickLookPanel/{QuickLookShell.tsx,RdbQuickLookBody.tsx,DocumentQuickLookBody.tsx,helpers.ts}` lists all four files.
  - `wc -l src/components/shared/QuickLookPanel/*.{ts,tsx}` shows no row above 400.
- Public-surface checks:
  - `grep -rn "from \"@components/shared/QuickLookPanel\"" src/ e2e/` produces the same matches as before the sprint (importers unchanged, just `DataGrid.tsx` + `DocumentDataGrid.tsx`).
  - `grep -rn "from \"@components/shared/QuickLookPanel/" src/ e2e/` returns 0 matches outside `src/components/shared/QuickLookPanel.tsx` (sub-files stay internal).
  - `grep -n "export interface QuickLookPanelRdbProps\|export interface QuickLookPanelDocumentProps\|export type QuickLookPanelProps" src/components/shared/QuickLookPanel.tsx` returns three matches.
- Project-wide gates: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` all exit 0.
- Diff sanity check: `git diff --stat src/components/shared/QuickLookPanel.test.tsx` reports no changes.
- Eslint-disable check: `git diff src/components/shared/QuickLookPanel.tsx src/components/shared/QuickLookPanel/` shows no added `eslint-disable*` lines vs. the pre-sprint baseline.
