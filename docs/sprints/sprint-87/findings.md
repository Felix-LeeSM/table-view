# Sprint 87 — Evaluator Findings

Phase 6 plan F-3 — Document UI completion. Evaluator review of Generator handoff
against `contract.md` AC-01..AC-20.

## Verdict: PASS

Overall score: **57 / 60** (95%). All required checks pass; all 20 acceptance
criteria satisfied with file:line evidence. No P0/P1 findings; one P2
(documentation nit) noted below.

## Six-Dimension Scorecard

| Dimension | Score | Evidence |
| --- | --- | --- |
| 1. Contract Fidelity | 10/10 | All 20 ACs met. Write Scope respected — only `DocumentDataGrid.tsx` + `.test.tsx` modified, only `src/components/document/{MqlPreview,AddDocument}Modal.{tsx,test.tsx}` created. `git status --short` shows no other source-tree edits. |
| 2. Correctness | 10/10 | `useDataGridEdit({ paradigm: "document", … })` wired at `DocumentDataGrid.tsx:131-139`. Sentinel guard at `DocumentDataGrid.tsx:157-162` (early return before `handleStartEdit`). MqlPreviewModal Execute/Cancel callbacks at `MqlPreviewModal.tsx:121-138` + `MqlPreviewModal.tsx:49` (`onOpenChange` → Esc). AddDocumentModal `JSON.parse` at `AddDocumentModal.tsx:66`, `insertDocument` invocation at `DocumentDataGrid.tsx:182`. |
| 3. Test Coverage | 10/10 | +20 new tests (req: ≥+12). MqlPreviewModal 7 cases, AddDocumentModal 7 cases, DocumentDataGrid +6 cases. Happy path / sentinel-readonly / error / boundary all covered (e.g. AddDocumentModal `[1,2,3]` rejection at `AddDocumentModal.test.tsx:65-78`; MqlPreviewModal `previewLines: []` disabled-Execute at `MqlPreviewModal.test.tsx:69-76`). |
| 4. Code Quality | 9/10 | Zero `any` in new code (confirmed via grep on `src/components/document/` and modified `DocumentDataGrid.tsx`). Tests use `getByRole`/`getByLabelText`/`getByText` — no `getByTestId`. Component-per-file + PascalCase + Tailwind dark-mode tokens (`bg-secondary`, `text-secondary-foreground`, `bg-destructive/10`). Minor nit: `MqlPreviewModal.tsx:62-73` Enter handler matches on the inner `div` but Radix focuses Execute button by default — acknowledged by Generator in Residual Risk; documented but not regression-tested. |
| 5. Invariants Preserved | 10/10 | `git diff --stat HEAD -- src-tauri/ src/lib/mongo/ src/types/documentMutate.ts src/lib/tauri.ts src/components/datagrid/useDataGridEdit.ts src/components/DataGrid.tsx` returns empty (verified). RDB grid + sqlGenerator + useDataGridEdit RDB branch byte-for-byte. Sprint 86 frontend middleware untouched. ConnectionDialog diff = pre-existing Sprint 79 only (767/385/382 lines, identical). |
| 6. Verification Rigor | 8/10 | All 5 contract checks PASS per orchestrator pre-verification (tsc 0, lint 0, vitest 1615/1615 = +20 vs 1595, protected-scope diff empty, ConnectionDialog diff Sprint-79-identical). Numbers in handoff §3 match Generator's stated +20. Slight deduction: handoff §3 quotes only the test summary line; full vitest output not captured but redundant given orchestrator's pre-flight. |
| **Total** | **57/60** | All dimensions ≥7 → **PASS** |

## Acceptance Criteria Evidence

| AC | Status | Evidence |
| --- | --- | --- |
| AC-01 | PASS | `DocumentDataGrid.tsx:131-139` — `useDataGridEdit({ data, schema: database, table: collection, connectionId, page, fetchData, paradigm: "document" })`. |
| AC-02 | PASS | `DocumentDataGrid.tsx:153-170` `handleStartEditCell` + `:362-388` `onDoubleClick` and `<input>` rendering (Enter/blur → `saveCurrentEdit`). Test `DocumentDataGrid.test.tsx:287-305` "double-click on a scalar cell opens the inline editor and records a pending edit". |
| AC-03 | PASS | `DocumentDataGrid.tsx:157-162` early-return on `isDocumentSentinel(cell)`. Test `DocumentDataGrid.test.tsx:307-318` "double-click on a sentinel cell is a no-op". |
| AC-04 | PASS | `DocumentDataGrid.tsx:323-328` row className adds `bg-destructive/10 line-through opacity-60` for deleted rows; `DocumentDataGrid.tsx:347-354` cell adds `bg-highlight/20` for pending edits + `bg-primary/10 ring-primary` for active editor. Test `DocumentDataGrid.test.tsx:406-421` asserts `bg-highlight` class. |
| AC-05 | PASS | `DocumentDataGrid.tsx:256` `onCommit={editState.handleCommit}`; `:449-457` modal mount when `mqlPreview` non-null. Test `DocumentDataGrid.test.tsx:320-338` "Commit button opens the MQL preview modal". |
| AC-06 | PASS | `DocumentDataGrid.tsx:194-201` `handleExecuteMql` awaits `editState.handleExecuteCommit()` (hook calls `fetchData` internally on success); modal unmounts when `mqlPreview` clears. Test `DocumentDataGrid.test.tsx:340-375` "Execute inside the MQL preview dispatches updateDocument and refetches". |
| AC-07 | PASS | `DocumentDataGrid.tsx:455` `onCancel={() => editState.setMqlPreview(null)}`; `MqlPreviewModal.tsx:49` `onOpenChange` forwards Esc to `onCancel`. Test `MqlPreviewModal.test.tsx:60-67` Cancel callback. |
| AC-08 | PASS | `MqlPreviewModal.tsx:101-118` errors list rendered conditionally; `:46` `executeDisabled = loading \|\| previewLines.length === 0`; `:132` `disabled={executeDisabled}`. Tests `MqlPreviewModal.test.tsx:33-47` errors render + `:69-76` disabled when no lines. |
| AC-09 | PASS | `DocumentDataGrid.tsx:172-175` `handleAddClick`; `:177-192` `handleAddSubmit` calls `insertDocument` + awaits `fetchData`. Test `DocumentDataGrid.test.tsx:377-404` "toolbar Add opens the AddDocumentModal and submits via insertDocument" (asserts both args + post-success modal close). |
| AC-10 | PASS | `AddDocumentModal.tsx:64-76` parse + `isPlainObject` check. Tests `AddDocumentModal.test.tsx:36-48` invalid JSON, `:65-78` array rejection. |
| AC-11 | PASS | `AddDocumentModal.tsx:82` `onOpenChange` forwards Esc; `:148-156` Cancel button. Test `AddDocumentModal.test.tsx:80-87` Cancel callback. |
| AC-12 | PASS | `DocumentDataGrid.tsx:259` `onDeleteRow={editState.handleDeleteRow}` routes to Sprint 86 hook. Sprint 86 covered the `deleteOne` preview branch in `useDataGridEdit.document.test.ts`. |
| AC-13 | PASS | `DocumentDataGrid.test.tsx` adds 6 new Sprint 87 cases (≥4 required): edit happy path, sentinel read-only, Commit→preview, Execute→updateDocument+refetch, Add→insertDocument, pending highlight. |
| AC-14 | PASS | `MqlPreviewModal.test.tsx` ships 7 cases (≥4 required): preview render, errors render, Execute callback, Cancel callback, disabled-empty, loading state, Enter shortcut. |
| AC-15 | PASS | `AddDocumentModal.test.tsx` ships 7 cases (≥4 required): valid submit, invalid JSON, empty input, array rejection, Cancel, parent error prop, Cmd+Enter submit. |
| AC-16 | PASS | `pnpm tsc --noEmit` → 0 errors (orchestrator pre-flight). |
| AC-17 | PASS | `pnpm lint` → 0 errors (orchestrator pre-flight). |
| AC-18 | PASS | `pnpm vitest run` → 1615/1615 PASS, +20 vs 1595 baseline (≥+12 required). |
| AC-19 | PASS | `git diff --stat HEAD -- src-tauri/ src/lib/mongo/ src/types/documentMutate.ts src/lib/tauri.ts src/components/datagrid/useDataGridEdit.ts src/components/DataGrid.tsx` → empty (re-verified by Evaluator). |
| AC-20 | PASS | `git diff --stat HEAD -- src/components/connection/ConnectionDialog.tsx` → 767 lines / 385 ins / 382 del, identical to pre-existing Sprint 79 quarantine. |

## Findings

### P0 (blocking)
None.

### P1 (must fix before next sprint)
None.

### P2 (nice-to-have)

1. **MqlPreviewModal Enter handler vs Radix focus policy** — `MqlPreviewModal.tsx:62-73` filters `INPUT`/`TEXTAREA` to skip Enter-to-Execute, but Radix focuses the Execute button on open (`autoFocus` at `:133`), so Enter on the dialog naturally fires Execute via the button itself. The dialog-level handler is a safety net. Generator already documented this in Residual Risk; consider a future regression test that pins focus policy to avoid silent breakage if the dialog focus default ever changes.

2. **`onToggleFilters` toolbar stub** — `DocumentDataGrid.tsx:249-253` renders the toolbar Filter button but the handler is a comment-only no-op. Out-of-scope per contract, but a `disabled` flag on the button would communicate the unavailability more accessibly than a silent click.

3. **Cancel guard during loading** — `DocumentDataGrid.tsx:464-468` blocks `onCancel` when `addLoading` is true (good), but the Esc key path through Radix (`AddDocumentModal.tsx:82` `onOpenChange`) does not gate by `loading`. A user pressing Esc mid-insert will trigger `onCancel` and close the modal optimistically while the in-flight insert finishes. Low risk because the parent already swallows the close, but the modal could explicitly compare `loading` before forwarding `onOpenChange(false)`.

## Notes

- Generator's "option (a)" choice (Add → JSON modal → direct `insertDocument`) is sound and explicitly justified in handoff Assumptions §1; the empty-positional-row Sprint 86 path is intentionally bypassed for MongoDB's schemaless idiom.
- The `mqlErrors` mapping in `DocumentDataGrid.tsx:204-225` translates the discriminated `MqlPreviewError` union into a `{row, message}` shape for the modal — clean separation of generator-internal types from UI props.
- Both new modals reuse the project's Radix Dialog wrapper (`@components/ui/dialog`) and Button — consistent with the RDB SqlPreviewDialog pattern referenced in the execution brief.
- `DocumentDataGrid.tsx` net diff is +328/-76 (substantial UI rewrite) but read-only behaviours from Sprint 66/71 are preserved in tests `DocumentDataGrid.test.tsx:133-283` (8 baseline cases still PASS).

## Next Sprint Readiness

Phase 6 plan F is **complete**. All three legs (Sprint 80 backend → Sprint 86 frontend middleware → Sprint 87 UI) shipped and verified. Nested-field editing, BulkDelete, and document filter bar remain explicit out-of-scope and can be queued for a Phase 7 sprint without blockers from F-3.

Recommended next-sprint focus options (orthogonal to F-3):

- Phase 7 RDB generalisation (MySQL/SQLite via the trait extraction Phase 9 plan).
- Document filter bar (close the toolbar Filter no-op stub flagged in P2).
- BSON nested-field editor + dot-path generator extension (closes Residual Risk §1).
