# Sprint Execution Brief: sprint-235

## Objective

Promote the existing **Rename Table** and **Drop Table** SchemaTree
flows from "minimal confirm dialog" to the Phase 24-26 DDL surface
contract:

- Backend `rename_table` / `drop_table` Tauri commands gain a
  `preview_only` branch + return `SchemaChangeResult { sql }` (mirror
  `create_table` / `alter_table`).
- Frontend grows two new modals: `RenameTableDialog` (single-field +
  inline DDL preview, no Safe Mode gate dispatch UX) and
  `DropTableDialog` (CASCADE checkbox + inline DDL preview + typing-
  confirm + Safe Mode gate dispatch).
- Both modals reuse `useDdlPreviewExecution` (Sprint 214) for the
  preview/execute lifecycle and `useSchemaTableMutations` (Sprint 223)
  for the post-commit cache refresh.
- The existing `Rename` / `Drop` context-menu items in
  `src/components/schema/SchemaTree/rows.tsx` keep their labels +
  positions; only the handlers + modal slots change.

This is Phase 27 sprint 10 of 11 (the master plan's "Sprint 189 —
Table CRUD" minus `create_table`, which Sprint 226 already shipped).

## Task Why

- **TablePlus parity** — Phase 27 closes the `working-with-table`
  parity gap. CREATE shipped in Sprint 226; this sprint closes
  rename + drop with the proper preview / Safe Mode / typing-confirm
  UX that the rest of Phase 24-26 already enforces for column / index
  / constraint mutations. Without this, drop/rename is the only DDL
  surface that bypasses the preview dialog + Safe Mode matrix —
  inconsistent UX + a Phase 23 invariant gap.
- **Sprint 198 mongo dropCollection parity** — Mongo collections
  already dispatch through `useSafeModeGate.decide` before drop;
  RDB tables should match.
- **Unblocks Sprint 236 (column add/drop) and Sprint 237 (column
  modify + USING cast)** — those depend on the same modal pattern.

## Scope Boundary

### In scope

- **Backend (Rust)**
  - `src-tauri/src/models/schema.rs` — add `RenameTableRequest` +
    `DropTableRequest` structs (camelCase serde); ≥ 2 serde roundtrip
    tests.
  - `src-tauri/src/db/traits.rs` — change `RdbAdapter::rename_table`
    and `::drop_table` signatures from positional scalars to
    `req: &RenameTableRequest` / `req: &DropTableRequest`, returning
    `Result<SchemaChangeResult, AppError>`.
  - `src-tauri/src/db/postgres/mutations.rs` — rewrite the existing
    `rename_table` and `drop_table` bodies to accept the request
    types, validate identifiers via shared `validate_identifier`
    helper, emit ANSI-quoted SQL with preview/execute branches
    (transactional `BEGIN/COMMIT`). Drop pre-existence check is
    REMOVED (let PG surface error verbatim — mirrors `create_table`).
    CASCADE branch appends ` CASCADE` literal; non-CASCADE branch
    omits the `RESTRICT` keyword (PG default). ≥ 8 new fixtures total
    (4 per command).
  - `src-tauri/src/commands/rdb/ddl.rs` — rewrite the `drop_table` +
    `rename_table` `#[tauri::command]` handlers to take
    `request: DropTableRequest` / `request: RenameTableRequest` (mirror
    `create_table` / `alter_table` shape). Tauri command names
    UNCHANGED.
  - `src-tauri/src/lib.rs` — no diff (handler identifiers unchanged).
- **Frontend (TS/TSX)**
  - `src/types/schema.ts` — add `RenameTableRequest` +
    `DropTableRequest` TS types.
  - `src/lib/tauri/ddl.ts` — DUAL exports for `dropTable` /
    `renameTable`:
    - New: `dropTableRequest(req)` / `renameTableRequest(req)` →
      `Promise<SchemaChangeResult>` (used by the new modals).
    - Compat: keep the old positional `dropTable(connectionId, table,
      schema)` / `renameTable(connectionId, table, schema, newName)`
      shapes returning `Promise<void>`; they call the request
      variants internally with `previewOnly: false` and discard the
      returned SQL. This keeps `schemaStore.dropTable` /
      `.renameTable` byte-equivalent (Sprint 223 hook + store
      invariant).
  - `src/components/schema/RenameTableDialog.tsx` (NEW) — single text
    input + Cancel + Show DDL + Apply buttons + inline preview
    pane. Reuses `useDdlPreviewExecution`. Apply disabled when input
    == current name OR fails identifier regex OR > 63 bytes. **NO
    explicit Safe Mode UX path** — `useDdlPreviewExecution` already
    routes through the gate internally; rename SQL almost never trips
    the warn/block tier so the path stays a no-op-equivalent in
    practice.
  - `src/components/schema/RenameTableDialog.test.tsx` (NEW) — ≥ 8
    cases.
  - `src/components/schema/DropTableDialog.tsx` (NEW) — typing-
    confirm input ("Type the table name to confirm"; case-sensitive
    byte-for-byte equality), CASCADE checkbox (default off; toggling
    invalidates preview), inline preview pane, Cancel + Show DDL +
    Apply buttons. Apply is disabled until typing-confirm matches.
    Dispatches through Safe Mode gate (block / warn-confirm / safe
    matrix).
  - `src/components/schema/DropTableDialog.test.tsx` (NEW) — ≥ 10
    cases including Safe Mode matrix.
  - `src/components/schema/SchemaTree/dialogs.tsx` (MOD) — replace
    the existing `DropTableConfirmDialog` + `RenameTableDialog` (the
    current minimal versions) with `RenameTableDialogSlot` +
    `DropTableDialogSlot` mount wrappers (mirror `CreateTableDialog
    Slot`).
  - `src/components/schema/SchemaTree/useSchemaTreeActions.ts`
    (MOD) — collapse the existing `confirmDialog` / `renameDialog`
    / `renameInput` / `renameError` / `isOperating` /
    `renameInputRef` state slots into two new slots:
    `renameTableDialog: { schemaName, tableName } | null` +
    `dropTableDialog: { schemaName, tableName } | null`. Collapse
    `handleDropTable` / `handleStartRename` / `handleConfirmRename`
    into 2 simple openers; the inner SQL-execution + history-record
    logic moves into the modals (delegated to
    `useDdlPreviewExecution`).
  - `src/components/schema/SchemaTree/rows.tsx` — diff = 0 (existing
    Rename / Drop menu items already call the right handler names;
    handler bodies change but not the call shape).
  - `src/components/schema/SchemaTree.tsx` (MOD) — swap the two
    dialog mounts to the new slot components.
  - `src/components/schema/SchemaTree.actions.test.tsx` (MOD) —
    rewrite the Rename / Drop case bodies to assert on the new modal
    slots + add 4 new cases per AC-235-07/08.

### Out of scope (defer to future sprints)

- Column add / drop / rename — Sprint 236.
- Column type modify + USING cast — Sprint 237.
- Multi-step ALTER TABLE in one tx — Sprint 237+.
- Index / constraint rename — Phase 25 polish.
- View / sequence / function / trigger drop — Phase 26+.
- MongoDB collection rename / drop UI — separate paradigm.
- DEFERRABLE / INITIALLY DEFERRED FK options — Phase 27 polish later.
- Sprint 180 cancel-token integration for DDL — see Open Questions §3
  in the contract.
- Drop CASCADE preflight (`pg_depend` dependency analysis) — Sprint
  238 candidate. Inline preview pane shows verbatim SQL only.

## Invariants

The 14 frozen paths from Sprint 234 stay frozen — diff = 0:

1. `src/components/structure/useDdlPreviewExecution.ts` (Sprint 214).
2. `src/components/structure/SqlPreviewDialog.tsx` (Sprint 214).
3. `src/__tests__/cross-window-connection-sync.test.tsx`.
4. `src/__tests__/cross-window-store-sync.test.tsx`.
5. `src/__tests__/window-lifecycle.ac141.test.tsx`.
6. `src/stores/connectionStore.ts`.
7. `src/stores/schemaStore.ts` (the IPC wrapper compat layer in
   `ddl.ts` keeps the store's call shape byte-equivalent).
8. `src/stores/safeModeStore.ts`.
9. `src/lib/safeMode.ts` (Sprint 231 — `decideSafeModeAction` matrix
   unchanged).
10. `src/lib/sql/sqlSafety.ts`.
11. `src/hooks/useFkReferencePicker.ts` (Sprint 229).
12. `src/lib/sql/postgresTypes.ts` (Sprint 230).
13. `src/components/shared/SqlSyntax.tsx` (Sprint 233).
14. `src/lib/sql/sqlTokenize.ts` (Sprint 233).

Plus:

- `src/hooks/useSchemaTableMutations.ts` (Sprint 223 hook signature
  unchanged) — the new modals consume the existing `dropTable` /
  `renameTable` surface; no new methods.
- `src/hooks/useSafeModeGate.ts` (Sprint 231 invariant).
- `src/components/schema/CreateTableDialog.tsx` +
  `src/components/schema/CreateTableDialog/Header.tsx` (Sprint 226-234
  byte-equivalent).
- All Sprint 226-234 cargo `create_table` byte-string fixtures pass
  UNMODIFIED.
- All Sprint 226-234 vitest cases on `CreateTableDialog.test.tsx`
  pass.

Code-quality invariants:

- Zero new `it.skip` / `describe.skip` / `it.only` / `xit` / `it.todo`.
- Zero new `eslint-disable*` lines.
- Zero new silent `catch {}` blocks.
- Zero new `any` in TS, zero new `unwrap()` in production Rust paths.

## Done Criteria

1. **AC-235-01** — Backend `rename_table` Tauri command accepts
   `RenameTableRequest { connection_id, schema, table, new_name,
   preview_only }`. `preview_only=true` returns `SchemaChangeResult
   { sql }` without DB write; `preview_only=false` executes inside
   `BEGIN/COMMIT`. Identifier validation via shared
   `validate_identifier`. Rust fixture
   `rename_table_preview_byte_equivalent` asserts SQL is byte-
   equivalent to `ALTER TABLE "public"."users" RENAME TO "people"`.

2. **AC-235-02** — Backend `drop_table` Tauri command accepts
   `DropTableRequest { connection_id, schema, table, cascade,
   preview_only }`. SQL = `DROP TABLE "<schema>"."<table>"` (no
   `RESTRICT`) when `cascade=false`; `DROP TABLE "<schema>"."<table>"
   CASCADE` when `cascade=true`. Pre-existence check REMOVED. Rust
   fixtures `drop_table_preview_no_cascade_byte_equivalent` +
   `drop_table_preview_cascade_byte_equivalent` lock the SQL.

3. **AC-235-03** — Frontend `tauri.dropTableRequest(request)` +
   `tauri.renameTableRequest(request)` exported in
   `src/lib/tauri/ddl.ts` returning `Promise<SchemaChangeResult>`.
   Compat positional `dropTable` / `renameTable` exports retained
   for the store. IPC payload uses `{ request: { ... } }` envelope.
   Vitest asserts call sequence is exactly `[{ preview_only: true },
   { preview_only: false }]`.

4. **AC-235-04** — `RenameTableDialog` (new) opens with current name
   pre-filled; Apply disabled when (a) input empty/whitespace, (b)
   fails `^[a-zA-Z_][a-zA-Z0-9_]*$` or > 63 bytes, (c) input ==
   current name. Commit-success closes + `onRefresh()`. ≥ 5 vitest
   cases.

5. **AC-235-05** — `DropTableDialog` (new) renders typing-confirm
   input + CASCADE checkbox + inline preview. Apply disabled until
   typing match (case-sensitive byte-for-byte). CASCADE toggle
   invalidates preview. ≥ 5 vitest cases.

6. **AC-235-06** — Drop dispatches through `useSafeModeGate(
   connectionId).decide(analyzeStatement(previewSql))`. Block path
   surfaces canonical message + commit closure NEVER invoked. Warn
   path requires both typing match AND `pendingConfirm` flow + warn-
   cancel surfaces canonical `"Safe Mode (warn): confirmation
   cancelled — no changes committed"` verbatim. ≥ 4 vitest cases
   covering the matrix.

7. **AC-235-07** — SchemaTree wiring: `Rename` menu opens
   RenameTableDialog; `Drop` menu opens DropTableDialog; commit-
   success on each → `useSchemaTableMutations.{renameTable,
   dropTable}` invoked exactly once. ≥ 4 new cases in
   `SchemaTree.actions.test.tsx`.

8. **AC-235-08** — Selection cleanup: dropped table → `selectedNodeId
   === null` after commit; renamed table → updates or clears (not
   stale). ≥ 2 cases.

9. **AC-235-09** — Identifier validation rejects: empty / whitespace,
   embedded `"`, embedded NULL byte, > 63 bytes, leading digit. Both
   layers (Rust + TS) enforce. ≥ 4 cases per layer.

10. **AC-235-10** — 4-set verification PASS. Vitest count ≥ 2872 +
    new cases; cargo `--lib` count ≥ 385 + new fixtures.

11. **AC-235-11** — Sprint 226-234 byte-equivalent: 22-fixture cargo
    `create_table` suite passes UNMODIFIED; frozen file diff = 0.

## Verification Plan

- **Profile:** `mixed` (browser visual smoke + command-line cargo /
  vitest / tsc / lint / build).

- **Required checks (40 total):**
  1. `pnpm vitest run` — 0 failed; ≥ 2894 tests.
  2. `pnpm tsc --noEmit` — exit 0.
  3. `pnpm lint` — exit 0.
  4. `cargo build --manifest-path src-tauri/Cargo.toml` — Finished.
  5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
     --all-features -- -D warnings` — 0 warnings.
  6. `cargo test --manifest-path src-tauri/Cargo.toml --lib
     rename_table` — ≥ 4 new fixtures PASS.
  7. `cargo test --manifest-path src-tauri/Cargo.toml --lib
     drop_table` — ≥ 4 new fixtures PASS.
  8. `cargo test --manifest-path src-tauri/Cargo.toml --lib
     create_table` — Sprint 226-234 22-fixture suite PASS unchanged.
  9. `cargo test --manifest-path src-tauri/Cargo.toml --lib
     create_index` — PASS unchanged.
  10. `cargo test --manifest-path src-tauri/Cargo.toml --lib
      add_constraint` — PASS unchanged.
  11. `cargo test --manifest-path src-tauri/Cargo.toml --lib
      alter_table` — PASS unchanged.
  12. `cargo test --manifest-path src-tauri/Cargo.toml --lib` —
      ≥ 385 + new fixtures.
  13. `pnpm vitest run src/components/schema/RenameTableDialog.test.
      tsx` — ≥ 8 cases PASS.
  14. `pnpm vitest run src/components/schema/DropTableDialog.test.
      tsx` — ≥ 10 cases PASS.
  15. `pnpm vitest run src/components/schema/SchemaTree.actions.
      test.tsx` — ≥ 4 new cases PASS.
  16. `pnpm vitest run src/hooks/useSchemaTableMutations.test.ts` —
      PASS unchanged.
  17. `pnpm vitest run src/components/schema/CreateTableDialog.test.
      tsx` — PASS unchanged.
  18. `pnpm vitest run -t "AC-235"` — all PASS.
  19. `git diff --stat src/components/structure/useDdlPreview
      Execution.ts` — 0.
  20. `git diff --stat src/components/structure/SqlPreviewDialog.
      tsx` — 0.
  21. `git diff --stat src/hooks/useSafeModeGate.ts` — 0.
  22. `git diff --stat src/lib/safeMode.ts src/lib/sql/sqlSafety.
      ts` — 0.
  23. `git diff --stat src/stores/schemaStore.ts` — 0.
  24. `git diff --stat src/stores/connectionStore.ts` — 0.
  25. `git diff --stat src/stores/safeModeStore.ts` — 0.
  26. `git diff --stat src/hooks/useSchemaTableMutations.ts` — 0.
  27. `git diff --stat src/components/schema/CreateTableDialog.tsx
      src/components/schema/CreateTableDialog/Header.tsx` — 0 each.
  28. `git diff --stat src/__tests__/cross-window-connection-sync.
      test.tsx src/__tests__/cross-window-store-sync.test.tsx
      src/__tests__/window-lifecycle.ac141.test.tsx` — 0 each.
  29. `grep -nE 'DROP TABLE' src-tauri/src/db/postgres/mutations.rs`
      — ≥ 2.
  30. `grep -nE 'RENAME TO' src-tauri/src/db/postgres/mutations.rs`
      — ≥ 1.
  31. `grep -nE 'RenameTableRequest|DropTableRequest' src-tauri/
      src/models/schema.rs` — ≥ 4.
  32. `grep -nE 'dropTableRequest|renameTableRequest' src/lib/tauri/
      ddl.ts` — ≥ 2.
  33. `grep -nE 'Type the table name' src/components/schema/
      DropTableDialog.tsx` — ≥ 1.
  34. `grep -nE 'CASCADE' src/components/schema/DropTableDialog.
      tsx` — ≥ 1.
  35. `git diff --stat src/components/schema/DocumentDatabaseTree/
      useDocumentDatabaseDrop.ts src/lib/tauri/document.ts src/lib/
      mongo/mongoSafety.ts` — 0 each.
  36. `grep -rnE 'it\.only|it\.skip|describe\.skip|xit|it\.todo'
      src/components/schema/RenameTableDialog.test.tsx
      src/components/schema/DropTableDialog.test.tsx
      src/components/schema/SchemaTree.actions.test.tsx` — 0.
  37. `git diff src/ src-tauri/ | grep "^+.*eslint-disable"` — 0.
  38. `git diff src/ | grep -E "^\+.*\bany\b"` — 0.
  39. `grep -rnE '\}\s*catch\s*\{\s*\}' src/components/schema/
      RenameTableDialog.tsx src/components/schema/DropTableDialog.
      tsx` — 0.
  40. `grep -nE '"ddl-structure"' src/components/schema/
      RenameTableDialog.tsx src/components/schema/DropTableDialog.
      tsx` — ≥ 2 OR consumed via `useDdlPreviewExecution` and
      asserted in tests.

- **Browser visual smoke (manual, recommended; document in
  `findings.md` if performed):**
  - `pnpm tauri dev` → connect to PG → expand schema → right-click
    a table → `Rename` → modal opens with current name → change →
    Show DDL → preview shows `ALTER TABLE "..."."..." RENAME TO
    "..."` → Apply → tree refreshes with new name.
  - Same flow for `Drop` (CASCADE off) → preview shows `DROP TABLE
    "..."."..."` (no CASCADE keyword) → typing-confirm input → type
    table name → Apply → table removed.
  - `Drop` with CASCADE on → preview shows `DROP TABLE "..."."..."
    CASCADE`.
  - `Drop` a referenced table without CASCADE → PG error verbatim
    in `previewError` → modal stays open.
  - Type-confirm mismatch (`Users` vs `users`) → Apply stays
    disabled.

- **Required evidence:**
  - Changed files table (path / lines / purpose).
  - Test counts: vitest before/after; cargo before/after.
  - AC-235 coverage table (AC → test name → file:line → result).
  - Verification check results (40 / 40 expected).
  - Byte-equivalent SQL strings (verbatim) for the 4 named fixtures.
  - Confirmation that `useDdlPreviewExecution` /
    `useSafeModeGate` / `useSchemaTableMutations` were reused
    without diff.
  - Confirmation that Mongo path untouched (check 35).
  - Decisions taken (typing-confirm pattern is new; drop pre-
    existence check removed; rename-to-self frontend-only check;
    CASCADE default off).
  - Open questions resolved (trait migration one-impl; cancel-token
    deferred; error type change for non-existent-table drop).
  - Edge cases tested (with file:line refs).
  - Assumptions & residual risks.

## Evidence To Return

- Changed files and purpose.
- Checks run and outcomes (40 checks).
- Done criteria (AC-235-01..AC-235-11) coverage with concrete
  evidence.
- Assumptions made during implementation (especially: trait
  migration scope, store wrapper compat layer, cancel-token deferral,
  drop pre-existence check removal error-type change).
- Residual risk or verification gaps.

## References

- **Contract:** `docs/sprints/sprint-235/contract.md`.
- **Findings (Generator writes):**
  `docs/sprints/sprint-235/findings.md`.
- **Pattern source contracts:**
  - `docs/sprints/sprint-226/contract.md` — Sprint 226 CREATE TABLE
    backend + dialog wiring.
  - `docs/sprints/sprint-214/contract.md` — `useDdlPreviewExecution`
    hook contract.
  - `docs/sprints/sprint-198/contract.md` — Mongo dropCollection
    Safe Mode dispatch (NOT typing-confirm — see Decisions).
  - `docs/sprints/sprint-223/contract.md` — `useSchemaTableMutations`
    hook extraction.
  - `docs/sprints/sprint-189/contract.md` — `useSafeModeGate` /
    `decideSafeModeAction` matrix.
- **Phase doc:** `docs/archives/phases/completed/phase-27.md`.
- **Master plan:** `docs/PLAN.md`.

### Relevant files (READ before implementing)

Backend:
- `src-tauri/src/commands/rdb/ddl.rs:19-49` — current `drop_table` +
  `rename_table` handler shapes.
- `src-tauri/src/commands/rdb/ddl.rs:64-72` — `create_table` handler
  shape (mirror this for the new request-based handlers).
- `src-tauri/src/db/traits.rs:156-180` — current `RdbAdapter` trait
  signatures for `drop_table` / `rename_table` / `create_table`.
- `src-tauri/src/db/postgres/mutations.rs:96-170` — current
  `drop_table` + `rename_table` impls (REMOVE the
  `information_schema.tables` pre-check; reuse `validate_identifier`).
- `src-tauri/src/db/postgres/mutations.rs:189-354` — `create_table`
  impl (mirror for preview/execute branches + transactional
  BEGIN/COMMIT).
- `src-tauri/src/db/postgres/mutations.rs:705-790` — current
  `drop_table` / `rename_table` test cases (REWRITE for new
  signatures).
- `src-tauri/src/models/schema.rs:217-` — `CreateTableRequest` decl
  (mirror for the new `RenameTableRequest` / `DropTableRequest`
  structs).

Frontend:
- `src/lib/tauri/ddl.ts` — IPC wrappers (DUAL exports needed).
- `src/types/schema.ts` — request type defs.
- `src/components/schema/CreateTableDialog.tsx` — modal pattern
  reference (preview pane styling, useDdlPreviewExecution wiring).
- `src/components/structure/useDdlPreviewExecution.ts:1-100` — hook
  contract (DO NOT MODIFY).
- `src/hooks/useSafeModeGate.ts` — gate signature (DO NOT MODIFY).
- `src/hooks/useSchemaTableMutations.ts` — Sprint 223 hook (DO NOT
  MODIFY; consume existing surface).
- `src/components/schema/SchemaTree/dialogs.tsx:1-209` — current
  `DropTableConfirmDialog` + `RenameTableDialog` + `CreateTableDialog
  Slot` (REPLACE the first two with new slot wrappers).
- `src/components/schema/SchemaTree/useSchemaTreeActions.ts:130-331`
  — current `confirmDialog` / `renameDialog` state slots + the 3
  handlers (COLLAPSE into 2 simple openers).
- `src/components/schema/SchemaTree/rows.tsx:320-345` — context-menu
  wiring (no diff expected).
- `src/components/schema/SchemaTree.tsx:373-396` — dialog mount
  block (swap mounts).
- `src/components/schema/DocumentDatabaseTree/useDocumentDatabaseDrop.
  ts` — Mongo Safe Mode dispatch reference (READ ONLY — do not
  modify; use for Safe Mode wiring template).

### Cautions

- The user's spec frames the typing-confirm as "mirror Mongo
  `drop_collection` pattern". The Mongo flow does **not** have a
  typing-confirm — it uses a regular confirm dialog. The Generator
  must implement the typing-confirm fresh. Constraint: case-sensitive
  byte-for-byte equality, NO trim, every keystroke re-evaluates,
  empty input → button disabled.
- The user's spec says "Sprint 180 cancel-token integration" mirrors
  `create_table`. Verification shows `create_table` does NOT
  integrate cancel-tokens. Default assumption in the contract: the
  "mirror" is zero-LOC (no cancel-token wiring this sprint). If the
  Generator interprets it as "add cancel-tokens to all four DDL
  commands now", flag in findings before proceeding.
- The trait signature change (`drop_table` / `rename_table` from
  positional → request) is one-impl-only — PG is currently the only
  `RdbAdapter`. Verify with `grep -rn 'impl RdbAdapter for'
  src-tauri/src/`.
- The `schemaStore.dropTable` / `.renameTable` action signatures are
  invariant (Sprint 223 hook expects `(connectionId, table, schema,
  ?newName)`). Keep these byte-equivalent via the `ddl.ts` dual
  exports — the store sees no change.
- The drop pre-existence check (`information_schema.tables`) is
  REMOVED. This flips the error type for "drop a non-existent table"
  from `AppError::NotFound` to `AppError::Database`. Grep for
  callers that asserted the old error message and update mechanically.
- Existing `cargo test --lib drop_table` / `--lib rename_table`
  fixtures (mutations.rs:705-790) use the OLD positional signatures.
  REWRITE them to use the new request-object shapes; preserve the
  original test intent (rejection of empty / whitespace-only /
  invalid-char / leading-digit names).
- `SchemaTree.actions.test.tsx`'s existing Rename / Drop cases
  reference the old `confirmDialog` / `renameDialog` slot names.
  Mechanical update to the new modal slot shapes is allowed (not a
  freeze violation — explicitly noted in the contract's Test
  invariants section).
