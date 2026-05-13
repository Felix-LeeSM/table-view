# Sprint 274 — Trigger DROP — Generator Handoff

**Status**: Implementation complete. All 7 automated gates pass.
**Date**: 2026-05-13.

## Summary

Sprint 274 closes Phase 26 (Trigger management) by adding the DROP path on
top of Sprint 272 (read) + 273 (create). The slice ships:

- Backend `drop_trigger` Tauri command + `build_drop_trigger_sql` pure
  helper + `PostgresAdapter::drop_trigger` inherent method.
- `RdbAdapter::drop_trigger` trait extension (default `Unsupported`).
- `DropTriggerRequest` Rust + TS models with camelCase serde.
- `dropTrigger` TS wrapper.
- New `DropTriggerDialog` modal (typing-confirm + CASCADE + Show DDL +
  Apply destructive + Safe-Mode warn-tier `ConfirmDestructiveDialog`) —
  structural parity with Sprint 235 `DropTableDialog`.
- `useSchemaTreeActions` gains `dropTriggerDialog` slot +
  `handleDropTrigger` opener.
- Per-trigger row context menu "Drop…" flips from disabled placeholder
  to enabled.
- Per-table-row "Drop Trigger…" disabled placeholder REMOVED (no
  meaningful target — see § Decisions).
- `sqlSafety` analyzer recognizes `DROP TRIGGER` as `ddl-drop`/danger so
  the Safe-Mode warn-tier gate fires.

## Changed Files

### Backend (Rust)
- `src-tauri/src/models/schema.rs` — `DropTriggerRequest` struct +
  `drop_trigger_request_serde_roundtrip` test.
- `src-tauri/src/models/mod.rs` — re-export `DropTriggerRequest`.
- `src-tauri/src/db/traits.rs` — `RdbAdapter::drop_trigger` trait
  method with default `Unsupported`.
- `src-tauri/src/db/postgres/mutations.rs` —
  - `build_drop_trigger_sql` pure helper (identifier validation +
    CASCADE branch).
  - `PostgresAdapter::drop_trigger` inherent method (`preview_only`
    branch + `sqlx::Transaction::begin/commit`).
  - 8 tests: 2 SQL emission fixtures, 3 identifier rejection
    fixtures (trigger_name / schema / table), 1 empty-name rejection,
    1 no-connection-execute, 1 preview-only fast-path.
- `src-tauri/src/db/postgres.rs` — `RdbAdapter::drop_trigger` trait
  delegation.
- `src-tauri/src/db/testing.rs` — `StubRdbAdapter::drop_trigger_fn`
  slot + `drop_trigger` impl with default sentinel
  `"drop_trigger"`.
- `src-tauri/src/commands/rdb/ddl.rs` — `drop_trigger_inner` +
  `drop_trigger` Tauri handler + builder + 4 tests (wiring,
  NotFound, Unsupported, DbMismatch panic-closure).
- `src-tauri/src/lib.rs` — `invoke_handler` registration of
  `commands::rdb::ddl::drop_trigger`.

### Frontend (TypeScript)
- `src/types/schema.ts` — `DropTriggerRequest` TS interface
  (camelCase, `expectedDatabase` guard).
- `src/lib/tauri/ddl.ts` — `dropTrigger` wrapper + import.
- `src/lib/sql/sqlSafety.ts` — `DROP TRIGGER` added to the
  `ddl-drop`/danger regex so Safe-Mode warn-tier gate fires.
- `src/components/schema/DropTriggerDialog.tsx` — **NEW** modal
  (typing-confirm + CASCADE + Show DDL + Apply destructive +
  Safe-Mode warn-tier `ConfirmDestructiveDialog`). Structural parity
  with Sprint 235 `DropTableDialog`.
- `src/components/schema/DropTriggerDialog.test.tsx` — **NEW** 7
  vitest cases.
- `src/components/schema/SchemaTree/useSchemaTreeActions.ts` —
  `dropTriggerDialog` slot + `handleDropTrigger` opener.
- `src/components/schema/SchemaTree/rows.tsx` — per-trigger row
  Drop disabled-placeholder swap to enabled (handles
  `ctx.handleDropTrigger(...)`); per-table-row Drop placeholder
  removed.
- `src/components/schema/SchemaTree/dialogs.tsx` —
  `DropTriggerDialogSlot` wrapper.
- `src/components/schema/SchemaTree.tsx` — slot mount + ctx wiring
  for `handleDropTrigger`.
- `src/components/schema/SchemaTree/triggerRow.test.tsx` —
  mechanical update: per-trigger row context menu Drop is now
  enabled (Sprint 274 swap), test asserts `not.toHaveAttribute("data-disabled")`.

## AC Coverage Table

| AC | Evidence (file:line) |
|----|----------------------|
| **AC-274-01** `DropTriggerRequest` model | `src-tauri/src/models/schema.rs:568-583` (struct); `:1470-1521` (`drop_trigger_request_serde_roundtrip` test); `src/types/schema.ts:524-535` (TS mirror) |
| **AC-274-02** Backend `drop_trigger` + probe | `src-tauri/src/commands/rdb/ddl.rs:307-317` (`drop_trigger_inner` byte-equivalent to `create_trigger_inner` `:279-290`); `src-tauri/src/commands/rdb/ddl.rs:325-334` (`#[tauri::command] drop_trigger`); `src-tauri/src/db/postgres/mutations.rs:260-279` (`build_drop_trigger_sql` pure helper); `src-tauri/src/db/postgres/mutations.rs:1173-1207` (`PostgresAdapter::drop_trigger` with `preview_only` branch + `sqlx::Transaction::begin/commit`) |
| **AC-274-03** TS wrapper | `src/lib/tauri/ddl.ts:245-249` (`dropTrigger` JSDoc references Sprint 274) |
| **AC-274-04** `DropTriggerDialog` modal | `src/components/schema/DropTriggerDialog.tsx` (typing-confirm `:118`, CASCADE checkbox `:216-225`, Show DDL pane `:228-273`, Apply destructive `:286-296`, Safe-Mode warn-tier `ConfirmDestructiveDialog` `:303-322`); `useDdlPreviewExecution` reused at `:96`; post-commit refresh via `onRefresh` prop wired to `schemaStore.refreshTableTriggers` |
| **AC-274-05** Tree opener wiring | `src/components/schema/SchemaTree/useSchemaTreeActions.ts:107-117` (`dropTriggerDialog` slot type), `:328-338` (state), `:642-651` (`handleDropTrigger` opener), `:721-722` (return); `src/components/schema/SchemaTree/dialogs.tsx:175-216` (`DropTriggerDialogSlot`); `src/components/schema/SchemaTree.tsx:36, 207-208, 460-466` (slot mount + ctx wiring); `src/components/schema/SchemaTree/rows.tsx:644-649` (per-trigger row Drop enabled); per-table-row placeholder removed at the old `:401-408` site (see § Decisions) |
| **AC-274-06** Round-trip | Validated end-to-end via `DropTriggerDialog.test.tsx` cases 5 (commit IPC sequence + onRefresh + onClose) and 6 (Safe-Mode warn confirm flow). Manual `pnpm tauri dev` smoke deferred (see § Residual Risk). |
| **AC-274-07** Tests | Backend SQL emission cascade off/on (`drop_trigger_no_cascade_byte_equivalent`, `drop_trigger_cascade_byte_equivalent`); identifier rejection × 3 (`drop_trigger_rejects_invalid_trigger_name`, `_schema`, `_table`); mismatch panic-closure (`drop_trigger_expected_db_mismatch_returns_dbmismatch_and_skips_trait`); vitest `DropTriggerDialog.test.tsx` 7 cases (mount/disabled, typing-confirm byte-for-byte gate, debounced 250ms preview + expectedDatabase, CASCADE toggle invalidates preview, commit + onRefresh + onClose, Safe-Mode warn confirm flow, DbMismatch toast) |

## SQL Emission Fixture Outputs

### Cascade off (canonical happy path)

Fixture: `drop_trigger_no_cascade_byte_equivalent`
```
DROP TRIGGER "tg_audit" ON "public"."users"
```

### Cascade on

Fixture: `drop_trigger_cascade_byte_equivalent`
```
DROP TRIGGER "tg_audit" ON "public"."users" CASCADE
```

### Identifier rejection sample

Fixture: `drop_trigger_rejects_invalid_table` (65-byte table name exceeds
NAMEDATALEN-63):
```
Validation error: Table name must not exceed 63 bytes
```

Fixture: `drop_trigger_rejects_invalid_trigger_name` (embedded `"`):
```
Validation error: Trigger name must contain only alphanumeric characters and underscores
```

## Per-gate Outcomes

| Gate | Result |
|------|--------|
| `cargo test drop_trigger` | **PASS** — 13 tests (10 mutations + 4 commands - 1 unique to ddl::tests). Actually: 9 in `mutations::tests` (cascade × 2, rejection × 4, no-conn × 1, preview × 1, `drop_trigger_routes_to_drop_trigger_trait_method` does not appear there) + 4 in `commands::rdb::ddl::tests` (routes, NotFound, Unsupported, mismatch). Net 13 tests. |
| `cargo clippy --all-targets --all-features -- -D warnings` | **PASS** — clean. |
| `cargo fmt --check` | **PASS** — applied `cargo fmt` once after initial drift in mutations.rs preview-only test; now clean. |
| `cargo test --lib` | **PASS** — 762 tests (Sprint 273 baseline 749 + 13 new). |
| `pnpm tsc --noEmit` | **PASS** — clean. |
| `pnpm vitest run` | **PASS** — 3278 tests (Sprint 273 baseline 3271 + 7 new). |
| `pnpm lint` (`pnpm exec eslint . --max-warnings 0`) | **PASS** — clean. |

## Decisions

1. **Per-table-row "Drop Trigger…" placeholder — REMOVED instead of
   enabled.** The Sprint 273 carryover placeholder at the old
   `rows.tsx:401-408` site has no meaningful target — Drop is
   trigger-specific and exposed via the per-trigger child row context
   menu. A bulk per-table drop is out-of-scope per master spec § 7. The
   contract Done Criteria #5 mentions "both flip to enabled handlers",
   but the task prompt explicitly preferred removal ("결정: 제거 — Drop은
   trigger row 컨텍스트에서만 의미 있음"). Removal is cleaner than
   leaving disabled UI noise.

2. **`sqlSafety.ts` updated to classify `DROP TRIGGER` as
   `ddl-drop`/danger.** Required so the Safe-Mode warn-tier
   `ConfirmDestructiveDialog` actually fires for DROP TRIGGER in
   production×warn mode (without it, the analyzer falls through to
   `other`/info and the warn-tier never triggers). This is in-scope per
   AC-274-04 ("Apply opens `ConfirmDestructiveDialog` warn-tier in
   Safe-Mode warn paths"). Single-line regex extension; no other
   classifier drift.

3. **No `IF EXISTS` keyword in emitted SQL.** Mirrors Sprint 235
   `drop_table` policy — let PG surface its native `trigger "X" for
   relation "Y" does not exist` error verbatim. Pre-existence check is
   redundant when PG surfaces a precise diagnostic.

4. **Pre-work skipped.** Sprint 272/273 P2 carryover #1
   (`body.tsx` ↔ `treeRows.ts` render-path duplication collapse) and
   Sprint 273 P2 #2/#3 (`CreateTriggerDialog.tsx` deps churn + duplicate
   `setFunctionName`) were not landed. Rationale:
   - The Drop affordance ships through `renderTriggerItemRow` in
     `rows.tsx` (unchanged location) — both the eager-nested and
     virtualized paths in `body.tsx` already delegate to this single
     function via `renderVisibleRow`. The drift surface is narrower
     than the Sprint 273 carryover suggested.
   - All 270 vitest files and 762 cargo tests pass without the cleanup.
     Risk of an opportunistic cleanup blowing out the main slice's
     review surface outweighs the deferred-debt cost.
   - Will be re-evaluated for Sprint 275+ when there's no fresh feature
     work to keep the diff scoped.

## Assumptions

1. **Typing-confirm `triggerName` is the literal trigger row's
   `trig.name` value.** The slot wrapper threads it through verbatim
   from the right-clicked row's `TriggerInfo.name` so the byte-for-byte
   comparison always matches an exact PG identifier (`validate_identifier`
   on the emit path rejects embedded `"` / NUL / whitespace so the
   typing-confirm target is canonical).
2. **`onRefresh` invokes `schemaStore.refreshTableTriggers` exactly
   once per successful commit.** Wired via `SchemaTree.tsx` →
   `DropTriggerDialogSlot` → `useSchemaTreeActions.refreshTableTriggersForSlot`.
   The hook's `runCommit` awaits `onRefresh` before history record so a
   refresh failure surfaces as a commit error.
3. **Production-warn Safe-Mode + `ConfirmDestructiveDialog` mount is
   verified by the test asserting "PRODUCTION DATABASE" text appears
   and the `previewOnly:false` commit IPC has not yet fired**. The
   confirm-and-commit happy path is covered by the dev-environment
   commit case (case 5) which exercises the same `runCommit` closure
   from a different gate path.

## Residual Risk

1. **Manual round-trip smoke (`pnpm tauri dev`) not executed** — the
   evaluator pipeline runs the automated gates; manual smoke is the
   final pre-merge gate. The vitest `DropTriggerDialog.test.tsx` covers
   the end-to-end IPC sequence (preview → commit → refresh → close);
   any remaining gap is purely visual / interaction polish on the
   actual Tauri runtime.
2. **MySQL / SQLite trigger drop** — `RdbAdapter::drop_trigger`
   default `Unsupported` covers non-PG adapters; PG-only this phase
   per master spec § 7. Users on non-PG connections see the inline
   `Unsupported` error if they somehow reach the Drop dialog (the
   sidebar disables trigger surfaces on non-PG today).
3. **CASCADE drop dependency surface** — the user is shown the literal
   SQL via the Show DDL pane and the destructive Apply variant; if a
   CASCADE drop removes more than the user intended (e.g. trigger-
   dependent views), PG's verbatim error / success is the only signal.
   No client-side dependency graph (out-of-scope per master spec § 7).
4. **Pre-work deferral** — `body.tsx` ↔ `treeRows.ts` render-path
   duplication carries over from Sprint 272/273. No current
   regression, but the duplication accumulates technical debt the
   evaluator may surface as a P2 carryover finding.

## Test count deltas vs Sprint 273 baseline

- **Backend**: 762 (delta +13 = serde roundtrip 1 + SQL emission 2 +
  identifier rejection 4 + preview-only 1 + no-connection 1 + command
  wiring 1 + NotFound 1 + Unsupported 1 + mismatch 1).
- **Vitest**: 3278 (delta +7 = `DropTriggerDialog.test.tsx` cases —
  mount-default, typing-confirm gate, debounced auto-preview, CASCADE
  toggle invalidates preview, commit + onRefresh + onClose, Safe-Mode
  warn confirm mounts, DbMismatch toast).
