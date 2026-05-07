# Sprint Contract: sprint-235

## Summary

- Goal: Phase 27 sprint 10 — first ALTER TABLE polish sprint. Promote the
  existing **rename / drop** SchemaTree flows from "minimal confirm dialog"
  to the Phase 24-26 DDL surface contract: backend `rename_table` /
  `drop_table` Tauri commands gain a `preview_only` branch + return
  `SchemaChangeResult { sql }`; frontend grows a `RenameTableDialog`
  (single-field, identifier validate, inline DDL preview via
  `useDdlPreviewExecution`) and a `DropTableDialog` (CASCADE checkbox +
  inline DDL preview + **typing-confirm** [new pattern] + Safe Mode gate
  dispatch). The existing Sprint 223 `useSchemaTableMutations` hook +
  context-menu entries (`Rename` / `Drop`) get repurposed as the wiring
  template — current `confirmDialog` / `renameDialog` slot replaced by
  the new modal slots. No column / type / multi-step ALTER work this
  sprint (Sprint 236+).
- Audience: Generator + Evaluator (multi-agent harness, post-234 cycle,
  Phase 27 sprint 10 of 11).
- Owner: harness skill orchestrator.
- Verification Profile: `mixed` (browser visual smoke + command-line
  cargo / vitest / tsc / lint / build).

## Pattern source

- Sprint 226 (`docs/sprints/sprint-226/contract.md`) — CREATE TABLE
  Tauri command + dialog + `useDdlPreviewExecution` reuse + SchemaTree
  wiring template.
- Sprint 214 — `useDdlPreviewExecution` hook (preview/execute lifecycle
  + Safe Mode gate dispatch + canonical warn-cancel message).
- Sprint 198 — `useDocumentDatabaseDrop` Mongo Safe Mode gate dispatch
  (used as Safe Mode integration template; **NOT** as typing-confirm
  template — the Mongo flow uses a regular confirm dialog, not a typing
  confirm. Sprint 235 introduces the typing-confirm pattern fresh.).
- Sprint 223 — `useSchemaTableMutations` hook (reload+fallback for
  drop/rename — extended in this sprint to drive both the new dialogs
  on commit-success without expanding the hook's surface).

## In Scope

### Backend (Rust)

- **MOD** `src-tauri/src/models/schema.rs` (~+50 LOC): add two new
  request types beside the existing `CreateTableRequest`:
  ```rust
  #[derive(Debug, Deserialize)]
  #[serde(rename_all = "camelCase")]
  pub struct RenameTableRequest {
      pub connection_id: String,
      pub schema: String,
      pub table: String,
      pub new_name: String,
      #[serde(default)]
      pub preview_only: bool,
  }

  #[derive(Debug, Deserialize)]
  #[serde(rename_all = "camelCase")]
  pub struct DropTableRequest {
      pub connection_id: String,
      pub schema: String,
      pub table: String,
      #[serde(default)]
      pub cascade: bool,
      #[serde(default)]
      pub preview_only: bool,
  }
  ```
  Both `#[serde(default)]` flags keep backwards-compatible JSON for
  callers that only set the required fields. Includes ≥ 2 serde
  roundtrip tests in `#[cfg(test)] mod tests`.

- **MOD** `src-tauri/src/db/traits.rs` (~+10 LOC): swap the existing
  `RdbAdapter::drop_table` (`(schema, table) -> Result<(), AppError>`)
  and `RdbAdapter::rename_table` (`(schema, table, new_name) ->
  Result<(), AppError>`) signatures for request-shaped variants
  matching `create_table` / `alter_table`:
  ```rust
  fn rename_table<'a>(
      &'a self,
      req: &'a RenameTableRequest,
  ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

  fn drop_table<'a>(
      &'a self,
      req: &'a DropTableRequest,
  ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;
  ```
  This is a breaking change to the trait; non-PG adapters (currently
  none — Mongo uses `DocumentAdapter`, MySQL/SQLite/Oracle are not
  yet behind `RdbAdapter` per Phase 17-20 status) are not affected.
  See **Open questions §1** for the migration path on the existing
  PG impl.

- **MOD** `src-tauri/src/db/postgres/mutations.rs` (~+220 LOC):
  - Replace the existing `drop_table(table, schema) -> Result<(),
    AppError>` body (lines ~96-128) with `drop_table(req:
    &DropTableRequest) -> Result<SchemaChangeResult, AppError>`. New
    body: validate identifiers (`validate_identifier` on `req.schema`
    + `req.table`); build SQL `DROP TABLE "<schema>"."<table>"` with
    `" CASCADE"` appended when `req.cascade == true` (do **not** emit
    `RESTRICT` keyword — PG default is RESTRICT, byte-equivalence with
    PG's implicit form is an explicit invariant); preview branch
    returns `SchemaChangeResult { sql }` without DB write; execute
    branch wraps the single statement in BEGIN/COMMIT for parity with
    `create_table` / `alter_table`. **Pre-existence check (the current
    `information_schema.tables` lookup) is REMOVED** — let PG surface
    the error verbatim, mirroring `create_table`'s
    "no client-side dependency analysis" stance.
  - Replace the existing `rename_table(table, schema, new_name)` body
    (lines ~131-170) with `rename_table(req: &RenameTableRequest)`.
    New body: validate identifiers (`validate_identifier` on
    `req.schema` + `req.table` + `req.new_name`); build SQL
    `ALTER TABLE "<schema>"."<table>" RENAME TO "<new_name>"`
    (single statement, ANSI quoting); preview branch returns
    `SchemaChangeResult { sql }`; execute branch wraps in BEGIN/COMMIT.
  - Both functions move identifier validation behind the shared
    `validate_identifier` helper that `create_table` / `alter_table`
    already use (so the regex / message stays single-sourced — the
    current `rename_table` body has its own ad-hoc validator that
    drifts from `validate_identifier`; re-use brings it back in line).

- **MOD** `src-tauri/src/db/postgres/mutations.rs#[cfg(test)] mod
  tests` (~+200 LOC): ≥ 8 new fixtures (4 per command):
  - `rename_table_preview_byte_equivalent` — single statement byte
    fixture: `ALTER TABLE "public"."users" RENAME TO "people"`.
  - `rename_table_preview_only_does_not_execute` — preview branch
    returns SQL even without a live pool.
  - `rename_table_invalid_new_name_rejected` — embedded space, embedded
    quote, length > 63 bytes, leading digit (4 sub-cases via
    table-driven test).
  - `rename_table_same_name_emits_sql` — `req.new_name == req.table`
    → SQL still emitted; locks the "no client-side rename-to-self
    pre-check" decision (frontend disables Apply when names match,
    but backend stays permissive so direct IPC callers behave the
    same as PG itself).
  - `drop_table_preview_no_cascade_byte_equivalent` — fixture:
    `DROP TABLE "public"."users"` (no `RESTRICT`, no `CASCADE`).
  - `drop_table_preview_cascade_byte_equivalent` — fixture:
    `DROP TABLE "public"."users" CASCADE`.
  - `drop_table_preview_only_does_not_execute` — preview without
    live pool.
  - `drop_table_invalid_table_name_rejected` — embedded space,
    embedded quote, empty post-trim (3 sub-cases).

- **MOD** `src-tauri/src/commands/rdb/ddl.rs` (~+10 / ~-25 LOC):
  rewrite the existing `drop_table` and `rename_table` handlers
  (currently take individual scalar args + delegate to the old trait
  signatures) so they take `request: DropTableRequest` /
  `request: RenameTableRequest` and return `SchemaChangeResult`.
  Mirror the `create_table` / `alter_table` handler shape exactly.
  **Tauri command name stays the same** (`drop_table`, `rename_table`)
  — the IPC payload changes from `{ connectionId, table, schema, ?
  newName }` to `{ request: { ... } }` (matches the rest of the
  `*Request` family).

- **MOD** `src-tauri/src/lib.rs`: no diff required — the handler
  identifiers stay the same; only the function bodies + signatures
  change.

### Frontend (TS/TSX)

- **MOD** `src/types/schema.ts` (~+25 LOC): add `RenameTableRequest`
  + `DropTableRequest` TypeScript types matching the Rust shapes
  (camelCase via serde rename).

- **MOD** `src/lib/tauri/ddl.ts` (~+15 LOC, ~-15 LOC): change
  `dropTable` / `renameTable` IPC wrapper signatures from positional
  scalars to `request: DropTableRequest` / `request: RenameTableRequest`
  (mirror `alterTable` / `createTable`). Return type changes from
  `Promise<void>` to `Promise<SchemaChangeResult>`.

- **NEW** `src/components/schema/RenameTableDialog.tsx` (~150-200 LOC):
  modal that owns form state + delegates preview/execute to
  `useDdlPreviewExecution` (Sprint 214 reuse). Single text input ("New
  table name"), Cancel + Show DDL + Apply buttons, inline DDL preview
  pane (the same `<pre>` rendering pattern that `CreateTableDialog`
  uses for its preview slot). **NO Safe Mode gate**: rename is
  classified low-risk; `useDdlPreviewExecution` already routes through
  Safe Mode internally (`analyzeStatement` on the preview SQL), so the
  gate fires automatically if the rename SQL is judged dangerous —
  that path stays a no-op-equivalent for `ALTER TABLE … RENAME TO`
  but the wiring is uniform with the rest of Phase 24-26.

- **NEW** `src/components/schema/RenameTableDialog.test.tsx`
  (~200-250 LOC, ≥ 8 cases): vitest suite covering form behaviour,
  preview→commit pipeline, Apply disabled when input == current name,
  identifier validation surfaces error inline, commit-success →
  `onRefresh` called once.

- **NEW** `src/components/schema/DropTableDialog.tsx` (~180-260 LOC):
  modal that owns: typing-confirm input ("Type the table name to
  confirm"), CASCADE checkbox (default off), inline DDL preview pane,
  Cancel + Show DDL + Apply buttons. Apply is `disabled` UNTIL the
  typing-confirm input matches the current table name byte-for-byte
  (case-sensitive). Internally dispatches through the Safe Mode gate
  (see Decisions §Drop Safe Mode dispatch) — block path surfaces
  toast + cancels Apply; warn path additionally requires the typing
  confirm; safe path requires only the typing confirm. Reuses
  `useDdlPreviewExecution` for the preview/execute lifecycle.

- **NEW** `src/components/schema/DropTableDialog.test.tsx`
  (~250-300 LOC, ≥ 10 cases): vitest covering typing-confirm
  enable/disable, CASCADE toggle → SQL re-preview, Safe Mode block /
  warn / safe matrix, commit-success → `onRefresh` called once,
  case-sensitive typing match (rejects all-lowercase when table is
  `Users`), preview-stale invalidation when CASCADE toggles.

- **MOD** `src/components/schema/SchemaTree/dialogs.tsx`
  (~+30 LOC, ~-100 LOC): replace the existing `DropTableConfirmDialog`
  + `RenameTableDialog` (the old single-field rename + simple confirm
  drop) with two new mount slots `RenameTableDialogSlot` +
  `DropTableDialogSlot` that wrap the new modals, threading
  `connectionId` + the schema/table name + `onRefresh`. Keep the
  `CreateTableDialogSlot` mount unchanged (Sprint 226 invariant).

- **MOD** `src/components/schema/SchemaTree/useSchemaTreeActions.ts`
  (~+20 LOC, ~-100 LOC): the `confirmDialog` / `renameDialog` /
  `renameInput` / `renameError` / `isOperating` / `renameInputRef`
  state slots collapse into two new slots: `renameTableDialog: {
  schemaName, tableName } | null` and `dropTableDialog: { schemaName,
  tableName } | null`. The 3 handlers `handleDropTable` /
  `handleStartRename` / `handleConfirmRename` collapse into 2 simple
  openers `handleStartRename(table, schema)` and `handleStartDrop(table,
  schema)` — both just set the dialog state. The existing in-handler
  Safe Mode dispatch + history-record + toast paths move INTO the
  modals (which delegate to `useDdlPreviewExecution`'s history/error
  handling). The post-commit refresh is wired through the
  `useSchemaTableMutations` hook (Sprint 223) — the new modals call
  `useSchemaTableMutations.dropTable` / `.renameTable` as their commit
  closure inside `useDdlPreviewExecution`. **Hook signature
  unchanged** (Sprint 223 invariant); the new modals consume the
  existing surface.

- **MOD** `src/components/schema/SchemaTree/rows.tsx`
  (~+0 LOC, ~-0 LOC): the existing `Rename` / `Drop` context menu
  items already exist and call `ctx.handleStartRename` /
  `ctx.handleDropTable` (lines 335-344). Action labels stay the same
  ("Rename" / "Drop") — visual surface is unchanged. The handlers'
  internal behaviour changes (open new modal instead of inline
  confirm/rename-input dialog).

- **MOD** `src/components/schema/SchemaTree.tsx`: replace the
  `<DropTableConfirmDialog>` + `<RenameTableDialog>` mounts with
  `<RenameTableDialogSlot>` + `<DropTableDialogSlot>` (the new
  slot components). Same prop passing pattern as
  `<CreateTableDialogSlot>`.

- **MOD** `src/components/schema/SchemaTree.actions.test.tsx`
  (~+50 LOC, ≥ 4 new cases): assert (1) `Rename` menu item opens
  `RenameTableDialog`, (2) `Drop` menu item opens `DropTableDialog`,
  (3) commit-success on rename → `useSchemaTableMutations.renameTable`
  called once, (4) commit-success on drop → `useSchemaTableMutations.
  dropTable` called once. Existing cases that assert the old
  `confirmDialog` / `renameDialog` shapes need mechanical update to
  the new modal shapes (see Invariants §Test invariants).

- **MOD** `src/stores/schemaStore.ts` — **diff = 0** invariant. The
  store's `dropTable` / `renameTable` actions still proxy through
  `tauri.dropTable` / `tauri.renameTable`, but the IPC wrapper
  signature change (positional → request object) is absorbed
  inside the wrapper itself; the store action's own arg shape stays
  byte-equivalent. The wrapper builds the request object internally
  with `preview_only: false` and discards the returned
  `SchemaChangeResult` for store callers (only the new modals see
  the SQL string). See Decisions §Store wrapper compatibility.

## Out of Scope

The following are explicitly frozen for sprint-235:

- **Column add / drop / rename** — Sprint 236.
- **Column type modify + USING cast** — Sprint 237.
- **Multi-step ALTER TABLE in one tx** (e.g. add column + add
  constraint) — Sprint 237+.
- **Index / constraint rename** — different ALTER family, Phase 25
  polish.
- **View / sequence / function / trigger drop** — Phase 26+.
- **MongoDB collection rename / drop UI** — separate paradigm; the
  existing Sprint 198 `useDocumentDatabaseDrop` flow stays unchanged.
- **DEFERRABLE / INITIALLY DEFERRED FK options** — Phase 27 polish
  later.
- **Sprint 180 cancel-token integration** — flagged in user spec but
  the current `create_table` / `alter_table` / `drop_table` /
  `rename_table` pipeline does NOT integrate cancel-tokens (verified
  in `src-tauri/src/db/postgres/mutations.rs` — no `CancellationToken`
  parameter on any of these). The locked decision (#7) conflicts with
  the current code shape; see **Open questions §3**. Defer to a
  cross-cutting sprint that handles cancel-tokens for the entire DDL
  family at once.
- **Drop preflight: `pg_depend` dependency analysis** — the spec is
  explicit that "no client-side dependency analysis this sprint";
  let PG surface the error verbatim. Future sprint candidate (Sprint
  238?).
- **CASCADE preview enrichment** — showing affected objects in the
  preview pane requires a separate `pg_depend` query; out of scope.
  Inline preview pane shows only the verbatim SQL.

## Invariants (Frozen Files — diff = 0)

The 14 frozen paths from Sprint 234 contract (`docs/sprints/sprint-234/
contract.md` Invariants section) stay frozen — re-listed here for the
Generator's grep-target convenience:

1. `src/components/structure/useDdlPreviewExecution.ts` — Sprint 214
   hook signature + body byte-equivalent (REUSE only).
2. `src/components/structure/SqlPreviewDialog.tsx` — Sprint 214
   invariant.
3. `src/__tests__/cross-window-connection-sync.test.tsx` — diff = 0.
4. `src/__tests__/cross-window-store-sync.test.tsx` — diff = 0.
5. `src/__tests__/window-lifecycle.ac141.test.tsx` — diff = 0.
6. `src/stores/connectionStore.ts` — diff = 0.
7. `src/stores/schemaStore.ts` — **diff = 0** (the store's `dropTable`
   / `renameTable` action signatures stay byte-equivalent; the new
   request-object IPC payload is built inside the `src/lib/tauri/
   ddl.ts` wrapper, so the store sees no change. See Decisions §Store
   wrapper compatibility).
8. `src/stores/safeModeStore.ts` — diff = 0.
9. `src/lib/safeMode.ts` — diff = 0 (decideSafeModeAction matrix
   unchanged — Sprint 231 contract).
10. `src/lib/sql/sqlSafety.ts` — diff = 0.
11. `src/hooks/useFkReferencePicker.ts` — Sprint 229 invariant.
12. `src/lib/sql/postgresTypes.ts` — Sprint 230 invariant.
13. `src/components/shared/SqlSyntax.tsx` — Sprint 233 invariant.
14. `src/lib/sql/sqlTokenize.ts` — Sprint 233 invariant.

Plus Sprint 226-234 CREATE TABLE byte-equivalent invariants:
- `src-tauri/src/db/postgres/mutations.rs::create_table` SQL emission
  byte-equivalent (all 22 `cargo test --lib create_table` fixtures
  pass UNMODIFIED).
- `src/components/schema/CreateTableDialog.tsx` — diff = 0.
- `src/components/schema/CreateTableDialog/Header.tsx` — diff = 0.
- All Sprint 226-234 vitest cases on `CreateTableDialog.test.tsx`
  pass.

Plus Sprint 223 invariant:
- `src/hooks/useSchemaTableMutations.ts` hook signature unchanged —
  `dropTable: (connectionId, table, schema) => Promise<void>` and
  `renameTable: (connectionId, table, schema, newName) => Promise<
  void>`. The new dialogs consume this surface; the hook is NOT
  expanded with new methods. (Verified in
  `src/hooks/useSchemaTableMutations.ts:33-45`.)

Plus Sprint 231 invariant:
- `useSafeModeGate(connectionId)` signature + `decideSafeModeAction`
  matrix unchanged. Verified in `src/hooks/useSafeModeGate.ts:18-32`
  + `src/lib/safeMode.ts`.

### Test invariants

- All Sprint 226-234 vitest cases pass with at most mechanical query
  selector adaptation in `SchemaTree.actions.test.tsx` (the existing
  `confirmDialog` / `renameDialog` slot tests need to be rewritten
  to use the new modal slot shapes — this is the only allowed
  sibling-test diff).
- All Sprint 226-234 cargo `create_table` byte-string fixtures pass
  UNCHANGED.
- Existing `cargo test --lib drop_table` / `cargo test --lib
  rename_table` cases (lines 705-790 in `mutations.rs`) need mechanical
  update because the function signatures change (positional →
  request); these are NOT frozen — the Generator MUST rewrite them
  to match the new request-object shape, preserving the original
  test intent (rejection of empty / whitespace-only / invalid-char
  / leading-digit names).
- No `it.skip`, `eslint-disable`, `any`, silent `catch{}`, `unwrap()`
  in production paths.

## Acceptance Criteria

- `AC-235-01` Backend `rename_table` Tauri command accepts
  `RenameTableRequest { connection_id, schema, table, new_name,
  preview_only }`. When `preview_only=true` returns
  `SchemaChangeResult { sql }` without DB write; when
  `preview_only=false` executes inside a `BEGIN/COMMIT` transaction
  and returns the SQL it ran. Identifier inputs validated by the
  shared `validate_identifier` helper (the same one `create_table` /
  `alter_table` use); failures return `AppError::Validation` and
  surface verbatim in `previewError`.
  **Testable:** Rust unit fixture `rename_table_preview_byte_equivalent`
  asserts SQL is byte-equivalent to `ALTER TABLE "public"."users"
  RENAME TO "people"`; `rename_table_invalid_new_name_rejected`
  asserts 4 invalid-name cases (embedded space / embedded quote /
  length > 63 / leading digit) all return `AppError::Validation`;
  `rename_table_preview_only_does_not_execute` asserts preview branch
  returns SQL even when no live pool exists.

- `AC-235-02` Backend `drop_table` Tauri command accepts
  `DropTableRequest { connection_id, schema, table, cascade,
  preview_only }`. Generated SQL is `DROP TABLE "<schema>"."<table>"`
  when `cascade=false` (no `RESTRICT` keyword — PG default is RESTRICT
  and byte-equivalence with the implicit form is required), and
  `DROP TABLE "<schema>"."<table>" CASCADE` when `cascade=true`. The
  preflight `information_schema.tables` existence check (currently in
  the legacy `drop_table` body) is REMOVED — let PG surface the error
  verbatim, mirroring `create_table`'s "no client-side dependency
  analysis" stance.
  **Testable:** Rust unit fixtures `drop_table_preview_no_cascade_byte_
  equivalent` (SQL = `DROP TABLE "public"."users"`) and
  `drop_table_preview_cascade_byte_equivalent` (SQL =
  `DROP TABLE "public"."users" CASCADE`) assert byte-equivalence;
  `drop_table_invalid_table_name_rejected` asserts 3 invalid-name
  cases.

- `AC-235-03` Frontend exposes `tauri.renameTable(request)` and
  `tauri.dropTable(request)` in `src/lib/tauri/ddl.ts`, both
  returning `Promise<SchemaChangeResult>`. The IPC payload uses
  the `{ request: { ... } }` envelope (matches `alterTable` /
  `createTable`). The store's `schemaStore.dropTable` /
  `schemaStore.renameTable` actions retain their existing signatures
  (positional scalars) — the IPC wrapper builds the request object
  with `preview_only: false` internally and discards the returned
  SQL.
  **Testable:** vitest mocks `tauri.renameTable` and asserts call
  shape `{ request: { connectionId, schema, table, newName,
  preview_only: <bool> } }`; the new modal sends preview-then-commit
  exactly `[{ preview_only: true }, { preview_only: false }]`.

- `AC-235-04` `RenameTableDialog` (new component) opens with the
  current table name pre-filled in a single text input. Apply button
  is `disabled` when (a) input is empty / whitespace-only, (b) input
  fails the identifier regex (`^[a-zA-Z_][a-zA-Z0-9_]*$`, length ≤ 63
  bytes), or (c) input equals the current table name byte-for-byte
  (rename-to-self pre-check on the client). On Apply, the dialog runs
  preview-then-commit through `useDdlPreviewExecution`. On commit
  success, calls `onRefresh()` + closes; on commit failure, the error
  surfaces in `previewError` and the modal stays open.
  **Testable:** vitest covers — opens with current name in input,
  Apply disabled at name == current; Apply disabled when input has
  embedded space; Apply disabled when input is `>63` bytes long;
  identifier validation message surfaces inline; commit-success
  closes modal + calls `onRefresh` once.

- `AC-235-05` `DropTableDialog` (new component) renders: a typing-
  confirm input ("Type the table name to confirm"), a CASCADE
  checkbox (default unchecked → emits `DROP TABLE "..."` with no
  `CASCADE`; checked → emits `DROP TABLE "..." CASCADE`), an inline
  DDL preview pane, Cancel + Show DDL + Apply buttons. Apply is
  `disabled` UNTIL typing-confirm input matches the table name
  byte-for-byte (case-sensitive — `Users` ≠ `users`). Toggling the
  CASCADE checkbox calls `invalidatePreview()` so the preview pane
  re-fetches with the new SQL on next "Show DDL" click.
  **Testable:** vitest covers — Apply disabled before typing match;
  case mismatch (`Users` table, user types `users`) keeps Apply
  disabled; CASCADE toggle invalidates preview; CASCADE checked
  emits `... CASCADE` in preview SQL; commit success closes modal
  + calls `onRefresh` once.

- `AC-235-06` Drop dispatches through the Safe Mode gate (`useSafeMode
  Gate(connectionId).decide(analyzeStatement(previewSql))`). Strict-
  block path surfaces the canonical Safe Mode block message and
  prevents commit. Warn-confirm path requires BOTH the typing match
  AND `useDdlPreviewExecution`'s `pendingConfirm` flow (the
  `ConfirmDangerousDialog` mounts; user types the analyzer reason;
  warn-cancel surfaces the canonical `"Safe Mode (warn): confirmation
  cancelled — no changes committed"` message in `previewError`). Safe
  path requires only the typing confirm.
  **Testable:** vitest fixture sets connection environment =
  `production` + Safe Mode = `strict` → asserts canonical block
  message + commit closure NEVER invoked; environment = `production`
  + Safe Mode = `warn` + warn-cancel → asserts canonical warn-cancel
  message verbatim in `previewError`; environment = `local` + Safe
  Mode = `safe` → asserts commit closure invoked exactly once.

- `AC-235-07` SchemaTree wiring: `Rename` context-menu item on a
  table row opens `RenameTableDialog` pre-filled with the current
  table name. `Drop` context-menu item opens `DropTableDialog` with
  the table name. Both modals close on commit-success and trigger
  `useSchemaTableMutations.renameTable` / `.dropTable` (Sprint 223
  hook reuse — hook signature unchanged) which in turn invalidates
  the `listTables(connectionId, schema)` cache and falls back to
  optimistic patching on listTables failure.
  **Testable:** `SchemaTree.actions.test.tsx` opens the menu, asserts
  `Rename` item exists + click → `RenameTableDialog` opens; asserts
  `Drop` item exists + click → `DropTableDialog` opens; commit-
  success on each → `useSchemaTableMutations.{renameTable,dropTable}`
  invoked exactly once.

- `AC-235-08` Schema tree refresh after success — selected table no
  longer exists after drop → `selectedNodeId` clears gracefully (no
  throw); after rename → `selectedNodeId` updates to the new name
  (or clears if the schemaStore's identity tracking can't follow).
  The `useSchemaTableMutations` hook's existing optimistic-patch
  path (Sprint 223) covers the cache update; this AC adds the
  selection cleanup on top.
  **Testable:** vitest renders `SchemaTree` with a selected table,
  drops it, asserts `selectedNodeId === null` after the commit
  resolves. Rename case: asserts `selectedNodeId` either updates to
  the new name or clears — both pass; the assertion is "does not
  throw + does not stay stale".

- `AC-235-09` Identifier validation rejects (verified in BOTH backend
  and frontend layers): empty / whitespace-only, embedded `"`,
  embedded NULL byte (`\0`), length > 63 bytes (PG identifier limit),
  leading digit. Single-quote in identifiers is NOT escaped (PG
  identifiers use `"` doubling, not `'` doubling) — the validator
  rejects single-quote in table names rather than allowing it through;
  the test fixture locks this rejection.
  **Testable:** Rust unit `validate_identifier_rejects_*` already
  covers most of these; new fixtures lock the 63-byte boundary and
  the embedded-NULL-byte case for both `rename_table` and
  `drop_table`. Frontend vitest asserts the same on the
  `RenameTableDialog` input.

- `AC-235-10` 4-set verification PASS (per `docs/PLAN.md:182-186`):
  `pnpm vitest run` exit 0, `pnpm tsc --noEmit` exit 0, `pnpm lint`
  exit 0, `cargo build --manifest-path src-tauri/Cargo.toml` exit 0,
  `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
  --all-features -- -D warnings` exit 0. Vitest count ≥ 2872 (Sprint
  234 baseline); cargo `--lib` count ≥ 385 (Sprint 234 baseline).

- `AC-235-11` Sprint 226-234 byte-equivalent fixtures pass UNMODIFIED.
  Frozen file diff = 0 (per the Invariants list). The 22-fixture
  `cargo test --lib create_table` suite passes byte-equivalent.

## Design Bar / Quality Bar

- **Narrow extraction** — reuse `useDdlPreviewExecution` (Sprint 214)
  + `useSafeModeGate` (Sprint 189) + `useSchemaTableMutations`
  (Sprint 223) as-is. No anticipatory abstraction. Do **not** extract
  a shared "Drop confirmation" or "single-input rename modal" base —
  wait until Sprint 236+ adds Column drop / rename to see the actual
  shape (per the Sprint 226 "wait until 3+ Create-* modals" rule).
- **Pattern source** — Sprint 226 `CreateTableDialog` for modal shape;
  `useDdlPreviewExecution` for preview/execute lifecycle; Sprint 198
  `useDocumentDatabaseDrop` for Safe Mode gate dispatch (NOT for the
  typing-confirm — see Decisions §Typing-confirm pattern is new).
- **Visual consistency** — both new modals use the existing shadcn
  `<Dialog>` primitive, the existing `<input>` styling from the
  current `RenameTableDialog`, and the inline preview pane styling
  from `CreateTableDialog`. No new visual primitives, no new shadcn
  components.
- **Identifier validation** — share the `validate_identifier` helper
  (Rust) and a single TS regex constant (extracted to
  `src/lib/sql/identifier.ts` if not already present). Do not
  duplicate inline.
- **SQL emission determinism** — every byte-string fixture must be
  byte-equivalent to a string literal in the test. No `.contains()`
  partial matches.
- **Modal-local state only** — no Zustand store added; `useState` for
  form fields, `useDdlPreviewExecution` owns preview SQL / loading /
  error / pendingConfirm.
- **TDD evidence** — capture `red-state.log` (or commit ordering with
  red-state commit message) in `docs/sprints/sprint-235/tdd-evidence/
  red-state.log` per `docs/PLAN.md:182-186`.

## Decisions

### Typing-confirm pattern is NEW in Sprint 235

The user's locked decision frames the Drop typing-confirm as
"mirror Mongo `drop_collection` pattern from Sprint 198", but
inspection of `src/components/schema/DocumentDatabaseTree/
useDocumentDatabaseDrop.ts:43-80` shows the Mongo flow uses a
**regular confirmation dialog** (Cancel + Drop button), NOT a typing-
confirm. There is currently NO typing-confirm component or pattern
in the codebase. Sprint 235 introduces it fresh — the Generator
should NOT search for an existing implementation. Implementation
constraints:
- Single text `<input>` labeled "Type the table name to confirm".
- Apply button `disabled` until the input value === current table
  name (byte-for-byte string equality, case-sensitive).
- No `onChange` debounce — every keystroke re-evaluates the match.
- Empty input → button stays disabled (covered by the equality check).
- Whitespace handling: input is NOT trimmed before comparison — the
  user must type the exact name without leading/trailing whitespace
  (defense against accidental whitespace-only matches).

### Drop Safe Mode dispatch — gate fires before typing confirm

The user's locked decision (#5) says "production environment +
dangerous → typing confirm + Safe Mode confirm". Two interpretations:

- **(A) Typing confirm always required, Safe Mode layered on top**
  (chosen). The typing-confirm protects against fat-finger / wrong-
  table errors regardless of environment. Safe Mode adds an
  ADDITIONAL gate when the analyzer flags the SQL as dangerous. So
  the full sequence is: user types name → Apply enables → click
  Apply → preview SQL fetched → Safe Mode gate decides → block /
  warn / safe → on warn, `pendingConfirm` modal mounts → user types
  the analyzer reason → commit runs.
- **(B) Safe Mode strict-block bypasses typing confirm** (rejected).
  Would mean the typing confirm never runs for prod-strict —
  inconsistent UX. Chosen path: typing confirm is ALWAYS required
  for Drop (it's about "did you pick the right table"), Safe Mode
  is layered on top (it's about "is this connection safe to mutate").

### Rename-to-self handling — frontend disable + backend permissive

Locked decision (verification edge case #3): backend always emits
the SQL; frontend disables Apply when `input === current name`.
This way:
- Direct IPC callers (CLI tools, future automation) get PG's
  verbose error verbatim if they request a rename-to-self.
- The modal's Apply stays disabled to save the user the pointless
  round-trip, but the disable is purely UX — no backend pre-check.

### Drop pre-existence check REMOVED

The current `drop_table` body (lines 102-117 in `mutations.rs`)
runs a `SELECT FROM information_schema.tables` pre-check and
returns `AppError::NotFound` if the table is missing. This is
removed in Sprint 235 to match `create_table`'s "no client-side
dependency analysis" stance — let PG surface its native
`relation "X" does not exist` error verbatim. Net behavioural
change: the error type for "drop a non-existent table" flips from
`AppError::NotFound` to `AppError::Database`. Test fixtures that
asserted `NotFound` need mechanical update.

### Store wrapper compatibility — diff = 0 on schemaStore

The IPC wrapper change (positional → request) is absorbed inside
`src/lib/tauri/ddl.ts`. The wrapper exports BOTH the old positional
signature (used by `schemaStore.dropTable` / `.renameTable`) and a
new `dropTablePreview` / `renameTablePreview` that takes the request
object directly — so the modals consume the new shape and the store
sees no change. Concretely:

```ts
// New: takes request object with preview_only, returns SchemaChangeResult.
export async function dropTableRequest(
  request: DropTableRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("drop_table", { request });
}

// Compat: the old positional shape, builds request internally,
// discards the returned SQL.
export async function dropTable(
  connectionId: string,
  table: string,
  schema: string,
): Promise<void> {
  await dropTableRequest({
    connectionId, schema, table,
    cascade: false,
    previewOnly: false,
  });
}
```
Same dual export for `renameTable` / `renameTableRequest`. The
backend `#[tauri::command] drop_table` / `rename_table` handlers
take `request: DropTableRequest` / `RenameTableRequest` (single
request-object payload) — both wrapper variants funnel into the
same handler. This means **the IPC payload SHAPE changes**, but
the store's call shape does not.

### CASCADE checkbox default — off (RESTRICT implicit)

PG's default behaviour for `DROP TABLE` without keyword is
RESTRICT (blocks the drop if any FK references exist). The
checkbox defaults to OFF so the user opts INTO the more dangerous
CASCADE explicitly. The emitted SQL omits the `RESTRICT` keyword
(byte-equivalent to PG's implicit form) — locked by fixture.

## Verification Plan

Profile: `mixed` (browser visual smoke + command-line cargo / vitest /
tsc / lint / build).

### Required Checks (command line)

| # | Check | Command | Expected |
| --- | --- | --- | --- |
| 1 | vitest full | `pnpm vitest run` | 0 failed; ≥ 2872 + ≥ 22 new = ≥ 2894 tests |
| 2 | tsc | `pnpm tsc --noEmit` | exit 0, silent |
| 3 | lint | `pnpm lint` | exit 0, silent |
| 4 | cargo build | `cargo build --manifest-path src-tauri/Cargo.toml` | Finished |
| 5 | cargo clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | 0 warnings |
| 6 | cargo test rename_table | `cargo test --manifest-path src-tauri/Cargo.toml --lib rename_table` | PASS — ≥ 4 new fixtures + existing-test rewrites |
| 7 | cargo test drop_table | `cargo test --manifest-path src-tauri/Cargo.toml --lib drop_table` | PASS — ≥ 4 new fixtures + existing-test rewrites |
| 8 | cargo test create_table — REGRESSION | `cargo test --manifest-path src-tauri/Cargo.toml --lib create_table` | PASS — Sprint 226-234 22-fixture suite byte-equivalent |
| 9 | cargo test create_index | `cargo test --manifest-path src-tauri/Cargo.toml --lib create_index` | PASS unchanged |
| 10 | cargo test add_constraint | `cargo test --manifest-path src-tauri/Cargo.toml --lib add_constraint` | PASS unchanged |
| 11 | cargo test alter_table | `cargo test --manifest-path src-tauri/Cargo.toml --lib alter_table` | PASS unchanged |
| 12 | cargo test --lib total | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | ≥ 385 + new fixtures |
| 13 | vitest — RenameTableDialog | `pnpm vitest run src/components/schema/RenameTableDialog.test.tsx` | ≥ 8 cases PASS |
| 14 | vitest — DropTableDialog | `pnpm vitest run src/components/schema/DropTableDialog.test.tsx` | ≥ 10 cases PASS |
| 15 | vitest — SchemaTree.actions | `pnpm vitest run src/components/schema/SchemaTree.actions.test.tsx` | PASS — 4 new cases + existing cases mechanically updated |
| 16 | vitest — useSchemaTableMutations | `pnpm vitest run src/hooks/useSchemaTableMutations.test.ts` | PASS unchanged |
| 17 | vitest — CreateTableDialog REGRESSION | `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx` | PASS unchanged |
| 18 | vitest — AC-235 named filter | `pnpm vitest run -t "AC-235"` | all PASS |
| 19 | frozen — useDdlPreviewExecution | `git diff --stat src/components/structure/useDdlPreviewExecution.ts` | 0 |
| 20 | frozen — SqlPreviewDialog | `git diff --stat src/components/structure/SqlPreviewDialog.tsx` | 0 |
| 21 | frozen — useSafeModeGate | `git diff --stat src/hooks/useSafeModeGate.ts` | 0 |
| 22 | frozen — safeMode + sqlSafety | `git diff --stat src/lib/safeMode.ts src/lib/sql/sqlSafety.ts` | 0 |
| 23 | frozen — schemaStore | `git diff --stat src/stores/schemaStore.ts` | 0 |
| 24 | frozen — connectionStore | `git diff --stat src/stores/connectionStore.ts` | 0 |
| 25 | frozen — safeModeStore | `git diff --stat src/stores/safeModeStore.ts` | 0 |
| 26 | frozen — useSchemaTableMutations | `git diff --stat src/hooks/useSchemaTableMutations.ts` | 0 (Sprint 223 hook signature invariant) |
| 27 | frozen — CreateTableDialog | `git diff --stat src/components/schema/CreateTableDialog.tsx src/components/schema/CreateTableDialog/Header.tsx` | 0 |
| 28 | frozen — cross-window tests | `git diff --stat src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/cross-window-store-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` | 0 each |
| 29 | grep — DROP TABLE emit | `grep -nE 'DROP TABLE' src-tauri/src/db/postgres/mutations.rs` | ≥ 2 (no-CASCADE + CASCADE branches) |
| 30 | grep — RENAME TO emit | `grep -nE 'RENAME TO' src-tauri/src/db/postgres/mutations.rs` | ≥ 1 |
| 31 | grep — request types | `grep -nE 'RenameTableRequest\|DropTableRequest' src-tauri/src/models/schema.rs` | ≥ 4 (struct decl + roundtrip test) |
| 32 | grep — IPC wrapper | `grep -nE 'dropTableRequest\|renameTableRequest' src/lib/tauri/ddl.ts` | ≥ 2 |
| 33 | grep — typing-confirm | `grep -nE 'Type the table name' src/components/schema/DropTableDialog.tsx` | ≥ 1 |
| 34 | grep — CASCADE checkbox | `grep -nE 'CASCADE' src/components/schema/DropTableDialog.tsx` | ≥ 1 |
| 35 | grep — Mongo path untouched | `git diff --stat src/components/schema/DocumentDatabaseTree/useDocumentDatabaseDrop.ts src/lib/tauri/document.ts src/lib/mongo/mongoSafety.ts` | 0 each |
| 36 | grep — no skipped tests | `grep -rnE 'it\.only\|it\.skip\|describe\.skip\|xit\|it\.todo' src/components/schema/RenameTableDialog.test.tsx src/components/schema/DropTableDialog.test.tsx src/components/schema/SchemaTree.actions.test.tsx` | 0 |
| 37 | grep — no eslint-disable | `git diff src/ src-tauri/ \| grep "^+.*eslint-disable"` | 0 |
| 38 | grep — no `any` | `git diff src/ \| grep -E "^\+.*\bany\b"` | 0 |
| 39 | grep — no silent catch | `grep -rnE '\}\s*catch\s*\{\s*\}' src/components/schema/RenameTableDialog.tsx src/components/schema/DropTableDialog.tsx` | 0 |
| 40 | grep — DDL history source | `grep -nE '"ddl-structure"' src/components/schema/RenameTableDialog.tsx src/components/schema/DropTableDialog.tsx` | ≥ 2 (one per dialog, OR consumed via `useDdlPreviewExecution` and asserted in test) |

### Browser visual smoke (manual, recommended — record in `docs/sprints/sprint-235/findings.md`)

1. `pnpm tauri dev` → connect to PG → expand a schema → right-click a
   table → `Rename` → modal opens with current name pre-filled →
   change name → click `Show DDL` → preview pane shows `ALTER TABLE
   "schema"."old" RENAME TO "new"` → click `Apply` → modal closes →
   tree refreshes → table now shows the new name.
2. Same flow for `Drop` → modal opens → CASCADE unchecked → typing-
   confirm input → type table name → `Show DDL` shows `DROP TABLE
   "schema"."table"` (no CASCADE) → `Apply` → modal closes → table
   removed from tree.
3. Drop with CASCADE → check the checkbox → preview pane re-fetches
   → SQL now shows `... CASCADE`.
4. Drop a referenced table without CASCADE → PG error surfaces in
   `previewError` → modal stays open.
5. Type-confirm mismatch (`Users` table, type `users`) → Apply stays
   disabled.

### Required Evidence

- Generator must provide:
  - changed files with purpose + LOC delta.
  - check 1-40 results (exit code + key output).
  - AC-235-01..AC-235-11 each cited with concrete test/fixture
    evidence (test file:line, fixture string for byte-equivalent
    SQL, IPC sequence trace).
  - byte-equivalent SQL strings (verbatim) for each of the 4 new
    fixtures: `rename_table_preview`, `drop_table_preview_no_cascade`,
    `drop_table_preview_cascade`, plus a 4th of the Generator's
    choice.
  - confirmation that `useDdlPreviewExecution` /
    `useSafeModeGate` / `useSchemaTableMutations` were reused
    without diff.
  - confirmation that Mongo path untouched (check 35).
  - browser visual smoke (1-5 above) — record in `findings.md` if
    performed (recommended but not blocking).
- Evaluator must cite:
  - per-AC pass/fail with concrete evidence (test file:line, fixture
    string match, grep output).
  - missing or weak evidence as P1/P2 findings.
  - regression freeze verification (Sprint 226-234 fixtures all
    pass byte-equivalent).
  - Sprint 223 hook signature invariant (check 26 = 0 diff).

## Test Requirements

### Unit Tests (필수)

- **AC-235-01**: Rust unit fixtures in `mutations.rs#[cfg(test)]` —
  `rename_table_preview_byte_equivalent`,
  `rename_table_invalid_new_name_rejected` (4 sub-cases),
  `rename_table_preview_only_does_not_execute`,
  `rename_table_same_name_emits_sql`. ≥ 4 cases.
- **AC-235-02**: Rust unit fixtures —
  `drop_table_preview_no_cascade_byte_equivalent`,
  `drop_table_preview_cascade_byte_equivalent`,
  `drop_table_preview_only_does_not_execute`,
  `drop_table_invalid_table_name_rejected` (3 sub-cases). ≥ 4 cases.
- **AC-235-03**: vitest on `RenameTableDialog.test.tsx` +
  `DropTableDialog.test.tsx` — assert IPC payload shape `{ request:
  { connectionId, schema, table, ?newName, ?cascade, preview_only } }`
  and call sequence `[{ preview_only: true }, { preview_only: false }]`.
- **AC-235-04**: vitest on `RenameTableDialog.test.tsx` — Apply
  disabled when input == current name; identifier validation surfaces
  inline; commit-success closes + calls onRefresh once. ≥ 5 cases.
- **AC-235-05**: vitest on `DropTableDialog.test.tsx` — typing-confirm
  case-sensitive match; CASCADE toggle invalidates preview; CASCADE
  emits in SQL; Apply disabled before match. ≥ 5 cases.
- **AC-235-06**: vitest on `DropTableDialog.test.tsx` — Safe Mode
  block / warn-cancel / warn-confirm / safe path matrix. ≥ 4 cases.
- **AC-235-07**: vitest on `SchemaTree.actions.test.tsx` — Rename
  menu opens RenameTableDialog; Drop menu opens DropTableDialog;
  commit-success → useSchemaTableMutations invoked. ≥ 4 cases.
- **AC-235-08**: vitest on `SchemaTree.actions.test.tsx` (or new
  test) — selectedNodeId clears on drop success; updates / clears
  on rename success. ≥ 2 cases.
- **AC-235-09**: vitest + Rust covering identifier rejection edge
  cases (length > 63, embedded NULL byte, leading digit, embedded
  quote). ≥ 4 cases each layer.
- **AC-235-10**: 4-set verification commands all PASS (verified by
  checks 1-5).
- **AC-235-11**: Sprint 226-234 fixtures byte-equivalent (verified
  by checks 8-11).

### Coverage Target

- 신규 `src/components/schema/RenameTableDialog.tsx`: 라인 ≥ 70%.
- 신규 `src/components/schema/DropTableDialog.tsx`: 라인 ≥ 70%.
- 신규 `src-tauri/src/db/postgres/mutations.rs::rename_table /
  ::drop_table` 함수: 브랜치 ≥ 70% (preview / execute / validation-
  fail / cascade-on / cascade-off).
- CI baseline: 라인 40% / 함수 40% / 브랜치 35%.

### Scenario Tests (필수)

- [x] **Happy path** — preview→commit with safe SQL → success →
  `onRefresh` + history entry + modal close.
- [x] **빈/누락 입력** — empty new name rejected (frontend disables
  Apply + backend defends with `AppError::Validation`); empty
  typing-confirm keeps Apply disabled.
- [x] **에러 복구** — Safe Mode warn-cancel surfaces canonical
  message + form stays editable; backend `AppError::Database` (table
  doesn't exist after concurrent drop) surfaces in preview dialog
  error slot + modal stays open.
- [x] **동시성/경쟁** — schema dropped between Preview and Execute →
  PG error verbatim; user clicks `Show DDL` twice → second preview
  overwrites first (Sprint 214 contract); user closes modal mid-
  flight → `cancelPreview` discards commit closure.
- [x] **상태 전이** — idle → preview-loading → preview-shown →
  safe-mode-decide → (safe → typing-confirm-required → commit-loading
  → success) | (warn → confirm-mounted → committed) | (block →
  previewError set).
- [x] **에지 케이스** — rename to same name (Apply disabled);
  identifier with embedded space (rejected); identifier > 63 bytes
  (rejected); identifier with embedded NULL byte (rejected); CASCADE
  toggle from off→on→off; typing-confirm `Users` vs `users`
  (case mismatch — Apply stays disabled).
- [x] **기존 기능 회귀 없음** — Sprint 226-234
  `CreateTableDialog.test.tsx` + cargo `create_table` fixtures all
  pass byte-equivalent.

## Test Script / Repro Script

1. baseline (before any change):
   ```sh
   pnpm vitest run
   pnpm vitest run src/components/schema/CreateTableDialog.test.tsx
   pnpm vitest run src/components/schema/SchemaTree.actions.test.tsx
   pnpm vitest run src/hooks/useSchemaTableMutations.test.ts
   cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run
   ```
2. Generator 작업 후 — primary command profile:
   ```sh
   pnpm vitest run src/components/schema/RenameTableDialog.test.tsx
   pnpm vitest run src/components/schema/DropTableDialog.test.tsx
   pnpm vitest run src/components/schema/SchemaTree.actions.test.tsx
   cargo test --manifest-path src-tauri/Cargo.toml --lib rename_table
   cargo test --manifest-path src-tauri/Cargo.toml --lib drop_table
   cargo test --manifest-path src-tauri/Cargo.toml --lib create_table
   pnpm vitest run src/components/schema/CreateTableDialog.test.tsx
   ```
3. 4-set verification:
   ```sh
   pnpm vitest run
   pnpm tsc --noEmit
   pnpm lint
   cargo build --manifest-path src-tauri/Cargo.toml
   cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
   ```
4. Surface + freeze 검증:
   ```sh
   git diff --stat src/components/structure/useDdlPreviewExecution.ts src/components/structure/SqlPreviewDialog.tsx
   git diff --stat src/stores/schemaStore.ts src/stores/connectionStore.ts src/stores/safeModeStore.ts
   git diff --stat src/hooks/useSafeModeGate.ts src/hooks/useSchemaTableMutations.ts
   git diff --stat src/lib/safeMode.ts src/lib/sql/sqlSafety.ts
   git diff --stat src/components/schema/CreateTableDialog.tsx src/components/schema/CreateTableDialog/Header.tsx
   git diff --stat src/components/schema/DocumentDatabaseTree/useDocumentDatabaseDrop.ts
   git diff src/ src-tauri/ | grep "^+.*eslint-disable"
   grep -rnE 'it\.only|it\.skip|describe\.skip|xit|it\.todo' src/components/schema/RenameTableDialog.test.tsx src/components/schema/DropTableDialog.test.tsx
   grep -nE 'DROP TABLE|RENAME TO' src-tauri/src/db/postgres/mutations.rs
   ```
5. Optional manual UI smoke (record in `docs/sprints/sprint-235/
   findings.md` if performed) — see "Browser visual smoke" above.

## Open questions

The Generator should resolve these before/during implementation; if
the resolution diverges from the assumption baked into this contract,
flag it in `findings.md`.

1. **Trait migration path for `RdbAdapter::drop_table` /
   `::rename_table`** — the existing trait signatures take positional
   scalars and return `Result<(), AppError>`. The user's locked
   decisions require a `preview_only` branch + `SchemaChangeResult`,
   so the trait MUST change. PG is currently the only `RdbAdapter`
   impl in tree (verified 2026-05-07; Phase 17-20 MySQL/SQLite/Oracle
   still on `DbAdapter` only). The migration is therefore one-impl
   only; no other adapter cascading. Generator confirms by grepping
   `impl RdbAdapter for` after the change → only PG matches.

2. **Typing-confirm pattern is NEW, not a Sprint 198 mirror** — see
   Decisions §Typing-confirm pattern is new. The user's spec says
   "mirror Mongo `drop_collection` pattern from Sprint 198", but the
   actual Sprint 198 impl uses a regular confirm dialog. The Generator
   should NOT search for an existing typing-confirm component — there
   isn't one. Implement fresh per the constraints in the Decisions
   section. If the Generator finds a hidden prior implementation
   (e.g. inside a feature flag), document it and align.

3. **Sprint 180 cancel-token integration deferred** — the user's
   locked decision (#7) says "both commands accept the token registry
   path (mirror `create_table`)". Verification of `create_table` /
   `alter_table` shows NEITHER currently integrates Sprint 180
   cancel-tokens (no `CancellationToken` parameter on either). The
   "mirror `create_table`" path is therefore zero-LOC. If the
   Generator interprets the locked decision as "add cancel-token
   integration to all four DDL commands now" instead, that would
   expand the sprint scope materially — flag it and confirm with
   the user before proceeding. Default assumption: defer cancel-
   tokens to a future cross-cutting sprint that handles all DDL
   commands at once.

4. **Drop pre-existence check removal — error type change** — the
   current `drop_table(table, schema)` body returns `AppError::
   NotFound` when the table is missing. Removing the pre-check (per
   `create_table`'s "let PG error surface verbatim" stance) flips
   the error type to `AppError::Database`. Existing callers of
   `tauri.dropTable` in tests / production code may have asserted
   the old error message text. Generator must grep for `Failed to
   drop` / `Table .* not found` / `NotFound` in test files and
   update mechanically. If a non-test caller depends on the old
   error type, flag it and reconsider keeping the pre-check.

5. **`schemaStore.dropTable` / `.renameTable` invariant — 0 diff
   feasible?** — the IPC wrapper signature change is absorbed inside
   `src/lib/tauri/ddl.ts` via dual exports (positional + request).
   Verify by running `git diff --stat src/stores/schemaStore.ts`
   after the change → must be 0. If the Generator finds the store
   has additional coupling to the IPC return type that breaks under
   the dual-export approach, flag and propose a 1-line alternative
   (e.g. add a thin shim function inside the store that calls the
   request variant + returns `void`).

## Ownership

- Generator: general-purpose agent (Phase 3, harness skill).
- Write scope: backend (`models/schema.rs` + new `RenameTableRequest`
  / `DropTableRequest` + `db/traits.rs` trait signature changes +
  `db/postgres/mutations.rs` body rewrites + `commands/rdb/ddl.rs`
  handler rewrites) + frontend types (`src/types/schema.ts`) + IPC
  wrappers (`src/lib/tauri/ddl.ts` dual exports) + 2 new modals
  (`RenameTableDialog.{tsx,test.tsx}` + `DropTableDialog.{tsx,test.
  tsx}`) + SchemaTree wiring (`useSchemaTreeActions.ts` slot collapse
  + `dialogs.tsx` slot replacement + `SchemaTree.tsx` mount swap +
  `SchemaTree.actions.test.tsx` extension).
- 변경 금지: `useDdlPreviewExecution.ts` / `SqlPreviewDialog.tsx` /
  `useSafeModeGate.ts` / `useSchemaTableMutations.ts` / `safeMode.ts`
  / `sqlSafety.ts` / `safeModeStore.ts` / `connectionStore.ts` /
  `schemaStore.ts` / `CreateTableDialog*` / Mongo paths / cross-
  window regression tests / `useFkReferencePicker.ts` / `postgres
  Types.ts` / `SqlSyntax.tsx` / `sqlTokenize.ts` / `main.tsx`.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- Required checks passing: `yes` (1-40 모두).
- Acceptance criteria evidence linked in `handoff.md` —
  AC-235-01..AC-235-11 each cited with concrete test/fixture
  evidence.
- 본 sprint 후 Phase 27 sprint 10 종료 — Sprint 236 (Column add /
  drop) unblocked.
- TDD evidence (`red-state.log` 또는 red-state commit) recorded in
  `docs/sprints/sprint-235/tdd-evidence/`.
- e2e closure dependency: **none**. `lefthook.yml:5_e2e` stays
  disabled. Phase 27 e2e smoke deferred under
  `[DEFERRED-PHASE-27-E2E]` marker.
