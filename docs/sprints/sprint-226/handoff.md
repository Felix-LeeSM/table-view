# Sprint 226 — Generator Handoff

## Changed Files

### Backend (Rust)
- `src-tauri/src/models/schema.rs` (+28 LOC) — added
  `ColumnDefinition` + `CreateTableRequest` request payload structs.
- `src-tauri/src/models/mod.rs` (+1 / -1 LOC) — re-export new types.
- `src-tauri/src/db/traits.rs` (+8 LOC) — added `create_table` method
  to `RdbAdapter` trait.
- `src-tauri/src/db/postgres/mutations.rs` (+346 LOC = ~80 impl + 266
  tests) — implemented `PostgresAdapter::create_table` with identifier
  validation, ANSI-quoted SQL build, preview branch, transactional
  execute branch, and 11 unit tests covering byte-equivalent SQL +
  validation rejections + connection-required.
- `src-tauri/src/db/postgres.rs` (+8 LOC) — `RdbAdapter::create_table`
  trait dispatch wrapper.
- `src-tauri/src/db/tests.rs` (+8 LOC) — added `create_table` no-op
  to two stub adapters (FakeCancellableRdb / FastFakeRdb).
- `src-tauri/src/commands/meta.rs` (+8 LOC) — added `create_table`
  no-op to the `StubRdbAdapter` in `verify_dispatch_rdb_returns_current_database`.
- `src-tauri/src/commands/rdb/ddl.rs` (+13 LOC) — added Tauri command
  `create_table` matching `alter_table` shape.
- `src-tauri/src/lib.rs` (+1 LOC) — registered `create_table` in
  `invoke_handler!`.

### Frontend (TS/TSX)
- `src/types/schema.ts` (+18 LOC) — `ColumnDefinition` +
  `CreateTableRequest` TS mirrors.
- `src/lib/tauri/ddl.ts` (+7 LOC) — `tauri.createTable(request)` IPC
  wrapper.
- `src/components/schema/CreateTableDialog.tsx` (NEW, ~370 LOC) —
  modal owning form state + delegating preview/execute to
  `useDdlPreviewExecution`.
- `src/components/schema/CreateTableDialog.test.tsx` (NEW, ~340 LOC,
  12 cases) — vitest suite for AC-226-03 + AC-226-04.
- `src/components/schema/SchemaTree/useSchemaTreeActions.ts`
  (+24 LOC) — `handleCreateTable` opener + `createTableDialog` state +
  setter on returned interface.
- `src/components/schema/SchemaTree/dialogs.tsx` (+35 LOC) — exported
  `CreateTableDialogSlot` mount.
- `src/components/schema/SchemaTree/rows.tsx` (+8 LOC) — `Plus` icon
  import + `Create Table…` ContextMenuItem on the schema row +
  `handleCreateTable` field on the rows context.
- `src/components/schema/SchemaTree.tsx` (+11 LOC) — wired
  `handleCreateTable` into `ctx` + mounted `CreateTableDialogSlot`.
- `src/components/schema/SchemaTree.actions.test.tsx` (+147 LOC, 3
  new cases) — entry-point regression for AC-226-05.

### Sprint artifacts
- `docs/sprints/sprint-226/handoff.md` (this file)
- `docs/sprints/sprint-226/findings.md`
- `docs/sprints/sprint-226/tdd-evidence/red-state.log`

## Checks Run

| Check | Command | Result |
|-------|---------|--------|
| 1 | `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx` | pass — 12/12 |
| 2 | `pnpm vitest run src/components/schema/SchemaTree.actions.test.tsx` | pass — 34/34 (3 new) |
| 3 | `cargo test --manifest-path src-tauri/Cargo.toml create_table` | pass — 11/11 + 1 integration |
| 4 | `pnpm vitest run src/components/structure/ColumnsEditor.test.tsx src/components/structure/IndexesEditor.test.tsx src/components/structure/ConstraintsEditor.test.tsx src/components/structure/SqlPreviewDialog.test.tsx` | pass — 26/26 |
| 5 | `pnpm vitest run` | pass — 2743/2743 across 215 files |
| 6 | `pnpm tsc --noEmit` | pass — exit 0 |
| 7 | `pnpm lint` | pass — exit 0 |
| 8 | `cargo build --manifest-path src-tauri/Cargo.toml` | pass |
| 9 | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | pass |
| 10 | `grep -nE 'create_table\b' src-tauri/src/lib.rs` | 1 hit (line 151) |
| 11 | `grep -nE 'createTable\b' src/lib/tauri/ddl.ts` | 1 hit (line 37) |
| 12 | `grep -rn 'CreateTableDialog\b' src/components/schema/SchemaTree/dialogs.tsx` | 3 hits (import + mount + JSX usage) |
| 13 | `grep -rnE 'Create Table…\|Create Table\.\.\.' src/components/schema/SchemaTree/` | 1 hit (rows.tsx:113) |
| 14 | `git diff --stat src/components/structure/useDdlPreviewExecution.ts` | 0 |
| 15 | `git diff --stat src/components/structure/SqlPreviewDialog.tsx` | 0 |
| 16 | `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts` | 0 |
| 17 | `grep -nE 'SYNCED_KEYS\|attachZustandIpcBridge' src/stores/connectionStore.ts \| wc -l` | 4 (unchanged from baseline) |
| 18 | `grep -rnE 'createCollection\|create_collection' src/lib/tauri/ src-tauri/src/commands/document/` | 0 hits |
| 19 | `git diff src/ src-tauri/ \| grep '^+.*eslint-disable'` | 0 hits |
| 20 | `git diff src/ \| grep -E '^\+.*\bany\b'` | 0 hits |
| 21 | `grep -nE 'it\.only\|it\.skip\|describe\.skip\|xit\|it\.todo\|this\.skip\(\)' src/components/schema/CreateTableDialog.test.tsx src/components/schema/SchemaTree.actions.test.tsx` | 0 hits |
| 22 | `grep -nE '"ddl-structure"' src/components/schema/CreateTableDialog.test.tsx` | 2 hits (test asserts source verbatim) |
| 23 | `grep -nE 'preview_only' src-tauri/src/db/postgres/mutations.rs \| wc -l` | 57 |
| 24 | Composite-PK byte-equivalent fixture | pass (see fixture below) |
| 25 | Vitest `[{preview_only:true},{preview_only:false}]` sequence | pass |
| 26 | Vitest Safe Mode warn-cancel canonical message | pass |
| 27 | `pnpm vitest run src/components/schema/SchemaTree.{lifecycle,expand,refresh,search,highlight,preview,preview.entrypoints,virtualization,rowcount,dbms-shape}.test.tsx` | pass — 108/108 |
| 28 | `git diff --stat` for sibling SchemaTree test files | 0 each |

## Done Criteria Coverage

### AC-226-01 — Backend create_table command
- Rust unit tests: `src-tauri/src/db/postgres/mutations.rs`
  `create_table_preview_one_column_no_pk` (line ~580 in current file
  layout), `create_table_table_name_with_embedded_space_rejected`,
  `create_table_empty_table_name_rejected`,
  `create_table_column_name_with_embedded_quote_rejected`,
  `create_table_without_connection_fails_non_preview`.
- Tauri command: `src-tauri/src/commands/rdb/ddl.rs::create_table`
  registered in `src-tauri/src/lib.rs:151`.
- AppError::Validation surfaces verbatim because the modal forwards
  rejection through `useDdlPreviewExecution.previewError`.

### AC-226-02 — SQL builder + ANSI quoting
- Composite-PK fixture (byte-equivalent assert): see fixture below.
- `create_table_empty_columns_rejected` —
  `AppError::Validation("Table must have at least one column")` text
  match.
- `create_table_pk_references_undeclared_column_rejected` — explicit
  "not declared" error text.
- 1-col no-PK / NOT NULL+DEFAULT cases also pass byte-equivalent.

### AC-226-03 — Modal form behaviour
- `CreateTableDialog.test.tsx` cases:
  - "opens with exactly one empty column row"
  - "adds a row when '+ Column' is clicked"
  - "removes a row when '−' is clicked but blocks the last one"
  - "PK multi-select reflects column names live"
  - "disables Preview SQL until table name + ≥1 valid column"

### AC-226-04 — Preview/execute pipeline + Safe Mode
- "issues preview→commit calls in exactly the [{preview_only:true},
  {preview_only:false}] sequence"
- "records a useQueryHistoryStore entry with source 'ddl-structure'
  on commit success"
- "surfaces the canonical Safe Mode warn-cancel message verbatim in
  previewError"
- "blocks commit closure entirely when Safe Mode is strict and
  statement is dangerous"
- `git diff --stat src/components/structure/useDdlPreviewExecution.ts`
  = 0 (Sprint 214 hook unchanged).

### AC-226-05 — Entry-point + refreshSchema
- `SchemaTree.actions.test.tsx` cases:
  - "[AC-226-05] schema-row right-click surfaces 'Create Table…' menu
    item" — locates the literal in the rendered ContextMenu.
  - "[AC-226-05] clicking 'Create Table…' opens dialog pre-filled
    with schema name" — asserts `Schema name` input value === "public"
    and readOnly.
  - "[AC-226-05] commit-success calls refreshSchema('public') exactly
    once" — `loadTablesSpy.mockClear()` before commit, then asserts
    exactly one post-commit `loadTables(connectionId, "public")` call.

## Composite-PK fixture (verbatim)

```
CREATE TABLE "public"."memberships" ("user_id" integer NOT NULL, "group_id" integer NOT NULL, "joined_at" timestamp DEFAULT now(), PRIMARY KEY ("user_id", "group_id"))
```

Asserted by `create_table_preview_three_column_composite_pk_byte_equivalent`
via `assert_eq!`.

## Assumptions

- **`ColumnDefinition` shape** — new struct over `ColumnChange::Add`
  reuse. Justified in `findings.md` (decoupled wire shape, no
  `Modify`/`Drop` enum variants needed for Create).
- **Identifier-validator share** — reused existing
  `validate_identifier` helper in `src-tauri/src/db/postgres/mutations.rs`.
  No extraction required; the helper was already shared.
- **`createTableDialog` state shape** — `{ schemaName: string } | null`
  rather than `{ open: bool, schemaName: string | null }`.
- **`dialogs.tsx` mount** — `CreateTableDialogSlot` exported as a thin
  wrapper that conditionally renders `CreateTableDialog`. Mounted in
  `SchemaTree.tsx` next to `DropTableConfirmDialog` /
  `RenameTableDialog`.
- **PK multi-select** — checkbox-list pattern matching IndexesEditor's
  CreateIndexModal columns picker.
- **Schema-row menu placement** — "Create Table…" placed ABOVE
  "Refresh".

## Residual Risk

- Manual `pnpm tauri dev` smoke not performed (optional per spec).
- Phase 27 e2e smoke deferred under `[DEFERRED-PHASE-27-E2E]` per
  lesson `e2e/2026-05-06-vite-oom-host-prereq-cross-window-invariant`.
- `ColumnDefinition` may merge with `ColumnChange::Add` in a future
  sprint if both shapes converge; tracked under "split if X" in
  `findings.md`.
- PG-only — Mongo `createCollection` deferred per Phase scope.
