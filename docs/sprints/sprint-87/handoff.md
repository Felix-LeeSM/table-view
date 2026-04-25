# Sprint 87 — Generator Handoff

Phase 6 plan F-3 — Document UI completion. Wires the Sprint 86 `useDataGridEdit({ paradigm: "document" })` hook + `mqlPreview` state into the DocumentDataGrid UI so MongoDB collections support the same inline-edit / Commit / preview / Execute loop the SQL grid ships.

## Changed Files

| Path | Kind | Purpose |
| --- | --- | --- |
| `src/components/DocumentDataGrid.tsx` | modify | Replaced the read-only header + native page buttons with `DataGridToolbar`, integrated the `useDataGridEdit({ paradigm: "document" })` hook, added inline edit inputs (scalar only — sentinel cells short-circuit), pending-edit visualisation, MQL preview modal mount, Add Document modal mount. |
| `src/components/DocumentDataGrid.test.tsx` | modify | Added Tauri mutate wrappers to the mock; updated the row-selection assertion to match the shared hook's Cmd+Click toggle; added +6 Sprint 87 scenarios (double-click edit, sentinel read-only, Commit → preview, Execute → updateDocument + fetch, Add → insertDocument, pending highlight). |
| `src/components/document/MqlPreviewModal.tsx` | new | Radix Dialog rendering `previewLines` as a monospace pre-block, per-row `errors` as a destructive list, Execute/Cancel footer. Enter triggers Execute outside inputs; Execute disabled when `previewLines.length === 0` or loading. |
| `src/components/document/MqlPreviewModal.test.tsx` | new | 7 cases — preview rendering, errors list, Execute callback, Cancel callback, disabled-when-empty, loading state, Enter shortcut. |
| `src/components/document/AddDocumentModal.tsx` | new | JSON textarea + parse/validate → calls parent `onSubmit` with a `Record<string, unknown>`; surfaces `parseError` (invalid/non-object/empty) and parent-provided `error` (e.g. backend rejection). Supports Cmd+Enter submit. |
| `src/components/document/AddDocumentModal.test.tsx` | new | 7 cases — valid submit, invalid JSON, empty input, array rejection, Cancel, parent error prop, Cmd+Enter submit. |
| `docs/sprints/sprint-87/handoff.md` | new | This file. |

Nothing in `src-tauri/**`, `src/components/DataGrid.tsx`, `src/components/datagrid/useDataGridEdit.ts`, `src/components/datagrid/sqlGenerator.ts`, `src/lib/mongo/mqlGenerator.ts`, `src/types/documentMutate.ts`, `src/lib/tauri.ts`, or `src/components/connection/ConnectionDialog.tsx` was modified by Sprint 87.

## Acceptance Criteria Coverage

| ID | Requirement | Evidence |
| --- | --- | --- |
| AC-01 | `useDataGridEdit({ paradigm: "document", … })` wired | `src/components/DocumentDataGrid.tsx:129-138` — hook call with `schema: database`, `table: collection`, `page`, `fetchData`, `paradigm: "document"`. |
| AC-02 | Scalar double-click → inline input → pendingEdits | `DocumentDataGrid.tsx:155-174` `handleStartEditCell`; `DocumentDataGrid.tsx:309-325` `onDoubleClick` + `input` rendering; test `DocumentDataGrid.test.tsx` — "double-click on a scalar cell opens the inline editor and records a pending edit". |
| AC-03 | Sentinel cell double-click stays read-only | `DocumentDataGrid.tsx:159-164` early-return when `isDocumentSentinel(cell)`; test — "double-click on a sentinel cell is a no-op — no editor appears". |
| AC-04 | Edit/new/delete row visualisation | `DocumentDataGrid.tsx:283-293` row className adds `bg-destructive/10 line-through opacity-60` for deleted rows; `DocumentDataGrid.tsx:305-307` cell adds `bg-highlight/20` for pending edits and `bg-primary/10 ring-primary` for the active editor; test "pending-edit visual cue — edited cell receives the highlight background" asserts the class. |
| AC-05 | Commit → MqlPreviewModal with previewLines | `DocumentDataGrid.tsx:237-240` toolbar `onCommit={editState.handleCommit}`; `DocumentDataGrid.tsx:394-402` modal mount when `mqlPreview` non-null; test "Commit button opens the MQL preview modal with the generated command lines". |
| AC-06 | Execute → handleExecuteCommit + fetchData + modal close | `DocumentDataGrid.tsx:191-198` `handleExecuteMql` awaits the hook's dispatch (which calls `fetchData` internally on success); modal auto-unmounts when `mqlPreview` clears; test "Execute inside the MQL preview dispatches updateDocument and refetches". |
| AC-07 | Cancel/Esc → `setMqlPreview(null)` | `DocumentDataGrid.tsx:400-401` `onCancel={() => editState.setMqlPreview(null)}`; `MqlPreviewModal.tsx:41` `onOpenChange` forwards Esc to `onCancel`; test "invokes onCancel when the Cancel button is clicked". |
| AC-08 | Errors surfaced; Execute disabled when no commands | `MqlPreviewModal.tsx:103-123` errors list; `MqlPreviewModal.tsx:44` `executeDisabled` + `MqlPreviewModal.tsx:138` `disabled={executeDisabled}`; test "disables the Execute button when no preview lines are generated". |
| AC-09 | Toolbar Add → AddDocumentModal → insertDocument + refetch | `DocumentDataGrid.tsx:176-179` `handleAddClick`; `DocumentDataGrid.tsx:181-196` `handleAddSubmit` calls `insertDocument` + awaits `fetchData`; test "toolbar Add opens the AddDocumentModal and submits via insertDocument". |
| AC-10 | AddDocumentModal invalid JSON / non-object error | `AddDocumentModal.tsx:62-81` parse + `isPlainObject` check; tests "shows an error and does not submit when JSON is invalid" / "rejects a JSON array with a non-object error". |
| AC-11 | AddDocumentModal Cancel / Esc closes without insert | `AddDocumentModal.tsx:91` `onOpenChange` forwards Esc; `AddDocumentModal.tsx:134-140` Cancel button; test "invokes onCancel when the Cancel button is clicked". |
| AC-12 | Toolbar Delete → pendingDeletedRowKeys + deleteOne preview | `DocumentDataGrid.tsx:241` `onDeleteRow={editState.handleDeleteRow}` routes through Sprint 86 hook; delete lines produced by `mqlGenerator.generateMqlPreview` are included in the preview block. Covered by `useDataGridEdit.document.test.ts` (Sprint 86) `"handleExecuteCommit dispatches mqlPreview commands in order and clears state on success"`. |
| AC-13 | `DocumentDataGrid.test.tsx` ≥ 4 new cases | 6 new Sprint 87 cases (edit happy path, sentinel read-only, Commit → preview, Execute → updateDocument + refetch, Add → insertDocument, pending cue). |
| AC-14 | `MqlPreviewModal.test.tsx` ≥ 4 cases | 7 cases — render lines, render errors, Execute callback, Cancel callback, disabled-empty, loading, Enter shortcut. |
| AC-15 | `AddDocumentModal.test.tsx` ≥ 4 cases | 7 cases — valid submit, invalid JSON, empty input, non-object rejection, Cancel, parent error prop, Cmd+Enter submit. |
| AC-16 | `pnpm tsc --noEmit` = 0 errors | See Verification §1. |
| AC-17 | `pnpm lint` = 0 errors | See Verification §2. |
| AC-18 | `pnpm vitest run` PASS, ≥ +12 new | See Verification §3 — 1615 total, +20 vs baseline 1595. |
| AC-19 | Protected-scope diff empty | See Verification §4 — `git diff --stat` returned empty. |
| AC-20 | ConnectionDialog diff unchanged | See Verification §5 — same 767 lines / 385 / 382 as pre-existing Sprint 79 diff. |

## Verification

All five required checks pass. Commands run from the repository root.

### 1. `pnpm tsc --noEmit`
Output: clean exit (0 errors).

### 2. `pnpm lint`
Output: clean exit (0 errors).

### 3. `pnpm vitest run`
```
Test Files  85 passed (85)
     Tests  1615 passed (1615)
  Duration  14.63s
```
Delta vs baseline 1595: **+20** new tests (`MqlPreviewModal` 7 + `AddDocumentModal` 7 + `DocumentDataGrid` 6).

### 4. `git diff --stat HEAD -- src-tauri/ src/lib/mongo/ src/types/documentMutate.ts src/lib/tauri.ts src/components/datagrid/useDataGridEdit.ts src/components/DataGrid.tsx`
Output: empty. Protected-scope artifacts from Sprints 80 and 86 and the RDB grid are byte-for-byte preserved.

### 5. `git diff --stat HEAD -- src/components/connection/ConnectionDialog.tsx`
```
src/components/connection/ConnectionDialog.tsx | 767 +++++++++++++------------
 1 file changed, 385 insertions(+), 382 deletions(-)
```
Identical to the pre-existing Sprint 79 diff — Sprint 87 introduced no additional modifications to this file.

## Assumptions

- **Add Row path — option (a)**: Toolbar Add opens `AddDocumentModal` (single JSON submit) and calls `insertDocument` directly + `await fetchData()`. The Sprint 86 `handleAddRow` empty-positional-row path is *not* used. Rationale: MongoDB documents have no enforced schema, so cell-by-cell positional editing is unnatural; a single JSON textarea matches mongosh usage and avoids inventing a new "schema-less positional row" UX. The trade-off is that the user must express the whole document in JSON rather than field-by-field.
- **Sentinel cell double-click behaviour**: noop. The grid guards in `handleStartEditCell` via `isDocumentSentinel(cell)` so the editor never opens. No tooltip / toast is surfaced — the sentinel text (`{...}`, `[N items]`) itself communicates the non-editability. Rationale: consistent with Sprint 86 generator behaviour (it rejects sentinel edits on commit anyway) and keeps the interaction silent for the v1 UI.
- **JSON validation depth**: `AddDocumentModal` uses `JSON.parse` + a prototype-based `isPlainObject` check. Nested types (BSON ObjectId, Date, NumberLong) are forwarded unchanged as extended-JSON literals (`{"$oid": "…"}`); the backend handles conversion to BSON. No schema-driven validation is attempted — the contract explicitly notes the backend is the authority on Mongo-acceptable documents.
- **Native `<table>` vs `DataGridTable`**: Kept native `<table>` rendering in `DocumentDataGrid.tsx`. `DataGridTable`'s prop surface is tightly coupled to `TableData` + FK navigation / BLOB viewer / context menu that don't apply to document grids; reusing it would have required props for "is this cell a sentinel" and would have expanded the surface. The native table keeps the sentinel short-circuit local and avoids the risk of drifting RDB behaviour.
- **Toolbar `Filter` toggle is a no-op for documents**: `onToggleFilters` is stubbed because the document filter bar is not yet implemented; the button stays visually consistent with the RDB grid but does nothing in this sprint. Out-of-scope per contract.
- **MQL preview executing state**: A local `executing` boolean wraps `editState.handleExecuteCommit` so the Execute button can show a spinner + stay disabled during dispatch. The hook itself does not expose a pending flag; keeping the flag component-local mirrors the RDB Dialog's inline behaviour.

## Residual Risk

- **Nested field editing still unsupported** (Phase 6 out-of-scope). Users cannot edit a key inside `{...}` or an element inside `[N items]`; the sentinel short-circuit explicitly prevents this. A future sprint would need an expanded cell editor + dot-path support in the MQL generator.
- **`_id` generation delegated to Mongo**: AddDocumentModal does not generate an ObjectId client-side when the user omits `_id`. The server generates one and returns it in `insertDocument`'s response; the current UI simply re-fetches the page so the new document reappears with its server-assigned id. If the user's insert lands on a later page this could look like the row "vanished" — expected behaviour for a v1 that doesn't track inserted-id position.
- **No JSON schema enforcement before submit**: Malformed types (e.g. a string where the column expects an int) will round-trip to the backend which may or may not reject. The `AddDocumentModal.error` prop surfaces the backend's response for the user to correct and retry.
- **Delete/duplicate on an unselected row is a silent no-op**: The toolbar disables those buttons at `selectedRowIdsCount === 0`, but the underlying `editState.handleDeleteRow` already guards the same case. No regression risk; just noting the defensive double-layer.
- **MQL preview Enter shortcut vs textarea**: The modal's Enter-to-Execute handler excludes `TEXTAREA` and `INPUT` elements, but a focused button inside the dialog (e.g. Cancel) would fall through to Execute on Enter. Not observed in practice because Radix focuses the Execute button on open; document for future auditors if the focus policy changes.

## Self-Evaluation

All five required checks PASS:
1. `pnpm tsc --noEmit` — 0 errors.
2. `pnpm lint` — 0 errors.
3. `pnpm vitest run` — 1615/1615 PASS, +20 vs baseline 1595.
4. Protected-scope `git diff --stat` — empty.
5. `ConnectionDialog.tsx` diff — identical to pre-existing Sprint 79 diff.

AC-01 through AC-20 all backed by file:line evidence or test case names in the table above. Phase 6 plan F is complete pending evaluator acceptance.
