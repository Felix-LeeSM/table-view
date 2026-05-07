# Sprint 236 — Findings

Date: 2026-05-07
Owner: Generator agent (harness)

## Implementation Notes

### Backend — `add_column` / `drop_column`

- Both inherent methods on `PostgresAdapter` validate identifiers
  through the shared `validate_identifier` helper introduced in
  Sprint 235 (PG `NAMEDATALEN` 63 bytes, leading letter / underscore,
  alphanumeric + underscore body, no embedded NULL byte). The same
  helper also guards `schema` and `table` parameters so a malformed
  IPC payload from outside the modal cannot bypass the gate.
- Empty `data_type.trim()` is rejected on `add_column` with the
  user-visible message `"Column type cannot be empty"`. The frontend's
  `canPreview` check renders Show DDL inert before this fires; the
  backend rejection is defense-in-depth.
- SQL emission order is locked:
  ```
  ALTER TABLE "schema"."table" ADD COLUMN "name" <type>
    [NOT NULL] [DEFAULT <expr>] [CHECK (<expr>)]
  ```
  ```
  ALTER TABLE "schema"."table" DROP COLUMN "name" [CASCADE]
  ```
  No `RESTRICT` keyword on DROP — PG defaults to RESTRICT, and the
  Sprint 236 contract emits CASCADE only when explicitly toggled
  on. No semicolon terminator (mirrors Sprint 226 `create_table`
  / Sprint 235 `drop_table`).
- DEFAULT and CHECK free-text expressions are interpolated via
  raw string concatenation — NO `quote_literal` escaping. Per
  AC-236-10 contract decision, the user retains full control over
  expression text including embedded single quotes; PG surfaces
  any malformed-expression errors verbatim from the server.
- Execute branch wraps the rendered SQL in `BEGIN; … COMMIT;` so a
  partial failure rolls back. Preview branch returns the SQL
  unwrapped and never opens a transaction.

### Backend — Trait + command surface

- `RdbAdapter::add_column` / `RdbAdapter::drop_column` declarations
  take `&'a AddColumnRequest` / `&'a DropColumnRequest` and return
  `BoxFuture<'a, Result<SchemaChangeResult, AppError>>` mirroring
  Sprint 235 pattern. Other backends (`mysql`, `sqlite`, `mongodb`)
  are not in scope; trait stubs (`tests.rs::FakeCancellableRdb` /
  `FastFakeRdb`, `commands::meta::StubRdbAdapter`) implement the
  methods returning `Err(AppError::Backend("not implemented"))` to
  keep compile clean.
- Tauri command handlers `add_column` / `drop_column` mirror
  `drop_table` / `rename_table` shape — `request: T` parameter,
  `Result<SchemaChangeResult, AppError>` return.
- Registered in `lib.rs` between `rename_table` and `alter_table`
  (alphabetical-by-domain ordering preserved).

### Frontend — `AddColumnDialog`

- Reuses `<CreateTableTypeCombobox>` (Sprint 230) with
  `usePostgresTypes(connectionId)` providing `typesSource` +
  `typeKindMap`. The Postgres types cache is connection-scoped;
  invalidation on test reset goes through
  `invalidatePostgresTypesCache(connectionId)` (helper existed
  pre-Sprint-236; just imported in tests).
- Identifier validation runs on every keystroke (`useState` +
  derived `validationError`); Apply disabled state recomputes on
  every render. No debounce (mirrors Sprint 235 dialogs).
- Collision pre-check uses `useMemo` over the parent-supplied
  `columns` prop. The list is the SAME `columns` that
  `EditableColumnRow` renders, so the user-visible inline hint is
  always in sync with the visible row set.
- Form reset on (re)open via `useEffect([open, tableName,
  schemaName])` mirroring Sprint 235; deliberately narrow deps
  (avoid re-running when `connectionId` flips because the parent
  remounts the entire StructurePanel on connection change).
- Commit-success closure (passed as the second argument to
  `ddl.loadPreview`) re-issues the request with `previewOnly:
  false`. The hook's `onRefresh` (an `await onColumnAdded()` →
  `onClose()` sequence) fires after successful execute; a refresh
  failure surfaces as a commit-error history entry (Sprint 187 /
  196 parity).

### Frontend — `DropColumnDialog`

- Typing-confirm match is byte-for-byte case-sensitive: `Email` ≠
  `email`. NO `.trim()`, NO debounce. Mirror Sprint 235
  `DropTableDialog`.
- CASCADE checkbox toggles `cascade` state AND invalidates the
  cached preview (`setPreviewStale(true)` + `setShowDdl(false)` +
  `ddl.cancelPreview()`) so the next Show DDL click re-fetches with
  the new SQL. Without this, the preview would lie (stale SQL).
- Apply variant=destructive (red) per Phase 27 destructive surface
  convention.
- ConfirmDangerousDialog mounts as a sibling so it stacks above
  the Drop dialog (the same z-index pattern as Sprint 235).

### Frontend — `ColumnsEditor` rerouting

- The inline-batched MODIFY path (Edit pencil → change → save →
  Review SQL → Execute → alterTable) stays UNCHANGED. The
  `EditableColumnRow` component still pushes `modify` changes into
  `pendingChanges`, and the Review SQL button still shows when the
  count > 0. This is the bridge that keeps Sprint 187 Safe Mode
  gate regressions valid (alterTable analyzer classification still
  fires).
- The inline-add path (`NewColumnRow` component +
  `NewColumnDraft` interface) is REMOVED. The `+ Column` toolbar
  button now sets `showAddColumnDialog: true`. The
  `NewColumnDraft` type stays exported for backcompat (zero
  external callers; kept as historical surface).
- The trash icon (`onDelete` prop) now sets `dropColumnTarget:
  columnName`. The pendingChanges drop push (`{ type: "drop",
  name: columnName }`) is REMOVED. The `droppedColumns` Set state
  is preserved because the inline-MODIFY rendering branch still
  uses it (`columns.filter((col) => !droppedColumns.has(col.name))`)
  — the Set just stays empty in the modal-driven flow.
- `<AddColumnDialog>` mounts unconditionally (`open` prop controls
  visibility); `<DropColumnDialog>` mounts conditionally on
  `dropColumnTarget !== null` (so the dialog tears down its
  internal state cleanly when the user closes it).

### Test migration

- `ColumnsEditor.test.tsx`: 6 Sprint 187 Safe Mode gate cases
  rewired to drive the inline-MODIFY path (Edit pencil → change
  data_type → save) instead of the trash path. The hoisted
  `alterTable` mock still returns a `DROP COLUMN` preview SQL, so
  the analyzer classification (and therefore the gate behavior)
  is unchanged. 2 new Sprint 236 modal-mount cases added (`+
  Column` opens AddColumnDialog; trash opens DropColumnDialog).
- `StructurePanel.columns.test.tsx`: 26 cases → 25 cases. The
  `Confirm add column` / `Cancel add column` (inline NewColumnRow)
  test cases are removed (replaced by the AddColumnDialog test
  suite which exhaustively covers the modal). 12 cases that
  previously triggered through the trash icon are migrated to the
  inline-MODIFY trigger via a small `queuePendingModifyForName()`
  helper. 2 new cases assert the modal-mount contract; 1 new
  AC-236-08 case verifies the DropColumnDialog commit closure
  triggers a `getTableColumns` refresh.
- The 14 frozen paths (Sprint 235 invariants) all remain at `git
  diff --stat = 0` — verified post-implementation.

## Observations

- The 14-LOC delta in `lib.rs` (registering 2 new commands) is the
  only code change to a Tauri command surface OTHER than the new
  command file itself. No invoke-handler refactor needed.
- `addColumnRequest` / `dropColumnRequest` are intentionally
  request-shaped only (no positional alias). The Sprint 235
  dual-export pattern was needed because `schemaStore.ts` had
  pre-existing positional callers; Sprint 236 has zero such
  callers (`git grep`-confirmed).
- The Sprint 226 `CreateTableDialog` `<CreateTableTypeCombobox>`
  reused unchanged. The component already exposed the
  `typesSource` + `typeKindMap` + `ariaLabel` props needed by
  AddColumnDialog.
- `useDdlPreviewExecution` (Sprint 214) handled the entire
  preview/execute lifecycle without modification — including
  Safe Mode dispatch, `previewError` surface, and commit closure
  registration. This is the third sprint that has been able to
  drop in a new DDL surface without touching the hook (Sprint 226
  CreateTable, Sprint 235 Rename/Drop, Sprint 236 Add/Drop
  column). The hook's `onRefresh` prop pattern is doing the heavy
  lifting.

## Risks Flagged

- The `NewColumnDraft` interface stays exported for backcompat but
  has zero in-tree consumers post-Sprint-236. A subsequent
  cleanup sprint can drop the export and the surrounding
  `newColumnDrafts` state slot in `ColumnsEditor.tsx` (still
  referenced in the empty-state condition; would need a 1-line
  edit there).
- Sprint 237 will close the Modify (USING-cast) gap. The current
  inline-MODIFY path emits a single-statement
  `ALTER TABLE … ALTER COLUMN … TYPE …` which fails on
  type-conversion-incompatible columns (e.g. `text → uuid`
  without `USING`). The Modify path will likely move into a
  dedicated modal too, eliminating the last inline-batched
  workflow in `ColumnsEditor`.
- The DEFAULT / CHECK free-text passthrough is intentionally
  permissive — the user can submit syntactically invalid PG
  expressions and the modal will surface the verbatim PG error
  through `previewError`. This matches the Sprint 236 user spec
  but means injection-style inputs (e.g. `'); DROP TABLE x;--`)
  would fail safely at the PG layer rather than at our IPC
  boundary. Acceptable for an admin-UI tool; flagging for the
  audit trail.
