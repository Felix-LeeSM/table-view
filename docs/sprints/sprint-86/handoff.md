# Sprint 86 Handoff — Phase 6 plan F-2 (Frontend mqlGenerator + paradigm dispatch)

## Status

Generator complete. All 17 acceptance criteria addressed. Ready for Evaluator review and Sprint 87 (F-3 UI completion).

## Changed Files

### New

- `src/types/documentMutate.ts` — `DocumentId` tagged union mirroring the Rust `enum DocumentId` (externally-tagged serde shape: `{"ObjectId": "…"}`, `{"String": "…"}`, `{"Number": <n>}`, `{"Raw": <ejson>}`). Ships 3 helpers (`parseObjectIdLiteral`, `documentIdFromRow`, `formatDocumentIdForMql`) plus a `kindOfDocumentId` discriminator for exhaustive switching.
- `src/types/documentMutate.test.ts` — 14 cases covering EJSON `$oid` wrappers, plain-hex `_id`, string/number `_id`, composite rejects, 4-variant format output, and wire-shape roundtrip sanity.
- `src/lib/mongo/mqlGenerator.ts` — `generateMqlPreview(input) → MqlPreview` implementation. Groups pending edits per row into a single `$set` patch, enforces id-in-patch / sentinel / missing-id guards, emits preview text in insert → update → delete order paired 1:1 with the dispatch `MqlCommand[]`.
- `src/lib/mongo/mqlGenerator.test.ts` — 14 cases (happy/update/delete/insert/ordering/error guards/edge cases/escaping).
- `src/components/datagrid/useDataGridEdit.document.test.ts` — 7 cases (start-edit, save-edit, commit populates mqlPreview, execute dispatches in order + clears state, execute failure preserves state, generator-error surfaces, discard clears mqlPreview).

### Modified

- `src/components/datagrid/useDataGridEdit.ts` — Sprint 66 document no-op guard removed from `handleStartEdit`; `handleCommit` now branches on `paradigm` (`"document"` → `generateMqlPreview` + populates `mqlPreview` state; RDB branch byte-identical); `handleExecuteCommit` branches similarly, dispatching through a new `dispatchMqlCommand` switch that forwards to the Tauri wrappers; `handleDiscard` clears `mqlPreview`; `hasPendingChanges` reflects an open non-empty `mqlPreview`; return type extended with `mqlPreview: MqlPreview | null` + `setMqlPreview`.
- `src/components/datagrid/useDataGridEdit.paradigm.test.ts` — Sprint 66 "document no-op guard" case re-purposed to assert that Sprint 86 now opens the editor for the document paradigm (AC-13).
- `src/components/datagrid/useDataGridEdit.promote.test.ts` — Sibling negative case ("does NOT promote when paradigm is document") flipped to positive: promotion now fires for document paradigm, matching the removed guard. This test file was not in the written scope, but leaving it asserting the pre-Sprint-86 behavior would directly contradict AC-09, so the minimal flip was necessary.
- `src/lib/tauri.ts` — `DocumentId` import added; 3 new wrappers (`insertDocument`, `updateDocument`, `deleteDocument`) appended after `aggregateDocuments`. Existing wrappers untouched.

### Documentation

- `docs/sprints/sprint-86/handoff.md` (this file).

## Hard-Stop Boundaries (all held)

- `git diff --stat HEAD -- src-tauri/` → unchanged from Sprint 86 start (4 files / 725 insertions / 45 deletions = pre-existing Sprint 80 workspace state). Baseline saved at `/tmp/sprint86_src_tauri_baseline.txt`; post-sprint diff identical.
- `git diff --stat HEAD -- src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/` → empty.
- `git diff --stat HEAD -- src/components/connection/ConnectionDialog.tsx` → unchanged from baseline (767 lines / 385 insertions / 382 deletions = Sprint 79 pre-existing). Baseline saved at `/tmp/sprint86_conn_dialog_baseline.txt`; post-sprint diff identical.
- `src/components/datagrid/sqlGenerator.ts` → untouched.
- `src/types/document.ts` / `src/types/connection.ts` → untouched.
- `src/stores/**` → untouched.

## Checks Run

| Check | Command | Result |
|---|---|---|
| TypeScript | `pnpm tsc --noEmit` | PASS (0 errors) |
| ESLint | `pnpm lint` | PASS (0 errors) |
| Vitest (full) | `pnpm vitest run` | PASS (1595/1595; baseline 1558 + 37 net new) |
| Vitest (new files only) | `pnpm vitest run src/types/documentMutate.test.ts src/lib/mongo/mqlGenerator.test.ts src/components/datagrid/useDataGridEdit.document.test.ts` | PASS (37/37) |
| src-tauri diff | `git diff --stat HEAD -- src-tauri/` | Matches pre-sprint baseline (no Sprint 86 delta) |
| UI-component diff | `git diff --stat HEAD -- src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/` | empty |
| Cargo lib | `cd src-tauri && cargo test --lib` | PASS (226/226 Sprint 80 baseline preserved) |
| Cargo mongo integration | `cd src-tauri && cargo test --test mongo_integration` | PASS (11/11 Sprint 80 baseline preserved) |

## Done Criteria Coverage

| AC | Evidence |
|---|---|
| AC-01 | `src/types/documentMutate.ts:38-55, 69, 95, 136` — `DocumentId` union + `parseObjectIdLiteral` / `documentIdFromRow` / `formatDocumentIdForMql` exports. |
| AC-02 | `src/types/documentMutate.test.ts` — 14 cases across `parseObjectIdLiteral` (3), `documentIdFromRow` (7), `formatDocumentIdForMql` (4), `kindOfDocumentId` (1), wire-roundtrip (1). ≥ 6 required. |
| AC-03 | `src/lib/mongo/mqlGenerator.ts:75-97` — `MqlCommand` 3 variants; `:99-103` — `MqlGenerationError` 4 variants; `:105-109` — `MqlPreview` shape; `:183` — `generateMqlPreview`. |
| AC-04 | `src/lib/mongo/mqlGenerator.ts:200-272` — update path: groups by row, emits `{ $set: patch }`; L240-245 guard for `_id`-in-patch. Test coverage: `mqlGenerator.test.ts:42, 56, 125` (happy + multi-cell grouping + id-in-patch error). |
| AC-05 | `src/lib/mongo/mqlGenerator.ts:226-240` — sentinel-edit guard using `isDocumentSentinel`. Test: `mqlGenerator.test.ts:141` + `183` for insert-side sentinel. |
| AC-06 | `src/lib/mongo/mqlGenerator.ts:277-299` — delete path; `:302-339` — insert path. Tests: `mqlGenerator.test.ts:86, 108, 95` covering delete/insert preview + commands. |
| AC-07 | `src/lib/mongo/mqlGenerator.test.ts` — 14 cases across 3 describe blocks (happy 5, guards 5, edge 4). ≥ 7 required. |
| AC-08 | `src/lib/tauri.ts:33` — `DocumentId` import; `:420, 440, 461` — 3 wrappers. Existing wrappers at `:32-405` unchanged. |
| AC-09 | `src/components/datagrid/useDataGridEdit.ts:429-456` — `handleStartEdit` document no-op guard removed, editingCell/editValue set unconditionally. Test: `useDataGridEdit.document.test.ts:99` + `useDataGridEdit.paradigm.test.ts:61`. |
| AC-10 | `src/components/datagrid/useDataGridEdit.ts:461-498` — document branch populates `mqlPreview`; `:500-519` — RDB branch preserved verbatim. Test: `useDataGridEdit.document.test.ts:125`. |
| AC-11 | `src/components/datagrid/useDataGridEdit.ts:579-599` — document branch iterates `mqlPreview.commands`, dispatches via `dispatchMqlCommand` (L539-575); `:601-622` — RDB branch preserved. Tests: `useDataGridEdit.document.test.ts:147, 196`. |
| AC-12 | `src/components/datagrid/useDataGridEdit.ts:237-246` — `mqlPreview: MqlPreview \| null` in return type; `:642-651` — `hasPendingChanges` includes `mqlPreview` non-empty check; `:691-692` — returned. |
| AC-13 | `src/components/datagrid/useDataGridEdit.document.test.ts` — 7 cases (≥ 5). `useDataGridEdit.paradigm.test.ts:61` — Sprint 66 no-op test re-purposed as "Sprint 86 edit allowed". |
| AC-14 | `git diff --stat HEAD -- src-tauri/` post-sprint matches the pre-sprint baseline byte-for-byte; `diff /tmp/sprint86_src_tauri_baseline.txt /tmp/sprint86_src_tauri_after.txt` empty. |
| AC-15 | `git diff --stat HEAD -- src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/` empty. |
| AC-16 | `pnpm tsc --noEmit` PASS (0 errors); `pnpm lint` PASS (0 errors). |
| AC-17 | `pnpm vitest run` → 1595/1595 (Sprint 80 baseline 1558 + 37 net new ≥ required +18). 0 regressions in existing RDB tests. |

## Key Decisions

1. **DocumentId wire format**: Verified via a scratch cargo binary that Rust's default serde serialisation for `enum DocumentId { ObjectId(String), String(String), Number(i64), Raw(Bson) }` emits `{"ObjectId":"…"}`, NOT `{"type":"ObjectId","value":"…"}`. The execution brief anticipated this — the TS mirror uses externally-tagged shape `{ ObjectId: string } | { String: string } | { Number: number } | { Raw: unknown }`.
2. **Row grouping into `$set`**: Multiple cell edits on the same row produce a single `updateOne` with a merged `$set` patch, not N updateOnes. This matches MongoDB's idiom and keeps the preview readable.
3. **`hasPendingChanges` considers open mqlPreview**: An open preview with pending commands keeps the commit shortcut enabled so the user can re-confirm without re-pressing save — mirrors the implicit semantics of the RDB `sqlPreview` state.
4. **`useDataGridEdit.promote.test.ts` flip**: The Sprint 66 negative case there directly depended on the removed no-op guard. Leaving it would contradict AC-09, so the minimal-scope fix was to flip the assertion and retitle it as a Sprint 86 change. Same pattern as the `useDataGridEdit.paradigm.test.ts` re-purpose explicitly called out by AC-13.
5. **`schema` / `table` as database / collection**: Sprint 86 does not add new props to `useDataGridEdit` because Sprint 87 is responsible for wiring the hook into `DocumentDataGrid` with the final argument shape. The document branch repurposes the existing `schema` / `table` arguments as `database` / `collection`, which `DocumentDataGrid` already passes the same way for its find/aggregate path.

## Assumptions

- The Sprint 80 backend is workspace-present but not committed. `git diff --stat HEAD -- src-tauri/` shows the Sprint 80 delta as pre-existing; Sprint 86's AC-14 is interpreted as "Sprint 86 adds no further delta", which `diff` of pre/post baselines confirms.
- Pre-existing `ConnectionDialog.tsx` diff (Sprint 79, 767 lines) is untouched by Sprint 86; same baseline comparison evidence.
- `isDocumentSentinel` from `src/types/document.ts` is the canonical sentinel detector (Sprint 66). `mqlGenerator` reuses it rather than re-defining the regex.
- Sprint 87 will wire `DocumentDataGrid` to pass `paradigm: "document"` — Sprint 86 does not modify the grid component, so today's user-visible behaviour is unchanged. All AC-09–AC-13 paths are exercised through unit tests only.

## Residual Risks

- **UI not yet wired**: `DocumentDataGrid` / the preview modal will not use `mqlPreview` until Sprint 87. A user running today's UI sees no runtime change.
- **Composite `_id` rows still missing-id**: Rows whose `_id` is a composite BSON document / array surface `missing-id` rather than a more descriptive error. Sprint 87 or later may want to route those to a `Raw`-backed edit path.
- **Nested path edits (`profile.name`)**: Out of scope — Phase 6 plan defers dot-path `$set` to a future iteration.
- **`describe_document_id` on Raw**: Raw variant preview uses `JSON.stringify`, which can emit a terse representation for BSON-binary-backed payloads. Sprint 87 may need a prettier printer.
- **Future paradigms (`search`, `kv`)**: The hook's paradigm union admits these but the commit/execute branches don't yet — they currently fall through to the RDB path. Explicit branching + `never` exhaustiveness check are work for those phases.

## Next Steps (Sprint 87 — F-3 UI completion)

- `DocumentDataGrid.tsx` — wire `useDataGridEdit({ ..., paradigm: "document" })`; replace read-only column renderer with inline editor; surface pending-diff styling.
- `src/components/shared/QueryPreviewModal.tsx` — generalise from today's `SqlPreviewDialog` to render either `sqlPreview: string[]` or `mqlPreview: MqlPreview` based on paradigm.
- `AddDocumentModal.tsx` — JSON editor backed by `insertDocument`.
- `ConfirmDeleteModal.tsx` — delete confirmation for `deleteDocument`.
