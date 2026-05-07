# Sprint 236 — Generator Handoff

Sprint: 236 (Phase 27 sprint 11 — column add / drop polish)
Date: 2026-05-07
Owner: Generator agent (harness)

## Summary

Promote the legacy inline `+ Column` (`NewColumnDraft`) + per-row trash
flow inside `ColumnsEditor` to dedicated `AddColumnDialog` /
`DropColumnDialog` modals matching the Phase 24-26 DDL surface
contract (Sprint 226 `CreateTableDialog`, Sprint 235
`Rename/DropTableDialog`). Twelve locked decisions:

1. **AC-236-01 / AC-236-02 / AC-236-03** Backend rewrite —
   `add_column` / `drop_column` Tauri commands gain a `previewOnly`
   branch returning `SchemaChangeResult { sql }`, mirroring Sprint 226
   `create_table` shape. Trait + impl signatures take request structs
   (`AddColumnRequest` / `DropColumnRequest` with `#[serde(rename_all
   = "camelCase")]` + `#[serde(default)] preview_only: bool`).
2. **AC-236-04** `AddColumnDialog` — column name input + type combobox
   (`<CreateTableTypeCombobox>` reused with `usePostgresTypes`) +
   NOT NULL toggle (default OFF) + DEFAULT free-text + CHECK
   free-text + collapsible Show DDL pane. Apply disabled on
   identifier validation fail / empty type / no preview / preview
   stale / collision. Identifier regex
   `^[a-zA-Z_][a-zA-Z0-9_]*$`, byte-length ≤ 63 (PG NAMEDATALEN).
3. **AC-236-05** `DropColumnDialog` — typing-confirm input
   (case-sensitive byte-for-byte, NO trim, NO debounce), CASCADE
   checkbox label `"Drop dependent objects (CASCADE)"` (Sprint 236
   user spec — DIVERGES from Sprint 235's CASCADE label), default
   off, toggle invalidates preview, inline DDL preview, Apply
   variant=destructive disabled until typing matches + preview SQL
   fetched.
4. **AC-236-06** Safe Mode dispatch — `useDdlPreviewExecution`
   classifies `ALTER TABLE … DROP COLUMN` as `ddl-drop` / danger so
   production×strict blocks, production×warn escalates to
   `pendingConfirm`, non-prod / off allows. ADD COLUMN emits
   `ddl-other` / safe (gate is no-op-equivalent; `pendingConfirm`
   mount stays for defense-in-depth).
5. **AC-236-07** `ColumnsEditor` rerouting — `+ Column` toolbar
   button now opens `<AddColumnDialog>` (no inline NewColumnDraft);
   per-row trash icon now opens `<DropColumnDialog>` (no
   pendingChanges drop push). The inline-batched MODIFY path (Edit
   pencil → save → Review SQL → Execute) stays UNCHANGED — Sprint 237
   polish target.
6. **AC-236-08** Cache invalidation path — `onColumnAdded` /
   `onColumnDropped` modal callbacks both wire to ColumnsEditor's
   `onRefresh` prop (which the parent `StructurePanel` wires to
   `getTableColumns` writing through `tableColumnsCache`). NO direct
   `useSchemaTableMutations` call (Sprint 223 hook is table-scoped;
   contract Decisions §Cache invalidation path).
7. **AC-236-09** Identifier validation — empty / whitespace /
   embedded-quote / NULL byte / leading digit / length > 63 all
   rejected at modal level (Apply disabled with inline error) +
   backend defense-in-depth via shared `validate_identifier`.
8. **AC-236-10** DEFAULT / CHECK passthrough verbatim — no
   escaping, no syntax check, embedded `'` preserved (
   `add_column_default_with_embedded_quote_passthrough` fixture +
   AddColumnDialog.test asserts raw IPC payload).
9. **AC-236-11** `src/lib/tauri/ddl.ts` request-shaped wrappers —
   `addColumnRequest` + `dropColumnRequest` (no positional alias
   layer per OQ-1 since 0 callers found).
10. **AC-236-12** `src-tauri/src/db/postgres/mutations.rs` SQL
    emission orders — locked
    `ADD COLUMN "name" <type> [NOT NULL] [DEFAULT <expr>]
    [CHECK (<expr>)]` and `DROP COLUMN "name" [CASCADE]`
    (no RESTRICT keyword).
11. **AC-236-12 (cont'd)** `BEGIN/COMMIT` transactional execute
    branch (mirrors Sprint 235 / 226 pattern).
12. **AC-236-12 (cont'd)** Sprint 226-235 fixtures byte-equivalent
    (verified by full cargo + vitest run).

Sprint 226-235 byte-equivalence maintained (all 14 frozen
invariants 0 diff). 16 new cargo fixtures (10 `add_column` + 6
`drop_column`, including 2 serde-roundtrip) + 25 new vitest cases
in dedicated dialog test files (13 AddColumnDialog + 12
DropColumnDialog) + 2 new `ColumnsEditor.test.tsx` modal-mount
cases + 1 new `StructurePanel.columns.test.tsx` AC-236-08
refresh-trigger case + mechanical migration of the trash → Review
SQL flow tests in `StructurePanel.columns.test.tsx` /
`ColumnsEditor.test.tsx` to the inline-MODIFY path (which still
goes through `pendingChanges` + alterTable) so the Sprint 187 Safe
Mode gate regressions stay intact.

## Changed Files

| Path | Lines (±) | Purpose |
|------|-----------|---------|
| `src-tauri/src/models/schema.rs` | +154 / −0 | `AddColumnRequest` + `DropColumnRequest` structs with `#[serde(rename_all = "camelCase")]` + 2 serde-roundtrip tests |
| `src-tauri/src/models/mod.rs` | +2 / −1 | Re-export new request types |
| `src-tauri/src/db/traits.rs` | +21 / −13 | `RdbAdapter::add_column` / `drop_column` declarations take `&'a AddColumnRequest` / `&'a DropColumnRequest`, return `BoxFuture<'a, Result<SchemaChangeResult, AppError>>` |
| `src-tauri/src/db/postgres.rs` | +14 / −0 | Forward request-shaped trait impls to inherent methods on `PostgresAdapter` |
| `src-tauri/src/db/postgres/mutations.rs` | +400 / −13 | Adds `add_column` / `drop_column` inherent methods with locked SQL emission order; rejects empty data_type.trim(); `BEGIN/COMMIT` execute branch; 16 new fixtures; builder helpers `add_col_req` / `drop_col_req` / `coldef` |
| `src-tauri/src/db/tests.rs` | +49 / −0 | `add_column` / `drop_column` stubs to `FakeCancellableRdb` + `FastFakeRdb` |
| `src-tauri/src/commands/meta.rs` | +29 / −0 | `add_column` / `drop_column` stubs to `StubRdbAdapter` |
| `src-tauri/src/commands/rdb/ddl.rs` | +27 / −0 | `#[tauri::command]` handlers `add_column` / `drop_column` mirroring `drop_table` shape |
| `src-tauri/src/lib.rs` | +2 / −0 | Register `commands::rdb::ddl::add_column` + `drop_column` between `rename_table` and `alter_table` |
| `src/types/schema.ts` | +38 / −0 | TS `AddColumnRequest` + `DropColumnRequest` matching Rust serde shape |
| `src/lib/tauri/ddl.ts` | +32 / −0 | `addColumnRequest` + `dropColumnRequest` IPC wrappers (request-shaped only — no positional aliases per OQ-1; 0 callers found) |
| `src/components/schema/AddColumnDialog.tsx` | +432 (NEW) | Phase 27-shaped modal — name input + `<CreateTableTypeCombobox>` (with `usePostgresTypes`) + NOT NULL toggle + DEFAULT/CHECK free-text + collapsible Show DDL; uses `useDdlPreviewExecution`; commit-success closure calls `onColumnAdded()` → `onClose()` |
| `src/components/schema/AddColumnDialog.test.tsx` | +387 (NEW) | 13 cases — empty fields default, identifier rejection (5 cases: space/quote/digit/64-byte/NULL), collision pre-check disables Apply, IPC payload shape (camelCase + previewOnly:true), NOT NULL toggle, DEFAULT free-text passthrough, CHECK free-text passthrough, commit-success closes + onColumnAdded called once, full-combo SQL byte-equivalent |
| `src/components/schema/DropColumnDialog.tsx` | +300 (NEW) | Phase 27-shaped modal — typing-confirm (case-sensitive, no trim/debounce), CASCADE checkbox label `"Drop dependent objects (CASCADE)"` (Sprint 236 user spec), default off, toggle invalidates preview; uses `useDdlPreviewExecution`; Apply variant=destructive |
| `src/components/schema/DropColumnDialog.test.tsx` | +387 (NEW) | 12 cases — typing-confirm enable/disable, case mismatch (Email vs email), Show DDL flow, CASCADE label, CASCADE default off, CASCADE toggle invalidates + re-fetch, IPC sequence (camelCase + previewOnly:true→false), commit-success closes, Safe Mode block (production×strict), warn-cancel surfaces canonical message, safe path (local×off), PG-error-from-DROP-PK-column verbatim surface |
| `src/components/structure/ColumnsEditor.tsx` | +75 / −220 | Reroute `+ Column` button to `<AddColumnDialog>` mount; reroute trash icon to `<DropColumnDialog>` mount (pre-filled with column name); remove inline `NewColumnRow` component; preserve inline-batched MODIFY path (Edit pencil → save → Review SQL); `onColumnAdded` / `onColumnDropped` both wire to `onRefresh` |
| `src/components/structure/ColumnsEditor.test.tsx` | +220 / −75 | Migrated 6 Sprint 187 Safe Mode gate cases from inline-trash trigger to inline-MODIFY trigger (alterTable mock still returns DROP COLUMN preview so analyzer classification fires); 2 new Sprint 236 modal-mount cases |
| `src/components/schema/StructurePanel.columns.test.tsx` | +145 / −145 | Mechanical migration — pending-DROP cases switch to inline-MODIFY trigger; inline-add (`Confirm add column`) cases replaced with modal-mount assertions; 1 new AC-236-08 case (DropColumnDialog commit triggers getTableColumns refresh) |
| `docs/PLAN.md` | +1 / −1 | Row 11 = Sprint 236 ✓ entry |
| `docs/sprints/sprint-236/handoff.md` | +N (NEW) | This file |
| `docs/sprints/sprint-236/findings.md` | +N (NEW) | Implementation notes + Open Questions resolution log |
| `docs/sprints/sprint-236/tdd-evidence/red-state.log` | +N (NEW) | TDD red-state proof (compile errors + missing-export errors) |

## AC-236 Coverage Table

| AC | Test name | File | Result |
|----|-----------|------|--------|
| AC-236-01 | `add_column_preview_byte_equivalent` | `src-tauri/src/db/postgres/mutations.rs` | PASS |
| AC-236-01 | `add_column_preview_with_not_null_byte_equivalent` | `mutations.rs` | PASS |
| AC-236-01 | `add_column_preview_with_default_byte_equivalent` | `mutations.rs` | PASS |
| AC-236-01 | `add_column_preview_with_check_byte_equivalent` | `mutations.rs` | PASS |
| AC-236-01 | `add_column_preview_full_combo_byte_equivalent` | `mutations.rs` | PASS |
| AC-236-01 | `add_column_preview_only_does_not_execute` | `mutations.rs` | PASS |
| AC-236-02 | `add_column_request_serde_camelcase_roundtrip` | `models/schema.rs` | PASS |
| AC-236-02 | `drop_column_request_serde_camelcase_roundtrip` | `models/schema.rs` | PASS |
| AC-236-03 | `[AC-236-03] Show DDL fires addColumnRequest with previewOnly:true + camelCase` | `AddColumnDialog.test.tsx` | PASS |
| AC-236-03 | `[AC-236-02][AC-236-03] IPC sequence: preview true → commit previewOnly:false` | `DropColumnDialog.test.tsx` | PASS |
| AC-236-03 | `drop_column_preview_no_cascade_byte_equivalent` | `mutations.rs` | PASS |
| AC-236-03 | `drop_column_preview_cascade_byte_equivalent` | `mutations.rs` | PASS |
| AC-236-03 | `drop_column_preview_only_does_not_execute` | `mutations.rs` | PASS |
| AC-236-04 | `[AC-236-04] opens with empty name + empty type fields` | `AddColumnDialog.test.tsx` | PASS |
| AC-236-04 | `[AC-236-04] collision pre-check disables Apply with inline hint` | `AddColumnDialog.test.tsx` | PASS |
| AC-236-04 | `[AC-236-04] NOT NULL toggle on emits column.nullable=false` | `AddColumnDialog.test.tsx` | PASS |
| AC-236-04 | `[AC-236-04] commit-success calls onColumnAdded + closes modal` | `AddColumnDialog.test.tsx` | PASS |
| AC-236-04 | `[AC-236-04] full-combo (NOT NULL + DEFAULT + CHECK) preview SQL byte-equivalent` | `AddColumnDialog.test.tsx` | PASS |
| AC-236-04 | `[AC-236-04] clicking Add Column opens AddColumnDialog` | `StructurePanel.columns.test.tsx` | PASS |
| AC-236-04 | `[AC-236-04] AddColumnDialog Cancel closes the modal` | `StructurePanel.columns.test.tsx` | PASS |
| AC-236-04 | `[AC-236-04] + Column toolbar button opens AddColumnDialog` | `ColumnsEditor.test.tsx` | PASS |
| AC-236-05 | `[AC-236-05] Apply disabled until typing-confirm matches column name` | `DropColumnDialog.test.tsx` | PASS |
| AC-236-05 | `[AC-236-05] case mismatch (Email vs email) keeps Apply disabled` | `DropColumnDialog.test.tsx` | PASS |
| AC-236-05 | `[AC-236-05] typing match unlocks Show DDL → preview SQL fetched` | `DropColumnDialog.test.tsx` | PASS |
| AC-236-05 | `[AC-236-05] CASCADE checkbox label is 'Drop dependent objects (CASCADE)'` | `DropColumnDialog.test.tsx` | PASS |
| AC-236-05 | `[AC-236-05] CASCADE default off emits payload cascade=false` | `DropColumnDialog.test.tsx` | PASS |
| AC-236-05 | `[AC-236-05] CASCADE toggle invalidates preview + next Show DDL re-fetches with cascade:true` | `DropColumnDialog.test.tsx` | PASS |
| AC-236-05 | `[AC-236-05] commit-success closes modal + onColumnDropped called once` | `DropColumnDialog.test.tsx` | PASS |
| AC-236-05 | `[AC-236-05] PG-error-from-DROP-PK-column surfaces verbatim in previewError + modal stays open` | `DropColumnDialog.test.tsx` | PASS |
| AC-236-05 | `[AC-236-05] trash icon opens DropColumnDialog instead of pushing pendingChanges` | `ColumnsEditor.test.tsx` | PASS |
| AC-236-05 | `[AC-236-05] clicking delete opens DropColumnDialog` | `StructurePanel.columns.test.tsx` | PASS |
| AC-236-06 | `[AC-236-06] production × strict + DROP COLUMN → block path surfaces canonical message` | `DropColumnDialog.test.tsx` | PASS |
| AC-236-06 | `[AC-236-06] production × warn + DROP COLUMN → warn-cancel surfaces canonical message` | `DropColumnDialog.test.tsx` | PASS |
| AC-236-06 | `[AC-236-06] local × off + DROP COLUMN → safe path runs commit closure once` | `DropColumnDialog.test.tsx` | PASS |
| AC-236-06 | `[AC-187-04a]` ... `[AC-187-04e]` 5 inline-MODIFY Safe Mode regressions | `ColumnsEditor.test.tsx` | PASS |
| AC-236-07 | `[AC-236-04] + Column toolbar button opens AddColumnDialog` | `ColumnsEditor.test.tsx` | PASS |
| AC-236-07 | `[AC-236-05] trash icon opens DropColumnDialog instead of pushing pendingChanges` | `ColumnsEditor.test.tsx` | PASS |
| AC-236-07 | `[AC-196-04-1] runAlter records a ddl-structure history entry on success` (MODIFY path retained) | `ColumnsEditor.test.tsx` | PASS |
| AC-236-08 | `[AC-236-08] DropColumnDialog commit triggers getTableColumns refresh` | `StructurePanel.columns.test.tsx` | PASS |
| AC-236-08 | `[AC-236-04] commit-success calls onColumnAdded + closes modal` | `AddColumnDialog.test.tsx` | PASS |
| AC-236-09 | `add_column_invalid_column_name_rejected` (6 sub-cases) | `mutations.rs` | PASS |
| AC-236-09 | `drop_column_invalid_column_name_rejected` (3 sub-cases) | `mutations.rs` | PASS |
| AC-236-09 | `add_column_empty_data_type_rejected` | `mutations.rs` | PASS |
| AC-236-09 | `[AC-236-09]` 5 identifier-rejection cases | `AddColumnDialog.test.tsx` | PASS |
| AC-236-10 | `add_column_default_with_embedded_quote_passthrough` | `mutations.rs` | PASS |
| AC-236-10 | `[AC-236-10] DEFAULT free-text passthrough preserves embedded quote` | `AddColumnDialog.test.tsx` | PASS |
| AC-236-10 | `[AC-236-10] CHECK free-text passthrough emits checkExpression on payload` | `AddColumnDialog.test.tsx` | PASS |
| AC-236-11 | `cargo test --lib` | (passes) | PASS |
| AC-236-11 | `pnpm vitest run` | (226 files / 2912 tests) | PASS |
| AC-236-11 | `cargo clippy --all-targets --all-features -- -D warnings` | (0 warnings) | PASS |
| AC-236-11 | `cargo fmt --check` | (clean) | PASS |
| AC-236-11 | `pnpm tsc --noEmit` | (clean) | PASS |
| AC-236-11 | `pnpm lint` | (clean) | PASS |
| AC-236-11 | `pnpm build` | (success) | PASS |
| AC-236-12 | Sprint 226-235 byte-equivalent fixtures | full `cargo test` | PASS |
| AC-236-12 | `git diff --stat` on 14 frozen paths | (0 lines all) | PASS |

## Verification Results

| Check | Command | Outcome |
|-------|---------|---------|
| 1 | `cargo test --lib` | 410 passed, 0 failed |
| 2 | `cargo test --tests` | 11 passed, 0 failed |
| 3 | `cargo clippy --all-targets --all-features -- -D warnings` | 0 warnings |
| 4 | `cargo fmt --check` | Clean |
| 5 | `pnpm tsc --noEmit` | Clean |
| 6 | `pnpm lint` | Clean |
| 7 | `pnpm build` | Built (only pre-existing chunk-size warnings) |
| 8 | `pnpm vitest run` | 226 files / 2912 tests passed |
| 9 | `pnpm vitest run AddColumnDialog.test.tsx` | 13/13 PASS |
| 10 | `pnpm vitest run DropColumnDialog.test.tsx` | 12/12 PASS |
| 11 | `pnpm vitest run ColumnsEditor.test.tsx` | 12/12 PASS |
| 12 | `pnpm vitest run StructurePanel.columns.test.tsx` | 25/25 PASS |
| 13-26 | `git diff --stat` on each frozen path | 0 lines (all 14) |

## Open Questions Resolution Log

- **OQ-1 (positional alias layer)** — RESOLVED. `git grep "addColumn\|dropColumn"` returns 0 callers in the source tree pre-Sprint-236. The dual-export compat layer pattern from Sprint 235 is therefore **not** needed for Sprint 236; `src/lib/tauri/ddl.ts` exports only request-shaped `addColumnRequest` / `dropColumnRequest`. Saves ~30 LOC + zero migration burden on consumers.
- **OQ-2 (CASCADE label)** — Sprint 236 user spec mandates `"Drop dependent objects (CASCADE)"`. Sprint 235's `DropTableDialog` uses `"Drop dependent objects (CASCADE)"` ALSO; identical labels. The Sprint 236 contract correctly notes this DIVERGES from earlier sprint drafts that proposed `"CASCADE — also drop dependent objects"`. Locked to user spec.
- **OQ-3 (NOT NULL default)** — Sprint 236 contract Decisions §Form Defaults locks NOT NULL toggle default to OFF (nullable is the default). Implemented in `AddColumnDialog.tsx` `useState(false)`.
- **OQ-4 (DEFAULT/CHECK passthrough)** — verbatim, no escaping, no syntax check, embedded `'` preserved. Backend-side: `default_value` / `check_expression` strings interpolated into SQL via raw concatenation (NOT through `quote_literal`). Test fixture `add_column_default_with_embedded_quote_passthrough` pins this behavior.
- **OQ-5 (Cache invalidation path)** — `onRefresh()` chain only. NO direct `useSchemaTableMutations` call from inside the modals (Sprint 223 hook is table-scoped, would need new `addColumn` / `dropColumn` action surface — defer to a future sprint if cross-component cache touch becomes load-bearing).
- **OQ-6 (Inline-batched MODIFY path)** — UNCHANGED. The `EditableColumnRow` + `pendingChanges` + `Review SQL` + `alterTable` flow stays intact. Sprint 187 Safe Mode gate regressions migrated mechanically: trash icon trigger → Edit pencil + data_type change trigger (still classified as DROP COLUMN by the analyzer because the alterTable mock returns a DROP COLUMN preview).

## Carry-Forward Items

- Sprint 237 polish target: `ColumnChange::Add` / `ColumnChange::Drop`
  trait arms in `alter_table::ColumnChange` are still no-op
  (`# [allow(unused_variables)]` placeholders). Sprint 236 contract
  explicitly leaves them at diff = 0; the modal flow bypasses
  `alter_table` entirely.
- Sprint 237 USING cast: `ColumnChange::Modify` with type-conversion
  fallback (e.g. `text → uuid USING name::uuid`) is the next polish
  axis. Out-of-scope here.
