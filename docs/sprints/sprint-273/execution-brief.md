# Sprint Execution Brief: sprint-273

## Objective

Ship **Trigger CREATE** end-to-end: backend `create_trigger` Tauri command
+ PG SQL emitter + identifier validation; TS wrapper `createTrigger`;
new `CreateTriggerDialog` modal (name + timing + events + ROW/STATEMENT +
WHEN clause + function picker + arguments + Show DDL preview);
`useSchemaTreeActions` opener + `+` affordance on the Triggers child
row + "Create Trigger…" context-menu flip from disabled (Sprint 272
placeholder) to enabled. Reuses Sprint 271c `expected_database` guard,
Sprint 214 `useDdlPreviewExecution` lifecycle, and Sprint 271c
DbMismatch user-initiated Retry-toast pattern. PG-only. NO drop UI
(Sprint 274). NO Function CREATE/EDIT (deferred indefinitely).

## Task Why

Phase 26 closes TablePlus parity item #6 (Trigger management). Sprint
273 is slice 2 of the 272/273/274 trio: Sprint 272 shipped the
read-only foundation (sidebar surfaces existing triggers, structure
panel renders `pg_get_triggerdef`) and Sprint 273 stacks the CREATE
affordance on top, anchored against the read path. Without this slice
the user has zero authoring surface for triggers — they must drop to
raw SQL in the query tab, defeating the TablePlus parity goal. Sprint
274 (DROP) depends on this CREATE landing first because the drop
context menu hangs off the same Triggers child row family that Sprint
273 extends with a `+` affordance.

## Scope Boundary

**In scope** — CREATE path only:

- `src-tauri/src/models/schema.rs` — `CreateTriggerRequest` struct +
  camelCase serde + roundtrip test.
- `src-tauri/src/db/traits.rs` — `RdbAdapter::create_trigger` trait
  method with default `Err(AppError::Unsupported(Paradigm::Relational))`.
- `src-tauri/src/db/postgres/mutations.rs` — PG SQL emitter with
  `validate_identifier` + whitelist + deterministic event order +
  single-quote re-escape on `function_arguments` (closes Sprint 272
  findings § P3) + INSTEAD OF rejection paths.
- `src-tauri/src/commands/rdb/ddl.rs` — `create_trigger_inner` +
  `create_trigger` Tauri handler reusing `ensure_expected_db` (Sprint
  271c hoist) + `not_connected` helper.
- `src-tauri/src/db/testing.rs` — `StubRdbAdapter::create_trigger_fn`
  setter.
- `src-tauri/src/lib.rs` — `invoke_handler` registration.
- `src/types/ddl.ts` (or wherever `*Request` TS mirrors live) —
  `CreateTriggerRequest` TS mirror.
- `src/lib/tauri/ddl.ts` — `createTrigger` wrapper.
- `src/components/schema/CreateTriggerDialog.tsx` — new modal (form
  fields per AC-273-04).
- `src/components/schema/CreateTriggerDialog.test.tsx` — vitest cases
  (open/close, Apply gating, debounced preview, INSTEAD OF disables
  STATEMENT, mismatch toast).
- `src/components/schema/SchemaTree/useSchemaTreeActions.ts` —
  `createTriggerDialog` slot + `handleCreateTrigger` opener.
- `src/components/schema/SchemaTree/rows.tsx` — `+` affordance on
  Triggers group header; "Create Trigger…" context-menu item flips
  from disabled (Sprint 272) to enabled.
- `src/components/schema/SchemaTree/dialogs.tsx` —
  `CreateTriggerDialogSlot`.

**Pre-work** (optional, 1 small commit before main slice): Sprint 272
findings § P2 render-path duplication cleanup — `body.tsx`
(`TriggerGroupSubtree` lines 536–660) consumes
`buildTriggerRowsForTable` output via the existing `renderVisibleRow`
dispatcher (`rows.tsx:629-663`) instead of duplicating branching
logic. Lands before Sprint 273 wires the `+` affordance to a single
source-of-truth, preventing drift.

**Out of scope** (explicitly deferred):

- **NO `DropTriggerDialog`** — Sprint 274.
- **NO `drop_trigger` Tauri command / `_inner` / `DropTriggerRequest`** —
  Sprint 274.
- **NO Function CREATE/EDIT UI** — deferred indefinitely (master spec
  § 7). The function picker is read-only over
  `schemaStore.functions[connectionId][db]` with a free-text fallback
  for the cache-miss race.
- **NO TRUNCATE event in CREATE dialog** — events checkbox set is
  `["INSERT", "UPDATE", "DELETE"]` only.
- **NO ALTER TRIGGER rename / DISABLE / ENABLE** — phase-wide deferred
  per master spec § 7.
- **NO event triggers (`CREATE EVENT TRIGGER`), trigger dependency
  graph, PL/pgSQL debugger, Mongo change streams, MySQL/SQLite
  triggers** — phase-wide deferred per master spec § 7.
- **NO regression in Sprint 272 surfaces**: `list_triggers`,
  `get_trigger_source`, `schemaStore.triggers` cache,
  `StructurePanel` Triggers tab, `SchemaTree` Triggers child row,
  `TriggerInfo` model, tgtype bitmask decoder, `decode_tgargs` MUST
  stay byte-equivalent. The only row-level edits permitted are (a)
  adding the `+` affordance on the Triggers group header and (b)
  flipping the existing disabled "Create Trigger…" context-menu item
  to enabled per Sprint 272 handoff § "Disabled-placeholder swap
  pattern".

## Invariants

- **Sprint 272 read-path surfaces unchanged**: `list_triggers`,
  `get_trigger_source`, `schemaStore.triggers` cache,
  `StructurePanel` Triggers sub-tab, `SchemaTree` Triggers child row,
  `TriggerInfo`, `decode_tgtype`, `decode_tgargs`. Sprint 273 may
  extend context-menu items from disabled placeholder to enabled
  handler, may add a `+` affordance to the Triggers group header,
  but MUST NOT mutate the read SQL, the cache shape, the tab
  content, or the row renderers other than the affordance /
  context-menu hooks.
- **Sprint 271c `ensure_expected_db` helper reused unchanged**: the
  new `create_trigger_inner` calls
  `ensure_expected_db(adapter, request.expected_database.as_deref()).await?`
  under the same `state.active_connections.lock().await` acquisition
  that wraps the trait dispatch — byte-equivalent to every other
  handler in `src-tauri/src/commands/rdb/ddl.rs` (e.g.
  `drop_table_inner` at `:32-43`). NO new probe variant; NO change to
  the helper signature.
- **Sprint 214 `useDdlPreviewExecution` reused unchanged**: the new
  `CreateTriggerDialog` consumes the existing
  `useDdlPreviewExecution(request, executor)` lifecycle (preview
  debounce + Safe-Mode dispatch + post-commit refresh). The hook
  signature MUST NOT change. Mirrors `CreateTableDialog` consumption
  pattern.
- **DbMismatch handling pattern reused**: on user-initiated Apply,
  parse `DbMismatch` via `parseDbMismatch`, run
  `syncMismatchedActiveDb`, surface a Retry toast (Sprint 269 +
  271a/c user-initiated path). Preview (debounced) mismatches stay
  **silent** to match Sprint 272 passive-prefetch contract.
- **Phase 21–25 CREATE dialogs unchanged**: `CreateTableDialog` (Phase
  21), `CreateIndexDialog` (Phase 22), `CreateConstraintDialog` (Phase
  23), View / Function read dialogs (Phase 24 / 25) MUST render
  byte-equivalent — verified by unchanged passing tests.
- **`validate_identifier` helper reused unchanged**: the new PG SQL
  emitter calls `validate_identifier(name)` on `trigger_name`,
  `schema`, `table`, `function_schema`, `function_name`.
  NAMEDATALEN-63-byte limit + identifier-character whitelist enforced
  verbatim. NO new helper introduced.
- **SQL identifier quoting**: every emitted identifier is wrapped in
  `"..."` (PG `quote_ident` semantics). `validate_identifier` rejects
  embedded double-quotes / NULs so byte-for-byte quoting is safe. NO
  string interpolation of unvalidated identifiers; arguments / WHEN
  are free-text passthrough (PG surfaces parse errors verbatim) with
  the single-quote re-escape on `function_arguments` fixing Sprint
  272 findings § P3.
- **Sprint 272 cache shape**: `schemaStore.triggers:
  ByConn<BySchema<ByTable<TriggerInfo[]>>>`. Post-commit refresh
  after Apply invalidates the `(connId, db, schema, table)` entry so
  the follow-up `getTableTriggers` re-fetches.

## Done Criteria

(Mirrors contract § Done Criteria.)

1. **AC-273-01** — `cargo test create_trigger_request_serde_roundtrip`
   passes; TS `CreateTriggerRequest` exported with camelCase field
   names (`connectionId`, `triggerName`, `whenExpression`,
   `functionSchema`, `functionName`, `functionArguments`,
   `previewOnly`, `expectedDatabase`).
2. **AC-273-02** — `cargo test create_trigger_inner_routes_to_trait`
   passes against `StubRdbAdapter`. Probe call-site
   (`ensure_expected_db(adapter,
   request.expected_database.as_deref())`) visible in
   `create_trigger_inner` body between `as_rdb()?` and the trait
   dispatch.
3. **AC-273-03** — `src/lib/tauri/ddl.ts` exports `createTrigger` with
   signature `(request: CreateTriggerRequest) =>
   Promise<SchemaChangeResult>`; JSDoc references Sprint 273.
4. **AC-273-04** — `CreateTriggerDialog` renders all 8 form fields
   (name, timing radio, events checkboxes, FOR EACH radio, WHEN
   textarea, function picker combobox, arguments input, Show DDL
   collapsible). STATEMENT radio is `disabled` when timing = INSTEAD
   OF. Apply button `disabled` until gate passes.
5. **AC-273-05** — `CreateTriggerDialog` consumes
   `useDdlPreviewExecution` with `expected_database` threaded into
   the request; user-initiated Apply mismatch path runs
   `parseDbMismatch` + `syncMismatchedActiveDb` + Retry toast
   (vitest assertion).
6. **AC-273-06** — `useSchemaTreeActions` exposes
   `createTriggerDialog` slot + `handleCreateTrigger` handler;
   `dialogs.tsx` mounts `CreateTriggerDialogSlot`; Triggers group
   header renders `+` affordance; "Create Trigger…" context-menu
   item is enabled and wires `onClick` to `handleCreateTrigger`.
7. **AC-273-07** — manual smoke evidence: screenshot or recording of
   the round-trip (BEFORE INSERT ROW + WHEN clause + function picker
   pick → preview → Apply → row appears in tree + tab).
8. **AC-273-08** — backend `cargo test create_trigger` adds: (i)–(iv)
   SQL emission fixtures (≥4 cases), 5+ rejection paths
   (`AppError::Validation`), 1 mismatch test (Sprint 271c
   panic-closure pattern). Vitest adds `CreateTriggerDialog.test.tsx`
   with ≥5 cases (open/close, Apply gating, debounced preview,
   INSTEAD OF disables STATEMENT, mismatch toast).

## Pre-work

**Recommended (1 small commit, not load-bearing)** — Sprint 272
findings § P2 render-path duplication cleanup:

`body.tsx::TriggerGroupSubtree` (lines 536–660) and
`treeRows.ts::buildTriggerRowsForTable` (lines 563–661) currently
implement the same branching logic in two places. Sprint 273 adds a
`+` affordance to the Triggers group header. If both render paths
survive, the new affordance must be wired twice (drift risk).

**Suggested fix** — change `body.tsx` to consume `buildTriggerRowsForTable`'s
`VisibleRow[]` output through the existing `renderVisibleRow` dispatcher
(`rows.tsx:629-663`), eliminating the eager-nested render branch.

Land this as its own commit (Conventional Commits:
`refactor(sprint-273): collapse Trigger render-path duplication`)
**before** the main Sprint 273 commit so the diff for the main slice
stays scoped to the CREATE feature.

## Verification Plan

- **Profile**: `mixed`.
- **Required checks**:
  1. `cd src-tauri && cargo test create_trigger` — SQL emission
     fixtures (≥4) + rejection paths (5) + mismatch test pass.
  2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D
     warnings` — clean.
  3. `cd src-tauri && cargo fmt --check` — passes.
  4. `cd src-tauri && cargo test --lib` — full backend green (no
     regression in Sprint 272 trigger tests or any earlier Phase
     tests).
  5. `pnpm tsc --noEmit` — clean.
  6. `pnpm vitest run` — passes; new `CreateTriggerDialog.test.tsx`
     ≥5 cases included; Sprint 272 trigger tests still green.
  7. `pnpm lint` — clean.
  8. **Manual round-trip smoke** — `pnpm tauri dev` against fixtures
     PG:
     - Right-click a Table row → "Create Trigger…" context-menu item
       enabled → modal opens.
     - Fill: trigger name `audit_users_insert`; timing BEFORE; events
       INSERT; FOR EACH ROW; WHEN `(NEW.email IS NOT NULL)`; function
       picker `audit.log_insert`; arguments empty.
     - Show DDL pane renders canonical SQL within 250ms of last
       keystroke.
     - Apply → modal closes → Triggers child row of `users` now
       lists `audit_users_insert`; `StructurePanel` Triggers tab
       renders the trigger metadata + `pg_get_triggerdef` block.
- **Required evidence**:
  - **Changed files** grouped by surface (models / traits / PG
    emitter / command handler / TS wrappers / UI / tests), each with
    a one-line purpose.
  - **Per-gate command output** (final ~40 lines): `cargo fmt
    --check`, `cargo clippy`, `cargo test` (with new-test count
    delta vs Sprint 272 baseline), `pnpm tsc --noEmit`, `pnpm vitest
    run` (with test count delta), `pnpm lint`.
  - **6 SQL emission fixture outputs** verbatim — the
    (i)/(ii)/(iii)/(iv) emission cases plus 2 from the 5 rejection
    cases (e.g. INSTEAD OF+STATEMENT, invalid identifier).
  - **AC coverage table** with `file:line` citations for each AC
    (e.g. `AC-273-02` → `src-tauri/src/commands/rdb/ddl.rs:NNN-MMM`
    for the probe block + trait dispatch;
    `src-tauri/src/db/postgres/mutations.rs:NNN-MMM` for the SQL
    emitter).
  - **Manual smoke evidence** — screenshot or screen-recording
    reference of the round-trip described in step 8.

## Evidence To Return

- Changed files and purpose (grouped by surface).
- Checks run and outcomes (per-gate tails, deltas vs Sprint 272
  baseline).
- Done criteria coverage with evidence (AC coverage table with
  `file:line` citations).
- 6 SQL emission fixture outputs verbatim.
- Assumptions made during implementation (e.g. function picker UX
  details, debounce timer wrapper choice, `BEGIN/COMMIT` wrap shape).
- Residual risk or verification gaps (e.g. fixtures PG seed
  availability, manual-smoke environment notes, fakeTimers
  reliability for the 250ms debounce assertion).

## References

- **Contract**: `docs/sprints/sprint-273/contract.md`
- **Master spec**: `docs/sprints/sprint-272/spec.md` § 3 — Sprint 273
- **Sprint 272 handoff** (reuse shapes): `docs/sprints/sprint-272/handoff.md`
- **Sprint 272 findings** (P2 cleanup + P3 escape action item):
  `docs/sprints/sprint-272/findings.md`
- **DDL handler pattern**: `src-tauri/src/commands/rdb/ddl.rs:32-43`
  — `drop_table_inner` body shape (probe + dispatch).
- **PG SQL emitter style**: `src-tauri/src/db/postgres/mutations.rs`
  — existing `create_table` / `add_constraint` emitters.
- **Request struct pattern**: `src-tauri/src/models/schema.rs:277-310`
  — `RenameTableRequest` / `DropTableRequest` (camelCase serde +
  `#[serde(default)] expected_database`).
- **Preview/commit hook**: `src/components/structure/useDdlPreviewExecution.ts`
  — Sprint 214 lifecycle to consume.
- **Similar dialog shape**: `src/components/schema/CreateTableDialog.tsx`
  — Show DDL collapsible pane, 250ms debounce, Apply gate.
- **Dialog opener pattern**: `src/components/schema/SchemaTree/useSchemaTreeActions.ts`
  — existing `createTableDialog` slot + `handleCreateTable`.
- **Dialog slot wrapper**: `src/components/schema/SchemaTree/dialogs.tsx`
  — existing wrappers (e.g. `CreateTableDialogSlot`).
- **DbMismatch sync**: `src/lib/api/syncMismatchedActiveDb.ts` —
  Sprint 269 / 271a passive sync; Sprint 271c user-initiated Retry
  toast lives in the dialog Apply path.
- **Relevant files** (write scope):
  - `src-tauri/src/models/schema.rs`
  - `src-tauri/src/db/traits.rs`
  - `src-tauri/src/db/postgres/mutations.rs`
  - `src-tauri/src/commands/rdb/ddl.rs`
  - `src-tauri/src/db/testing.rs`
  - `src-tauri/src/lib.rs`
  - `src/types/ddl.ts`
  - `src/lib/tauri/ddl.ts`
  - `src/components/schema/CreateTriggerDialog.tsx` (new)
  - `src/components/schema/CreateTriggerDialog.test.tsx` (new)
  - `src/components/schema/SchemaTree/useSchemaTreeActions.ts`
  - `src/components/schema/SchemaTree/rows.tsx`
  - `src/components/schema/SchemaTree/dialogs.tsx`
  - Optional pre-work:
    `src/components/schema/SchemaTree/body.tsx` +
    `src/components/schema/SchemaTree/treeRows.ts`
