# Sprint Execution Brief: sprint-236

## Objective

Phase 27 sprint 11 — second ALTER TABLE polish sprint. Add
**Column add / drop** Tauri commands + matching frontend modal
dialogs, mirroring the Sprint 235 `rename_table` / `drop_table`
shape. Concretely:

- Backend `add_column` / `drop_column` `RdbAdapter` methods +
  `#[tauri::command]` handlers (preview/execute branches,
  request-shaped payloads, byte-equivalent SQL fixtures, ANSI
  quoting, identifier validation via shared `validate_identifier`).
- Frontend grows two new modals:
  - `AddColumnDialog` — column name + type combobox (reuses Sprint
    230 `usePostgresTypes` + Sprint 227 `CreateTableTypeCombobox`)
    + NOT NULL toggle (default OFF) + DEFAULT free-text + CHECK
    free-text + collapsible Show DDL pane (default collapsed).
  - `DropColumnDialog` — typing-confirm input (case-sensitive
    byte-for-byte, no trim, no debounce) + CASCADE checkbox
    (default OFF, label `"Drop dependent objects (CASCADE)"`) +
    inline DDL preview + Safe Mode gate dispatch.
- Both modals reuse `useDdlPreviewExecution` (Sprint 214) for the
  preview/execute lifecycle.
- `ColumnsEditor`'s existing `+ Column` toolbar button is
  repurposed to open `AddColumnDialog`; per-row trash icon is
  repurposed to open `DropColumnDialog`. The existing
  inline-batched `pendingChanges` MODIFY flow stays UNTOUCHED
  (Sprint 237 polish target).
- Schema cache `tableColumnsCache` invalidation flows through the
  existing `onRefresh()` prop chain → `getTableColumns` →
  cache write-through. **`useSchemaTableMutations` is NOT
  extended** (Sprint 223 hook is table-scoped).

This is Phase 27 sprint 11 of 12 (the master plan's "Sprint 190 —
Column 편집기 (add / drop) + 트리 갱신").

## Task Why

- **TablePlus parity** — Phase 27 closes the
  `working-with-table/column.md` parity gap. Sprint 235 closed
  table-level rename + drop. Sprint 236 closes column add + drop
  with the Phase 24-26 preview / Safe Mode / typing-confirm UX
  contract. Without this, column add/drop is the only DDL surface
  that bypasses the dedicated modal pattern (currently inline in
  `ColumnsEditor`).
- **Sprint 235 typing-confirm pattern reuse** — Sprint 235 just
  shipped the typing-confirm pattern; Sprint 236 reuses it
  verbatim for column drop. Pattern-source consolidation pressure
  is rising — Sprint 237 will likely extract a shared
  `TypingConfirmInput` primitive after the third occurrence
  (per Sprint 226 "wait until 3+ Create-* modals" rule).
- **Unblocks Sprint 237 (column modify + USING cast + multi-step
  + Phase 27 마무리 마일스톤)** — Sprint 237 depends on the same
  modal pattern + on `add_column` / `drop_column` shipping first
  so the column-modify dialog can compose with them.

## Scope Boundary

### In scope

- **Backend (Rust)**
  - `src-tauri/src/models/schema.rs` (~+70 LOC) — add
    `AddColumnRequest` (with `column: ColumnDefinition` + optional
    `check_expression`) + `DropColumnRequest` (with `column_name:
    String` + `cascade: bool`) structs (camelCase serde); ≥ 2
    serde roundtrip tests
    (`add_column_request_serde_camelcase_roundtrip`,
    `drop_column_request_serde_camelcase_roundtrip`).
  - `src-tauri/src/db/traits.rs` (~+12 LOC) — add `RdbAdapter::
    add_column` and `::drop_column` trait methods, returning
    `BoxFuture<'a, Result<SchemaChangeResult, AppError>>`.
  - `src-tauri/src/db/postgres/mutations.rs` (~+260 LOC inherent
    + ~+260 LOC tests) — new `add_column` / `drop_column` methods
    on `PostgresAdapter`. Validate identifiers (shared
    `validate_identifier`); reject empty `data_type.trim()`.
    Emit ANSI-quoted SQL with preview/execute branches
    (transactional `BEGIN/COMMIT`).
    - **add_column SQL**: `ALTER TABLE "<schema>"."<table>"
      ADD COLUMN "<name>" <type> [NOT NULL] [DEFAULT <expr>]
      [CHECK (<expr>)]`. Locked emission order. NOT NULL keyword
      iff `!column.nullable`. DEFAULT clause iff
      `column.default_value.is_some() && trim().is_non_empty()`.
      CHECK clause iff `check_expression.is_some() &&
      trim().is_non_empty()`. Free-text DEFAULT / CHECK —
      verbatim interpolation, NO escaping. Comments NOT emitted
      (Sprint 237 polish).
    - **drop_column SQL**: `ALTER TABLE "<schema>"."<table>"
      DROP COLUMN "<name>"` when `cascade=false`;
      `... DROP COLUMN "<name>" CASCADE` when `cascade=true`. NO
      `RESTRICT` keyword (mirror Sprint 235 `drop_table`
      convention). NO pre-existence check.
    - ≥ 12 new fixtures total (≥ 6 per command).
  - `src-tauri/src/db/postgres.rs` (~+18 LOC) — `impl RdbAdapter
    for PostgresAdapter` gains `add_column` / `drop_column` arms
    delegating to inherent methods.
  - `src-tauri/src/commands/rdb/ddl.rs` (~+30 LOC) — two new
    `#[tauri::command]` handlers `add_column` / `drop_column`
    mirroring Sprint 235 `drop_table` / `rename_table` body
    shape.
  - `src-tauri/src/lib.rs` (~+2 LOC) — register the two new
    handlers in the `tauri::generate_handler!` macro between
    `rename_table` (line 149) and `alter_table` (line 150).
  - `src-tauri/src/db/tests.rs` (~+18 LOC) +
    `src-tauri/src/commands/meta.rs` (~+10 LOC) — mechanical
    trait stub additions on the test stub adapters.
- **Frontend (TS/TSX)**
  - `src/types/schema.ts` (~+30 LOC) — add `AddColumnRequest`
    and `DropColumnRequest` TS types.
  - `src/lib/tauri/ddl.ts` (~+40 LOC) — add `addColumnRequest` /
    `dropColumnRequest` request-shaped IPC wrappers. Optional
    positional aliases `addColumn` / `dropColumn` for symmetry
    (may be removed if no callers — see brief Open questions §1).
  - `src/lib/tauri/index.ts` (~+4 LOC) — re-export from `./ddl`.
  - `src/components/schema/AddColumnDialog.tsx` (NEW, ~280-360
    LOC) — modal with name + type combobox + NOT NULL +
    DEFAULT + CHECK + collapsible Show DDL pane (default
    collapsed). Reuses `useDdlPreviewExecution` (Sprint 214) +
    `usePostgresTypes` (Sprint 230) +
    `<CreateTableTypeCombobox>` (Sprint 227). NO Safe Mode UX
    path (gate fires internally; ADD COLUMN is `ddl-other`/safe
    so the path is no-op-equivalent). Apply disabled when (a)
    name fails identifier validation, (b) type empty, (c)
    preview not fetched OR stale, (d) name collides with
    existing column from `columns` prop.
  - `src/components/schema/AddColumnDialog.test.tsx` (NEW,
    ~280-340 LOC) — ≥ 12 cases.
  - `src/components/schema/DropColumnDialog.tsx` (NEW, ~200-280
    LOC) — typing-confirm + CASCADE checkbox + inline DDL
    preview + Safe Mode dispatch. Apply variant=destructive,
    disabled until typing match. CASCADE label = `"Drop
    dependent objects (CASCADE)"` (diverges from Sprint 235
    label — see Open questions §3).
  - `src/components/schema/DropColumnDialog.test.tsx` (NEW,
    ~260-320 LOC) — ≥ 12 cases including Safe Mode matrix.
  - `src/components/structure/ColumnsEditor.tsx` (~+50 / ~-15
    LOC) — rewire `+ Column` toolbar button to open
    `<AddColumnDialog>` instead of pushing inline
    `NewColumnDraft`. Rewire per-row trash icon to open
    `<DropColumnDialog>` instead of pushing pending drop. The
    inline `pendingChanges` MODIFY flow stays UNCHANGED.
  - `src/components/structure/ColumnsEditor.test.tsx` (~+80 /
    ~-30 LOC) — mechanical updates: existing inline-add and
    inline-drop tests rewritten to assert modal mounts. Modify
    path tests stay intact.

### Out of scope (defer to Sprint 237 / Phase 27 마무리)

- **Column modify** (type change, USING cast, nullability,
  DEFAULT change) — Sprint 237.
- **Column rename** (`ALTER TABLE … RENAME COLUMN`) — defer to
  Sprint 237 if scope; otherwise out of Phase 27.
- **Multi-step ALTER TABLE in one tx** (add column + add
  constraint + add index) — Sprint 237.
- **Column reorder** — PG natively unsupported; out of phase-27.
- **Index / constraint rename** — Phase 25 polish.
- **View / sequence / function / trigger drop** — Phase 26+.
- **MongoDB collection field add / drop UI** — separate paradigm.
- **DEFERRABLE / INITIALLY DEFERRED FK options** — Phase 27 polish.
- **Sprint 180 cancel-token integration for DDL** — Sprint 235
  OQ-3 precedent: defer to cross-cutting sprint.
- **CASCADE preflight: `pg_depend` dependency analysis** — let PG
  surface error verbatim.
- **Column COMMENT in `add_column`** — Sprint 237 polish (the
  `ColumnDefinition.comment` field is REUSED but `add_column`
  does NOT emit `COMMENT ON COLUMN`).
- **Named CHECK constraint** (`ADD CONSTRAINT chk_x_y CHECK
  (...)`) — inline form only this sprint. Multi-statement /
  named CHECK is Sprint 237.
- **Pre-check column existence on add** — let PG surface
  `ERROR: column "X" of relation "Y" already exists` verbatim.

## Invariants

The 14 frozen paths from Sprint 235 stay frozen — diff = 0:

1. `src/components/structure/useDdlPreviewExecution.ts` (Sprint
   214).
2. `src/components/structure/SqlPreviewDialog.tsx` (Sprint 214).
3. `src/__tests__/cross-window-connection-sync.test.tsx`.
4. `src/__tests__/cross-window-store-sync.test.tsx`.
5. `src/__tests__/window-lifecycle.ac141.test.tsx`.
6. `src/stores/connectionStore.ts`.
7. `src/stores/schemaStore.ts`.
8. `src/stores/safeModeStore.ts`.
9. `src/lib/safeMode.ts` (Sprint 231 — `decideSafeModeAction`
   matrix unchanged).
10. `src/lib/sql/sqlSafety.ts`.
11. `src/hooks/useFkReferencePicker.ts` (Sprint 229).
12. `src/lib/sql/postgresTypes.ts` (Sprint 230).
13. `src/components/shared/SqlSyntax.tsx` (Sprint 233).
14. `src/lib/sql/sqlTokenize.ts` (Sprint 233).

Plus Sprint 226-235 byte-equivalent invariants:

- `src/hooks/useSchemaTableMutations.ts` (Sprint 223 hook
  signature unchanged — Sprint 236 does NOT extend the hook).
- `src/hooks/useSafeModeGate.ts` (Sprint 231 invariant).
- `src/hooks/usePostgresTypes.ts` (Sprint 230 invariant).
- `src/components/schema/CreateTableDialog.tsx` /
  `CreateTableDialog/Header.tsx` (Sprint 226-234 byte-equivalent).
- `src/components/schema/CreateTableTypeCombobox.tsx` (Sprint
  227+230 byte-equivalent — `AddColumnDialog` reuses as black-box).
- `src/components/schema/RenameTableDialog.tsx` /
  `RenameTableDialog.test.tsx` (Sprint 235 byte-equivalent).
- `src/components/schema/DropTableDialog.tsx` /
  `DropTableDialog.test.tsx` (Sprint 235 byte-equivalent).
- `src/components/schema/SchemaTree.actions.test.tsx` (Sprint 235
  byte-equivalent — no SchemaTree wiring this sprint).
- All Sprint 226-235 cargo `--lib` test fixtures pass UNMODIFIED:
  `create_table` 22/22, `create_index` 11/11, `add_constraint`
  12/12, `rename_table` 11/11, `drop_table` 6/6, `alter_table`
  byte-equivalent.
- `alter_table` body byte-equivalent — Sprint 236 introduces
  PARALLEL `add_column` / `drop_column` commands but does NOT
  modify `alter_table` (which still covers `ColumnChange::Add` /
  `ColumnChange::Drop` via the batched modify path; Sprint 237
  may revisit).

Code-quality invariants:

- Zero new `it.skip` / `describe.skip` / `it.only` / `xit` /
  `it.todo`.
- Zero new `eslint-disable*` lines (other than mirroring the
  same `react-hooks/exhaustive-deps` Sprint 235 dialogs already
  use; justify in `findings.md`).
- Zero new silent `catch {}` blocks.
- Zero new `any` in TS, zero new `unwrap()` in production Rust
  paths.

## Done Criteria

1. **AC-236-01** — Backend `add_column` Tauri command accepts
   `AddColumnRequest { connection_id, schema, table, column,
   check_expression?, preview_only }`. Preview returns
   `SchemaChangeResult { sql }` without DB write; execute runs
   inside `BEGIN/COMMIT`. Identifier validation via shared
   `validate_identifier`. Empty `column.data_type.trim()` →
   `AppError::Validation`. SQL emission order locked: `<name>
   <type> [NOT NULL] [DEFAULT <expr>] [CHECK (<expr>)]`. ≥ 6
   Rust fixtures (basic, NOT NULL, DEFAULT, CHECK, full-combo,
   preview-only).

2. **AC-236-02** — Backend `drop_column` Tauri command accepts
   `DropColumnRequest { connection_id, schema, table,
   column_name, cascade, preview_only }`. SQL = `ALTER TABLE
   "<schema>"."<table>" DROP COLUMN "<column_name>"` (no
   `RESTRICT`) when `cascade=false`; `... DROP COLUMN "<col>"
   CASCADE` when `cascade=true`. No pre-existence check. ≥ 4
   Rust fixtures.

3. **AC-236-03** — Frontend exposes `tauri.addColumnRequest(
   request)` + `tauri.dropColumnRequest(request)` in
   `src/lib/tauri/ddl.ts` returning `Promise<SchemaChangeResult>`.
   IPC payload `{ request: { ... } }` envelope. Vitest asserts
   call sequence `[{ previewOnly: true }, { previewOnly: false
   }]`. Rust serde roundtrip tests lock the wire shape.

4. **AC-236-04** — `AddColumnDialog` (new) renders name input +
   type combobox (consumes `usePostgresTypes` mock) + NOT NULL
   checkbox (default OFF) + DEFAULT input + CHECK input +
   collapsible Show DDL (default collapsed) + Cancel + Apply.
   Apply disabled on (a) identifier validation fail, (b) empty
   type, (c) no/stale preview, (d) name collision with loaded
   `columns` prop. ≥ 8 vitest cases.

5. **AC-236-05** — `DropColumnDialog` (new) renders typing-
   confirm + CASCADE checkbox (label `"Drop dependent objects
   (CASCADE)"`, default OFF) + inline preview. Apply disabled
   until case-sensitive byte-for-byte match. CASCADE toggle
   invalidates preview. ≥ 5 vitest cases.

6. **AC-236-06** — Drop dispatches through `useSafeModeGate(
   connectionId).decide(analyzeStatement(previewSql))`. Block
   path → canonical message + commit closure NEVER invoked.
   Warn path → both typing match AND `pendingConfirm` flow +
   warn-cancel canonical message. Safe path → typing match
   only. ≥ 4 cases covering matrix.

7. **AC-236-07** — `ColumnsEditor` wiring: `+ Column` button
   mounts `<AddColumnDialog>`; trash icon mounts
   `<DropColumnDialog>`. Commit-success on each → `onRefresh`
   called once. Inline MODIFY path (Edit pencil → save →
   `pendingChanges` → review SQL → `alter_table`) stays
   UNCHANGED. ≥ 4 cases.

8. **AC-236-08** — Cache refresh: dropped column gone +
   added column appears after `getTableColumns` re-fetch
   (writes through `tableColumnsCache`). `useSchemaTable
   Mutations` NOT extended. ≥ 2 cases.

9. **AC-236-09** — Identifier validation rejects (BOTH layers):
   empty / whitespace, embedded `"`, embedded NULL byte, > 63
   bytes, leading digit. ≥ 4 cases each layer.

10. **AC-236-10** — DEFAULT and CHECK passthrough verbatim — no
    escaping, no syntax check, no normalization. Embedded `'` +
    `now()` + parametric `varchar(255)` all pass through. Rust
    fixture `add_column_default_with_embedded_quote_passthrough`
    + frontend IPC payload assertion.

11. **AC-236-11** — 4-set verification PASS. Vitest count ≥ 2886
    + ≥ 24 new = ≥ 2910 tests; cargo `--lib` count ≥ 395 + ≥ 12
    new = ≥ 407.

12. **AC-236-12** — Sprint 226-235 byte-equivalent: 22-fixture
    `create_table`, 11-fixture `create_index`, 12-fixture
    `add_constraint`, 11-fixture `rename_table`, 6-fixture
    `drop_table`, `alter_table` all pass UNMODIFIED. Frozen
    file diff = 0.

## Verification Plan

- **Profile:** `mixed` (browser visual smoke + command-line
  cargo / vitest / tsc / lint / build).

- **Required checks (54 total):**
  1. `pnpm vitest run` — 0 failed; ≥ 2910 tests.
  2. `pnpm tsc --noEmit` — exit 0.
  3. `pnpm lint` — exit 0.
  4. `cargo build --manifest-path src-tauri/Cargo.toml` — Finished.
  5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-
     targets --all-features -- -D warnings` — 0 warnings.
  6. `cargo fmt --check --manifest-path src-tauri/Cargo.toml` —
     silent.
  7. `cargo test --lib add_column` — ≥ 6 new fixtures PASS.
  8. `cargo test --lib drop_column` — ≥ 4 new fixtures PASS.
  9. `cargo test --lib serde_camelcase_roundtrip` — ≥ 4 (2
     existing Sprint 235 + 2 new Sprint 236).
  10. `cargo test --lib create_table` — Sprint 226-235 22-
      fixture suite PASS unchanged.
  11. `cargo test --lib create_index` — 11/11 unchanged.
  12. `cargo test --lib add_constraint` — 12/12 unchanged.
  13. `cargo test --lib rename_table` — 11/11 unchanged.
  14. `cargo test --lib drop_table` — 6/6 unchanged.
  15. `cargo test --lib alter_table` — PASS unchanged.
  16. `cargo test --lib` — ≥ 407 (was 395 + ≥ 12 new).
  17. `pnpm vitest run src/components/schema/AddColumnDialog.
      test.tsx` — ≥ 12 cases PASS.
  18. `pnpm vitest run src/components/schema/DropColumnDialog.
      test.tsx` — ≥ 12 cases PASS.
  19. `pnpm vitest run src/components/structure/ColumnsEditor.
      test.tsx` — modify path unchanged + add/drop rewired.
  20-26. Regression vitest suites — DropTableDialog,
      RenameTableDialog, CreateTableDialog,
      SchemaTree.actions, useSchemaTableMutations,
      useDdlPreviewExecution, usePostgresTypes — all PASS
      unchanged.
  27. `pnpm vitest run -t "AC-236"` — all PASS.
  28-41. Frozen file diff = 0 — useDdlPreviewExecution,
      SqlPreviewDialog, useSafeModeGate, safeMode + sqlSafety,
      schemaStore, connectionStore, safeModeStore,
      useSchemaTableMutations, postgresTypes + usePostgresTypes,
      CreateTableDialog, RenameTableDialog + DropTableDialog
      (impl + tests), SchemaTree.actions test, cross-window
      tests.
  42. `grep -nE 'ADD COLUMN' src-tauri/src/db/postgres/
      mutations.rs` — ≥ 1 (in `add_column` body).
  43. `grep -nE 'DROP COLUMN' src-tauri/src/db/postgres/
      mutations.rs` — ≥ 1 (existing `alter_table` ColumnChange::
      Drop also matches — accept ≥ 2).
  44. `grep -nE 'AddColumnRequest|DropColumnRequest'
      src-tauri/src/models/schema.rs` — ≥ 4.
  45. `grep -nE 'addColumnRequest|dropColumnRequest'
      src/lib/tauri/ddl.ts` — ≥ 2.
  46. `grep -nE 'Type the column name' src/components/schema/
      DropColumnDialog.tsx` — ≥ 1.
  47. `grep -nE 'Drop dependent objects \(CASCADE\)'
      src/components/schema/DropColumnDialog.tsx` — ≥ 1.
  48. `git diff --stat src/components/schema/DocumentDatabaseTree
      /useDocumentDatabaseDrop.ts src/lib/tauri/document.ts
      src/lib/mongo/mongoSafety.ts` — 0 each.
  49. `grep -rnE 'it\.only|it\.skip|describe\.skip|xit|it\.todo'
      src/components/schema/AddColumnDialog.test.tsx
      src/components/schema/DropColumnDialog.test.tsx
      src/components/structure/ColumnsEditor.test.tsx` — 0.
  50. `git diff src/ src-tauri/ | grep "^+.*eslint-disable"` —
      0 new (justify any in findings).
  51. `git diff src/ | grep -E "^\+.*\bany\b"` — 0.
  52. `grep -rnE '\}\s*catch\s*\{\s*\}' src/components/schema/
      AddColumnDialog.tsx src/components/schema/DropColumnDialog.
      tsx` — 0.
  53. `grep -nE '"ddl-structure"' src/components/schema/
      AddColumnDialog.tsx src/components/schema/DropColumnDialog.
      tsx` — ≥ 0 (consumed via `useDdlPreviewExecution`,
      asserted in test).
  54. `grep -nE 'commands::rdb::ddl::add_column|commands::rdb::
      ddl::drop_column' src-tauri/src/lib.rs` — ≥ 2.

- **Browser visual smoke (manual, recommended; document in
  `findings.md` if performed):**
  1. `pnpm tauri dev` → connect to PG → Structure tab → Columns
     sub-tab → click `+ Column` → AddColumnDialog mounts →
     fill name + type + NOT NULL + DEFAULT + CHECK → Show DDL
     → preview pane shows full SQL → Apply → modal closes →
     new row visible in editor.
  2. Type combobox: free-text `numeric(10,4)` → preview emits
     verbatim.
  3. Drop column: trash icon on row → DropColumnDialog →
     CASCADE off → typing-confirm → Show DDL shows
     `DROP COLUMN "<col>"` → Apply → row gone.
  4. Drop with CASCADE → preview re-fetches → SQL ends with
     `... CASCADE`.
  5. Drop a referenced column without CASCADE → PG error
     verbatim in `previewError` → modal stays open.
  6. Type-confirm mismatch (`Email` vs `email`) → Apply
     disabled.
  7. Add column with name collision → Apply disabled with hint.
  8. Drop PK column → PG error verbatim → modal stays open.

- **Required evidence:**
  - Changed files table (path / lines / purpose).
  - Test counts: vitest before/after; cargo before/after.
  - AC-236 coverage table (AC → test name → file:line → result).
  - Verification check results (54 / 54 expected).
  - Byte-equivalent SQL strings (verbatim) for the 5+ named add
    fixtures + 2 named drop fixtures.
  - Confirmation that `useDdlPreviewExecution` /
    `useSafeModeGate` / `useSchemaTableMutations` /
    `usePostgresTypes` / `CreateTableTypeCombobox` were reused
    without diff.
  - Confirmation that Mongo path untouched (check 48).
  - Confirmation that Sprint 235 dialogs / tests untouched
    (checks 38, 39).
  - Open questions resolved (positional alias emit, hook
    extension vs inline, CASCADE label inconsistency,
    context-menu vs trash icon, button repurpose,
    `alter_table` Add/Drop arms).
  - Decisions taken (CHECK inline, NOT NULL default OFF,
    DEFAULT free-text, CASCADE default OFF, Show DDL
    collapsed, cache via onRefresh, typing-confirm case-
    sensitive byte-for-byte, drop pre-existence check
    REMOVED).
  - Edge cases tested (with file:line refs).
  - Assumptions made + residual risks.

## Evidence To Return

- Changed files and purpose.
- Checks run and outcomes (54 checks).
- Done criteria (AC-236-01..AC-236-12) coverage with concrete
  evidence.
- Assumptions made during implementation (especially: positional
  alias emit decision, hook-extension decision, CASCADE label
  inconsistency, context-menu vs trash, button repurpose,
  `alter_table` Add/Drop arms keep-vs-remove).
- Residual risk or verification gaps.

## References

- **Contract:** `docs/sprints/sprint-236/contract.md`.
- **Findings (Generator writes):**
  `docs/sprints/sprint-236/findings.md`.
- **Pattern source contracts:**
  - `docs/sprints/sprint-235/contract.md` — Sprint 235 rename /
    drop table modals + dual-export IPC compat layer + typing-
    confirm + CASCADE + Safe Mode dispatch (PRIMARY pattern
    source — Sprint 236 mirrors this shape exactly for the
    column family).
  - `docs/sprints/sprint-235/handoff.md` — Sprint 235 changed
    files + AC coverage table + decisions taken (read for the
    "load-bearing dual-export" pattern + "case-sensitive
    byte-for-byte typing confirm" decision).
  - `docs/sprints/sprint-226/contract.md` — Sprint 226 CREATE
    TABLE backend + dialog wiring (ColumnDefinition struct +
    preview pane styling + Show DDL collapsible default).
  - `docs/sprints/sprint-227/contract.md` — `CreateTableType
    Combobox` props + parametric type free-text fallback.
  - `docs/sprints/sprint-230/contract.md` — `usePostgresTypes`
    hook + `typesByName` ReadonlyMap (Sprint 236 reuses
    verbatim).
  - `docs/sprints/sprint-214/contract.md` —
    `useDdlPreviewExecution` hook contract.
  - `docs/sprints/sprint-223/contract.md` —
    `useSchemaTableMutations` hook (table-scoped — Sprint 236
    does NOT extend).
  - `docs/sprints/sprint-189/contract.md` — `useSafeModeGate`
    / `decideSafeModeAction` matrix.
  - `docs/sprints/sprint-229/contract.md` — CHECK constraint
    free-text contract (mirror for `add_column` CHECK
    expression scope).
- **Phase doc:** `docs/phases/phase-27.md`.
- **Master plan:** `docs/PLAN.md`.

### Relevant files (READ before implementing)

Backend:
- `src-tauri/src/commands/rdb/ddl.rs:1-121` — current handler
  shapes. Add `add_column` + `drop_column` between
  `rename_table` (line 38-49) and `alter_table` (line 51-61).
- `src-tauri/src/db/traits.rs:155-204` — current `RdbAdapter`
  trait DDL block. Add `add_column` / `drop_column` siblings
  between `alter_table` (line 174-177) and `create_table`
  (line 181-184) — OR between `drop_constraint` and
  `get_table_indexes`; either is fine; mirror the Sprint 235
  positioning (rename_table / drop_table at the top of the
  DDL block).
- `src-tauri/src/db/postgres/mutations.rs:111-226` — current
  `drop_table` + `rename_table` impls (Sprint 235 PATTERN
  SOURCE — mirror the BEGIN/COMMIT shape, the
  `validate_identifier` calls, the `req.preview_only` branch).
- `src-tauri/src/db/postgres/mutations.rs:228-410` —
  `create_table` impl (mirror for transactional commit + SQL
  emission style).
- `src-tauri/src/db/postgres/mutations.rs:414-502` —
  `alter_table` impl. **The existing `ColumnChange::Add` /
  `ColumnChange::Drop` arms are the SQL emission reference**
  — the new `add_column` / `drop_column` SQL must be byte-
  equivalent to the corresponding single-statement
  `alter_table` emission (just packaged as standalone commands
  with the new request shapes + the additional `CHECK` clause
  for add).
- `src-tauri/src/db/postgres/mutations.rs:760-800` — Sprint
  235 `drop_req` / `rename_req` builder helpers (mirror for
  `add_col_req` / `drop_col_req` builders).
- `src-tauri/src/db/postgres/mutations.rs:32-64` —
  `validate_identifier` helper (REUSE for new methods).
- `src-tauri/src/models/schema.rs:206-250` —
  `ColumnDefinition` struct (REUSED in `AddColumnRequest`) +
  `RenameTableRequest` + `DropTableRequest` (mirror the
  Sprint 235 shape: `#[serde(rename_all = "camelCase")]`,
  `#[serde(default)]` on optional fields).
- `src-tauri/src/lib.rs:148-155` — DDL handler registration
  block. Add `add_column` + `drop_column` between
  `rename_table` (line 149) and `alter_table` (line 150).

Frontend:
- `src/lib/tauri/ddl.ts:1-121` — IPC wrappers + Sprint 235
  dual-export pattern. Add `addColumnRequest` /
  `dropColumnRequest` (request-shaped) + optional `addColumn`
  / `dropColumn` aliases.
- `src/types/schema.ts:124-159` — Sprint 235
  `RenameTableRequest` + `DropTableRequest` TS types (mirror
  for the new column request types).
- `src/types/schema.ts:235-259` — `ColumnDefinition` +
  `CreateTableRequest` (REUSE `ColumnDefinition` in
  `AddColumnRequest`).
- `src/components/schema/RenameTableDialog.tsx` (Sprint 235
  PRIMARY pattern source for `AddColumnDialog`'s shell —
  identifier validation, preview pane, Apply disabled
  matrix).
- `src/components/schema/DropTableDialog.tsx` (Sprint 235
  PRIMARY pattern source for `DropColumnDialog` — typing-
  confirm + CASCADE + Safe Mode dispatch).
- `src/components/schema/CreateTableDialog.tsx:420-1130` —
  `usePostgresTypes` + `<CreateTableTypeCombobox>` wiring
  inside the column-row repeater. Mirror the
  `typesSource={types}` + `typeKindMap={typesByName}` props.
- `src/components/schema/CreateTableTypeCombobox.tsx:32-67`
  — combobox props (`value` / `onChange` / `typesSource` /
  `typeKindMap` / `ariaLabel` / `placeholder`).
- `src/hooks/usePostgresTypes.ts:224-300` —
  `usePostgresTypes(connectionId)` hook (returns `types`,
  `typesByName`, `loading`, `error`, `reload`).
- `src/components/structure/ColumnsEditor.tsx:1-694` —
  current editor. Sprint 236 rewires `handleAddColumn`
  (line 376-387) to open `<AddColumnDialog>` and
  `handleDeleteColumn` (line 439-459) to open
  `<DropColumnDialog>`. Inline `pendingChanges` MODIFY path
  (Edit pencil → save → review SQL) stays UNCHANGED.
- `src/components/structure/useDdlPreviewExecution.ts:1-232`
  — hook contract (DO NOT MODIFY).
- `src/hooks/useSafeModeGate.ts:1-32` — gate signature (DO
  NOT MODIFY).
- `src/hooks/useSchemaTableMutations.ts:1-112` — Sprint 223
  hook (DO NOT MODIFY; do NOT extend with column methods —
  see decisions §Cache invalidation path).
- `src/components/schema/RenameTableDialog.test.tsx` /
  `DropTableDialog.test.tsx` — Sprint 235 test pattern source
  for the new dialog tests (mock `tauri.{add,drop}Column
  Request`, assert IPC sequence, assert form behaviour, assert
  Safe Mode matrix).
- `src/components/schema/DocumentDatabaseTree/
  useDocumentDatabaseDrop.ts` — Mongo Safe Mode dispatch
  reference (READ ONLY — do not modify).
- `src/components/schema/StructurePanel.tsx:60-128` — confirms
  that `onRefresh` chains through `fetchData` →
  `getTableColumns` → `tableColumnsCache` write-through. The
  cache invalidation path Sprint 236 uses — no new code path.

### Cautions

- The user's spec frames Sprint 236 as "mirror Sprint 235 for the
  column family". Read the Sprint 235 contract end-to-end
  (`docs/sprints/sprint-235/contract.md`, 960 lines) for the
  decisions baked into the table-level dialogs — they apply
  verbatim to the column-level dialogs except where flagged in
  Open questions.
- The CASCADE checkbox label DIVERGES from Sprint 235. User spec
  locks Sprint 236 to `"Drop dependent objects (CASCADE)"`;
  Sprint 235 ships `"CASCADE — drop dependent objects (default:
  off)"`. Sprint 235 stays diff = 0 (frozen). The browser
  smoke will visibly show two different labels — flag for
  future polish sprint.
- `useSchemaTableMutations` is **table-scoped** (drop / rename
  table, patches `state.tables`). Do NOT extend it for column
  add/drop — the natural-extension test fails (different cache
  key, different fallback semantics). Sprint 236 cache
  invalidation flows through the existing `onRefresh()` prop
  chain (`AddColumnDialog → ColumnsEditor → StructurePanel.
  fetchData → getTableColumns → tableColumnsCache write-
  through`). `schemaStore.ts` and `useSchemaTableMutations.ts`
  both stay diff = 0.
- The `+ Column` toolbar button currently pushes an inline
  `NewColumnDraft` row. Sprint 236 REPURPOSES the button to open
  `<AddColumnDialog>` — the inline path is REMOVED. The inline-
  batched MODIFY path (Edit pencil → save → review SQL → batched
  `alter_table`) stays UNCHANGED. If the Generator finds users
  rely on the inline-batched ADD workflow (e.g. add 3 columns in
  one tx via `pendingChanges`), flag in `findings.md` and
  consider keeping both surfaces.
- Per-row trash icon in `EditableColumnRow` currently pushes a
  `pendingChanges` drop entry. Sprint 236 REPURPOSES the icon to
  open `<DropColumnDialog>`. The user spec says "context-menu
  entry" but no right-click menu currently exists — adding a
  full context menu is a non-trivial UX expansion. Default:
  rewire the existing trash icon. Flag in `findings.md` if the
  user wants a literal right-click menu.
- The `alter_table` Tauri command still handles
  `ColumnChange::Add` / `ColumnChange::Modify` /
  `ColumnChange::Drop` in batched form. Sprint 236 introduces
  PARALLEL `add_column` / `drop_column` — do NOT modify
  `alter_table` (Sprint 237 polish target). The `add_column` /
  `drop_column` SQL emission MUST be byte-equivalent to what
  `alter_table` would emit for the equivalent single
  `ColumnChange::Add{nullable=false, default=Some(x)}` /
  `ColumnChange::Drop` (modulo the new `CHECK` clause).
- Sprint 226 `ColumnDefinition` struct is REUSED verbatim in
  `AddColumnRequest.column`. The `comment` field is part of
  `ColumnDefinition` (Sprint 227) but `add_column` does NOT
  emit `COMMENT ON COLUMN` (Sprint 237 polish). The field flows
  through deserialization but is silently ignored on the
  emission side.
- DEFAULT and CHECK expressions are FREE-TEXT verbatim
  passthrough. NO escaping, NO syntax validation. User-
  responsibility convention (mirrors Sprint 229 CHECK contract).
  An embedded `'` in DEFAULT will produce SQL that PG rejects
  with a syntax error — surface verbatim in `previewError`.
- The trait signature change (`drop_table` / `rename_table`
  from positional → request) was Sprint 235 work. Sprint 236
  ADDs `add_column` / `drop_column` as NEW methods — no
  signature change to existing trait methods. Trait stub
  updates needed in `src-tauri/src/db/tests.rs` +
  `src-tauri/src/commands/meta.rs` (add the two new arms;
  return `AppError::Unsupported` or fixture
  `SchemaChangeResult { sql: "" }`).
- Existing `ColumnsEditor.test.tsx` cases reference inline-add
  (`<NewColumnRow>` mounts) and inline-drop (`pendingChanges`
  with type=drop). Mechanical rewrite to the new modal mounts
  is ALLOWED (explicitly noted in the contract's Test
  invariants section). The inline MODIFY tests stay intact.
- TDD evidence path: capture a `red-state.log` (or use a red-
  state commit) in `docs/sprints/sprint-236/tdd-evidence/`
  per `docs/PLAN.md:182-186`.
