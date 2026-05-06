# Sprint 226 — Findings

## TDD evidence

See `docs/sprints/sprint-226/tdd-evidence/red-state.log` for the
ordered red→green sequence. Summary:

- Pre-implementation, both `cargo test create_table` and the new
  vitest cases fail at COMPILE / file-resolution stage because none
  of the new symbols (`CreateTableRequest`, `RdbAdapter::create_table`,
  `tauri.createTable`, `CreateTableDialog`) exist yet.
- Post-implementation, all 12 `CreateTableDialog` cases + 3 new
  `SchemaTree.actions` entry-point cases + 11 Rust unit fixtures pass.

## Decisions

### `ColumnDefinition` shape — new struct (not `ColumnChange::Add` reuse)

I introduced a dedicated `ColumnDefinition` struct in
`src-tauri/src/models/schema.rs` rather than reusing `ColumnChange::Add`.

Reasoning:
- `ColumnChange` is an enum with `Add` / `Modify` / `Drop` variants.
  Reusing the variant payload as the request shape would expose a
  serde wire form like `{"type":"add","name":"id",...}` for every
  Create row, which is awkward for the frontend's flat repeater.
- Creates do not need the `Modify` / `Drop` semantics. A flat shape
  (`{name, data_type, nullable, default_value}`) maps 1:1 to the
  modal's column draft state.
- If the two paths later diverge (e.g. ALTER-add gains
  `column_position` while CREATE never needs it), the structs stay
  decoupled with no deprecation churn.

### Identifier-validator share — reused existing helper

Reused `validate_identifier` already defined at the top of
`src-tauri/src/db/postgres/mutations.rs:21` (the same validator that
`alter_table` / `create_index` / `add_constraint` consume). No
extraction required because the helper was already shared at the
module-private level. `rename_table` itself uses inline character
checks rather than `validate_identifier`, but both enforce the same
rule (whitespace-trimmed, non-empty, no embedded `"`).

### `useSchemaTreeActions.createTableDialog` shape

Picked the simple `{ schemaName: string } | null` discriminated form
over a richer `{ open: bool, schemaName: string | null }` discriminated
union. The `null` state is unambiguous (modal closed) and `schemaName`
is always present when the modal is open, so a separate `open` flag
would be redundant.

### `dialogs.tsx` mount placement

Placed the `CreateTableDialogSlot` next to `DropTableConfirmDialog` and
`RenameTableDialog` in `SchemaTree.tsx`'s JSX shell — same render
phase, so all three modals close on outside-click via the same
`onOpenChange` plumbing.

### PK multi-select primitive

Used the same checkbox-list pattern as `IndexesEditor`'s
`CreateIndexModal` columns picker (sprint 213 surface) — labels with
`type="checkbox"` inside a max-height-scrolling div. No new shadcn
primitive added.

### Schema-row context-menu placement

Placed `"Create Table…"` ABOVE the existing `"Refresh"` item. Reasoning:
the schema row currently only had a single action ("Refresh"), and
"Create Table…" is the new primary action a user is likely to reach
for after expanding a schema. Above-Refresh ordering matches the
implicit "actions before maintenance" hierarchy you already see in
the table-row menu (Structure / Data / Rename / Drop — Drop last).

## Trade-offs

- **`primary_key: Some([])`** — the SQL builder ignores an empty PK
  list (no `PRIMARY KEY ()` clause emitted). The frontend never sends
  an empty `Some([])`; the request payload uses `pkColumns.length > 0
  ? pkColumns : null` to ensure `None` over `Some(empty)`. The
  defensive ignore on the backend is a safety net for any future
  caller that reads the contract loosely.
- **`onClose` resets the form even on cancel** — opening the modal
  twice in a row starts fresh. The trade-off is that "I closed the
  modal accidentally and want to reopen with the same draft" is no
  longer possible. Acceptable per spec: Create is non-destructive and
  the draft is fast to retype.
- **Modal does not call `tauri.createTable` for live validation** —
  duplicate-column-name detection is gated only by the backend's
  `AppError::Validation` / PG error on Execute. The frontend gate
  ("Preview SQL disabled until name + ≥1 valid column") is the
  cheapest pre-flight check we can run without a server round-trip.

## Residual risk

- **Manual UI smoke not performed** — the CI command profile passes,
  but I have not run `pnpm tauri dev` to verify visual fidelity to
  `IndexesEditor`'s create dialog. The class names + layout follow
  the same pattern, so the visual delta should be minimal.
- **PG-only** — Mongo `createCollection` is intentionally deferred
  (per Out-of-Scope freeze). Mongo schema rows do not surface the menu
  item because `SchemaTree` is the relational surface;
  `DocumentDatabaseTree` is the Mongo path and is untouched.
- **`ColumnDefinition` reuse vs new struct** — see decision above. If
  ALTER's column-add semantics later subsume CREATE's column shape,
  a future sprint can collapse them; today the duplication is
  intentional.
- **Schema dropped between Preview and Execute** — backend execution
  surfaces the PG error verbatim through `AppError::Database`. The
  modal stays open so the user can edit and retry. No client-side
  guard added.
- **No `[DEFERRED-PHASE-27-E2E]` smoke** — `lefthook.yml:5_e2e` stays
  disabled per ADR 0019 + sprint freeze. Phase 27 e2e smoke (right-
  click → Create Table → fill → Execute → confirm tree refresh)
  remains deferred until e2e recovery.

## Composite-PK fixture (verbatim)

The Rust unit test
`create_table_preview_three_column_composite_pk_byte_equivalent`
asserts byte-equivalence to:

```sql
CREATE TABLE "public"."memberships" ("user_id" integer NOT NULL, "group_id" integer NOT NULL, "joined_at" timestamp DEFAULT now(), PRIMARY KEY ("user_id", "group_id"))
```

Any whitespace / quoting drift in the SQL builder breaks the test —
the assertion is `assert_eq!`, not `.contains()`.

## Preview→commit IPC sequence trace

`CreateTableDialog.test.tsx` case "issues preview→commit calls in
exactly the [{preview_only:true},{preview_only:false}] sequence"
asserts:

```
mockCreateTable.mock.calls[0][0] = { preview_only: true,  schema: "public", name: "events", … }
mockCreateTable.mock.calls[1][0] = { preview_only: false, schema: "public", name: "events", … }
mockCreateTable.mock.calls.length === 2
```

No third call, no skipped preview, no double-commit.

## Safe Mode warn-cancel canonical message match

`CreateTableDialog.test.tsx` case "surfaces the canonical Safe Mode
warn-cancel message verbatim in previewError" asserts exact byte match
of:

```
Safe Mode (warn): confirmation cancelled — no changes committed
```

Reused via `useDdlPreviewExecution.cancelDangerous` (Sprint 214);
sprint-226 does not redefine the message.
