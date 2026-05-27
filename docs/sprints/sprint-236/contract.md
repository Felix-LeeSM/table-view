# Sprint Contract: sprint-236

## Summary

- Goal: Phase 27 sprint 11 — second ALTER TABLE polish sprint. Add
  dedicated **Column add / drop** Tauri commands + matching frontend
  modal dialogs, mirroring the Sprint 235 `rename_table` / `drop_table`
  shape. Backend grows `add_column` and `drop_column` `RdbAdapter`
  methods + `#[tauri::command]` handlers (preview/execute branches,
  request-shaped payloads, byte-equivalent SQL fixtures). Frontend
  grows `AddColumnDialog` (name + type combobox + NOT NULL + DEFAULT +
  CHECK inline preview) and `DropColumnDialog` (typing-confirm +
  CASCADE + Safe Mode gate dispatch). Existing `ColumnsEditor`'s
  `+ Column` toolbar button is repurposed to open `AddColumnDialog`;
  per-row trash icon is repurposed to open `DropColumnDialog`. The
  existing inline-batched `alter_table` flow stays untouched (Sprint
  237 polish target). Schema cache `tableColumnsCache` invalidation
  flows through a new minimal cache-eviction path (NOT through Sprint
  223 `useSchemaTableMutations` — that hook is table-scoped). No
  column **modify** / multi-step / column **rename** work this sprint
  (Sprint 237).
- Audience: Generator + Evaluator (multi-agent harness, post-235
  cycle, Phase 27 sprint 11 of 12).
- Owner: harness skill orchestrator.
- Verification Profile: `mixed` (browser visual smoke +
  command-line cargo / vitest / tsc / lint / build).

## Pattern source

- Sprint 235 (`docs/sprints/sprint-235/contract.md`) — `rename_table`
  / `drop_table` Tauri commands + `RenameTableDialog` /
  `DropTableDialog` modals + dual-export IPC compat layer in
  `src/lib/tauri/ddl.ts`. **Sprint 236 is a near-mechanical clone
  for the Column ADD/DROP family.** Re-use the dialog shape, the
  preview pane styling, the typing-confirm pattern (case-sensitive
  byte-for-byte, no trim, no debounce), the CASCADE checkbox UX,
  the `useDdlPreviewExecution` lifecycle wiring, and the
  Safe-Mode-gate-fires-after-typing-confirm sequencing.
- Sprint 226 — `create_table` Tauri command + `CreateTableDialog`
  preview pane shape (Show DDL collapsible, default collapsed; inline
  `<pre>` rendering via `SqlSyntax`).
- Sprint 230 — `usePostgresTypes(connectionId)` hook +
  `CreateTableTypeCombobox` props (`typesSource: readonly string[]`,
  `typeKindMap: ReadonlyMap<string, string>`). `AddColumnDialog`
  reuses both verbatim — same merged type list + colored kind dots
  rendered in the type picker popover.
- Sprint 227 — parametric type free-text fallback (`varchar(255)`,
  `numeric(10,4)`) — `CreateTableTypeCombobox` already supports it;
  `AddColumnDialog` inherits the contract.
- Sprint 214 — `useDdlPreviewExecution` hook (preview/execute
  lifecycle + Safe Mode gate dispatch + canonical warn-cancel
  message). REUSED unchanged — Sprint 214 contract invariant.
- Sprint 231 — `useSafeModeGate(connectionId)` + `decideSafeModeAction`
  matrix. REUSED unchanged — Sprint 231 contract invariant.

## In Scope

### Backend (Rust)

- **MOD** `src-tauri/src/models/schema.rs` (~+70 LOC): add two new
  request types beside `RenameTableRequest` / `DropTableRequest`:
  ```rust
  #[derive(Debug, Clone, Serialize, Deserialize)]
  #[serde(rename_all = "camelCase")]
  pub struct AddColumnRequest {
      pub connection_id: String,
      pub schema: String,
      pub table: String,
      pub column: ColumnDefinition,
      /// Optional inline CHECK expression (Sprint 236). When `Some`
      /// and the trimmed expression is non-empty, emits
      /// `CHECK (<expr>)` in the column definition. Free-text — no
      /// syntax validation, no escaping (caller responsibility,
      /// mirrors Sprint 229 CHECK constraint contract).
      #[serde(default)]
      pub check_expression: Option<String>,
      #[serde(default)]
      pub preview_only: bool,
  }

  #[derive(Debug, Clone, Serialize, Deserialize)]
  #[serde(rename_all = "camelCase")]
  pub struct DropColumnRequest {
      pub connection_id: String,
      pub schema: String,
      pub table: String,
      pub column_name: String,
      #[serde(default)]
      pub cascade: bool,
      #[serde(default)]
      pub preview_only: bool,
  }
  ```
  `ColumnDefinition` (Sprint 226) already has `name`, `data_type`,
  `nullable`, `default_value`, `comment` — REUSED verbatim. The new
  `check_expression` is request-level (NOT inside `ColumnDefinition`)
  so the Sprint 226 `CreateTableRequest` shape stays diff = 0.
  Includes ≥ 2 serde roundtrip tests
  (`add_column_request_serde_camelcase_roundtrip`,
  `drop_column_request_serde_camelcase_roundtrip`).

- **MOD** `src-tauri/src/db/traits.rs` (~+12 LOC): add two new
  methods to `RdbAdapter`:
  ```rust
  fn add_column<'a>(
      &'a self,
      req: &'a AddColumnRequest,
  ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

  fn drop_column<'a>(
      &'a self,
      req: &'a DropColumnRequest,
  ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;
  ```
  PG is the only `RdbAdapter` impl in tree (verified Sprint 235 OQ-1).
  No other adapter cascading needed.

- **MOD** `src-tauri/src/db/postgres/mutations.rs` (~+260 LOC inside
  `impl PostgresAdapter` + the trait forwarder; ~+260 LOC in `#[cfg(test)]`):
  - `add_column(req: &AddColumnRequest) -> Result<SchemaChangeResult,
    AppError>`. Validate identifiers (`req.schema`, `req.table`,
    `req.column.name`) via shared `validate_identifier`; reject empty
    `req.column.data_type.trim()` with `AppError::Validation`. Build
    SQL:
    ```
    ALTER TABLE "<schema>"."<table>" ADD COLUMN "<name>" <type>
        [NOT NULL] [DEFAULT <expr>] [CHECK (<expr>)]
    ```
    Single statement, ANSI quoting. NOT NULL keyword emitted iff
    `!req.column.nullable`. DEFAULT clause emitted iff
    `req.column.default_value.is_some()` AND post-trim non-empty
    (mirror Sprint 226 `create_table` rule). CHECK clause emitted iff
    `req.check_expression.is_some()` AND post-trim non-empty (verbatim
    interpolation — NO escaping, NO syntax check; user-responsible per
    Sprint 229 contract). Comments are NOT emitted by `add_column`
    (defer to Sprint 237 polish — `COMMENT ON COLUMN` is a separate
    statement and would expand scope). Preview branch returns
    `SchemaChangeResult { sql }`; execute branch wraps the single
    statement in `BEGIN/COMMIT` (mirror `rename_table`/`drop_table`).
  - `drop_column(req: &DropColumnRequest) -> Result<SchemaChangeResult,
    AppError>`. Validate identifiers (`req.schema`, `req.table`,
    `req.column_name`) via shared `validate_identifier`. Build SQL:
    ```
    ALTER TABLE "<schema>"."<table>" DROP COLUMN "<name>" [CASCADE]
    ```
    Single statement. CASCADE keyword appended iff `req.cascade ==
    true`. **No `RESTRICT` keyword emitted on the non-cascade branch
    — PG default is RESTRICT and byte-equivalence with PG's implicit
    form is locked by fixture (mirror Sprint 235 `drop_table`
    convention).** Preview / execute branches identical to
    `add_column`.
  - Trait forwarder additions in
    `src-tauri/src/db/postgres.rs` (~+18 LOC) — `impl RdbAdapter for
    PostgresAdapter` gains `add_column` / `drop_column` arms that
    delegate to the inherent methods.

- **MOD** `src-tauri/src/db/postgres/mutations.rs#[cfg(test)] mod
  tests` (~+260 LOC): ≥ 12 new fixtures total (≥ 6 per command). Use
  the `req` builder pattern from Sprint 235:
  - `add_column_preview_byte_equivalent` — fixture:
    `ALTER TABLE "public"."users" ADD COLUMN "email" varchar(255)`
    (nullable=true, no default, no check).
  - `add_column_preview_with_not_null_byte_equivalent` — fixture:
    `ALTER TABLE "public"."users" ADD COLUMN "email" varchar(255) NOT NULL`.
  - `add_column_preview_with_default_byte_equivalent` — fixture:
    `ALTER TABLE "public"."users" ADD COLUMN "created_at" timestamptz DEFAULT now()`.
  - `add_column_preview_with_check_byte_equivalent` — fixture:
    `ALTER TABLE "public"."users" ADD COLUMN "age" int CHECK (age >= 0)`.
  - `add_column_preview_full_combo_byte_equivalent` — NOT NULL +
    DEFAULT + CHECK in the locked emission order. Fixture:
    `ALTER TABLE "public"."users" ADD COLUMN "age" int NOT NULL DEFAULT 0 CHECK (age >= 0)`.
  - `add_column_preview_only_does_not_execute` — preview branch
    returns SQL even without a live pool.
  - `add_column_invalid_column_name_rejected` — table-driven (4
    sub-cases): empty / embedded space / embedded quote / leading
    digit / >63 bytes / embedded NULL byte.
  - `add_column_empty_data_type_rejected` — `req.column.data_type =
    ""` → `AppError::Validation`.
  - `add_column_default_with_embedded_quote_passthrough` — fixture:
    `ALTER TABLE "public"."users" ADD COLUMN "name" varchar(255) DEFAULT 'O'Brien'`
    (verbatim — no auto-doubling). Locks the "user-responsible
    escaping" decision.
  - `drop_column_preview_no_cascade_byte_equivalent` — fixture:
    `ALTER TABLE "public"."users" DROP COLUMN "email"` (no
    `RESTRICT`, no `CASCADE`).
  - `drop_column_preview_cascade_byte_equivalent` — fixture:
    `ALTER TABLE "public"."users" DROP COLUMN "email" CASCADE`.
  - `drop_column_preview_only_does_not_execute` — preview without
    live pool.
  - `drop_column_invalid_column_name_rejected` — 3 sub-cases (empty
    / embedded quote / leading digit).

- **MOD** `src-tauri/src/commands/rdb/ddl.rs` (~+30 LOC): add two
  new `#[tauri::command]` handlers:
  ```rust
  #[tauri::command]
  pub async fn add_column(
      state: tauri::State<'_, AppState>,
      request: AddColumnRequest,
  ) -> Result<SchemaChangeResult, AppError> { ... }

  #[tauri::command]
  pub async fn drop_column(
      state: tauri::State<'_, AppState>,
      request: DropColumnRequest,
  ) -> Result<SchemaChangeResult, AppError> { ... }
  ```
  Mirror the Sprint 235 `drop_table` / `rename_table` handler bodies
  exactly: lock `state.active_connections`, resolve via
  `as_rdb()?`, delegate to the trait method.

- **MOD** `src-tauri/src/lib.rs` (~+2 LOC): register the two new
  handlers in the `tauri::generate_handler!` macro at lines 148-155
  (between `rename_table` and `alter_table`):
  ```rust
  commands::rdb::ddl::add_column,
  commands::rdb::ddl::drop_column,
  ```

- **MOD** stub adapter impls — mechanical signature additions to
  match the new trait methods:
  - `src-tauri/src/db/tests.rs` (`FakeCancellableRdb`,
    `FastFakeRdb`) — return `AppError::Unsupported` or a fixture
    `SchemaChangeResult { sql: "" }`.
  - `src-tauri/src/commands/meta.rs` (`StubRdbAdapter`) — same.

### Frontend (TS/TSX)

- **MOD** `src/types/schema.ts` (~+30 LOC): add `AddColumnRequest`
  + `DropColumnRequest` TypeScript types matching the Rust shapes
  (camelCase via serde rename). `AddColumnRequest.column` reuses the
  existing `ColumnDefinition` type.

- **MOD** `src/lib/tauri/ddl.ts` (~+40 LOC): mirror Sprint 235 dual
  exports — request-shaped + (optional) compat positional. Sprint
  236 has NO existing positional `addColumn` / `dropColumn` callers
  (the existing flow is `alter_table` batched), so the **compat
  positional wrappers are NOT needed** — only the request-shaped
  variants. Concretely add:
  ```ts
  export async function addColumnRequest(
    request: AddColumnRequest,
  ): Promise<SchemaChangeResult> {
    return invoke<SchemaChangeResult>("add_column", { request });
  }

  export async function dropColumnRequest(
    request: DropColumnRequest,
  ): Promise<SchemaChangeResult> {
    return invoke<SchemaChangeResult>("drop_column", { request });
  }
  ```
  Per the user's locked decision (#9) the dual-export pattern is
  required. Generator emits both `addColumn` (3-arg positional alias
  for symmetry with `dropTable`/`renameTable` — invokes
  `addColumnRequest` with `previewOnly: false` and discards SQL) and
  `addColumnRequest`. **OPEN QUESTION §1**: is the positional shape
  actually consumed anywhere? Default assumption: emit both for
  pattern consistency, even if only the request shape is consumed
  by Sprint 236 dialogs.

- **NEW** `src/components/schema/AddColumnDialog.tsx` (~280-360 LOC):
  modal that owns form state + delegates preview/execute to
  `useDdlPreviewExecution` (Sprint 214 reuse). Form fields:
  - **Column name** (single text input) — `validateIdentifier` from
    the same regex constant Sprint 235 RenameTableDialog uses
    (`^[a-zA-Z_][a-zA-Z0-9_]*$`, ≤ 63 bytes). Inline error surface.
  - **Type** combobox — `<CreateTableTypeCombobox>` reused with
    `typesSource={types}` and `typeKindMap={typesByName}` from
    `usePostgresTypes(connectionId)` (Sprint 230). Free-text
    parametric (`varchar(255)`, `numeric(10,4)`) supported.
  - **NOT NULL** checkbox (default OFF — i.e. nullable is the
    default, per locked decision).
  - **DEFAULT expression** single-line text input. Free text, no
    validation, no escaping. Empty/whitespace-only → emits no
    DEFAULT clause. Placeholder `e.g. 0, now(), 'pending'`.
  - **CHECK expression** single-line text input. Free text, no
    validation, no escaping. Empty → no CHECK clause.
  Show DDL is **collapsed by default** (mirror Sprint 226
  CreateTableDialog default). Cancel + Show DDL + Apply buttons.
  Apply disabled when (a) name fails identifier validation, (b)
  type combobox value is empty/whitespace, (c) preview not yet
  fetched / preview is stale, OR (d) name collides with an existing
  column from the loaded `columns` prop (graceful preflight per
  edge case #8). NO Safe Mode UX path — `useDdlPreviewExecution`
  routes through the gate internally; `ALTER TABLE … ADD COLUMN`
  is `ddl-other` (safe) so the gate path stays a no-op-equivalent.
  On commit success, the dialog calls `onColumnAdded()`
  (synchronous; the parent `ColumnsEditor` invalidates
  `tableColumnsCache` + re-fetches columns). NO direct
  `useSchemaTableMutations` call (that hook is table-scoped).

- **NEW** `src/components/schema/AddColumnDialog.test.tsx`
  (~280-340 LOC, ≥ 12 cases): vitest covering — opens with empty
  name + empty type; identifier validation surfaces inline (empty
  / embedded space / embedded quote / leading digit / >63 bytes /
  embedded NULL byte); NOT NULL toggle reflects in preview SQL;
  DEFAULT input free-text passthrough; CHECK input free-text
  passthrough; type combobox suggests from
  `usePostgresTypes`-mocked source; collision pre-check disables
  Apply when name matches existing column; commit-success calls
  `onColumnAdded` once + closes; preview SQL byte-equivalent for
  the full-combo case (NOT NULL + DEFAULT + CHECK).

- **NEW** `src/components/schema/DropColumnDialog.tsx` (~200-280
  LOC): modal that owns: typing-confirm input ("Type the column name
  to confirm"), CASCADE checkbox (default off), inline DDL preview
  pane, Cancel + Show DDL + Apply (variant=destructive) buttons.
  Apply is `disabled` UNTIL the typing-confirm input matches the
  current column name byte-for-byte (case-sensitive — `Email` ≠
  `email`). CASCADE checkbox label = `"Drop dependent objects
  (CASCADE)"` per the user's locked decision (note: this DIVERGES
  from Sprint 235 `DropTableDialog`'s label `"CASCADE — drop
  dependent objects (default: off)"` — see **Open Questions §3**).
  Internally dispatches through the Safe Mode gate (DROP COLUMN is
  classified as `ddl-drop` / danger by `analyzeStatement` — gate
  fires automatically). On commit success, calls `onColumnDropped()`.
  Reuses `useDdlPreviewExecution` for the preview/execute lifecycle.
  Re-uses Sprint 235 `ConfirmDangerousDialog` mount pattern for the
  warn-tier confirm. **Sprint 235 `DropTableDialog`'s typing-confirm
  + CASCADE + Safe Mode flow is the structural source — copy the
  shape, swap labels (table → column).**

- **NEW** `src/components/schema/DropColumnDialog.test.tsx` (~260-320
  LOC, ≥ 12 cases): vitest covering — typing-confirm enable/disable;
  CASCADE toggle invalidates preview; CASCADE emits keyword in
  preview SQL; case-sensitivity (`Email` typed as `email` → Apply
  stays disabled); IPC sequence `[{ previewOnly: true }, {
  previewOnly: false }]`; Safe Mode block / warn-cancel / safe
  matrix; commit-success calls `onColumnDropped` once + closes;
  PG-error-from-DROP-PK-column surfaces verbatim in `previewError`
  + modal stays open (mock the IPC reject).

- **MOD** `src/components/structure/ColumnsEditor.tsx` (~+50 LOC,
  ~-15 LOC): rewire the existing `+ Column` toolbar button to open
  `<AddColumnDialog>` instead of pushing a `NewColumnDraft` row
  inline. The existing inline-batched `pendingChanges` flow stays
  intact for **Modify** (still routed through `alter_table` —
  Sprint 237 territory) and for the inline name/default/nullable
  edits. The `handleAddColumn` button handler swaps from
  `setNewColumnDrafts((prev) => [...prev, ...])` to
  `setShowAddColumnDialog(true)`. Per-row trash icon
  (`onDelete={() => handleDeleteColumn(col.name)}`) is rewired to
  open `<DropColumnDialog>` instead of pushing a pending drop.
  **Modal commit success** triggers `onRefresh()` (the existing
  `ColumnsEditor` prop that re-fetches columns via
  `StructurePanel.fetchData`). The schema cache invalidation +
  re-fetch path is byte-equivalent — `onRefresh` already calls
  `getTableColumns` which writes through the
  `tableColumnsCache`. **Decision: NO new `addColumn` / `dropColumn`
  methods on `useSchemaTableMutations`** — see Decisions §Cache
  invalidation path + Open Questions §2.

- **MOD** `src/components/structure/ColumnsEditor.test.tsx` (~+80
  LOC, ~-30 LOC): mechanical updates — the existing
  `handleAddColumn` test cases that asserted `NewColumnRow` mounts
  inline need rewriting to assert `<AddColumnDialog>` mounts.
  Existing Drop tests (asserting `pendingChanges` add a `drop`
  entry) need rewriting to assert `<DropColumnDialog>` mounts.
  **Both are NOT freeze violations** — explicitly listed under
  Test invariants (allowed sibling-test diff). The
  `pendingChanges` modify path tests stay intact (Sprint 237 polish
  target).

- **MOD** `src/index.css` (~+0 LOC) — no diff expected.

- **MOD** `src/lib/tauri/index.ts` (~+4 LOC): re-export
  `addColumnRequest` / `dropColumnRequest` from `./ddl` so the
  dialogs can `import * as tauri from "@lib/tauri"` (existing
  re-export pattern).

## Out of Scope

The following are explicitly frozen for sprint-236:

- **Column modify** (type change, USING cast, nullability change,
  DEFAULT change) — Sprint 237. The existing inline `pendingChanges`
  modify flow in `ColumnsEditor` stays untouched.
- **Column rename** (`ALTER TABLE … RENAME COLUMN`) — defer to
  Sprint 237 if scope allows; otherwise out of Phase 27 entirely
  per the user's locked spec.
- **Multi-step ALTER TABLE in one tx** (e.g. add column + add
  constraint + add index in one tx) — Sprint 237 polish.
- **Column reorder** — PG natively unsupported (recreate required);
  explicitly out of scope per `phase-27.md`.
- **Index / constraint rename** — different ALTER family.
- **View / sequence / function / trigger drop** — Phase 26+.
- **MongoDB collection field add / drop UI** — separate paradigm.
- **DEFERRABLE / INITIALLY DEFERRED FK options** — Phase 27 polish.
- **Sprint 180 cancel-token integration for DDL** — not integrated
  in `add_column` / `drop_column` per Sprint 235 OQ-3 precedent.
  Defer to a cross-cutting sprint.
- **CASCADE preflight: `pg_depend` dependency analysis** — let PG
  surface the error verbatim (Sprint 235 OQ precedent). Future
  sprint candidate.
- **Column COMMENT in `add_column`** — Sprint 237 polish (the
  `ColumnDefinition.comment` field is REUSED but `add_column` does
  NOT emit `COMMENT ON COLUMN` this sprint).
- **Named CHECK constraint** (`ADD CONSTRAINT chk_x_y CHECK (...)`)
  — Sprint 236 emits the inline form only (`ADD COLUMN "x" int
  CHECK (...)`). Multi-statement / named CHECK is Sprint 237 or
  Phase 25 polish.
- **Pre-check column existence on add** — let PG surface
  `ERROR: column "X" of relation "Y" already exists` verbatim
  (mirror Sprint 235 drop pre-existence check removal). The
  frontend MAY do an optimistic Apply-disabled hint based on the
  loaded `columns` prop, but the backend stays permissive.

## Invariants (Frozen Files — diff = 0)

The 14 frozen paths from Sprint 235 contract stay frozen — re-listed
here for the Generator's grep-target convenience:

1. `src/components/structure/useDdlPreviewExecution.ts` — Sprint 214
   hook signature + body byte-equivalent (REUSE only).
2. `src/components/structure/SqlPreviewDialog.tsx` — Sprint 214
   invariant.
3. `src/__tests__/cross-window-connection-sync.test.tsx` — diff = 0.
4. `src/__tests__/cross-window-store-sync.test.tsx` — diff = 0.
5. `src/__tests__/window-lifecycle.ac141.test.tsx` — diff = 0.
6. `src/stores/connectionStore.ts` — diff = 0.
7. `src/stores/schemaStore.ts` — **diff = 0** (Sprint 236 cache
   invalidation goes through `getTableColumns` re-fetch, NOT
   through a new store action).
8. `src/stores/safeModeStore.ts` — diff = 0.
9. `src/lib/safeMode.ts` — diff = 0 (decideSafeModeAction matrix
   unchanged — Sprint 231 contract).
10. `src/lib/sql/sqlSafety.ts` — diff = 0.
11. `src/hooks/useFkReferencePicker.ts` — Sprint 229 invariant.
12. `src/lib/sql/postgresTypes.ts` — Sprint 230 invariant.
13. `src/components/shared/SqlSyntax.tsx` — Sprint 233 invariant.
14. `src/lib/sql/sqlTokenize.ts` — Sprint 233 invariant.

Plus Sprint 226-235 byte-equivalent invariants:
- `src-tauri/src/db/postgres/mutations.rs::create_table` SQL emission
  byte-equivalent (all 22 `cargo test --lib create_table` fixtures
  pass UNMODIFIED).
- `src-tauri/src/db/postgres/mutations.rs::create_index` SQL emission
  byte-equivalent (11 fixtures).
- `src-tauri/src/db/postgres/mutations.rs::add_constraint` SQL
  emission byte-equivalent (12 fixtures).
- `src-tauri/src/db/postgres/mutations.rs::rename_table` SQL emission
  byte-equivalent (11 fixtures — Sprint 235).
- `src-tauri/src/db/postgres/mutations.rs::drop_table` SQL emission
  byte-equivalent (6 fixtures — Sprint 235).
- `src-tauri/src/db/postgres/mutations.rs::alter_table` SQL emission
  byte-equivalent — **CRITICAL**: `alter_table` already covers
  Add/Drop column via `ColumnChange::Add` / `ColumnChange::Drop`.
  Sprint 236 introduces a PARALLEL command (`add_column` /
  `drop_column`) but does NOT modify `alter_table`. The existing
  `ColumnsEditor` modify-flow tests must continue to pass
  byte-equivalent.
- `src/components/schema/CreateTableDialog.tsx` /
  `CreateTableDialog/Header.tsx` — diff = 0.
- `src/components/schema/RenameTableDialog.tsx` — Sprint 235 diff = 0.
- `src/components/schema/DropTableDialog.tsx` — Sprint 235 diff = 0.
- `src/components/schema/RenameTableDialog.test.tsx` — diff = 0.
- `src/components/schema/DropTableDialog.test.tsx` — diff = 0.
- `src/components/schema/SchemaTree.actions.test.tsx` — Sprint 235
  diff = 0 (no new SchemaTree wiring this sprint — Sprint 236 modal
  entry-points are inside `ColumnsEditor`, NOT `SchemaTree`).
- `src/lib/tauri/ddl.ts` — Sprint 235 dual-export `dropTable` /
  `renameTable` / `dropTableRequest` / `renameTableRequest` exports
  stay diff = 0; Sprint 236 ADDs `addColumn` / `addColumnRequest` /
  `dropColumn` / `dropColumnRequest` (does NOT modify the existing
  exports).

Plus Sprint 223 invariant:
- `src/hooks/useSchemaTableMutations.ts` hook signature unchanged —
  `dropTable: (connectionId, table, schema) => Promise<void>` and
  `renameTable: (connectionId, table, schema, newName) => Promise<
  void>`. Sprint 236 does NOT extend this hook (it is table-scoped;
  column-scoped cache invalidation flows through `onRefresh()` →
  `getTableColumns()` → `tableColumnsCache` write-through, which is
  the existing Sprint 226+227 path).

Plus Sprint 231 invariant:
- `useSafeModeGate(connectionId)` signature + `decideSafeModeAction`
  matrix unchanged.

### Test invariants

- All Sprint 226-235 vitest cases pass UNMODIFIED. Specifically:
  `CreateTableDialog.test.tsx`, `RenameTableDialog.test.tsx`,
  `DropTableDialog.test.tsx`, `SchemaTree.actions.test.tsx`,
  `useSchemaTableMutations.test.ts`,
  `useDdlPreviewExecution.test.tsx` all pass byte-equivalent.
- `ColumnsEditor.test.tsx` — sibling-test diff is ALLOWED (the
  existing inline-NewColumnRow tests need mechanical update to the
  new `<AddColumnDialog>` mount; existing inline-drop tests need
  mechanical update to `<DropColumnDialog>` mount). The
  `pendingChanges` modify-flow tests must stay intact.
- All Sprint 226-235 cargo `--lib` tests pass UNCHANGED:
  `create_table` 22/22, `create_index` 11/11, `add_constraint`
  12/12, `rename_table` 11/11, `drop_table` 6/6, `alter_table`
  unchanged.
- No `it.skip`, `eslint-disable`, `any`, silent `catch{}`,
  `unwrap()` in production paths.

## Acceptance Criteria

- `AC-236-01` Backend `add_column` Tauri command accepts
  `AddColumnRequest { connection_id, schema, table, column,
  check_expression?, preview_only }`. When `preview_only=true`
  returns `SchemaChangeResult { sql }` without DB write; when
  `preview_only=false` executes inside a `BEGIN/COMMIT` transaction.
  Identifier inputs validated by the shared `validate_identifier`
  helper. Empty `column.data_type.trim()` returns
  `AppError::Validation`. SQL emission order is locked: `<name>
  <type> [NOT NULL] [DEFAULT <expr>] [CHECK (<expr>)]`. NOT NULL
  keyword emitted iff `!column.nullable`; DEFAULT clause emitted iff
  `column.default_value.is_some() && trim().is_non_empty()`; CHECK
  clause emitted iff `check_expression.is_some() &&
  trim().is_non_empty()`.
  **Testable:** Rust unit fixtures
  `add_column_preview_byte_equivalent` (basic),
  `add_column_preview_with_not_null_byte_equivalent`,
  `add_column_preview_with_default_byte_equivalent`,
  `add_column_preview_with_check_byte_equivalent`,
  `add_column_preview_full_combo_byte_equivalent` (NOT NULL +
  DEFAULT + CHECK), and
  `add_column_preview_only_does_not_execute`. ≥ 6 fixtures.

- `AC-236-02` Backend `drop_column` Tauri command accepts
  `DropColumnRequest { connection_id, schema, table, column_name,
  cascade, preview_only }`. Generated SQL is
  `ALTER TABLE "<schema>"."<table>" DROP COLUMN "<column_name>"`
  when `cascade=false` (no `RESTRICT` keyword — PG default is
  RESTRICT and byte-equivalence with the implicit form is required),
  and `... DROP COLUMN "<column_name>" CASCADE` when `cascade=true`.
  No pre-existence check — PG surfaces `column "X" does not exist`
  verbatim.
  **Testable:** Rust unit fixtures
  `drop_column_preview_no_cascade_byte_equivalent` (SQL =
  `ALTER TABLE "public"."users" DROP COLUMN "email"`),
  `drop_column_preview_cascade_byte_equivalent` (SQL =
  `ALTER TABLE "public"."users" DROP COLUMN "email" CASCADE`),
  `drop_column_preview_only_does_not_execute`,
  `drop_column_invalid_column_name_rejected` (3 sub-cases). ≥ 4
  fixtures.

- `AC-236-03` Frontend exposes `tauri.addColumnRequest(request)` and
  `tauri.dropColumnRequest(request)` in `src/lib/tauri/ddl.ts`,
  both returning `Promise<SchemaChangeResult>`. The IPC payload
  uses the `{ request: { ... } }` envelope (matches `alterTable`
  / `createTable` / Sprint 235 `dropTableRequest`). Modals send
  preview-then-commit exactly `[{ previewOnly: true }, {
  previewOnly: false }]`. Optional positional aliases (`addColumn`
  / `dropColumn`) are emitted for symmetry per locked decision #9
  but are not consumed by any production caller (open question —
  may be removed if Generator confirms zero callers).
  **Testable:** vitest mocks `tauri.addColumnRequest` and asserts
  call shape `{ request: { connectionId, schema, table, column:
  { name, dataType, nullable, defaultValue, comment? },
  checkExpression?, previewOnly: <bool> } }`; same for
  `dropColumnRequest`. Roundtrip serde tests on the Rust side
  (`add_column_request_serde_camelcase_roundtrip`,
  `drop_column_request_serde_camelcase_roundtrip`) lock the wire
  shape.

- `AC-236-04` `AddColumnDialog` (new component) renders: column
  name input, type combobox (`<CreateTableTypeCombobox>` reused
  with `typesSource` + `typeKindMap` from
  `usePostgresTypes(connectionId)`), NOT NULL checkbox (default
  unchecked = nullable), DEFAULT single-line input, CHECK
  single-line input, collapsible Show DDL pane (default
  collapsed), Cancel + Show DDL + Apply buttons. Apply is
  `disabled` when (a) name fails identifier validation
  (`^[a-zA-Z_][a-zA-Z0-9_]*$`, ≤ 63 bytes), (b) type combobox
  value is empty/whitespace, (c) preview not yet fetched OR
  preview is stale, OR (d) name collides with an existing column
  from the loaded `columns` prop (collision pre-check renders an
  inline hint but the backend stays permissive). On Apply, the
  dialog runs preview-then-commit through
  `useDdlPreviewExecution`. On commit success, calls
  `onColumnAdded()` + closes; on commit failure, error surfaces
  in `previewError` and modal stays open.
  **Testable:** vitest covers — opens with empty name + empty
  type; identifier validation surfaces inline; type combobox
  consumes `usePostgresTypes` mock; NOT NULL toggle reflected in
  preview SQL; DEFAULT free-text passthrough; CHECK free-text
  passthrough; collision pre-check disables Apply with hint;
  commit-success closes + `onColumnAdded` called once.

- `AC-236-05` `DropColumnDialog` (new component) renders: typing-
  confirm input ("Type the column name to confirm"), CASCADE
  checkbox (default unchecked, label "Drop dependent objects
  (CASCADE)"), inline DDL preview pane (collapsed by default),
  Cancel + Show DDL + Apply (variant=destructive) buttons. Apply
  is `disabled` UNTIL typing-confirm input matches the column
  name byte-for-byte (case-sensitive — `Email` ≠ `email`).
  Toggling CASCADE invalidates the preview so the next Show DDL
  click re-fetches.
  **Testable:** vitest covers — Apply disabled before typing
  match; case mismatch keeps Apply disabled; CASCADE toggle
  invalidates preview; CASCADE checked emits ` CASCADE` in
  preview SQL; commit-success closes + `onColumnDropped` called
  once.

- `AC-236-06` `DropColumnDialog` dispatches through the Safe Mode
  gate (`useSafeModeGate(connectionId).decide(analyzeStatement(
  previewSql))`). Strict-block path surfaces the canonical Safe
  Mode block message and prevents commit. Warn-confirm path
  requires BOTH the typing match AND
  `useDdlPreviewExecution`'s `pendingConfirm` flow (the
  `ConfirmDangerousDialog` mounts; user types the analyzer reason;
  warn-cancel surfaces canonical `"Safe Mode (warn): confirmation
  cancelled — no changes committed"` message in `previewError`).
  Safe path requires only the typing confirm.
  **Testable:** vitest fixture sets connection environment =
  `production` + Safe Mode = `strict` → asserts canonical block
  message + commit closure NEVER invoked; environment =
  `production` + Safe Mode = `warn` + warn-cancel → asserts
  canonical warn-cancel message verbatim in `previewError`;
  environment = `local` + Safe Mode = `safe` → asserts commit
  closure invoked exactly once.

- `AC-236-07` `ColumnsEditor` wiring: the `+ Column` toolbar button
  opens `<AddColumnDialog>` instead of pushing an inline
  `NewColumnDraft` row. The per-row trash icon
  (`<EditableColumnRow.onDelete>`) opens `<DropColumnDialog>`
  pre-filled with the column name. Both modals close on commit-
  success and trigger `onRefresh()` (which re-runs
  `getTableColumns` and writes through the `tableColumnsCache`).
  The existing inline `pendingChanges` MODIFY flow (column rename
  / type change / nullability / default) stays UNCHANGED — Sprint
  237 polish target.
  **Testable:** `ColumnsEditor.test.tsx` asserts (1) clicking
  `+ Column` mounts `<AddColumnDialog>`, (2) clicking trash on
  a row mounts `<DropColumnDialog>`, (3) commit-success on each
  → `onRefresh` invoked exactly once, (4) the existing
  inline-edit-modify path still produces an `alter_table`
  request with `ColumnChange::Modify`.

- `AC-236-08` Schema cache refresh after success: dropped column
  no longer appears in the next `StructurePanel.fetchData` cycle
  (writes through `tableColumnsCache[${connectionId}:${schema}:
  ${table}]`); added column appears. Selected row in StructurePanel
  stays where the user left it (no selection state managed on
  columns at this surface — implicit invariant). `useSchemaTable
  Mutations` is NOT extended (Sprint 223 invariant).
  **Testable:** vitest mocks `tauri.getTableColumns` to return
  `[colA, colB]` initially, then `[colA, colB, colC]` after add /
  `[colA]` after drop; asserts the new list flows through
  `onRefresh` → next render shows the updated columns.

- `AC-236-09` Identifier validation rejects (verified in BOTH
  backend and frontend layers): empty / whitespace-only, embedded
  `"`, embedded NULL byte (`\0`), length > 63 bytes (PG identifier
  limit), leading digit. Same rules as Sprint 235.
  **Testable:** Rust unit `add_column_invalid_column_name_rejected`
  (4-6 sub-cases) and `drop_column_invalid_column_name_rejected`
  (3 sub-cases). Frontend vitest asserts the same on the
  `AddColumnDialog` name input.

- `AC-236-10` DEFAULT and CHECK expressions are passed through
  verbatim — NO escaping, NO syntax validation, NO normalization
  on the backend or frontend. Embedded `'`, `now()`,
  `CURRENT_TIMESTAMP`, `gen_random_uuid()` all pass through
  unchanged. Parametric type free-text (`varchar(255)`,
  `numeric(10,4)`) emits the type verbatim.
  **Testable:** Rust unit
  `add_column_default_with_embedded_quote_passthrough` asserts SQL
  contains the embedded `'` verbatim (no auto-doubling); frontend
  vitest asserts the IPC payload's `column.defaultValue` field
  preserves the raw user input.

- `AC-236-11` 4-set verification PASS (per `docs/PLAN.md:182-186`):
  `pnpm vitest run` exit 0, `pnpm tsc --noEmit` exit 0, `pnpm lint`
  exit 0, `cargo build --manifest-path src-tauri/Cargo.toml` exit
  0, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-
  targets --all-features -- -D warnings` exit 0. Vitest count ≥
  2886 (Sprint 235 baseline) + ≥ 24 new = ≥ 2910 tests; cargo
  `--lib` count ≥ 395 (Sprint 235 baseline) + ≥ 12 new = ≥ 407.

- `AC-236-12` Sprint 226-235 byte-equivalent fixtures pass
  UNMODIFIED. Frozen file diff = 0 (per the Invariants list). The
  22-fixture `cargo test --lib create_table` suite, the 11-fixture
  `create_index`, the 12-fixture `add_constraint`, the 11-fixture
  `rename_table`, and the 6-fixture `drop_table` all pass byte-
  equivalent. `alter_table` (which still covers add/drop column
  via `ColumnChange`) passes byte-equivalent.

## Design Bar / Quality Bar

- **Narrow extraction** — reuse `useDdlPreviewExecution` (Sprint
  214) + `useSafeModeGate` (Sprint 231) + `usePostgresTypes`
  (Sprint 230) + `CreateTableTypeCombobox` (Sprint 227) +
  `ConfirmDangerousDialog` (Sprint 198/214) as-is. No anticipatory
  abstraction. Do **not** extract a shared "Add * dialog" or
  "typing-confirm modal" base — wait until Sprint 237 (column
  modify) lands to see the third-shape pressure (per the Sprint
  226 "wait until 3+ Create-* modals" rule).
- **Pattern source** — Sprint 235 `RenameTableDialog` /
  `DropTableDialog` for the modal shape + typing-confirm + Safe
  Mode dispatch. Sprint 226 `CreateTableDialog` for the type
  combobox + preview pane styling.
- **Visual consistency** — both new modals use the existing
  shadcn `<Dialog>` primitive, the existing `<input>` styling
  from Sprint 235 dialogs, and the inline preview pane styling
  (`<pre>` + `SqlSyntax`) from Sprint 235 dialogs. No new visual
  primitives, no new shadcn components.
- **Identifier validation** — share the `validate_identifier`
  helper (Rust) and the same TS regex constant Sprint 235 uses
  (`/^[a-zA-Z_][a-zA-Z0-9_]*$/`). The Sprint 235 dialogs declare
  `IDENTIFIER_RE` + `IDENTIFIER_MAX_BYTES` locally — duplicate
  the same constants in the new dialogs (do NOT introduce a new
  shared module — wait until Sprint 237 confirms the third-shape
  pattern, per Sprint 226 rule).
- **SQL emission determinism** — every byte-string fixture must
  be byte-equivalent to a string literal in the test. No
  `.contains()` partial matches. Locked emission order: `<name>
  <type> [NOT NULL] [DEFAULT <expr>] [CHECK (<expr>)]`.
- **Modal-local state only** — no Zustand store added; `useState`
  for form fields, `useDdlPreviewExecution` owns preview SQL /
  loading / error / pendingConfirm.
- **TDD evidence** — capture `red-state.log` (or commit ordering
  with red-state commit message) in `docs/sprints/sprint-236/
  tdd-evidence/red-state.log` per `docs/PLAN.md:182-186`.

## Decisions

### CHECK constraint emission shape — INLINE only (Sprint 236)

Locked decision (per user spec). `add_column` emits the inline
form `ADD COLUMN "x" int CHECK (x >= 0)` — single statement, no
named CHECK constraint, no separate `ADD CONSTRAINT chk_x_y CHECK
(...)` statement. Rationale:
- Single statement is simpler, atomic-by-default, and matches PG's
  native `ALTER TABLE ... ADD COLUMN ... CHECK (...)` syntax.
- A named CHECK constraint can be added later via the existing
  Sprint 229 `add_constraint` flow (different surface, different
  command, different request shape).
- Multi-step transaction (add column + add named constraint)
  defers to Sprint 237 polish.

### NOT NULL default — OFF (nullable is the default)

Locked decision (per user spec). The `AddColumnDialog` NOT NULL
checkbox defaults to **unchecked** (nullable column). User opts INTO
NOT NULL explicitly. Toggling ON appends ` NOT NULL` to the emitted
SQL after the `<type>` token. Rationale:
- PG's own `ALTER TABLE ... ADD COLUMN` defaults to nullable when
  the keyword is omitted.
- Adding NOT NULL to a populated table without a DEFAULT is an
  error (`column "X" of relation contains null values`). Defaulting
  the checkbox to OFF saves the user from a fat-finger error
  surface.
- Edge case #1 covers the "user toggled NOT NULL on a populated
  table without DEFAULT" path: PG errors verbatim, surfaces in
  `previewError` (no client-side pre-check).

### DEFAULT expression scope — free-text, NO escaping

Locked decision (per user spec, mirror Sprint 229 CHECK contract).
The DEFAULT input is single-line free text. NO syntax validation,
NO autocomplete, NO escaping. Pass through verbatim to the SQL
emitter. The user is responsible for escaping `'` in string
literals — a DEFAULT of `'O'Brien'` will emit
`DEFAULT 'O'Brien'` (which PG rejects, surfacing the syntax error
verbatim). Test fixture
`add_column_default_with_embedded_quote_passthrough` locks this
decision.

### CHECK expression scope — free-text, NO escaping

Same as DEFAULT. Single-line free text, verbatim interpolation
into the SQL string. NO syntax validation. PG's parser is the
ground truth for whether the expression is valid. Mirrors Sprint
229 `ConstraintDefinition::Check` contract.

### CASCADE checkbox label divergence from Sprint 235

The user spec for Sprint 236 locks the CASCADE label as **`"Drop
dependent objects (CASCADE)"`**. Sprint 235 `DropTableDialog` ships
the label **`"CASCADE — drop dependent objects (default: off)"`**.
The two labels diverge. Sprint 236 follows the user spec; Sprint
235 stays diff = 0 (frozen). The inconsistency is flagged in
**Open Questions §3** — recommend a future polish sprint to
unify.

### CASCADE checkbox default — OFF

Mirror Sprint 235 `DropTableDialog`. PG's default for
`DROP COLUMN` without keyword is RESTRICT (blocks the drop if any
FK / view / index references the column). User opts INTO CASCADE
explicitly. Emitted SQL omits the `RESTRICT` keyword (byte-
equivalent to PG's implicit form) — locked by fixture.

### Show DDL pane — collapsed by default

Mirror Sprint 226 `CreateTableDialog` default. The pane stays
collapsed on initial mount; user clicks "Show DDL" to expand and
trigger the preview fetch. Reduces visual noise on the common
add-column path (where the user just wants a quick add).

### Cache invalidation path — `onRefresh()` only

Locked decision per user spec. Sprint 223
`useSchemaTableMutations` is **table-scoped** (drop / rename
table), NOT column-scoped. Extending it with `addColumn` /
`dropColumn` methods would expand the hook surface — explicitly
disallowed unless the natural-extension test passes. The natural
path is:

1. `AddColumnDialog` / `DropColumnDialog` commit closure invokes
   `tauri.{addColumn,dropColumn}Request({ ..., previewOnly:
   false })`.
2. On commit success, `useDdlPreviewExecution.runCommit` calls
   `onRefresh()` (the prop passed in by `ColumnsEditor`).
3. `ColumnsEditor.onRefresh` is the existing prop set up by
   `StructurePanel` to call `fetchData()`, which re-runs
   `getTableColumns(connectionId, table, schema)` →
   `schemaStore` writes through `tableColumnsCache[
   ${connectionId}:${schema}:${table}]`.
4. The next render of `ColumnsEditor` reflects the new list.

NO new store action. NO new hook. **`schemaStore.ts` and
`useSchemaTableMutations.ts` both stay diff = 0.**

### Typing-confirm pattern — case-sensitive byte-for-byte

Mirror Sprint 235 `DropTableDialog` exactly. NO trim, NO debounce,
every keystroke re-evaluates. Empty input → button disabled.
Whitespace-only input → button disabled. `Email` ≠ `email`.

### Drop column Safe Mode dispatch — gate fires after typing confirm

Mirror Sprint 235 `DropTableDialog`. Two-layer protection:
1. **Typing confirm** protects against fat-finger / wrong-column
   errors regardless of environment.
2. **Safe Mode gate** adds an ADDITIONAL gate when the analyzer
   flags the SQL as dangerous (`ALTER TABLE ... DROP COLUMN` is
   `ddl-drop` / danger).

Sequence: user types name → Apply enables → click Apply → preview
SQL fetched → Safe Mode gate decides → block / warn / safe → on
warn, `pendingConfirm` modal mounts → user types analyzer reason
→ commit runs.

### Pre-existence check on add — REMOVED on backend, optimistic on frontend

Mirror Sprint 235 `drop_table` pre-existence check removal. PG
surfaces `column "X" of relation "Y" already exists` verbatim in
`previewError`. Frontend MAY do an optimistic Apply-disabled hint
when the typed name matches an existing column from the loaded
`columns` prop — purely UX, no backend pre-check.

## Verification Plan

Profile: `mixed` (browser visual smoke + command-line cargo /
vitest / tsc / lint / build).

### Required Checks (command line)

| # | Check | Command | Expected |
| --- | --- | --- | --- |
| 1 | vitest full | `pnpm vitest run` | 0 failed; ≥ 2886 + ≥ 24 new = ≥ 2910 tests |
| 2 | tsc | `pnpm tsc --noEmit` | exit 0, silent |
| 3 | lint | `pnpm lint` | exit 0, silent |
| 4 | cargo build | `cargo build --manifest-path src-tauri/Cargo.toml` | Finished |
| 5 | cargo clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | 0 warnings |
| 6 | cargo fmt | `cargo fmt --check --manifest-path src-tauri/Cargo.toml` | silent |
| 7 | cargo test add_column | `cargo test --manifest-path src-tauri/Cargo.toml --lib add_column` | PASS — ≥ 6 new fixtures |
| 8 | cargo test drop_column | `cargo test --manifest-path src-tauri/Cargo.toml --lib drop_column` | PASS — ≥ 4 new fixtures |
| 9 | cargo test serde_camelcase_roundtrip | `cargo test --manifest-path src-tauri/Cargo.toml --lib serde_camelcase_roundtrip` | PASS — ≥ 4 (existing 2 Sprint 235 + 2 new Sprint 236) |
| 10 | cargo test create_table — REGRESSION | `cargo test --manifest-path src-tauri/Cargo.toml --lib create_table` | PASS — Sprint 226-235 22-fixture suite byte-equivalent |
| 11 | cargo test create_index — REGRESSION | `cargo test --manifest-path src-tauri/Cargo.toml --lib create_index` | PASS — 11/11 unchanged |
| 12 | cargo test add_constraint — REGRESSION | `cargo test --manifest-path src-tauri/Cargo.toml --lib add_constraint` | PASS — 12/12 unchanged |
| 13 | cargo test rename_table — REGRESSION | `cargo test --manifest-path src-tauri/Cargo.toml --lib rename_table` | PASS — 11/11 unchanged |
| 14 | cargo test drop_table — REGRESSION | `cargo test --manifest-path src-tauri/Cargo.toml --lib drop_table` | PASS — 6/6 unchanged |
| 15 | cargo test alter_table — REGRESSION | `cargo test --manifest-path src-tauri/Cargo.toml --lib alter_table` | PASS unchanged (still covers ColumnChange::Add/Drop via batched path) |
| 16 | cargo test --lib total | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | ≥ 395 + ≥ 12 new = ≥ 407 |
| 17 | vitest — AddColumnDialog | `pnpm vitest run src/components/schema/AddColumnDialog.test.tsx` | ≥ 12 cases PASS |
| 18 | vitest — DropColumnDialog | `pnpm vitest run src/components/schema/DropColumnDialog.test.tsx` | ≥ 12 cases PASS |
| 19 | vitest — ColumnsEditor | `pnpm vitest run src/components/structure/ColumnsEditor.test.tsx` | PASS — modify path unchanged + add/drop rewired to modals |
| 20 | vitest — DropTableDialog REGRESSION | `pnpm vitest run src/components/schema/DropTableDialog.test.tsx` | PASS unchanged |
| 21 | vitest — RenameTableDialog REGRESSION | `pnpm vitest run src/components/schema/RenameTableDialog.test.tsx` | PASS unchanged |
| 22 | vitest — CreateTableDialog REGRESSION | `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx` | PASS unchanged |
| 23 | vitest — SchemaTree.actions REGRESSION | `pnpm vitest run src/components/schema/SchemaTree.actions.test.tsx` | PASS unchanged |
| 24 | vitest — useSchemaTableMutations REGRESSION | `pnpm vitest run src/hooks/useSchemaTableMutations.test.ts` | PASS unchanged |
| 25 | vitest — useDdlPreviewExecution REGRESSION | `pnpm vitest run src/components/structure/useDdlPreviewExecution.test.tsx` | PASS unchanged |
| 26 | vitest — usePostgresTypes REGRESSION | `pnpm vitest run src/hooks/usePostgresTypes.test.ts` | PASS unchanged |
| 27 | vitest — AC-236 named filter | `pnpm vitest run -t "AC-236"` | all PASS |
| 28 | frozen — useDdlPreviewExecution | `git diff --stat src/components/structure/useDdlPreviewExecution.ts` | 0 |
| 29 | frozen — SqlPreviewDialog | `git diff --stat src/components/structure/SqlPreviewDialog.tsx` | 0 |
| 30 | frozen — useSafeModeGate | `git diff --stat src/hooks/useSafeModeGate.ts` | 0 |
| 31 | frozen — safeMode + sqlSafety | `git diff --stat src/lib/safeMode.ts src/lib/sql/sqlSafety.ts` | 0 |
| 32 | frozen — schemaStore | `git diff --stat src/stores/schemaStore.ts` | 0 |
| 33 | frozen — connectionStore | `git diff --stat src/stores/connectionStore.ts` | 0 |
| 34 | frozen — safeModeStore | `git diff --stat src/stores/safeModeStore.ts` | 0 |
| 35 | frozen — useSchemaTableMutations | `git diff --stat src/hooks/useSchemaTableMutations.ts` | 0 (Sprint 223 hook signature invariant) |
| 36 | frozen — postgresTypes + usePostgresTypes | `git diff --stat src/lib/sql/postgresTypes.ts src/hooks/usePostgresTypes.ts` | 0 each |
| 37 | frozen — CreateTableDialog | `git diff --stat src/components/schema/CreateTableDialog.tsx src/components/schema/CreateTableDialog/Header.tsx` | 0 |
| 38 | frozen — RenameTableDialog + DropTableDialog | `git diff --stat src/components/schema/RenameTableDialog.tsx src/components/schema/DropTableDialog.tsx` | 0 each |
| 39 | frozen — Rename/DropTableDialog tests | `git diff --stat src/components/schema/RenameTableDialog.test.tsx src/components/schema/DropTableDialog.test.tsx` | 0 each |
| 40 | frozen — SchemaTree.actions test | `git diff --stat src/components/schema/SchemaTree.actions.test.tsx` | 0 |
| 41 | frozen — cross-window tests | `git diff --stat src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/cross-window-store-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` | 0 each |
| 42 | grep — ADD COLUMN emit | `grep -nE 'ADD COLUMN' src-tauri/src/db/postgres/mutations.rs` | ≥ 1 (in `add_column` body) |
| 43 | grep — DROP COLUMN emit | `grep -nE 'DROP COLUMN' src-tauri/src/db/postgres/mutations.rs` | ≥ 1 (in `drop_column` body; existing `alter_table` ColumnChange::Drop also matches — accept ≥ 2) |
| 44 | grep — request types | `grep -nE 'AddColumnRequest\|DropColumnRequest' src-tauri/src/models/schema.rs` | ≥ 4 (struct decls + serde roundtrip tests) |
| 45 | grep — IPC wrapper | `grep -nE 'addColumnRequest\|dropColumnRequest' src/lib/tauri/ddl.ts` | ≥ 2 |
| 46 | grep — typing-confirm | `grep -nE 'Type the column name' src/components/schema/DropColumnDialog.tsx` | ≥ 1 |
| 47 | grep — CASCADE checkbox | `grep -nE 'Drop dependent objects \(CASCADE\)' src/components/schema/DropColumnDialog.tsx` | ≥ 1 |
| 48 | grep — Mongo path untouched | `git diff --stat src/components/schema/DocumentDatabaseTree/useDocumentDatabaseDrop.ts src/lib/tauri/document.ts src/lib/mongo/mongoSafety.ts` | 0 each |
| 49 | grep — no skipped tests | `grep -rnE 'it\.only\|it\.skip\|describe\.skip\|xit\|it\.todo' src/components/schema/AddColumnDialog.test.tsx src/components/schema/DropColumnDialog.test.tsx src/components/structure/ColumnsEditor.test.tsx` | 0 |
| 50 | grep — no eslint-disable | `git diff src/ src-tauri/ \| grep "^+.*eslint-disable"` | 0 (excluding the `// eslint-disable-next-line react-hooks/exhaustive-deps` already present in Sprint 235 dialogs which Sprint 236 may legitimately need to mirror — Generator must justify any new occurrence in `findings.md`) |
| 51 | grep — no `any` | `git diff src/ \| grep -E "^\+.*\bany\b"` | 0 |
| 52 | grep — no silent catch | `grep -rnE '\}\s*catch\s*\{\s*\}' src/components/schema/AddColumnDialog.tsx src/components/schema/DropColumnDialog.tsx` | 0 |
| 53 | grep — DDL history source | `grep -nE '"ddl-structure"' src/components/schema/AddColumnDialog.tsx src/components/schema/DropColumnDialog.tsx` | ≥ 0 (consumed via `useDdlPreviewExecution` and asserted in test; explicit string is optional) |
| 54 | grep — register handlers | `grep -nE 'commands::rdb::ddl::add_column\|commands::rdb::ddl::drop_column' src-tauri/src/lib.rs` | ≥ 2 |

### Browser visual smoke (manual, recommended — record in `docs/sprints/sprint-236/findings.md`)

1. `pnpm tauri dev` → connect to PG → expand a schema → click a
   table → Structure tab → Columns sub-tab → click `+ Column` →
   `<AddColumnDialog>` mounts → enter name `email`, type
   `varchar(255)`, NOT NULL on, DEFAULT `''`, CHECK
   `email LIKE '%@%'` → click Show DDL → preview pane shows
   `ALTER TABLE "public"."users" ADD COLUMN "email" varchar(255) NOT NULL DEFAULT '' CHECK (email LIKE '%@%')`
   → click Apply → modal closes → ColumnsEditor refreshes →
   new `email` row visible.
2. Same flow with type combobox → start typing `var` → suggestions
   include `varchar`, `varchar(255)`, custom user types from
   `usePostgresTypes`. Free-text `numeric(10,4)` → preview emits
   `... numeric(10,4) ...` verbatim.
3. Drop a column: right-click / trash icon on `email` row →
   `<DropColumnDialog>` mounts → CASCADE unchecked → typing-confirm
   `email` → click Show DDL → preview pane shows
   `ALTER TABLE "public"."users" DROP COLUMN "email"` → click
   Apply → modal closes → row gone.
4. Drop with CASCADE → check the checkbox → preview re-fetches →
   SQL now shows `... DROP COLUMN "email" CASCADE`.
5. Drop a referenced column without CASCADE → PG error
   verbatim in `previewError` → modal stays open.
6. Type-confirm mismatch (column `Email`, type `email`) → Apply
   stays disabled.
7. Add column with name collision (`email` already exists) →
   Apply disabled with inline hint "column already exists".
8. Drop PK column → PG errors verbatim → modal stays open.

### Required Evidence

- Generator must provide:
  - changed files with purpose + LOC delta.
  - check 1-54 results (exit code + key output).
  - AC-236-01..AC-236-12 each cited with concrete test/fixture
    evidence (test file:line, fixture string for byte-equivalent
    SQL, IPC sequence trace).
  - byte-equivalent SQL strings (verbatim) for the 5+ named add
    fixtures + 2 drop fixtures.
  - confirmation that `useDdlPreviewExecution` /
    `useSafeModeGate` / `useSchemaTableMutations` /
    `usePostgresTypes` / `CreateTableTypeCombobox` were reused
    without diff.
  - confirmation that Mongo path untouched (check 48).
  - confirmation that Sprint 235 dialogs / tests untouched
    (checks 38, 39).
  - browser visual smoke (1-8 above) — record in `findings.md`
    if performed (recommended but not blocking).
- Evaluator must cite:
  - per-AC pass/fail with concrete evidence (test file:line,
    fixture string match, grep output).
  - missing or weak evidence as P1/P2 findings.
  - regression freeze verification (Sprint 226-235 fixtures all
    pass byte-equivalent).
  - Sprint 223 hook signature invariant (check 35 = 0 diff).
  - Sprint 230 `usePostgresTypes` invariant (check 36 = 0 diff).

## Test Requirements

### Unit Tests (필수)

- **AC-236-01**: Rust unit fixtures in `mutations.rs#[cfg(test)]`
  — `add_column_preview_byte_equivalent`,
  `add_column_preview_with_not_null_byte_equivalent`,
  `add_column_preview_with_default_byte_equivalent`,
  `add_column_preview_with_check_byte_equivalent`,
  `add_column_preview_full_combo_byte_equivalent`,
  `add_column_preview_only_does_not_execute`. ≥ 6 cases.
- **AC-236-02**: Rust unit fixtures —
  `drop_column_preview_no_cascade_byte_equivalent`,
  `drop_column_preview_cascade_byte_equivalent`,
  `drop_column_preview_only_does_not_execute`,
  `drop_column_invalid_column_name_rejected` (3 sub-cases). ≥ 4
  cases.
- **AC-236-03**: vitest on `AddColumnDialog.test.tsx` +
  `DropColumnDialog.test.tsx` — IPC payload shape `{ request: {
  connectionId, schema, table, column?, columnName?,
  checkExpression?, cascade?, previewOnly } }` + sequence `[{
  previewOnly: true }, { previewOnly: false }]`. Rust serde
  roundtrip tests
  (`add_column_request_serde_camelcase_roundtrip`,
  `drop_column_request_serde_camelcase_roundtrip`).
- **AC-236-04**: vitest on `AddColumnDialog.test.tsx` — name
  validation matrix (empty / space / quote / digit-start /
  >63 bytes / NULL byte) + type combobox consumes
  `usePostgresTypes` mock + NOT NULL toggle reflected in preview
  + DEFAULT/CHECK passthrough + collision pre-check. ≥ 8 cases.
- **AC-236-05**: vitest on `DropColumnDialog.test.tsx` — typing-
  confirm enable/disable + case sensitivity + CASCADE toggle
  invalidates preview + CASCADE keyword in SQL + commit-success.
  ≥ 5 cases.
- **AC-236-06**: vitest on `DropColumnDialog.test.tsx` — Safe Mode
  block / warn-cancel / warn-confirm / safe path matrix. ≥ 4 cases.
- **AC-236-07**: vitest on `ColumnsEditor.test.tsx` — `+ Column`
  button mounts `<AddColumnDialog>`; trash icon mounts
  `<DropColumnDialog>`; commit-success → `onRefresh` invoked
  exactly once; existing Modify path unchanged. ≥ 4 cases.
- **AC-236-08**: vitest on `ColumnsEditor.test.tsx` (or new
  `StructurePanel.columns.test.tsx`) — column appears /
  disappears after refresh; `tableColumnsCache` write-through
  verified via mocked `getTableColumns`. ≥ 2 cases.
- **AC-236-09**: vitest + Rust covering identifier rejection edge
  cases (length > 63, embedded NULL byte, leading digit, embedded
  quote, embedded space, empty/whitespace). ≥ 4 cases each layer.
- **AC-236-10**: Rust fixture
  `add_column_default_with_embedded_quote_passthrough` + vitest
  on `AddColumnDialog.test.tsx` asserting raw IPC payload
  preserves the user's verbatim DEFAULT / CHECK input.
- **AC-236-11**: 4-set verification commands all PASS (verified
  by checks 1-5).
- **AC-236-12**: Sprint 226-235 fixtures byte-equivalent
  (verified by checks 10-15, 20-26).

### Coverage Target

- 신규 `src/components/schema/AddColumnDialog.tsx`: 라인 ≥ 70%.
- 신규 `src/components/schema/DropColumnDialog.tsx`: 라인 ≥ 70%.
- 신규 `src-tauri/src/db/postgres/mutations.rs::add_column /
  ::drop_column` 함수: 브랜치 ≥ 70% (preview / execute /
  validation-fail / cascade-on / cascade-off / not-null / default /
  check).
- CI baseline: 라인 40% / 함수 40% / 브랜치 35%.

### Scenario Tests (필수)

- [x] **Happy path** — preview→commit with safe SQL → success →
  `onRefresh` + history entry + modal close.
- [x] **빈/누락 입력** — empty name rejected (frontend Apply
  disabled + backend `AppError::Validation`); empty type rejected;
  empty typing-confirm keeps Apply disabled.
- [x] **에러 복구** — Safe Mode warn-cancel surfaces canonical
  message + form stays editable; backend `AppError::Database`
  (column doesn't exist after concurrent drop) surfaces in
  preview pane error slot + modal stays open; PK column drop →
  PG error verbatim.
- [x] **동시성/경쟁** — table dropped between Preview and Execute
  → PG error verbatim; user clicks `Show DDL` twice → second
  preview overwrites first (Sprint 214 contract); user closes
  modal mid-flight → `cancelPreview` discards commit closure.
- [x] **상태 전이** — idle → preview-loading → preview-shown →
  safe-mode-decide → (safe → typing-confirm-required (drop only)
  → commit-loading → success) | (warn → confirm-mounted →
  committed) | (block → previewError set).
- [x] **에지 케이스** — NOT NULL on populated table without
  DEFAULT (PG verbatim error); embedded `'` in DEFAULT (verbatim
  passthrough); parametric `varchar(255)` / `numeric(10,4)`
  (verbatim type emit); identifier with embedded space
  (rejected); identifier > 63 bytes (rejected); identifier with
  embedded NULL byte (rejected); CASCADE toggle from off→on→off;
  typing-confirm `Email` vs `email` (case mismatch — Apply stays
  disabled); name collision pre-check (Apply disabled with hint).
- [x] **기존 기능 회귀 없음** — Sprint 226-235 byte-equivalent
  fixtures pass UNMODIFIED; `alter_table` (still covers Add/Drop
  via `ColumnChange`) passes byte-equivalent.

## Test Script / Repro Script

1. baseline (before any change):
   ```sh
   pnpm vitest run
   pnpm vitest run src/components/structure/ColumnsEditor.test.tsx
   pnpm vitest run src/components/schema/RenameTableDialog.test.tsx
   pnpm vitest run src/components/schema/DropTableDialog.test.tsx
   cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run
   ```
2. Generator 작업 후 — primary command profile:
   ```sh
   pnpm vitest run src/components/schema/AddColumnDialog.test.tsx
   pnpm vitest run src/components/schema/DropColumnDialog.test.tsx
   pnpm vitest run src/components/structure/ColumnsEditor.test.tsx
   cargo test --manifest-path src-tauri/Cargo.toml --lib add_column
   cargo test --manifest-path src-tauri/Cargo.toml --lib drop_column
   cargo test --manifest-path src-tauri/Cargo.toml --lib create_table
   cargo test --manifest-path src-tauri/Cargo.toml --lib rename_table
   cargo test --manifest-path src-tauri/Cargo.toml --lib drop_table
   cargo test --manifest-path src-tauri/Cargo.toml --lib alter_table
   pnpm vitest run src/components/schema/RenameTableDialog.test.tsx
   pnpm vitest run src/components/schema/DropTableDialog.test.tsx
   pnpm vitest run src/components/schema/CreateTableDialog.test.tsx
   ```
3. 4-set verification:
   ```sh
   pnpm vitest run
   pnpm tsc --noEmit
   pnpm lint
   cargo build --manifest-path src-tauri/Cargo.toml
   cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
   cargo fmt --check --manifest-path src-tauri/Cargo.toml
   ```
4. Surface + freeze 검증:
   ```sh
   git diff --stat src/components/structure/useDdlPreviewExecution.ts src/components/structure/SqlPreviewDialog.tsx
   git diff --stat src/stores/schemaStore.ts src/stores/connectionStore.ts src/stores/safeModeStore.ts
   git diff --stat src/hooks/useSafeModeGate.ts src/hooks/useSchemaTableMutations.ts src/hooks/usePostgresTypes.ts
   git diff --stat src/lib/safeMode.ts src/lib/sql/sqlSafety.ts src/lib/sql/postgresTypes.ts
   git diff --stat src/components/schema/CreateTableDialog.tsx src/components/schema/CreateTableDialog/Header.tsx
   git diff --stat src/components/schema/RenameTableDialog.tsx src/components/schema/DropTableDialog.tsx
   git diff --stat src/components/schema/RenameTableDialog.test.tsx src/components/schema/DropTableDialog.test.tsx
   git diff --stat src/components/schema/SchemaTree.actions.test.tsx
   git diff --stat src/components/schema/DocumentDatabaseTree/useDocumentDatabaseDrop.ts
   git diff src/ src-tauri/ | grep "^+.*eslint-disable"
   grep -rnE 'it\.only|it\.skip|describe\.skip|xit|it\.todo' src/components/schema/AddColumnDialog.test.tsx src/components/schema/DropColumnDialog.test.tsx
   grep -nE 'ADD COLUMN|DROP COLUMN' src-tauri/src/db/postgres/mutations.rs
   grep -nE 'add_column|drop_column' src-tauri/src/lib.rs
   ```
5. Optional manual UI smoke (record in `docs/sprints/sprint-236/
   findings.md` if performed) — see "Browser visual smoke"
   above.

## Open questions

The Generator should resolve these before/during implementation;
if the resolution diverges from the assumption baked into this
contract, flag it in `findings.md`.

1. **Compat positional `addColumn` / `dropColumn` exports — emit
   or skip?** — The user's locked decision (#9) calls for "Sprint
   235 dual-export pattern" which has both `dropTable(positional)`
   and `dropTableRequest(request)`. Sprint 235's positional shape
   exists because `schemaStore.ts` already consumed the legacy
   positional signature pre-235 — diff = 0 invariant required the
   wrapper. Sprint 236 has NO existing positional `addColumn` /
   `dropColumn` callers (the existing column flow is
   `alter_table` batched). Default assumption baked into this
   contract: emit BOTH variants for symmetry with Sprint 235, but
   the positional aliases will be unused. Generator should
   confirm with `grep -rn 'tauri\.addColumn\b\|tauri\.dropColumn\b'
   src/` returns 0 hits in production code; if so, the positional
   aliases may be DROPPED (slim the public API surface).

2. **`useSchemaTableMutations` extension OR inline cache
   invalidation?** — The user's locked decision (#8) says: "extend
   the hook with `addColumn` / `dropColumn` methods OR scope inline
   in the dialog (avoid expanding the hook surface unless
   natural)". Verification of `useSchemaTableMutations` shows the
   hook is **table-scoped**: it patches `state.tables[key]` with a
   filter / map. Extending it for column add/drop would touch
   `state.tableColumnsCache[key2]` — a different shape, different
   cache key (`${connectionId}:${schema}:${table}` vs
   `${connectionId}:${schema}`), different fallback semantics
   (the table-level fallback re-fetches `listTables`; the column-
   level equivalent would re-fetch `getTableColumns`). The
   "natural extension" test fails: the hook's existing reload-then-
   fallback pattern doesn't compose with the column-cache shape.
   Default decision baked into this contract: **scope inline via
   `onRefresh()`** (the existing prop chain
   `AddColumnDialog → ColumnsEditor → StructurePanel.fetchData →
   getTableColumns` already handles the cache write-through).
   `useSchemaTableMutations.ts` stays diff = 0 (Sprint 223
   invariant). If the Generator finds the natural-extension path
   compiles cleanly, document the trade-off and choose; default
   guidance is "stay inline".

3. **CASCADE checkbox label inconsistency with Sprint 235** —
   The user's locked decision for Sprint 236 says label =
   `"Drop dependent objects (CASCADE)"`. Sprint 235
   `DropTableDialog` ships
   `"CASCADE — drop dependent objects (default: off)"`. The two
   labels diverge on:
   - "Drop dependent objects" word order (Sprint 236 spec) vs
     "drop dependent objects (default: off)" suffix (Sprint 235).
   - "(CASCADE)" wraps the keyword (Sprint 236) vs "CASCADE — ..."
     prefix (Sprint 235).

   Sprint 236 follows the user's locked spec exactly. Sprint 235
   stays diff = 0 (frozen). The inconsistency surfaces in
   browser smoke (a user dropping a table sees one label; a user
   dropping a column sees another). Recommendation: future
   polish sprint (Sprint 238?) to unify both labels — flag in
   `docs/archives/incidents/` post-sprint.

4. **StructurePanel context-menu vs. trash icon for drop** — The
   user's locked decision (#7) says "per-row 'Drop Column…'
   context-menu entry". Verification of the existing
   `EditableColumnRow` in `ColumnsEditor.tsx` shows there is
   currently NO right-click context menu — drop is triggered by a
   trash icon (`<Trash2>`) inside the row's action cell. Adding a
   full context menu is a non-trivial UX expansion (new shadcn
   primitive, keyboard / accessibility plumbing). Default
   assumption baked into this contract: **rewire the existing
   trash icon** (`onDelete={() => handleDeleteColumn(col.name)}`)
   to open `<DropColumnDialog>` rather than push a pending drop.
   This preserves the existing visual surface + preserves the
   "Drop Column" entry-point. If the Generator strictly
   interprets "context-menu entry" as a literal right-click menu,
   flag it and confirm with the user before adding new shadcn
   primitives.

5. **`+ Column` toolbar button vs new "Add Column…" dropdown** —
   The user's locked decision (#7) says "add 'Add Column…' entry
   to the columns table header / `+ Column` toolbar button".
   Verification of `ColumnsEditor.tsx` shows a single `+ Column`
   button that pushes an inline `NewColumnDraft`. The user spec
   suggests EITHER (a) repurpose the existing button to open the
   modal OR (b) keep the existing button + add a parallel
   "Add Column…" entry-point. Default assumption baked into this
   contract: **repurpose the existing button to open the modal**
   (option a — single entry-point, no UX duplication, simplest
   diff). The inline-NewColumnDraft path is REMOVED in Sprint
   236; the modal becomes the sole add-column surface. If the
   Generator finds users rely on the inline-batched workflow
   (e.g. add 3 columns at once via `pendingChanges`), flag it
   and consider keeping both surfaces. **Note: the inline-batched
   MODIFY path (Edit pencil → save change → review SQL) stays
   intact — only the ADD inline path is removed.**

6. **`alter_table` inline-add path still emits `ColumnChange::Add`
   — keep or remove?** — The existing `alter_table` Tauri command
   handles `ColumnChange::Add` / `ColumnChange::Modify` /
   `ColumnChange::Drop` in batched form. Sprint 236 introduces
   PARALLEL `add_column` / `drop_column` commands. The Add and
   Drop arms of `alter_table` are now redundant with the new
   commands — but `alter_table` MUST stay for the multi-step
   modify path (Sprint 237 polish target). Default decision baked
   into this contract: **keep `alter_table` byte-equivalent (no
   diff)**. The Generator may not remove the `ColumnChange::Add`
   / `::Drop` arms even though they're redundant — Sprint 237
   will revisit. Frontend `ColumnsEditor` no longer EMITS
   `ColumnChange::Add` (the inline path is gone) but may still
   emit `ColumnChange::Drop` if the existing per-row trash
   batching path is preserved. Default: **trash icon now opens
   modal** (per OQ §4) so `ColumnChange::Drop` is also no longer
   emitted by the frontend; `alter_table` is reduced to MODIFY-
   only in practice but the backend signature stays unchanged.

## Ownership

- Generator: general-purpose agent (Phase 3, harness skill).
- Write scope: backend (`models/schema.rs` + new `AddColumnRequest`
  / `DropColumnRequest` + `db/traits.rs` trait additions +
  `db/postgres/mutations.rs` new methods + trait forwarder in
  `postgres.rs` + `commands/rdb/ddl.rs` two new handlers + `lib.rs`
  handler registration + `db/tests.rs` + `commands/meta.rs`
  trait stub additions) + frontend types (`src/types/schema.ts`)
  + IPC wrappers (`src/lib/tauri/ddl.ts` two new exports +
  `src/lib/tauri/index.ts` re-exports) + 2 new modals
  (`AddColumnDialog.{tsx,test.tsx}` +
  `DropColumnDialog.{tsx,test.tsx}`) + ColumnsEditor wiring
  (`src/components/structure/ColumnsEditor.tsx` button rewires +
  `ColumnsEditor.test.tsx` mechanical updates).
- 변경 금지: `useDdlPreviewExecution.ts` / `SqlPreviewDialog.tsx`
  / `useSafeModeGate.ts` / `useSchemaTableMutations.ts` /
  `usePostgresTypes.ts` / `safeMode.ts` / `sqlSafety.ts` /
  `safeModeStore.ts` / `connectionStore.ts` / `schemaStore.ts` /
  `postgresTypes.ts` / `CreateTableDialog*` / `CreateTableTypeCombobox*`
  / `RenameTableDialog*` / `DropTableDialog*` /
  `SchemaTree.actions.test.tsx` / Mongo paths / cross-window
  regression tests / `useFkReferencePicker.ts` / `SqlSyntax.tsx`
  / `sqlTokenize.ts` / `main.tsx` / `alter_table` body and
  `create_table` / `create_index` / `add_constraint` /
  `rename_table` / `drop_table` bodies.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- Required checks passing: `yes` (1-54 모두).
- Acceptance criteria evidence linked in `handoff.md` —
  AC-236-01..AC-236-12 each cited with concrete test/fixture
  evidence.
- 본 sprint 후 Phase 27 sprint 11 종료 — Sprint 237 (Column
  modify + USING cast + multi-step + Phase 27 마무리 마일스톤)
  unblocked.
- TDD evidence (`red-state.log` 또는 red-state commit) recorded
  in `docs/sprints/sprint-236/tdd-evidence/`.
- e2e closure dependency: **none**. `lefthook.yml:5_e2e` stays
  disabled. Phase 27 e2e smoke deferred under
  `[DEFERRED-PHASE-27-E2E]` marker.
