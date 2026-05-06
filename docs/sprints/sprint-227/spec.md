# Feature Spec: Create Table UI — DataGrip-parity foundation (Phase 27 — Sprint 2)

## Description

Sprint 226 shipped the first cut of CREATE TABLE UI (backend `create_table` + `CreateTableDialog` modal + SchemaTree entry-point). Manual feedback (2026-05-06): "form이 너무 구리다 — type 자동완성, constraint/index 같이" + DataGrip "Import 'actor' Table" 모달 reference (Tabs: Columns / Keys / Indexes / Foreign Keys + 인라인 DDL Preview).

This sprint is the **foundation** for the DataGrip-parity rewrite. It restructures `CreateTableDialog` into a tabbed surface (Columns / Keys / Indexes / Foreign Keys), adds a Target schema picker (dropdown), upgrades the Type input to an autocomplete combobox over the common PG type list, adds per-column comment (emitted as `COMMENT ON COLUMN` statements alongside `CREATE TABLE` in a single transaction), and replaces the modal-on-modal SQL preview with an inline collapsible DDL Preview pane. Indexes / Foreign Keys tabs are present-but-disabled placeholders that 228 / 229 will plug into.

User decision (2026-05-06): atomic policy = **C (partial-atomic)**. `create_table` only handles CREATE TABLE + PK + NOT NULL + DEFAULT + COMMENT ON inside one transaction. Indexes / FKs are separate Tauri commands chained sequentially in 228 / 229.

## Sprint Breakdown

### Sprint 227: Modal redesign — Schema picker + Tabs + Type combobox + Column comment + Inline DDL preview

**Goal**: `CreateTableDialog` becomes a tabbed surface with a Target schema dropdown header, DataGrip-aligned Columns tab (autocomplete type combobox + comment input), Keys tab (PK selection), Indexes / Foreign Keys placeholder tabs, and an inline collapsible DDL Preview pane (replaces the `SqlPreviewDialog` modal-on-modal). Backend emits `COMMENT ON COLUMN` statements for any column with a non-empty comment, atomically with the CREATE TABLE inside one transaction.

**Verification Profile**: `command` (vitest + tsc + lint + cargo test + cargo clippy). e2e is dead per `lefthook.yml:61-86` and is **not** a closure dependency.

**Acceptance Criteria**:

1. **AC-227-01 — Tabbed modal layout.** `CreateTableDialog` renders four tabs labelled `"Columns"`, `"Keys"`, `"Indexes"`, `"Foreign Keys"`. Columns + Keys tabs are interactive. Indexes + Foreign Keys tabs are clickable but render an empty-state body with verbatim `"Available in Sprint 228"` (Indexes) / `"Available in Sprint 229"` (Foreign Keys) — body is read-only (no inputs). Tab keyboard navigation (←/→) works via the existing `Tabs` primitive (`src/components/ui/tabs.tsx`). Verifiable by vitest cases asserting each tab role + label + placeholder content.

2. **AC-227-02 — Target schema picker.** Modal header surfaces a `Select` dropdown labelled `"Target schema"` populated with the connection's schema list (from `useSchemaStore.schemas[connectionId]`). Default = the schema name passed into the modal (the right-clicked schema from SchemaTree entry-point). User can change the schema; selection drives the `schema` field in the `CreateTableRequest` payload AND the `<schema>` token in generated SQL. Selection change invalidates the cached DDL preview (per AC-227-05). If the connection has only one schema, the dropdown still renders (no auto-collapse). aria-label `"Target schema"`. Verifiable by vitest: dropdown lists ≥ 2 mocked schemas; default selection equals the pre-filled schema; changing selection updates the SQL preview's schema token; the Tauri payload's `schema` field reflects the selection.

3. **AC-227-03 — Type input becomes an autocomplete combobox.** Per-column data-type input renders as a filterable combobox seeded with the canonical PG common-type list (≥ 25 entries: `serial`, `bigserial`, `smallserial`, `integer`, `bigint`, `smallint`, `varchar`, `varchar(255)`, `text`, `boolean`, `timestamp`, `timestamptz`, `date`, `time`, `numeric`, `numeric(10,2)`, `real`, `double precision`, `uuid`, `jsonb`, `json`, `bytea`, `inet`, `cidr`, `interval`, `char`, `money`, `tsvector`, `xml`). Behavioural: typing filters case-insensitively; ↑/↓ moves selection; Enter commits highlighted suggestion; Esc closes popover; **free-text fallback** — custom strings (`numeric(10,4)`) commit on blur and forward to backend's `data_type.trim()` path. Verifiable by vitest: typing `"int"` filters to expected suggestions; Enter commits; typing `"numeric(10,4)"` + blur commits verbatim.

4. **AC-227-04 — Column comment input + COMMENT ON SQL emission.** Each column row gains a comment text input (placeholder `"comment (optional)"`, aria-label `"Column comment"`). Backend `ColumnDefinition` accepts optional `comment: Option<String>` (`#[serde(default)]`). When any column has a non-empty (post-trim) comment, generated SQL contains `CREATE TABLE …;` followed by one `COMMENT ON COLUMN "<schema>"."<table>"."<col>" IS '<escaped>';` per commented column, in column-declaration order. Comment SQL-escaping doubles single quotes (`O'Brien` → `'O''Brien'`). Empty comments emit no `COMMENT ON`. Backend executes the full batch inside one transaction. Verifiable by Rust unit fixtures: 2-col with one comment byte-equivalent; 3-col with single-quote escape; 0-comment case byte-equivalent to Sprint 226 fixture (regression).

5. **AC-227-05 — Inline DDL Preview pane.** Modal footer no longer opens `SqlPreviewDialog` as a separate modal. Instead, an inline collapsible region between form body and Cancel/Execute buttons toggles between `"Show DDL"` (collapsed) and `"Hide DDL"` (expanded). When opened with a valid form, fetches preview via `tauri.createTable({ preview_only: true })` and displays. Edits to form (any of: table name, column rows, schema picker) invalidate the cached preview — next "Show DDL" refetches. Multi-statement SQL renders intact (visible newlines or semicolons). Execute button lives in modal footer (not in child preview dialog) and is enabled only when a fetched preview is current and Safe Mode does not strict-block. Verifiable by vitest: clicking "Show DDL" calls `tauri.createTable` exactly once with `preview_only: true`; preview text contains `CREATE TABLE` + `COMMENT ON` substrings; editing a field invalidates cached preview; clicking Execute calls `tauri.createTable` with `preview_only: false`.

6. **AC-227-06 — Keys tab houses Primary Key selection.** PK multi-select that lived in the flat Sprint 226 form now renders inside the **Keys** tab. Behavioural: PK options derive live from column-row name list. Switching tabs does not lose form state. The `primary_key` field of the Tauri payload is unchanged. Verifiable by vitest: typing column name on Columns tab, switching to Keys, asserting checkbox appears with that label; checking it; switching back to Columns and renaming — Keys tab's checkbox label updates live (Sprint 226 behaviour parity).

7. **AC-227-07 — Footer + Safe Mode parity.** Footer renders `Cancel` + `Execute` (no separate "Preview SQL" button). Execute closure runs through `useDdlPreviewExecution` (Sprint 214) + `useSafeModeGate` (Sprint 189). Multi-statement preview is `;`-split and analyzed per statement (CREATE/COMMENT ON both `safe`). Safe Mode warn-cancel surfaces canonical message `"Safe Mode (warn): confirmation cancelled — no changes committed"` verbatim. `useQueryHistoryStore` records single `source: "ddl-structure"` entry on commit success. Verifiable by vitest: IPC sequence `[{preview_only:true},{preview_only:false}]`; one history entry; canonical warn-cancel message verbatim.

8. **AC-227-08 — No regression on Sprint 226 contract.** Backend `create_table` CREATE-TABLE SQL is byte-equivalent to Sprint 226 fixture **when no comment is set**. Sprint 226 `composite_pk_byte_equivalent` Rust unit test passes unmodified. Sprint 226 vitest cases for "preview→commit IPC sequence" and "history source" continue to pass with at most mechanical adaptation to tab structure (e.g. `getByLabelText("Column name")` scoped to Columns tab panel). Verifiable by `cargo test create_table_preview_three_column_composite_pk_byte_equivalent` exit 0 unchanged + regression-locked vitest cases surviving.

**Components to Create/Modify**:

- `src-tauri/src/models/schema.rs`: extend `ColumnDefinition` with `comment: Option<String>` (`#[serde(default)]`).
- `src-tauri/src/db/postgres/mutations.rs`: extend `create_table` to emit `COMMENT ON COLUMN` statements in same transaction. PG-specific multi-statement DDL emission with single-quote escaping. Add Rust unit fixtures.
- `src/types/schema.ts`: extend `ColumnDefinition` with optional `comment` field.
- `src/components/schema/CreateTableDialog.tsx`: redesign — Target schema dropdown header + Tabs wrapper + Type combobox per column + comment input per column + inline DDL preview region. Drop `SqlPreviewDialog` import (modal-on-modal).
- `src/components/schema/CreateTableDialog.test.tsx`: extend with AC-227-01..08 cases. Pre-existing AC-226 cases stay (or mechanically migrated to tab-aware queries).
- `src/components/schema/CreateTableTypeCombobox.tsx` (new, optional): the filterable type combobox. Generator's call: extract or inline.
- `src/components/schema/CreateTableTypeCombobox.test.tsx` (new, if extracted).
- `src/lib/sql/postgresTypes.ts` (new, optional): canonical PG type list.
- `src/components/schema/SchemaTree/dialogs.tsx`: pass `availableSchemas` prop to `CreateTableDialog` (from `useSchemaStore.schemas[connectionId]`).
- `docs/PLAN.md`: add row 2 to post-225 feature cycle table for sprint-227.

### Future sprints (not part of sprint-227)

- **Sprint 228 — Indexes tab functional**: + / − rows for index declarations (name + columns + type + unique). Frontend chains `tauri.createTable` → `tauri.createIndex` per declared index. Indexes outside CREATE TABLE transaction (partial-atomic policy C).
- **Sprint 229 — Foreign Keys + Constraints tab**: + / − rows for FK declarations (columns + reference table picker + reference columns + ON DELETE/UPDATE). May fold in CHECK/UNIQUE. Frontend chains `tauri.addConstraint` after CREATE TABLE.
- **Sprint 230 — Reorder + table comment polish**: ↑/↓ row reorder buttons. Table-level `COMMENT ON TABLE`. Type coloring on combobox display.
- **Phase 27 closure sprint**: parity smoke matrix + lessons retro.

## Global Acceptance Criteria

1. **No cross-window invariant changes.** No new IPC channel, no `attachZustandIpcBridge` modification, no `SYNCED_KEYS` extension. Schema cache stays window-local. Sprint 227 does not depend on e2e recovery.
2. **TDD evidence captured** in `docs/sprints/sprint-227/tdd-evidence/red-state.log` or commit ordering.
3. **Skip-zero gate**: zero new `it.skip` / `describe.skip` / `it.todo` / `xit` / `this.skip()`.
4. **Verification 4-set passes**: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`, `cargo build --manifest-path src-tauri/Cargo.toml` exit 0. `cargo clippy --all-targets --all-features -- -D warnings` exit 0.
5. **No regression** in: `ColumnsEditor`, `IndexesEditor`, `ConstraintsEditor`, `useDdlPreviewExecution`, `SqlPreviewDialog`, `SchemaTree.*` test suites; Sprint 226 backend fixtures byte-equivalent unchanged.
6. **No e2e dependency**.
7. **Cross-window invariant test suite untouched**: `git diff --stat src/__tests__/cross-window-*.test.tsx` = 0.

## Data Flow

1. User opens `CreateTableDialog` from `SchemaTree` (entry-point Sprint 226).
2. Modal renders with Columns tab active, one empty column row, **Target schema dropdown defaulting to the right-clicked schema**, table name input focused.
3. User can switch schema via dropdown — driving `schema` field.
4. User fills column rows: Name (input), Type (combobox with filter+free-text), Nullable (checkbox), Default (input), Comment (input).
5. User switches to Keys tab; PK multi-select reflects column names live.
6. (Indexes / Foreign Keys tabs clickable but body shows `"Available in Sprint 228"` / `"Available in Sprint 229"`.)
7. User clicks "Show DDL" → `tauri.createTable({ preview_only: true })` → preview pane renders SQL.
8. User edits any field → preview state invalidates.
9. User clicks Execute → `useDdlPreviewExecution.attemptExecute` → `;`-split + per-statement Safe Mode → on `safe` runs commit closure → `tauri.createTable({ preview_only: false })` → backend executes multi-statement batch in one transaction → `useQueryHistoryStore.addHistoryEntry({ source: "ddl-structure", … })` → `useSchemaCache.refreshSchema(selectedSchema)` → modal closes.
10. On failure: PG error verbatim in inline preview pane error slot; modal stays open.

API endpoints touched:
- Reused: `useQueryHistoryStore.addHistoryEntry`, `useSafeModeGate.decide`, `useSchemaCache.refreshSchema`.
- Modified contract (additive): `tauri.createTable` request payload gains optional `comment: string | null` per column. Frontend continues to accept callers that omit `comment` (Sprint 226 callers).

State management:
- Modal-local form state (`useState`): table name, column drafts (name / data_type / nullable / default / **comment** / is_pk), **selected schema**, active tab, "Show DDL" expanded, cached preview SQL, "preview is stale" flag.
- `useDdlPreviewExecution` reused as-is (render-agnostic).
- No new Zustand store. No `schemaStore` mutation.

## UI States

- **Loading (preview fetch)**: inline preview pane shows spinner + `"Generating DDL…"`.
- **Loading (commit)**: Execute button shows `"Executing…"` + spinner; form fields disabled.
- **Empty (modal opened)**: Columns tab active, one empty column row, schema dropdown defaulted, table name input focused, Execute button disabled.
- **Empty (Indexes / Foreign Keys tab)**: tab body renders `"Available in Sprint 228"` / `"Available in Sprint 229"`.
- **Error (validation)**: backend `AppError::Validation` surfaces in inline preview pane error slot.
- **Error (database)**: PG error verbatim in inline preview pane error slot.
- **Success**: modal closes; SchemaTree refreshes selected schema.
- **Safe Mode warn**: `ConfirmDangerousDialog` mounts atop modal. Cancel surfaces canonical message in preview pane.
- **Safe Mode block**: preview pane shows `"Safe Mode blocked: <reason>"`.
- **DDL preview hidden (default)**: pane collapsed; toggle reads `"Show DDL"`; no fetch.
- **DDL preview shown**: pane expanded; SQL visible; toggle reads `"Hide DDL"`; Execute enabled.
- **DDL preview stale (after edit)**: cached preview cleared; pane collapsed back to `"Show DDL"` state.

## Edge Cases

- **Type combobox custom free-text**: `numeric(10,4)` not in suggestion list → on blur commits verbatim, forwarded to backend `data_type.trim()`.
- **Type combobox empty filter**: shows full canonical list (or no popover); does NOT commit a default.
- **Comment with single quotes**: `O'Brien` → SQL `'O''Brien'` (Rust fixture).
- **Comment with newlines/tabs**: emitted verbatim inside single-quoted literal (PG accepts).
- **Comment with `;`**: inside literal — not statement separator. SQL builder must NOT split on `;` for storage; preview rendering must show comment string intact.
- **Empty comment**: whitespace-only or empty → no COMMENT ON statement.
- **Tab switch with unsaved column draft**: state owned by modal, NOT lost.
- **Schema dropdown change after Preview**: invalidates cached preview.
- **Schema dropdown with single schema**: still renders dropdown (no auto-collapse).
- **DDL preview without valid form**: Show DDL disabled until table name + ≥ 1 valid column row.
- **Sprint 226 callers without `comment`**: backend `#[serde(default)]` → `None`. Frontend `comment` optional in TS.
- **Indexes / Foreign Keys tab**: present-but-disabled — no hidden "advanced" path.
- **Multi-statement preview with mid-batch failure**: backend transaction rolls back. PG error in preview pane.
- **Form reset on commit success**: Sprint 226 behaviour preserved.

## Visual Direction

Modal aesthetic mirrors DataGrip "Import 'actor' Table" reference: header with table name + Target schema dropdown; tab strip beneath header (Columns / Keys / Indexes / Foreign Keys); body content per tab; inline collapsible DDL Preview pane separated by thin border above footer; footer Cancel + Execute. Reuses existing `Tabs` primitive + existing `Select` primitive + existing `Popover` primitive. No new shadcn primitives. Disabled-tab placeholder body: muted-foreground italic style. Type coloring on combobox display = **out of scope for 227 (Sprint 230 polish)**.

## Verification Hints

- **Primary command profile**:
  - `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx`
  - `pnpm vitest run src/components/schema/CreateTableTypeCombobox.test.tsx` (if extracted)
  - `pnpm vitest run src/components/schema/SchemaTree.actions.test.tsx` (entry-point regression Sprint 226 lock)
  - `cargo test --manifest-path src-tauri/Cargo.toml create_table`
  - `pnpm vitest run src/components/structure/ColumnsEditor.test.tsx src/components/structure/IndexesEditor.test.tsx src/components/structure/ConstraintsEditor.test.tsx src/components/structure/SqlPreviewDialog.test.tsx`
  - Verification 4-set + clippy.
- **Evidence the Evaluator should require**:
  1. Rust fixture: byte-equivalent multi-statement SQL for 2-col with `O'Brien`-style comment (single-quote escape).
  2. Rust fixture: 0-comment byte-equivalent to Sprint 226 (additive proof).
  3. Vitest: type combobox filter (`"int"` → expected suggestions); Enter commits.
  4. Vitest: free-text fallback (`numeric(10,4)` blur commits verbatim).
  5. Vitest: schema dropdown lists schemas, default selection, change updates payload.
  6. Vitest: Indexes/FK tabs render canonical empty-state, no inputs.
  7. Vitest: inline preview "Show DDL" → 1× `tauri.createTable({preview_only:true})`; edit invalidates cached preview.
  8. Vitest: Sprint 226 IPC sequence assertion holds for comment-bearing form.
  9. Vitest: canonical Safe Mode warn-cancel message verbatim survives redesign.
  10. `git grep -n "it.skip\|it.todo\|describe.skip\|xit" -- 'src/components/schema/CreateTable*'` matches 0.
  11. Sprint 226 `composite_pk_byte_equivalent` fixture passing unchanged.
- **Browser path** (manual smoke, e2e dead): `pnpm tauri dev` → connect PG → expand schema → right-click → Create Table → switch schema in dropdown → fill 2 columns with comments + PK on Keys tab → Show DDL → confirm multi-statement SQL → Execute → verify table appears in selected schema; `\d+ <table>` in psql shows column comments.
