# Feature Spec: Create Table UI (Phase 27 — Sprint 1)

## Description

Adds the missing CREATE TABLE surface to close the Phase 27 (Table / Column DDL) parity gap. Today users can drop, rename, and alter columns of existing tables, but they cannot create a new table from the GUI — a fundamental gap for a TablePlus-equivalent. This sprint introduces a single `create_table` DDL command + a "+ Table" entry-point in `SchemaTree` + a "Create Table" modal that reuses the existing column-row builder, Preview SQL dialog, and Safe Mode gate.

## Sprint Breakdown

### Sprint 226: Create Table — backend command + modal entry-point

**Goal**: Users can right-click a schema (or click a "+ Table" header action) → fill a Create Table form → preview the generated SQL → commit through the Safe Mode gate. The new table appears in the schema tree without a manual refresh.

**Verification Profile**: `command` (vitest + tsc + lint + cargo test), with optional manual UI smoke. e2e is dead per `lefthook.yml:61-86` — not a closure dependency for this sprint.

**Acceptance Criteria**:

1. **AC-226-01** Backend `create_table` Tauri command accepts `CreateTableRequest { connection_id, schema, name, columns: Vec<ColumnDefinition>, primary_key: Option<Vec<String>>, preview_only: bool }`. When `preview_only=true` it returns `SchemaChangeResult { sql: String }` without executing; when `preview_only=false` it executes inside a transaction and returns the SQL it ran. Identifier inputs are validated by the same rule already enforced in `rename_table` (whitespace-trimmed, non-empty, no embedded `"`); failures return `AppError::Validation` and are surfaced verbatim by the modal. Verifiable by Rust unit tests in `src-tauri/src/db/postgres/mutations.rs` and `src-tauri/src/commands/rdb/ddl.rs`.

2. **AC-226-02** Generated SQL follows PG ANSI quoting: `CREATE TABLE "<schema>"."<name>" ("<col1>" <type1> [NOT NULL] [DEFAULT …], …, PRIMARY KEY ("<pkcol>", …))`. Empty column list is rejected with `AppError::Validation("Table must have at least one column")`. PK columns must reference declared columns; mismatch rejected with a specific error. Verifiable by Rust unit-test fixtures covering: 1-col no-PK, 3-col composite-PK, NOT NULL + DEFAULT, identifier with embedded space (rejected).

3. **AC-226-03** Frontend exposes `tauri.createTable(request)` in `src/lib/tauri/ddl.ts`. A new `CreateTableDialog` component (modal) renders: a "Table name" text input + a column-row repeater (name / data_type / nullable toggle / default_value) + a "Primary key" multi-select bound to the declared columns + Preview SQL button + Cancel button. Rendered text strings, button labels, and field aria labels are asserted by a vitest test suite that covers: opens with one empty column row, "+ Column" adds a row, "−" removes a row but blocks the last one, PK multi-select reflects current column names live, "Preview SQL" disabled until name + ≥1 valid column.

4. **AC-226-04** "Preview SQL" routes through the existing `useDdlPreviewExecution` hook (Sprint 214, `src/components/structure/useDdlPreviewExecution.ts`). Preview fetch calls `tauri.createTable({ ..., preview_only: true })`; Execute closure calls the same with `preview_only: false`. The Safe Mode gate (`useSafeModeGate`, Sprint 189) decides strict-block vs warn-confirm vs safe-pass identically to the existing `ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor` paths. Verifiable by a vitest test that mocks `tauri.createTable` and asserts: preview→commit calls are exactly `[{ preview_only: true }, { preview_only: false }]`, on commit success a `useQueryHistoryStore` entry with `source: "ddl-structure"` is recorded, on Safe Mode warn-cancel the canonical message `"Safe Mode (warn): confirmation cancelled — no changes committed"` surfaces.

5. **AC-226-05** Entry-point: `SchemaTree`'s schema-row right-click context menu surfaces a "Create Table…" item. Clicking it opens `CreateTableDialog` pre-filled with the right-clicked schema name (read-only field). On commit-success the modal closes and the SchemaTree refreshes the schema's table list (`refreshSchema(schemaName)` from `useSchemaTreeActions`) so the new table appears without manual reload. Verifiable by a vitest test on `SchemaTree.actions.test.tsx` that opens the menu, asserts the item exists, clicks it, and confirms `refreshSchema` is called exactly once after a mocked successful commit.

**Components to Create/Modify**:

- `src-tauri/src/models/schema.rs`: add `CreateTableRequest` and `ColumnDefinition` (or reuse `ColumnChange::Add` shape — Generator's call). What: a serde-deserializable request payload mirroring the frontend modal fields.
- `src-tauri/src/db/traits.rs`: add `create_table` method to the `RdbAdapter` trait (returning `Result<SchemaChangeResult, AppError>`). What: contract surface for all RDB adapters.
- `src-tauri/src/db/postgres/mutations.rs`: implement `create_table` on the PG adapter — identifier validation, SQL building, transactional execute, preview branch. What: PG-specific `CREATE TABLE` SQL emission with ANSI identifier quoting.
- `src-tauri/src/commands/rdb/ddl.rs`: add `#[tauri::command] pub async fn create_table(...)`. What: thin command-level dispatch matching the existing `alter_table` shape.
- `src-tauri/src/lib.rs`: register the new handler in `invoke_handler!` (line ~148 area where `drop_table` / `rename_table` / `alter_table` already register). What: routing only.
- `src/types/schema.ts`: add `CreateTableRequest` (and `ColumnDefinition` if not subsumed). What: TypeScript mirror of the Rust payload.
- `src/lib/tauri/ddl.ts`: add `createTable(request): Promise<SchemaChangeResult>`. What: IPC wrapper paralleling `alterTable`.
- `src/components/schema/CreateTableDialog.tsx` (new): modal that owns form state and delegates preview/execute to `useDdlPreviewExecution`. What: presentational + form-state component; no IPC math beyond what the hook orchestrates.
- `src/components/schema/CreateTableDialog.test.tsx` (new): vitest suite covering form behaviour + preview/commit pipeline + Safe Mode gate branches.
- `src/components/schema/SchemaTree/useSchemaTreeActions.ts`: add `handleCreateTable(schemaName)` opening the modal + `createTableDialog` state field on the returned `SchemaTreeActions` interface. What: dialog open/close orchestration + `refreshSchema` call on commit.
- `src/components/schema/SchemaTree/dialogs.tsx`: mount `CreateTableDialog` alongside the existing `DropTableConfirmDialog` and rename modal. What: render slot only.
- `src/components/schema/SchemaTree/rows.tsx` (or wherever schema-row context menu lives): add the "Create Table…" menu item. What: entry-point wiring.
- `src/components/schema/SchemaTree.actions.test.tsx`: extend the existing test file with the entry-point assertion. What: regression coverage for the menu item + refresh call.

### Future sprints (not part of sprint-226)

- **Sprint 227 — Drop Table CASCADE preview**: `drop_table` already exists, but Phase 27's exit criteria call for typing-confirm + CASCADE-impact preview (which dependent objects will be dropped). Out-of-scope for sprint-226 because CASCADE preview requires a new backend `pg_depend` query path and is a separable user story.
- **Sprint 228 — Phase 26 Trigger Read**: schema-tree Trigger node + `list_triggers` + `get_trigger_source` backend + StructurePanel trigger list. Read-only first cut; Trigger Write deferred to sprint-229.
- **Sprint 229 — Phase 26 Trigger Write**: trigger CREATE/EDIT modal reusing the same `useDdlPreviewExecution` pattern.
- **Sprint 230 — Phase 26 Function CREATE/EDIT** (optional follow-up): trigger-function authoring flow.
- **Phase 27 closure sprint**: parity smoke matrix vs `docs/table_plus/gui-tools/working-with-table/` and lessons retro.

## Global Acceptance Criteria

1. **No cross-window invariant changes.** No new IPC channel, no `attachZustandIpcBridge` modification, no `SYNCED_KEYS` extension. The schema cache is window-local; refresh after commit is a single-window concern.
2. **TDD evidence captured** in `docs/sprints/sprint-226/tdd-evidence/red-state.log` (or commit ordering) per the policy at `docs/PLAN.md:182-186`.
3. **Skip-zero gate**: zero new `it.skip` / `describe.skip` / `it.todo` / `xit` / `this.skip()` in any touched test file.
4. **Verification 4-set passes**: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`, `cargo build --manifest-path src-tauri/Cargo.toml` all exit 0.
5. **No regression** in existing DDL surfaces: `ColumnsEditor`, `IndexesEditor`, `ConstraintsEditor`, `useDdlPreviewExecution`, `SchemaTree` rename/drop, and `useSafeModeGate` test suites pass without text-string changes.
6. **No e2e dependency**. Sprint 226 closure does not require `lefthook.yml:5_e2e` to be re-enabled. The Phase 27 e2e smoke is captured as a deferred item with a `[DEFERRED-PHASE-27-E2E]` marker referencing the e2e recovery prerequisite (lesson `e2e/2026-05-06-vite-oom-host-prereq-cross-window-invariant`).

## Data Flow

1. User right-clicks a schema row in `SchemaTree` → `useSchemaTreeActions.handleCreateTable(schemaName)` opens `CreateTableDialog` with `schemaName` pre-filled.
2. User enters table name, adds N column rows, optionally marks PK columns.
3. User clicks "Preview SQL" → `useDdlPreviewExecution.loadPreview` calls `tauri.createTable({ ..., preview_only: true })` → backend builds SQL string and returns `{ sql }` without executing.
4. Generated SQL renders in the existing `SqlPreviewDialog` surface (already wired by `useDdlPreviewExecution`).
5. User clicks "Execute" → `useDdlPreviewExecution.attemptExecute` splits SQL on `;`, runs each through `analyzeStatement` + `useSafeModeGate.decide`:
   - **safe** → commit closure runs `tauri.createTable({ ..., preview_only: false })` → backend executes inside a transaction.
   - **warn** → `ConfirmDangerousDialog` mounts; on confirm the same closure runs.
   - **block** → `previewError` set; commit aborted.
6. On commit success: `useQueryHistoryStore.addHistoryEntry({ source: "ddl-structure", ... })` records the operation, `useSchemaCache.refreshSchema(schemaName)` re-fetches the table list, `CreateTableDialog` closes.
7. On commit failure: error toast surfaces via the same path the existing editors use; modal stays open so the user can edit and retry.

API endpoints touched:
- New: `create_table` Tauri command.
- Reused: `useQueryHistoryStore.addHistoryEntry`, `useSafeModeGate.decide`, `useSchemaCache.refreshSchema`.

State management:
- Modal-local form state (`useState`) for table name, column rows, PK selection.
- `useDdlPreviewExecution` owns preview SQL / loading / error / pendingConfirm state.
- No new Zustand store. No `schemaStore` mutation beyond the existing `refreshSchema` path.

## UI States

- **Loading (preview fetch)**: Preview button shows a spinner; form fields disabled. Reuses `previewLoading` from `useDdlPreviewExecution`.
- **Loading (commit)**: Same `previewLoading` flag, surfaced as "Executing…" inside `SqlPreviewDialog` (existing behaviour for sibling editors).
- **Empty**: Modal opens with one empty column row; Preview button disabled until table name is non-empty AND ≥ 1 column row has a non-empty name + non-empty type.
- **Error**: Backend `AppError::Validation` (empty name, duplicate column, invalid identifier) surfaces in `previewError` and renders inline below the form. Backend `AppError::Database` (e.g. permission denied, table already exists) surfaces in the SqlPreviewDialog's error slot.
- **Success**: Modal closes, schema tree shows the new table at the next render tick after `refreshSchema` resolves. No success toast (matches existing rename/drop UX — refresh is the user-visible signal).
- **Safe Mode warn**: `ConfirmDangerousDialog` mounts on top of the SqlPreviewDialog with the verbatim analyzer reason. Confirm runs commit; cancel surfaces the canonical `"Safe Mode (warn): confirmation cancelled — no changes committed"` in `previewError`.
- **Safe Mode block**: `previewError` shows `"Safe Mode (strict): <reason>"`; commit closure not invoked.

## Edge Cases

- **Empty table name** → Preview button disabled.
- **Whitespace-only table name** → backend `AppError::Validation`.
- **Duplicate column names within the form** → frontend pre-validation rejects with inline error before invoking `tauri.createTable`.
- **Identifier with embedded `"`** → backend rejects via the same regex/validation already used by `rename_table`.
- **PK references a column not in the column list** (can happen if user removes a column row after marking it PK) → frontend de-references stale PK entries on every column-list change so this is unreachable, but backend also defends with `AppError::Validation`.
- **Table already exists in the target schema** → backend execution returns `AppError::Database` with the underlying PG error; surfaced in the preview dialog's error slot, modal stays open.
- **Schema dropped concurrently between Preview and Execute** → backend execution surfaces PG error verbatim; modal stays open.
- **User clicks Preview, then edits the form, then clicks Preview again** → `useDdlPreviewExecution.loadPreview` already overwrites the prior preview SQL and commit closure (Sprint 214 contract) — no leak.
- **User clicks Preview, then closes the modal without executing** → `useDdlPreviewExecution.cancelPreview` discards the registered commit closure.
- **0 columns** → Preview button disabled; backend defensively rejects.
- **Cancel during commit** → out of scope. Sprint 180 cancel-token integration is not required for `CREATE TABLE` because PG's `CREATE TABLE` is near-instant; deferred unless follow-up sprint shows operator pain.
- **Connection paradigm is Mongo / non-RDB** → entry-point is gated on `connectionStore.activeConnection.db_type` being a relational paradigm (PG only at this point per `docs/PLAN.md` parity scope). Mongo schema rows do not surface the menu item.
- **Read-only or restricted DB user** → backend `CREATE TABLE` returns PG permission error; surfaced verbatim in preview dialog. No special UX beyond the error message.

## Visual Direction

Modal aesthetic mirrors the existing `IndexesEditor` / `ConstraintsEditor` create dialogs (same `Dialog` shadcn primitive, same column-row repeater idiom as `ColumnsEditor`). Column rows reuse the visual pattern of the existing `ColumnsEditor.tsx` add-column flow so users moving from "modify existing table" to "create new table" feel a continuous surface. PK multi-select uses the same checkbox-list pattern as the constraint Primary Key form. No new visual primitives.

## Verification Hints

- **Primary command profile**:
  - `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx` — sprint-226's new component test.
  - `pnpm vitest run src/components/schema/SchemaTree.actions.test.tsx` — entry-point regression.
  - `cargo test --manifest-path src-tauri/Cargo.toml create_table` — Rust unit tests for SQL generation + identifier validation.
  - Full `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`, `cargo build --manifest-path src-tauri/Cargo.toml` (the Verification 4-set per `docs/PLAN.md:186`).
- **Evidence the Evaluator should require**:
  1. A vitest test demonstrating the preview→execute call sequence is exactly `[preview_only: true, preview_only: false]`.
  2. A Rust unit test asserting the generated SQL for a 3-column composite-PK table matches a fixture string byte-for-byte (RFC-style determinism).
  3. A vitest test asserting `useQueryHistoryStore.addHistoryEntry` is called with `source: "ddl-structure"` after a successful commit.
  4. A vitest test asserting Safe Mode warn-cancel surfaces the canonical message verbatim.
  5. A `git grep -n "it.skip\|it.todo\|describe.skip\|xit" -- 'src/components/schema/CreateTable*' 'src/components/structure/useDdlPreviewExecution.ts' 'src-tauri/src/db/postgres/mutations.rs' 'src-tauri/src/commands/rdb/ddl.rs'` returning zero hits.
  6. Manual UI smoke in `pnpm tauri dev` (optional but recommended): right-click schema → Create Table → fill in 2 columns → Preview → Execute → confirm new table appears in the tree. Document in `docs/sprints/sprint-226/findings.md` if performed.
- **Browser path** (manual smoke only — e2e is dead): `pnpm tauri dev` → connect to a PG instance → expand schema in SchemaTree → right-click "public" → "Create Table…" → form path described above.
- **API path** (Rust-only, no UI): can be exercised via `cargo test` with PG container. Skip without container — the Rust unit tests for SQL generation are deterministic and require no DB connection.

## Notes on residual risk and what NOT to do this sprint

- **DO NOT** add `create_table` to MongoDB / DocumentAdapter. Phase 27 is PG-first per Phase scope; Mongo collection creation is a separate paradigm.
- **DO NOT** introduce CASCADE-impact preview — that belongs to the Drop Table refinement (Sprint 227 candidate).
- **DO NOT** add typing-confirm UX — only Drop benefits from it. Create is non-destructive.
- **DO NOT** modify `SYNCED_KEYS` of any store. Schema cache is window-local; cross-window broadcast is unnecessary.
- **DO NOT** restore e2e or write Playwright specs. Phase 27's e2e smoke is captured as a deferred item until e2e recovery (per lesson `e2e/2026-05-06-vite-oom-host-prereq-cross-window-invariant`).
- **DO NOT** extract a shared "DDL modal" base component this sprint. Wait until 3+ Create-* modals exist to extract; premature extraction risks the same kind of cross-component shape mismatch that prompted Sprint 214's `useDdlPreviewExecution` extraction (which solved real duplication, not anticipatory).
