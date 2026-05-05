# Feature Spec: DocumentDataGrid god-file split (Sprint 210)

## Description

`src/components/document/DocumentDataGrid.tsx` (951 lines) currently mixes seven concerns: data fetch + cancellation + pagination, edit-state adapter wiring, Mongo bulk delete/update flows, Add Document flow, MQL preview, dialog rendering, query history recording, Safe Mode gate, and a `fetchIdRef` stale-response guard. Sprint 210 splits this god component behavior-preserving into two focused hooks (`useDocumentGridData`, `useMongoBulkOps`), two presentational dialog components (`DocumentBulkDeleteDialog`, `DocumentBulkUpdateDialog`), with the entry file (`DocumentDataGrid.tsx`) reduced to toolbar / grid / modal wiring. Entry path, public props, and all observable behavior remain identical so the existing 3 regression test files pass unchanged.

## Sprint Breakdown

### Sprint 210: DocumentDataGrid entry-pattern split
**Goal**: Decompose `DocumentDataGrid.tsx` into a thin entry file plus 4 co-located sub-files (2 hooks + 2 dialog components) under `src/components/document/DocumentDataGrid/`, while preserving entry path, public props, and all observable behavior covered by the 3 existing test files.

**Verification Profile**: command

**Acceptance Criteria**:
1. **Entry path + public props preserved.** `src/components/document/DocumentDataGrid.tsx` continues to exist and is importable as `DocumentDataGrid from "@components/document/DocumentDataGrid"`. The default export is a React component whose props equal `{ connectionId: string; database: string; collection: string }` (no added or removed props). `grep -n "from \"@components/document/DocumentDataGrid\"" src/ e2e/` matches at least the existing `src/components/layout/MainArea.tsx` import unchanged.
2. **Sub-file layout exists.** All five of the following files exist after the sprint and have non-empty content: `src/components/document/DocumentDataGrid.tsx` (entry), `src/components/document/DocumentDataGrid/useDocumentGridData.ts`, `src/components/document/DocumentDataGrid/useMongoBulkOps.ts`, `src/components/document/DocumentDataGrid/DocumentBulkDeleteDialog.tsx`, `src/components/document/DocumentDataGrid/DocumentBulkUpdateDialog.tsx`. Each sub-file exports at least one symbol that the entry imports.
3. **Entry shrinks meaningfully.** `wc -l src/components/document/DocumentDataGrid.tsx` reports a line count strictly less than 600 (down from 951 — a >35% reduction). The four sub-files together cover the extracted concerns, and no single sub-file exceeds 400 lines.
4. **Existing tests pass unchanged.** `pnpm vitest run src/components/document/DocumentDataGrid.test.tsx src/components/document/DocumentDataGrid.pagination.test.tsx src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` exits 0. None of these three test files are modified by this sprint (verifiable with `git diff --stat src/components/document/DocumentDataGrid.test.tsx src/components/document/DocumentDataGrid.pagination.test.tsx src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` showing zero changes).
5. **Project-wide regression bar.** `pnpm vitest run` exits 0 with file/test totals at least matching the post-Sprint-209 baseline. `pnpm tsc --noEmit` exits 0. `pnpm lint` exits 0. No new `eslint-disable` directives are introduced compared to the pre-sprint file (verifiable with `git diff` showing no added `eslint-disable*` lines under the touched paths).

**Components to Create/Modify**:
- `src/components/document/DocumentDataGrid.tsx` (modify): entry file. Renders `CollectionReadOnlyBanner`, `DataGridToolbar`, `DocumentFilterBar`, the table body, `QuickLookPanel`, `MqlPreviewModal`, `AddDocumentModal`, and the two extracted bulk dialogs. Wires the two extracted hooks plus the existing `useDataGridEdit`, `useSafeModeGate`, and `useDelayedFlag` hooks. Holds only the state that crosses extracted concerns (pagination cursor, filter state, Add modal state, edit hook bridge); does not perform `runFind`, cancellation, bulk-write invocation, or query-history recording inline.
- `src/components/document/DocumentDataGrid/useDocumentGridData.ts` (create): owns `runFind` dispatch, pagination skip/limit derivation, the `fetchIdRef` stale-response guard, the `queryIdRef` in-flight tracking, the loading/error state, the cancel handler that bumps `fetchIdRef`, drops `loading` synchronously, and best-effort calls `cancelQuery`. Exposes whatever shape the entry needs to render (loading flag, error string, refetch trigger, cancel handler, the query result projection used by the grid). Pure orchestration hook — no JSX, no store mutations beyond `runFind`.
- `src/components/document/DocumentDataGrid/useMongoBulkOps.ts` (create): owns the deleteMany / updateMany decision flow. Encapsulates the Safe Mode gate decision, JSON patch parse + `_id`-rejection validation, `invokeDeleteMany` / `invokeUpdateMany` dispatch, success/error toast, query-history `addHistoryEntry` calls (with `source: "mongo-op"`, `paradigm: "document"`, `queryMode: "find"`, identical timing fields), and the post-success refetch trigger. Exposes the action handlers, dialog open flags, and per-dialog loading/error state to the entry.
- `src/components/document/DocumentDataGrid/DocumentBulkDeleteDialog.tsx` (create): presentational. Renders the existing "Delete matching documents" dialog content (title, description that varies by filter presence, filter JSON pre block, Cancel + destructive Confirm buttons with their existing aria-labels and disabled states). Receives `open`, `onOpenChange`, `database`, `collection`, `activeFilter`, `loading`, `onConfirm` as props.
- `src/components/document/DocumentDataGrid/DocumentBulkUpdateDialog.tsx` (create): presentational. Renders the existing "Update matching documents" dialog content (title, filter-aware description, filter JSON pre block, patch JSON `<textarea>` with the placeholder `{ "status": "archived" }`, alert paragraph for parse errors, Cancel + default Confirm buttons with their existing aria-labels, disabled states, and loading copy). Receives `open`, `onOpenChange`, `database`, `collection`, `activeFilter`, `patchInput`, `onPatchInputChange`, `error`, `loading`, `onConfirm` as props.

## Global Acceptance Criteria

1. **Behavior change = 0.** Every user-visible behavior currently exercised by `DocumentDataGrid.test.tsx`, `DocumentDataGrid.pagination.test.tsx`, and `DocumentDataGrid.refetch-overlay.test.tsx` must remain identical. None of these three test files may be modified.
2. **Query-history side-effect ordering preserved.** For each path that records history (Add Document success, Add Document error, deleteMany success, deleteMany error, updateMany success, updateMany error), `addHistoryEntry` is invoked with the same `sql`, `executedAt`, `duration`, `status`, `connectionId`, `paradigm`, `queryMode`, `database`, `collection`, `source` fields, and the call still happens after the toast/UI update and before the loading flag clears (the existing ordering observable in the test for AC-196-05-1 must continue to pass).
3. **Safe Mode gate semantics preserved.** Both bulk handlers run `safeModeGate.decide(analyzeMongoOperation(...))` before opening their dialog, surface the same `toast.error(decision.reason)` on `block`, and never open the dialog when blocked.
4. **`fetchIdRef` stale-response invariant preserved.** Concurrent or cancelled fetches still drop their results when superseded; the cancel handler still clears `loading` synchronously within one frame regardless of whether the backend has settled. Race protection between `setLoading(false)` and `setError(...)` continues to be gated by `fetchIdRef.current === fetchId`. The "cancel → re-trigger paints second attempt's data" test (`AC-180-05-DocumentDataGrid`) continues to pass.
5. **Mongo bulk-write commands wiring preserved.** `invokeDeleteMany` is still called as `(connectionId, database, collection, activeFilter)` and `invokeUpdateMany` as `(connectionId, database, collection, activeFilter, patch)`. Both still emit success toasts of the form `"Deleted {N} document(s)"` / `"Updated {N} document(s)"` and error toasts/alert text that mirror the current copy.
6. **Public import path stays a single barrel.** External code (e.g., `MainArea.tsx`) continues to import `DocumentDataGrid` only from `@components/document/DocumentDataGrid`. The new sub-files are internal to that path; they may be imported by the entry file but should not become public surface (no consumers outside `src/components/document/DocumentDataGrid/` and the entry file).
7. **No silent error swallowing added.** Any new `catch` clause introduced by the sprint either re-surfaces the error to the user (toast or state) or carries an inline justification comment, in line with the project's catch-policy convention.

## Data Flow

- **Read flow:** entry → `useDocumentGridData(connectionId, database, collection, page, pageSize, activeFilter)` → calls `useDocumentStore.runFind` (Tauri `findDocuments`) → result lands in `useDocumentStore.queryResults[key]` → entry projects it into a `TableData` shape for `useDataGridEdit`.
- **Cancel flow:** overlay Cancel → `handleCancelRefetch` (inside `useDocumentGridData`) → bumps `fetchIdRef`, clears `loading` synchronously, fires best-effort `cancelQuery(queryId)`.
- **Add Document flow:** entry handler calls `insertDocument` → on resolve/reject, records a history entry (`source: "mongo-op"`) → triggers refetch via the data hook.
- **Bulk Delete flow:** toolbar button → `useMongoBulkOps.handleDeleteManyClick` runs Safe Mode decision → on `block` toasts and aborts; otherwise opens `DocumentBulkDeleteDialog` → confirm calls `invokeDeleteMany` → success/error toast + history record + refetch via the data hook.
- **Bulk Update flow:** toolbar button → `useMongoBulkOps.handleUpdateManyClick` runs Safe Mode decision → on `block` toasts and aborts; otherwise opens `DocumentBulkUpdateDialog` → confirm parses the JSON patch (rejects non-object, array, missing JSON, or `_id`-bearing) → calls `invokeUpdateMany` → success/error toast + history record + refetch.
- **Edit flow:** entry continues to wire `useDataGridEdit` exactly as today (including `paradigm: "document"`); the data hook supplies `fetchData` to the edit hook for post-commit refetch.

## UI States (per sprint where relevant)

- **Loading (initial):** centered `Loader2` spinner appears while `loading && !data` (unchanged).
- **Loading (refetch overlay):** `AsyncProgressOverlay` paints only after `useDelayedFlag(loading, 1000)` flips true; cancel button clears the overlay synchronously (unchanged AC-176/AC-180 contract).
- **Empty:** "No documents" row when `data.rows.length === 0` (unchanged copy and styling).
- **Error (fetch):** alert role, `border-destructive/20 bg-destructive/10` banner with the error string (unchanged copy and roles).
- **Bulk delete dialog:** title "Delete matching documents"; description varies by `activeFilterCount`; filter pre-block visible; destructive Confirm aria-labelled "Confirm delete matching"; loading text "Deleting...".
- **Bulk update dialog:** title "Update matching documents"; description varies by `activeFilterCount`; filter pre-block visible; patch `<textarea>` with placeholder `{ "status": "archived" }`; inline alert for parse / `_id` errors; Confirm aria-labelled "Confirm update matching"; loading text "Updating...".

## Edge Cases

- Cancel fires before backend settles → `loading` drops within one frame; the eventual resolve is dropped by `fetchIdRef` guard (covered by `AC-180-05-DocumentDataGrid`).
- Filter is empty when bulk-delete is requested → dialog shows the "every document" wording (covered by current dialog copy assertions).
- Patch input is empty / not JSON / a JSON array / a JSON object containing `_id` → confirm rejects with the existing inline error messages and does not call `invokeUpdateMany`.
- Safe Mode `block` decision → `toast.error(decision.reason)` and the dialog never opens.
- Page change while a fetch is pending → the older fetch's resolve/reject is ignored once `fetchIdRef` advances; new page renders cleanly (covered by pagination test).
- Cmd+L with zero rows or zero selection → Quick Look panel does not mount (covered by existing tests).

## Verification Hints

- Primary regression command: `pnpm vitest run src/components/document/DocumentDataGrid.test.tsx src/components/document/DocumentDataGrid.pagination.test.tsx src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` — must exit 0 with no test-file edits.
- File-shape checks:
  - `wc -l src/components/document/DocumentDataGrid.tsx` reports < 600.
  - `ls src/components/document/DocumentDataGrid/{useDocumentGridData.ts,useMongoBulkOps.ts,DocumentBulkDeleteDialog.tsx,DocumentBulkUpdateDialog.tsx}` lists all four files.
- Public-surface checks:
  - `grep -rn "from \"@components/document/DocumentDataGrid\"" src/ e2e/` produces the same matches as before the sprint (importers unchanged).
  - `grep -rn "from \"@components/document/DocumentDataGrid/" src/ e2e/` returns 0 matches outside `src/components/document/DocumentDataGrid.tsx` (sub-files stay internal).
- Project-wide gates: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` all exit 0.
- Diff sanity check: `git diff --stat src/components/document/DocumentDataGrid.test.tsx src/components/document/DocumentDataGrid.pagination.test.tsx src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` reports no changes.
