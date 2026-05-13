# Sprint Execution Brief: sprint-274

## Objective

Ship **Trigger DROP** end-to-end (Phase 26 슬라이스 3, 최종):

- Backend `drop_trigger` Tauri command + `build_drop_trigger_sql` pure
  helper + `validate_identifier` on `trigger_name` / `schema` / `table`
  + `PostgresAdapter::drop_trigger` inherent method with
  `sqlx::Transaction::begin` / `commit`.
- `drop_trigger_inner(&AppState, &DropTriggerRequest)` handler reusing
  Sprint 271c `ensure_expected_db` probe under
  `active_connections.lock()` — byte-equivalent to Sprint 273
  `create_trigger_inner` (`src-tauri/src/commands/rdb/ddl.rs:279-290`)
  and Sprint 235 `drop_table_inner` (`:33-43`).
- TS `dropTrigger(request: DropTriggerRequest):
  Promise<SchemaChangeResult>` wrapper + `DropTriggerRequest` TS mirror.
- New `DropTriggerDialog` modal — structural parity with
  `DropTableDialog` (Sprint 235): typing-confirm input (byte-for-byte
  case-sensitive, no `.trim()`), CASCADE checkbox, Show DDL collapsible
  pane (default OPEN, 250ms debounce), Apply destructive variant +
  Safe-Mode warn-tier `ConfirmDestructiveDialog` `pendingConfirm` mount.
  Consumes `useDdlPreviewExecution` (Sprint 214) unchanged.
- `useSchemaTreeActions.dropTriggerDialog` slot +
  `handleDropTrigger(triggerName, tableName, schemaName)` opener +
  `DropTriggerDialogSlot` wrapper.
- Disabled-placeholder swap at `rows.tsx:401-408` (per-table-row
  context-menu Drop Trigger placeholder) and `rows.tsx:648-655`
  (per-trigger row context-menu Drop placeholder) — both flip from
  `disabled` + `title="Drop Trigger is coming soon"` to enabled
  `onClick={() => ctx.handleDropTrigger(...)}`. Matching
  regression-guard line at `triggerRow.test.tsx:208` updated
  mechanically (same shape as Sprint 273's Create-side swap).
- Post-commit refresh invalidates the
  `schemaStore.triggers[connId][db][schema][table]` cache entry so the
  dropped trigger disappears from the Triggers child row +
  StructurePanel tab.

PG-only. Closes the Trigger lifecycle on top of Sprint 272 (read) +
273 (create).

## Task Why

Phase 26 closes TablePlus parity item #6 (Trigger management). The
slice is the third and last of the 272/273/274 trio:

- Sprint 272 shipped read-only introspection (sidebar surfaces existing
  triggers, StructurePanel renders `pg_get_triggerdef`).
- Sprint 273 stacked CREATE on top (modal + SQL emitter + `+`
  affordance + context-menu Create flip).
- Sprint 274 closes the lifecycle with DROP — without it, the user can
  surface and create triggers but cannot remove them without dropping
  to the query tab and writing raw `DROP TRIGGER`, leaving the parity
  goal incomplete.

The Drop surface specifically uses the per-trigger row context menu
that Sprint 273 left as a disabled placeholder
(`rows.tsx:648-655`) — the slice both implements the new affordance
and clears the "coming soon" placeholder language that has been
visible in the sidebar since Sprint 272.

## Scope Boundary

**In scope** — DROP path only:

- `src-tauri/src/models/schema.rs` — `DropTriggerRequest` struct +
  camelCase serde + roundtrip test.
- `src-tauri/src/db/traits.rs` — `RdbAdapter::drop_trigger` trait
  method with default `Err(AppError::Unsupported(...))` (mirror
  `create_trigger` default at `:454-463`).
- `src-tauri/src/db/postgres/mutations.rs` —
  `build_drop_trigger_sql` pure helper (mirror
  `build_create_trigger_sql` `:126-242` shape) +
  `PostgresAdapter::drop_trigger` inherent method (mirror `:1077-1130`
  shape) with `preview_only` branch + `sqlx::Transaction::begin` /
  `commit`.
- `src-tauri/src/db/postgres.rs` — trait delegation + import (mirror
  Sprint 273).
- `src-tauri/src/commands/rdb/ddl.rs` — `drop_trigger_inner` +
  `drop_trigger` Tauri handler reusing `ensure_expected_db` (Sprint
  271c hoist) + `not_connected` helper.
- `src-tauri/src/db/testing.rs` — `StubRdbAdapter::drop_trigger_fn`
  setter (mirror `create_trigger_fn` at `:115, 386-397`).
- `src-tauri/src/lib.rs` — `invoke_handler` registration.
- `src/types/schema.ts` — `DropTriggerRequest` TS mirror with
  camelCase fields + `expectedDatabase` guard.
- `src/lib/tauri/ddl.ts` — `dropTrigger` wrapper with JSDoc
  referencing Sprint 274.
- `src/components/schema/DropTriggerDialog.tsx` — new modal
  (typing-confirm + CASCADE + Show DDL + Safe-Mode warn-tier
  confirm), structural parity with `DropTableDialog`.
- `src/components/schema/DropTriggerDialog.test.tsx` — vitest cases
  (open/close, typing-confirm gate byte-for-byte, CASCADE toggle
  invalidates preview, mismatch toast, Safe-Mode warn-tier confirm,
  post-commit cache refresh).
- `src/components/schema/SchemaTree/useSchemaTreeActions.ts` —
  `dropTriggerDialog` slot + `handleDropTrigger` opener +
  `refreshTableTriggersForSlot` reuse.
- `src/components/schema/SchemaTree/rows.tsx` — two disabled-placeholder
  swap sites only (`:401-408` per-table row Drop Trigger; `:648-655`
  per-trigger row Drop).
- `src/components/schema/SchemaTree/dialogs.tsx` —
  `DropTriggerDialogSlot`.
- `src/components/schema/SchemaTree.tsx` — slot mount + ctx wiring.
- `src/components/schema/SchemaTree/triggerRow.test.tsx` — mechanical
  swap at `:208` ("Drop Trigger… disabled placeholder" → "Drop
  Trigger… enabled"), same shape as Sprint 273's Create-side update.

**Pre-work** (recommended, 1 small commit, not load-bearing):

- **Sprint 272/273 P2 carryover #1** — `body.tsx::TriggerGroupSubtree`
  ↔ `treeRows.ts::buildTriggerRowsForTable` trigger render-path
  duplication collapse. Sprint 274 wires the Drop affordance through
  the per-trigger row context menu, which exercises the duplicated
  path again. Cleaning up before the main slice prevents drift and
  keeps the main commit scoped.
- **Sprint 273 P2 #2/#3** — `CreateTriggerDialog.tsx:251`
  `eventsArray` useEffect deps churn (replace with `events.size` or
  stable join hash) + `:488, 499` duplicate `setFunctionName` collapse
  (single setter `match.name ?? next`). May piggyback on the same
  pre-work commit.

**Out of scope** (explicitly deferred):

- **NO Function CREATE/EDIT UI** — deferred indefinitely (master spec
  § 7).
- **NO ALTER TRIGGER rename** (`ALTER TRIGGER … RENAME TO`).
- **NO DISABLE / ENABLE triggers** (`ALTER TABLE … DISABLE
  TRIGGER`).
- **NO event triggers (DB-level)** (`CREATE EVENT TRIGGER`).
- **NO trigger dependency graph visualisation**.
- **NO PL/pgSQL debugger**.
- **NO Mongo change streams**.
- **NO MySQL / SQLite trigger support** — `RdbAdapter::drop_trigger`
  default `Unsupported` covers non-PG adapters; PG-only this phase.
- **NO regression in Sprint 272 surfaces**: `list_triggers`,
  `get_trigger_source`, `schemaStore.triggers` cache shape
  (`ByConn<BySchema<ByTable<TriggerInfo[]>>>`), `StructurePanel`
  Triggers tab, `SchemaTree` Triggers child row, `TriggerInfo`
  model, tgtype bitmask decoder, `decode_tgargs` MUST stay
  byte-equivalent.
- **NO regression in Sprint 273 surfaces**: `CreateTriggerRequest`,
  `create_trigger` command + `_inner`, `build_create_trigger_sql`
  emitter, `createTrigger` TS wrapper, `CreateTriggerDialog` modal,
  `useSchemaTreeActions.createTriggerDialog` slot +
  `handleCreateTrigger` opener, `CreateTriggerDialogSlot`, Create
  context-menu items, Triggers group header `+` affordance MUST
  stay byte-equivalent. The only row-level edits permitted are the
  two disabled-placeholder swap sites
  (`rows.tsx:401-408`, `rows.tsx:648-655`) and the matching
  regression-guard line (`triggerRow.test.tsx:208`).

## Invariants

(Mirrors contract § Invariants verbatim.)

- **Sprint 272 surfaces unchanged**: `list_triggers`,
  `get_trigger_source`, `schemaStore.triggers` cache shape,
  `StructurePanel` Triggers tab, `SchemaTree` Triggers child row,
  `TriggerInfo`, `decode_tgtype`, `decode_tgargs`. Sprint 274 may
  flip the existing disabled "Drop Trigger…" context-menu items to
  enabled, but MUST NOT mutate the read SQL, the cache shape, the
  tab content, or the row renderers other than the two
  disabled-placeholder swap sites.
- **Sprint 273 surfaces unchanged**: `CreateTriggerRequest` Rust + TS
  model, `create_trigger` command + `_inner`, `build_create_trigger_sql`
  PG SQL emitter, `createTrigger` TS wrapper, `CreateTriggerDialog`
  modal, `useSchemaTreeActions.createTriggerDialog` slot +
  `handleCreateTrigger` opener, `CreateTriggerDialogSlot`, "Create
  Trigger…" context-menu items, Triggers group header `+` affordance.
  Verified by unchanged passing Sprint 272/273 tests.
- **Sprint 271c `ensure_expected_db` helper reused unchanged**: the
  new `drop_trigger_inner` calls `ensure_expected_db(adapter,
  request.expected_database.as_deref()).await?` under the same
  `state.active_connections.lock().await` acquisition that wraps the
  trait dispatch — byte-equivalent to `create_trigger_inner` at
  `src-tauri/src/commands/rdb/ddl.rs:279-290` and `drop_table_inner`
  at `:33-43`. NO new probe variant; NO change to the helper
  signature.
- **Sprint 214 `useDdlPreviewExecution` reused unchanged**: the new
  `DropTriggerDialog` consumes the existing
  `useDdlPreviewExecution(request, executor)` lifecycle (preview
  debounce + Safe-Mode dispatch + post-commit refresh). The hook
  signature MUST NOT change (shared with 6+ other DDL dialogs).
- **`validate_identifier` helper reused unchanged**: the new PG SQL
  emitter calls `validate_identifier(name)` on `trigger_name`,
  `schema`, `table`. NAMEDATALEN-63-byte limit +
  identifier-character whitelist enforced verbatim. NO new helper
  introduced.
- **DbMismatch handling pattern reused**: on user-initiated Apply,
  parse `DbMismatch` via `parseDbMismatch`, run
  `syncMismatchedActiveDb`, surface a Retry toast (Sprint 269 +
  271a/c user-initiated path). Preview (debounced) mismatches stay
  **silent** to match Sprint 272 passive-prefetch contract.
- **`DropTableDialog` structural parity** (Sprint 235): typing-confirm
  input byte-for-byte case-sensitive match (no `.trim()`), CASCADE
  checkbox, Show DDL collapsible pane, Apply destructive variant,
  Safe-Mode warn-tier `ConfirmDestructiveDialog` `pendingConfirm`
  mount on top of the typing-confirm gate. Sprint 274's
  `DropTriggerDialog` mirrors this shape — only the SQL target
  differs.
- **Phase 21–25 DROP dialogs unchanged**: `DropTableDialog`,
  `DropIndexDialog`, `DropConstraintDialog`, View / Function drop
  dialogs MUST render byte-equivalent — verified by unchanged
  passing tests.
- **`sqlx::Transaction::begin` / `commit` pattern** (Sprint 273
  mutation shape at `mutations.rs:1099-1113`): `preview_only: false`
  wraps the single `DROP TRIGGER` statement via the
  `sqlx::Transaction::begin(pool).await?` API + `tx.commit().await?`
  call — NO literal `BEGIN` / `COMMIT` strings issued from Rust to
  the wire.
- **SQL identifier quoting**: every emitted identifier is wrapped in
  `"..."` (PG `quote_ident` semantics). `validate_identifier`
  rejects embedded double-quotes / NULs so byte-for-byte quoting is
  safe.
- **Post-commit refresh invalidates Sprint 272 cache**: after Apply
  commit, `refreshTableTriggers(connId, db, schema, table)` evicts
  the `(connId, db, schema, table)` entry in `schemaStore.triggers`
  and re-fetches via `listTriggers`, so the dropped trigger
  disappears from the Triggers child row + StructurePanel tab.

## Done Criteria

(Mirrors contract § Done Criteria.)

1. **AC-274-01** — `cargo test drop_trigger_request_serde_roundtrip`
   passes; TS `DropTriggerRequest` exported with camelCase field
   names (`connectionId`, `triggerName`, `cascade`, `previewOnly`,
   `expectedDatabase`).
2. **AC-274-02** — `cargo test drop_trigger_inner_routes_to_trait`
   passes against `StubRdbAdapter`. Probe call-site
   (`ensure_expected_db(adapter, request.expected_database.as_deref())`)
   visible in `drop_trigger_inner` body between `as_rdb()?` and the
   trait dispatch, byte-equivalent to `create_trigger_inner` at
   `:279-290`.
3. **AC-274-03** — `src/lib/tauri/ddl.ts` exports `dropTrigger` with
   signature `(request: DropTriggerRequest) =>
   Promise<SchemaChangeResult>`; JSDoc references Sprint 274.
4. **AC-274-04** — `DropTriggerDialog` renders typing-confirm input,
   CASCADE checkbox, Show DDL collapsible pane (default OPEN), Apply
   destructive button. Typing-confirm input gate is byte-for-byte
   case-sensitive (no `.trim()`) — empty / partial / whitespace stays
   Apply-disabled. Apply opens `ConfirmDestructiveDialog` warn-tier
   in Safe-Mode warn paths; commit-success path invalidates the
   triggers cache.
5. **AC-274-05** — `useSchemaTreeActions` exposes `dropTriggerDialog`
   slot + `handleDropTrigger` handler; `dialogs.tsx` mounts
   `DropTriggerDialogSlot`; per-trigger row context-menu "Drop…"
   item is enabled and wires `onClick` to `handleDropTrigger`;
   per-table-row context-menu "Drop Trigger…" placeholder
   (`rows.tsx:401-408`) and per-trigger context-menu placeholder
   (`rows.tsx:648-655`) both flip from `disabled` + `title="Drop
   Trigger is coming soon"` to enabled handlers.
6. **AC-274-06** — manual smoke evidence: screenshot or recording of
   the round-trip (right-click trigger row → Drop… → typing-confirm
   → CASCADE off → preview → Apply → warn confirm → row disappears).
7. **AC-274-07** — backend `cargo test drop_trigger` adds: cascade
   on/off SQL emission fixtures (≥2), identifier-rejection fixtures
   (3 — trigger_name, schema, table), 1 mismatch test (Sprint 271c
   panic-closure pattern). Vitest adds `DropTriggerDialog.test.tsx`
   with ≥6 cases (open/close, typing-confirm gate, CASCADE toggle
   invalidates preview, mismatch toast, Safe-Mode warn-tier confirm,
   post-commit cache refresh).

## Pre-work

**Recommended (1 small commit, not load-bearing)** — collapse the
following residuals before the main slice:

1. **Sprint 272/273 P2 carryover #1** — `body.tsx::TriggerGroupSubtree`
   (lines 536–660) and `treeRows.ts::buildTriggerRowsForTable` (lines
   563–661) currently implement the same branching logic in two
   places. Sprint 274 wires the Drop affordance through the
   per-trigger row context menu, which exercises both paths.
   Suggested fix: change `body.tsx` to consume
   `buildTriggerRowsForTable`'s `VisibleRow[]` output through the
   existing `renderVisibleRow` dispatcher (`rows.tsx:629-663`),
   eliminating the eager-nested render branch. Sprint 273 deferred
   this with the same justification — Sprint 274 is the appropriate
   point to land it because the new Drop affordance hangs off the
   per-trigger row.
2. **Sprint 273 P2 #2** — `CreateTriggerDialog.tsx:251` `eventsArray`
   useEffect deps churn — replace with `events.size` or stable join
   hash (`Array.from(events).sort().join('|')`).
3. **Sprint 273 P2 #3** — `CreateTriggerDialog.tsx:488, 499` duplicate
   `setFunctionName` — collapse to a single setter
   (`setFunctionName(match.name ?? next)`).

Land as one or two commits (Conventional Commits:
`refactor(sprint-274): ...`) **before** the main Sprint 274 commit so
the diff for the main slice stays scoped to the DROP feature. Skipping
this pre-work does not block Sprint 274 ACs, but Evaluator may surface
the duplication / churn as a P2 carryover finding.

## Verification Plan

- **Profile**: `mixed`.
- **Required checks**:
  1. `cd src-tauri && cargo test drop_trigger` — cascade on/off SQL
     emission + identifier rejection (trigger_name / schema / table)
     + mismatch panic-closure test pass.
  2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D
     warnings` — clean.
  3. `cd src-tauri && cargo fmt --check` — passes.
  4. `cd src-tauri && cargo test --lib` — full backend green (no
     regression in Sprint 272/273 trigger tests or any earlier Phase
     tests; total count ≥ Sprint 273 baseline 749 + new tests).
  5. `pnpm tsc --noEmit` — clean.
  6. `pnpm vitest run` — passes; new `DropTriggerDialog.test.tsx`
     ≥6 cases included; Sprint 272/273 trigger tests still green.
  7. `pnpm lint` — clean (`pnpm exec eslint . --max-warnings 0`).
  8. **Manual round-trip smoke** — `pnpm tauri dev` against fixtures
     PG:
     - Right-click an existing trigger row in the SchemaTree (under a
       Table → Triggers child group) → "Drop…" context-menu item
       enabled → modal opens.
     - Type the trigger name into the typing-confirm input; CASCADE
       checkbox left OFF.
     - Show DDL pane renders `DROP TRIGGER "<name>" ON
       "<schema>"."<table>"` within 250ms of the last keystroke or
       CASCADE toggle.
     - Apply → Safe-Mode warn-tier `ConfirmDestructiveDialog` opens →
       Confirm → modal closes → Triggers child row of the parent
       table no longer lists the dropped trigger; `StructurePanel`
       Triggers tab refresh removes the row.
- **Required evidence**:
  - **Changed files** grouped by surface (models / traits / PG emitter
    / command handler / TS wrappers / UI / tests), each with a
    one-line purpose.
  - **Per-gate command output** (final ~40 lines): `cargo fmt
    --check`, `cargo clippy`, `cargo test` (with new-test count
    delta vs Sprint 273 baseline 749), `pnpm tsc --noEmit`, `pnpm
    vitest run` (with test count delta vs Sprint 273 baseline 3271),
    `pnpm lint`.
  - **SQL emission fixture outputs** verbatim — both cascade-on and
    cascade-off fixtures plus at least one identifier-rejection
    fixture.
  - **AC coverage table** with `file:line` citations for each AC
    (e.g. `AC-274-02` → `src-tauri/src/commands/rdb/ddl.rs:NNN-MMM`
    for the probe block + trait dispatch;
    `src-tauri/src/db/postgres/mutations.rs:NNN-MMM` for the SQL
    emitter).
  - **Manual smoke evidence** — screenshot or screen-recording
    reference of the round-trip described in step 8.

## Evidence To Return

- Changed files and purpose (grouped by surface).
- Checks run and outcomes (per-gate tails, deltas vs Sprint 273
  baseline 749 backend / 3271 vitest).
- Done criteria coverage with evidence (AC coverage table with
  `file:line` citations).
- SQL emission fixture outputs verbatim (cascade on/off + ≥1
  identifier-rejection sample).
- Assumptions made during implementation (e.g. typing-confirm
  whitespace handling, CASCADE toggle debounce wiring, Safe-Mode
  warn-tier vs deny-tier dispatch on Drop Trigger).
- Residual risk or verification gaps (e.g. fixtures PG seed
  availability for the manual smoke, fakeTimers reliability for the
  CASCADE toggle 250ms re-fetch assertion, whether
  `body.tsx ↔ treeRows.ts` cleanup landed in pre-work or deferred
  again).

## References

- **Contract**: `docs/sprints/sprint-274/contract.md`
- **Master spec**: `docs/sprints/sprint-272/spec.md` § 3 — Sprint 274
- **Sprint 273 handoff** (reuse shapes + first move 8 steps + Drop-only
  reuse): `docs/sprints/sprint-273/handoff.md`
- **Sprint 273 findings** (P2 carryover × 4): `docs/sprints/sprint-273/findings.md`
- **DDL handler template (byte-equivalent target)**:
  `src-tauri/src/commands/rdb/ddl.rs:279-290` — `create_trigger_inner`.
- **DDL handler reference (earlier shape)**:
  `src-tauri/src/commands/rdb/ddl.rs:33-43` — `drop_table_inner`.
- **PG SQL emitter pattern**:
  `src-tauri/src/db/postgres/mutations.rs:126-242` —
  `build_create_trigger_sql` pure helper.
- **PG inherent-method pattern**:
  `src-tauri/src/db/postgres/mutations.rs:1077-1130` —
  `PostgresAdapter::create_trigger` with `preview_only` branch +
  `sqlx::Transaction::begin` / `commit`.
- **`StubRdbAdapter` slot pattern**:
  `src-tauri/src/db/testing.rs:115, 386-397` — `create_trigger_fn`
  test-double slot.
- **Request struct pattern**:
  `src-tauri/src/models/schema.rs` — `DropTableRequest` /
  `CreateTriggerRequest` (camelCase serde + `#[serde(default)]
  expected_database`).
- **Modal structural parity**:
  `src/components/schema/DropTableDialog.tsx` — Sprint 235 typing-confirm
  + CASCADE + Show DDL + Safe-Mode warn-tier `ConfirmDestructiveDialog`.
  Typing-confirm comparison at line 105 (case-sensitive byte-for-byte,
  no `.trim()`).
- **Preview/commit hook (UNCHANGED)**:
  `src/components/structure/useDdlPreviewExecution.ts` — Sprint 214
  lifecycle to consume.
- **Destructive confirm dialog**:
  `src/components/workspace/ConfirmDestructiveDialog.tsx` — Safe-Mode
  warn-tier danger confirmation.
- **Dialog opener pattern**:
  `src/components/schema/SchemaTree/useSchemaTreeActions.ts` —
  existing `createTriggerDialog` slot + `handleCreateTrigger`.
- **Dialog slot wrapper**:
  `src/components/schema/SchemaTree/dialogs.tsx` —
  `CreateTriggerDialogSlot` (Sprint 273) reference shape.
- **Disabled-placeholder swap sites**:
  `src/components/schema/SchemaTree/rows.tsx:401-408` (per-table row
  Drop Trigger placeholder, line 403 `title="Drop Trigger is coming
  soon"`); `src/components/schema/SchemaTree/rows.tsx:648-655`
  (per-trigger row Drop placeholder, line 648 same title). Both flip
  in Sprint 274 to enabled handlers.
- **Regression-guard line**:
  `src/components/schema/SchemaTree/triggerRow.test.tsx:208` — Sprint
  273 did the equivalent mechanical update for the Create-side
  ("Create Trigger… disabled placeholder" → "Create Trigger…
  enabled"); Sprint 274 does the matching swap for the Drop side.
- **DbMismatch sync**: `src/lib/api/syncMismatchedActiveDb.ts` — Sprint
  269 / 271a passive sync; Sprint 271c user-initiated Retry toast lives
  in the dialog Apply path.
- **Relevant files** (write scope):
  - `src-tauri/src/models/schema.rs`
  - `src-tauri/src/db/traits.rs`
  - `src-tauri/src/db/postgres/mutations.rs`
  - `src-tauri/src/db/postgres.rs`
  - `src-tauri/src/commands/rdb/ddl.rs`
  - `src-tauri/src/db/testing.rs`
  - `src-tauri/src/lib.rs`
  - `src/types/schema.ts`
  - `src/lib/tauri/ddl.ts`
  - `src/components/schema/DropTriggerDialog.tsx` (new)
  - `src/components/schema/DropTriggerDialog.test.tsx` (new)
  - `src/components/schema/SchemaTree/useSchemaTreeActions.ts`
  - `src/components/schema/SchemaTree/rows.tsx` (two swap sites only)
  - `src/components/schema/SchemaTree/dialogs.tsx`
  - `src/components/schema/SchemaTree.tsx` (slot mount + ctx wiring)
  - `src/components/schema/SchemaTree/triggerRow.test.tsx`
    (mechanical line:208 swap)
  - Optional pre-work:
    `src/components/schema/SchemaTree/body.tsx` +
    `src/components/schema/SchemaTree/treeRows.ts` (render-path
    duplication cleanup) +
    `src/components/schema/CreateTriggerDialog.tsx` (Sprint 273 P2
    cleanup).
