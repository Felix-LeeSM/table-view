# Sprint Contract: sprint-274

## Summary

- **Goal**: Phase 26 Slice 3 (최종) — ship **Trigger DROP** end-to-end.
  Backend `drop_trigger` Tauri command + `build_drop_trigger_sql` pure
  helper + identifier validation; TS wrapper `dropTrigger`; new
  `DropTriggerDialog` modal with typing-confirm input + CASCADE checkbox
  + Show DDL preview + Apply destructive + Safe-Mode warn-tier
  `ConfirmDestructiveDialog`; `useSchemaTreeActions` opener +
  `DropTriggerDialogSlot`; per-trigger row context-menu "Drop…" flip
  from disabled (Sprint 272/273 placeholder) to enabled. Round-trip
  from right-click trigger row → Drop… → Apply → trigger disappears
  from Sprint 272's read path. PG-only. Closes the Trigger lifecycle
  on top of Sprint 272 (read) + 273 (create).
- **Audience**: Generator (implementation), Evaluator (gate verification).
- **Owner**: harness Generator.
- **Verification Profile**: `mixed` — backend `cargo test` + frontend
  `vitest` + `tsc` + `lint` + `cargo clippy` + `cargo fmt` + manual
  round-trip smoke.

## In Scope

Sprint 274 (per master spec `docs/sprints/sprint-272/spec.md` § 3 —
Sprint 274 — Trigger DROP). Seven ACs: `AC-274-01` .. `AC-274-07`
(listed verbatim under § Acceptance Criteria).

Touched surfaces:

- `src-tauri/src/models/schema.rs` — `DropTriggerRequest` struct +
  camelCase serde + roundtrip test.
- `src-tauri/src/db/traits.rs` — `RdbAdapter::drop_trigger` trait method
  with default `Err(AppError::Unsupported(...))` impl (mirrors
  `create_trigger` default at `:454-463`).
- `src-tauri/src/db/postgres/mutations.rs` — PG `build_drop_trigger_sql`
  pure helper (mirror `build_create_trigger_sql` shape at `:126-242`)
  with `validate_identifier` on `trigger_name`, `schema`, `table`;
  CASCADE branch appends trailing ` CASCADE`. `PostgresAdapter::drop_trigger`
  inherent method with `preview_only` branch + `sqlx::Transaction::begin`
  / `commit` (mirror `:1077-1130`).
- `src-tauri/src/commands/rdb/ddl.rs` — `drop_trigger_inner` /
  `drop_trigger` Tauri handler reusing Sprint 271c `ensure_expected_db`
  probe + `not_connected` helper under `active_connections.lock()`.
  Byte-equivalent to `create_trigger_inner` (`:279-290`) template.
- `src-tauri/src/db/testing.rs` — `StubRdbAdapter::drop_trigger_fn`
  slot + impl (mirror `create_trigger_fn` at `:115, 386-397`). DDL
  default sentinel `Ok(SchemaChangeResult { sql: "drop_trigger" })`.
- `src-tauri/src/lib.rs` — `invoke_handler` registration of `drop_trigger`.
- `src/types/schema.ts` — `DropTriggerRequest` TS mirror with camelCase
  fields + `expectedDatabase` guard.
- `src/lib/tauri/ddl.ts` — `dropTrigger(request: DropTriggerRequest):
  Promise<SchemaChangeResult>` wrapper with JSDoc referencing Sprint 274.
- `src/components/schema/DropTriggerDialog.tsx` — new modal:
  typing-confirm input (byte-for-byte match against `triggerName`),
  CASCADE checkbox, Show DDL collapsible pane (default OPEN, 250ms
  debounce), Apply destructive variant, Safe-Mode warn-tier
  `ConfirmDestructiveDialog` pendingConfirm path. Structural parity
  with `DropTableDialog` (Sprint 235).
- `src/components/schema/DropTriggerDialog.test.tsx` — new vitest file:
  open/close, typing-confirm gate (byte-for-byte; empty / partial /
  whitespace stays Apply-disabled), CASCADE toggle invalidates preview,
  mismatch toast (user-initiated Apply), Safe-Mode warn-tier confirm
  flow, post-commit refresh invalidates `schemaStore.triggers` cache.
- `src/components/schema/SchemaTree/useSchemaTreeActions.ts` —
  `dropTriggerDialog: { schemaName, tableName, triggerName } | null`
  slot + `handleDropTrigger(triggerName, tableName, schemaName)`
  opener + `refreshTableTriggersForSlot` reuse (already added in
  Sprint 273).
- `src/components/schema/SchemaTree/rows.tsx` — disabled-placeholder
  swap at two sites: `:401-408` (per-table row context-menu Drop
  Trigger placeholder, line 403 `title="Drop Trigger is coming soon"`)
  and `:648-655` (per-trigger row context-menu Drop placeholder, line
  648 same title). Both flip from `disabled` + placeholder title to
  enabled `onClick={() => ctx.handleDropTrigger(...)}` per Sprint 273
  handoff § "Disabled-placeholder swap pattern".
- `src/components/schema/SchemaTree/dialogs.tsx` — `DropTriggerDialogSlot`
  wrapper (mirror `CreateTriggerDialogSlot` shape).
- `src/components/schema/SchemaTree.tsx` — slot mount + ctx wiring.
- `src/components/schema/SchemaTree/triggerRow.test.tsx` — mechanical
  swap at `:208` ("Drop Trigger… disabled placeholder" → "Drop
  Trigger… enabled"), same shape as Sprint 273's Create-side mechanical
  update.

**Pre-work (1 small commit, recommended but not load-bearing)**:
Sprint 272/273 P2 carryover #1 — `body.tsx::TriggerGroupSubtree` ↔
`treeRows.ts::buildTriggerRowsForTable` render-path duplication
collapse. Sprint 274 wires Drop affordance through the per-trigger row
context menu, which exercises the duplicated path again. Land the
cleanup as its own commit before the main slice so the diff stays
scoped. Sprint 273 P2 #2/#3 — `CreateTriggerDialog.tsx:251` useEffect
deps churn + `:488, 499` duplicate `setFunctionName` collapse — small
cleanup, may piggyback on the same pre-work commit.

## Out of Scope

**Phase-wide deferred** (per master spec § 7):

- **Function CREATE/EDIT UI** — deferred indefinitely.
- **ALTER TRIGGER rename** (`ALTER TRIGGER … RENAME TO`).
- **DISABLE / ENABLE triggers** (`ALTER TABLE … DISABLE TRIGGER`).
- **Event triggers** (DB-level, `CREATE EVENT TRIGGER`).
- **Trigger dependency graph visualisation**.
- **PL/pgSQL debugger**.
- **Mongo change streams**.
- **MySQL / SQLite trigger support** — `RdbAdapter::drop_trigger`
  default `Unsupported` covers non-PG adapters; PG-only this phase.
- **TRUNCATE event trigger CREATE** — Sprint 273 set; not relevant to
  Drop (Drop is name-targeted, agnostic to events).

**Sprint 272/273 surfaces — must not regress**:

- Sprint 272: `list_triggers`, `get_trigger_source`,
  `schemaStore.triggers` cache slice, `StructurePanel` Triggers
  sub-tab, `SchemaTree` Triggers child row, `TriggerInfo` model,
  tgtype bitmask decoder. All landed Sprint 272 (`PASS`, 8.6/10).
- Sprint 273: `CreateTriggerRequest` model, `create_trigger` Tauri
  command + `_inner`, `build_create_trigger_sql` PG SQL emitter,
  `createTrigger` TS wrapper, `CreateTriggerDialog` modal,
  `useSchemaTreeActions.createTriggerDialog` slot +
  `handleCreateTrigger` opener, `+` affordance on Triggers group
  header, "Create Trigger…" context-menu items (3 entry points).
  All landed Sprint 273 (`PASS`, 8.4/10).

Sprint 274 MUST leave all of the above byte-equivalent — only the two
disabled "Drop Trigger…" placeholders (`rows.tsx:401-408` and `:648-655`)
and the matching regression-guard line (`triggerRow.test.tsx:208`)
flip from disabled to enabled.

## Invariants

- **Sprint 272 surfaces unchanged**: `list_triggers`,
  `get_trigger_source`, `schemaStore.triggers` cache shape
  (`ByConn<BySchema<ByTable<TriggerInfo[]>>>`), `StructurePanel`
  Triggers tab, `SchemaTree` Triggers child row, `TriggerInfo`,
  `decode_tgtype`, `decode_tgargs`. Sprint 274 may flip the existing
  disabled "Drop Trigger…" context-menu items to enabled, but MUST
  NOT mutate the read SQL, the cache shape, the tab content, or the
  row renderers other than the two disabled-placeholder swap sites.
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
  trait dispatch — byte-equivalent to `create_trigger_inner`
  (`src-tauri/src/commands/rdb/ddl.rs:279-290`) and every other
  handler in the file (e.g. `drop_table_inner` `:33-43`). NO new
  probe variant; NO change to the helper signature.
- **Sprint 214 `useDdlPreviewExecution` reused unchanged**: the new
  `DropTriggerDialog` consumes the existing
  `useDdlPreviewExecution(request, executor)` lifecycle (preview
  debounce + Safe-Mode dispatch + post-commit refresh). The hook
  signature MUST NOT change (shared with 6+ other DDL dialogs).
- **`validate_identifier` helper reused unchanged**: the new PG SQL
  emitter calls `validate_identifier(name)` on `trigger_name`,
  `schema`, `table`. NAMEDATALEN-63-byte limit + identifier-character
  whitelist enforced verbatim. NO new helper introduced.
- **DbMismatch handling pattern reused**: on user-initiated Apply,
  parse `DbMismatch` via `parseDbMismatch`, run
  `syncMismatchedActiveDb`, surface a Retry toast (Sprint 269 +
  271a/c user-initiated path). Preview (debounced) mismatches stay
  **silent** to match Sprint 272 passive-prefetch contract.
- **`DropTableDialog` structural parity** (Sprint 235,
  `src/components/schema/DropTableDialog.tsx`): typing-confirm input
  byte-for-byte case-sensitive match (no `.trim()`), CASCADE checkbox,
  Show DDL collapsible pane, Apply destructive variant, Safe-Mode
  warn-tier `ConfirmDestructiveDialog` `pendingConfirm` mount on top
  of the typing-confirm gate. Sprint 274's `DropTriggerDialog`
  mirrors this shape — only the SQL target differs.
- **Phase 21–25 DROP dialogs unchanged**: `DropTableDialog` (Sprint
  235), `DropIndexDialog` (Phase 22), `DropConstraintDialog` (Phase
  23), View / Function drop dialogs (Phase 24 / 25) MUST render
  byte-equivalent — verified by unchanged passing tests.
- **`sqlx::Transaction::begin` / `commit` pattern** (Sprint 273
  mutation shape at `mutations.rs:1099-1113`): `preview_only: false`
  wraps the single `DROP TRIGGER` statement via the
  `sqlx::Transaction::begin(pool).await?` API + `tx.commit().await?`
  call — NO literal `BEGIN` / `COMMIT` strings issued from Rust to
  the wire.
- **SQL identifier quoting**: every emitted identifier is wrapped in
  `"..."` (PG `quote_ident` semantics). `validate_identifier` rejects
  embedded double-quotes / NULs so byte-for-byte quoting is safe. NO
  string interpolation of unvalidated identifiers.
- **Post-commit refresh invalidates Sprint 272 cache**: after Apply
  commit, `refreshTableTriggers(connId, db, schema, table)` evicts
  the `(connId, db, schema, table)` entry in `schemaStore.triggers`
  and re-fetches via `listTriggers`, so the dropped trigger
  disappears from the Triggers child row + StructurePanel tab.

## Acceptance Criteria

Verbatim from master spec § 3 — Sprint 274.

- **`AC-274-01` — `DropTriggerRequest` model**: Rust + TS struct with
  `#[serde(rename_all = "camelCase")]` carrying `connection_id`,
  `schema`, `table`, `trigger_name`, `cascade: bool`
  (`#[serde(default)]`), `preview_only: bool` (`#[serde(default)]`),
  `expected_database: Option<String>` (`#[serde(default)]`). camelCase
  wire shape with serde roundtrip test.
- **`AC-274-02` — Backend `drop_trigger`**: lives in
  `src-tauri/src/commands/rdb/ddl.rs`.
  `drop_trigger_inner(&AppState, &DropTriggerRequest)` body shape
  byte-equivalent to `create_trigger_inner`. `ensure_expected_db`
  probe before trait dispatch. PG impl:
  - `validate_identifier` on `trigger_name`, `schema`, `table`.
  - Emit `DROP TRIGGER "name" ON "schema"."table"` (+ trailing
    ` CASCADE` when `cascade == true`).
  - `preview_only: true` → return `SchemaChangeResult { sql }`;
    `preview_only: false` → wrap in `sqlx::Transaction::begin` /
    `commit` and execute.
- **`AC-274-03` — TS wrapper**: `src/lib/tauri/ddl.ts` exports
  `dropTrigger(request: DropTriggerRequest):
  Promise<SchemaChangeResult>`.
- **`AC-274-04` — `DropTriggerDialog` modal**: structural parity with
  `DropTableDialog` (Sprint 235): typing-confirm byte-for-byte input
  (no `.trim()`), CASCADE checkbox, Show DDL pane, Apply destructive
  variant + Safe-Mode warn-tier `ConfirmDestructiveDialog`.
  `useDdlPreviewExecution` drives lifecycle. Post-commit refresh
  invalidates the `schemaStore.triggers[connId][db][schema][table]`
  cache entry.
- **`AC-274-05` — Tree opener wiring**: `useSchemaTreeActions` gains
  `dropTriggerDialog: { schemaName, tableName, triggerName } | null`
  slot + `handleDropTrigger(triggerName, tableName, schemaName)`
  opener. Per-trigger child row context menu `danger` "Drop…" item
  flips from disabled (Sprint 272 placeholder, Sprint 273 carryover)
  to enabled. `DropTriggerDialogSlot` added to
  `src/components/schema/SchemaTree/dialogs.tsx`.
- **`AC-274-06` — Round-trip**: right-click trigger row → Drop… →
  type trigger name → CASCADE off → Show DDL renders
  `DROP TRIGGER "t" ON "schema"."table"` → Apply → Safe-Mode warn
  confirms → trigger disappears from Triggers child row +
  StructurePanel tab.
- **`AC-274-07` — Tests**: backend SQL emission for `cascade: false`
  (`DROP TRIGGER "name" ON "schema"."table"`) and `cascade: true`
  (same + trailing ` CASCADE`). Identifier-validation rejection for
  each of `trigger_name`, `schema`, `table` (embedded double-quote
  / NUL / >63 bytes → `AppError::Validation`). Backend mismatch test
  (Sprint 271c panic-closure pattern). Vitest:
  `DropTriggerDialog` open/close, typing-confirm gate (byte-for-byte;
  empty / partial / whitespace stays Apply-disabled), CASCADE toggle
  invalidates preview cache (debounced re-fetch), mismatch toast
  (user-initiated Apply path), Safe-Mode warn-tier
  `ConfirmDestructiveDialog` flow, post-commit refresh invalidates
  `schemaStore.triggers[connId][db][schema][table]` (dropped trigger
  vanishes from cache).

## Done Criteria

One testable bullet per AC.

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

## Design Bar / Quality Bar

- **`_inner` shape** in `drop_trigger_inner` is byte-equivalent to
  `create_trigger_inner` (`src-tauri/src/commands/rdb/ddl.rs:279-290`)
  — lock acquisition → `get` → `not_connected` → `as_rdb()?` →
  `ensure_expected_db` → trait dispatch. Same template as
  `drop_table_inner` (`:33-43`).
- **PG SQL emitter** in `src-tauri/src/db/postgres/mutations.rs`:
  - `build_drop_trigger_sql` is a pure helper (no pool / no async)
    mirroring `build_create_trigger_sql` (`:126-242`) shape — testable
    in isolation.
  - Identifier validation BEFORE any string concatenation.
  - CASCADE branch: trailing ` CASCADE` appended only when
    `cascade == true`. No other formatter drift (no `IF EXISTS`,
    no schema fallback to `current_schema`).
  - `PostgresAdapter::drop_trigger` inherent method follows the
    `:1077-1130` shape — `preview_only: true` short-circuits with
    `Ok(SchemaChangeResult { sql })`; `preview_only: false` opens
    `sqlx::Transaction::begin(pool).await?`, executes the single
    DROP statement via `sqlx::query(&sql).execute(&mut *tx).await?`,
    then `tx.commit().await?`. NO literal `BEGIN` / `COMMIT` issued
    from Rust source as strings.
- **No `unwrap()`** on adapter / probe paths. Use `?`,
  `unwrap_or_default()`, `ok_or_else(...)`.
- **No `any` (TypeScript)** on wrapper or dialog signatures.
- **No `console.log`** shipped.
- **JSDoc** on `dropTrigger` wrapper + a one-line comment naming the
  parameter and referencing Sprint 274 (mirrors Sprint 273 `createTrigger`
  wrapper docs).
- **Debounce 250ms** on preview refresh — match `DropTableDialog` /
  `CreateTriggerDialog` shape; fakeTimers vitest case asserts CASCADE
  toggle triggers exactly one IPC dispatch per 250ms idle window.
- **Typing-confirm gate** computed in one place (the dialog body),
  byte-for-byte case-sensitive comparison against
  `props.triggerName`. Whitespace-only input stays invalid (NO
  `.trim()`). Mirrors `DropTableDialog` line 105 contract.
- **No `--no-verify`**. No hook skipping (project rule
  `.claude/rules/git-policy.md`).

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo test drop_trigger` — SQL emission fixtures
   (cascade on/off) + identifier-rejection fixtures (3) + mismatch
   test (panic-closure) pass.
2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D
   warnings` — clean.
3. `cd src-tauri && cargo fmt --check` — passes.
4. `cd src-tauri && cargo test --lib` — full backend green (no
   regression in Sprint 272/273 trigger tests or any earlier Phase
   tests; total count ≥ Sprint 273 baseline 749 + new tests).
5. `pnpm tsc --noEmit` — clean.
6. `pnpm vitest run` — passes; new `DropTriggerDialog.test.tsx` ≥6
   cases included; Sprint 272/273 trigger tests still green.
7. `pnpm lint` — clean (`pnpm exec eslint . --max-warnings 0`).
8. **Manual round-trip smoke** — `pnpm tauri dev` against fixtures PG:
   - Right-click an existing trigger row in the SchemaTree (under a
     Table → Triggers child group) → "Drop…" context-menu item
     enabled → modal opens.
   - Type the trigger name into the typing-confirm input;
     CASCADE checkbox left OFF.
   - Show DDL pane renders `DROP TRIGGER "<name>" ON
     "<schema>"."<table>"` within 250ms of the last keystroke or
     CASCADE toggle.
   - Apply → Safe-Mode warn-tier `ConfirmDestructiveDialog` opens →
     Confirm → modal closes → Triggers child row of the parent table
     no longer lists the dropped trigger; `StructurePanel` Triggers
     tab refresh removes the row.

### Required Evidence

Generator must provide in `handoff.md`:

- **Changed files** grouped by surface (models / traits / PG emitter
  / command handler / TS wrappers / UI / tests), each with a one-line
  purpose.
- **Per-gate command output** (final ~40 lines): `cargo fmt --check`,
  `cargo clippy`, `cargo test` (with new-test count delta vs Sprint
  273 baseline 749), `pnpm tsc --noEmit`, `pnpm vitest run` (with
  test count delta vs Sprint 273 baseline 3271), `pnpm lint`.
- **SQL emission fixture outputs** verbatim — both cascade-on and
  cascade-off fixtures plus at least one identifier-rejection fixture.
- **AC coverage table** with `file:line` citations for each AC (e.g.
  `AC-274-02` → `src-tauri/src/commands/rdb/ddl.rs:NNN-MMM` for the
  probe block + trait dispatch;
  `src-tauri/src/db/postgres/mutations.rs:NNN-MMM` for the SQL
  emitter).
- **Manual smoke evidence** — screenshot or screen-recording
  reference of the round-trip described in step 8.

Evaluator must cite:

- Actual line numbers of the probe block in `drop_trigger_inner`;
  byte-equivalence to `create_trigger_inner` at `:279-290` and
  `drop_table_inner` at `:33-43`.
- cargo test + vitest deltas reconciled vs Sprint 273 baseline.
- Each AC pass/fail decision linked to a `file:line` citation from
  the evidence table.
- Sprint 272/273 surfaces (read path + cache + tab + child row + Create
  surfaces) verified byte-equivalent — i.e. NO regression in Sprint
  272/273 tests.

## Test Requirements

### Unit Tests (필수)

- **Backend (Rust)** in `src-tauri/src/db/postgres/mutations.rs`
  (alongside `build_drop_trigger_sql`) + `src-tauri/src/commands/rdb/ddl.rs`
  (alongside the handler):
  - **SQL emission fixtures**:
    - `cascade: false` → emitted SQL is exactly
      `DROP TRIGGER "name" ON "schema"."table"` (no trailing
      keyword, no semicolon issued at the helper layer — the
      transaction wrapper at the inherent-method layer owns
      execution).
    - `cascade: true` → emitted SQL is exactly
      `DROP TRIGGER "name" ON "schema"."table" CASCADE`.
  - **Identifier rejection** (each returns `AppError::Validation`):
    - invalid `trigger_name` (embedded double-quote / NUL / >63 bytes
      / empty).
    - invalid `schema` (same).
    - invalid `table` (same).
  - **Mismatch test** —
    `drop_trigger_inner_expected_db_mismatch_returns_dbmismatch_and_skips_trait`
    using the Sprint 271c panic-closure pattern: stub adapter
    `current_database_fn = Some("dbA")`, `drop_trigger_fn =
    panic!("must not run on mismatch")`, caller passes
    `expected_database = Some("dbB")`, assert
    `Err(AppError::DbMismatch { expected: "dbB", actual: "dbA" })`
    and the panic did not fire.
  - **Wiring test** —
    `drop_trigger_routes_to_drop_trigger_trait_method` follows the
    existing wiring tests' shape (e.g.
    `src-tauri/src/commands/rdb/ddl.rs:514-528` for the
    `drop_table_rdb_ok_propagates_payload_verbatim` template):
    default `StubRdbAdapter`, assert returned `sql == "drop_trigger"`.
  - **Serde roundtrip** — `drop_trigger_request_serde_roundtrip`:
    construct, serialise to JSON, deserialise back, assert deep
    equality + camelCase wire format.
- **Frontend (vitest)** in
  `src/components/schema/DropTriggerDialog.test.tsx`:
  - **Open/close** — modal mounts with `open=true`, unmounts cleanly
    on Cancel.
  - **Typing-confirm gate (byte-for-byte)** — Apply is disabled when
    the typing-confirm input is empty, contains only whitespace
    (assert NO `.trim()`), or is a partial / case-mismatched prefix
    of `triggerName`. Apply becomes enabled only when the input
    matches `triggerName` byte-for-byte AND `previewSql` is non-empty
    AND `previewLoading` is false.
  - **CASCADE toggle invalidates preview** — fakeTimers; toggle the
    CASCADE checkbox; assert the debounced preview re-fetch fires
    exactly once after 250ms idle and the emitted SQL contains
    trailing ` CASCADE`.
  - **Mismatch toast (user-initiated Apply)** — mock backend rejects
    Apply with `AppError::DbMismatch { expected, actual }`; assert
    `parseDbMismatch` parses the error, `syncMismatchedActiveDb`
    runs, and a Retry toast surfaces (Sprint 271c user-initiated
    path).
  - **Safe-Mode warn-tier `ConfirmDestructiveDialog` flow** — Apply
    in warn-tier Safe-Mode opens the nested
    `ConfirmDestructiveDialog`; Confirm closes both dialogs and
    commits.
  - **Post-commit cache invalidation** — after Apply commits, assert
    `refreshTableTriggers(connId, db, schema, table)` is invoked
    (or equivalent eviction action) so the dropped trigger
    disappears from `schemaStore.triggers[connId][db][schema][table]`
    on the next read.

### Coverage Target

- 신규/수정 코드: 라인 70% 이상 권장.
- CI 전체 기준: 라인 40%, 함수 40%, 브랜치 35%.

### Scenario Tests (필수)

- [x] **Happy path** — right-click trigger row → Drop… →
      typing-confirm → CASCADE off → preview renders → Apply →
      Safe-Mode warn confirm → trigger vanishes from tree + tab.
- [x] **에러/예외** — invalid identifier on `trigger_name` / `schema`
      / `table` each rejected with `AppError::Validation`. Apply
      mismatch path surfaces Retry toast. Drop non-existent trigger
      → PG verbatim error surfaces in `previewError`.
- [x] **경계 조건** — typing-confirm empty / whitespace-only /
      partial / case-mismatched all keep Apply disabled (byte-for-byte
      comparison, NO `.trim()`); CASCADE toggle invalidates the
      debounced preview cache and emits trailing ` CASCADE`;
      typing-confirm against a name with embedded double-quote is
      pre-blocked by `validate_identifier` so byte-for-byte match is
      canonical.
- [x] **기존 기능 회귀 없음** — Sprint 272 trigger read tests + Sprint
      273 trigger CREATE tests still green; Phase 21–25 DROP dialogs
      (`DropTableDialog` etc.) render byte-equivalent;
      `useDdlPreviewExecution` consumers (table / column / index /
      constraint / view / Create-Trigger dialogs) unchanged;
      `triggerRow.test.tsx:208` mechanical update preserves all
      other Sprint 272/273 regression-guard assertions.

## Test Script / Repro Script

1. Stand up `sprint-274` branch from `main` (post-Sprint-273 head).
2. Pre-work commit (optional but recommended): collapse `body.tsx ↔
   treeRows.ts` trigger render-path duplication (Sprint 272/273 P2
   carryover #1); piggyback Sprint 273 P2 #2/#3 cleanup
   (`CreateTriggerDialog.tsx:251` useEffect deps + `:488, 499`
   duplicate `setFunctionName`).
3. Land `DropTriggerRequest` (Rust + TS) + serde roundtrip test.
4. Add `RdbAdapter::drop_trigger` trait method with default
   `Err(Unsupported)`; extend `StubRdbAdapter` with `drop_trigger_fn`
   slot (mirror `create_trigger_fn` at `testing.rs:115, 386-397`).
5. Implement `build_drop_trigger_sql` pure helper in `mutations.rs`
   with `validate_identifier` calls and CASCADE branch. Add cascade
   on/off + 3 identifier-rejection unit tests.
6. Implement `PostgresAdapter::drop_trigger` inherent method
   (mirror `:1077-1130` shape) with `preview_only` branch +
   `sqlx::Transaction::begin` / `commit`.
7. Add `drop_trigger_inner` + `drop_trigger` Tauri handler in
   `ddl.rs` reusing `ensure_expected_db` + `not_connected`. Add
   wiring test + mismatch test.
8. Register the command in `src-tauri/src/lib.rs` `invoke_handler`.
9. Add `dropTrigger` TS wrapper in `src/lib/tauri/ddl.ts` +
   `DropTriggerRequest` TS mirror in `src/types/schema.ts`.
10. Implement `DropTriggerDialog.tsx` with typing-confirm input,
    CASCADE checkbox, Show DDL pane, Apply destructive variant,
    Safe-Mode warn-tier `ConfirmDestructiveDialog`. Reuse
    `useDdlPreviewExecution`.
11. Wire `useSchemaTreeActions.dropTriggerDialog` slot +
    `handleDropTrigger` opener; mount `DropTriggerDialogSlot` in
    `dialogs.tsx`.
12. Flip the two disabled placeholders in `rows.tsx` (`:401-408`
    and `:648-655`) from `disabled` + placeholder title to enabled
    handlers; update the matching regression-guard line at
    `triggerRow.test.tsx:208`.
13. Add `DropTriggerDialog.test.tsx` with ≥6 cases (open/close,
    typing-confirm gate, CASCADE toggle invalidates preview,
    mismatch toast, Safe-Mode warn-tier confirm, post-commit cache
    refresh).
14. Run all 7 automated gates + manual round-trip smoke.
15. Write `handoff.md` with per-gate tails + SQL emission fixture
    outputs + AC coverage table + manual smoke evidence.

## Ownership

- **Generator**: harness Generator agent.
- **Write scope**:
  - `src-tauri/src/models/schema.rs`
  - `src-tauri/src/db/traits.rs`
  - `src-tauri/src/db/postgres/mutations.rs`
  - `src-tauri/src/db/postgres.rs` (trait delegation + import, mirror
    Sprint 273)
  - `src-tauri/src/commands/rdb/ddl.rs`
  - `src-tauri/src/db/testing.rs`
  - `src-tauri/src/lib.rs` (command registration only)
  - `src/types/schema.ts`
  - `src/lib/tauri/ddl.ts`
  - `src/components/schema/DropTriggerDialog.tsx` (new)
  - `src/components/schema/DropTriggerDialog.test.tsx` (new)
  - `src/components/schema/SchemaTree/useSchemaTreeActions.ts`
  - `src/components/schema/SchemaTree/rows.tsx` (two
    disabled-placeholder swap sites only)
  - `src/components/schema/SchemaTree/dialogs.tsx`
  - `src/components/schema/SchemaTree.tsx` (slot mount + ctx wiring)
  - `src/components/schema/SchemaTree/triggerRow.test.tsx`
    (mechanical line:208 swap)
  - Optional pre-work:
    `src/components/schema/SchemaTree/body.tsx` +
    `src/components/schema/SchemaTree/treeRows.ts` (render-path
    duplication cleanup) + `src/components/schema/CreateTriggerDialog.tsx`
    (Sprint 273 P2 cleanup).
  - `docs/sprints/sprint-274/handoff.md` (created by Generator at end).
- **Merge order**: pre-work commit (optional, 1 small) → main
  Sprint 274 commit covering all of the above. Conventional Commits
  format, `feat(sprint-274): ...`.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- All 7 ACs (`AC-274-01` .. `AC-274-07`) evidenced in `handoff.md`
  with `file:line` citations: `yes`
- Sprint 271c `ensure_expected_db` probe byte-equivalent in
  `drop_trigger_inner`: `yes`
- Sprint 272 surfaces (`list_triggers`, `get_trigger_source`,
  `schemaStore.triggers`, StructurePanel Triggers tab, SchemaTree
  Triggers child row, `TriggerInfo`, `decode_tgtype`,
  `decode_tgargs`) byte-equivalent — verified by unchanged passing
  tests: `yes`
- Sprint 273 surfaces (`CreateTriggerRequest`, `create_trigger`,
  `build_create_trigger_sql`, `createTrigger` TS wrapper,
  `CreateTriggerDialog`, `useSchemaTreeActions.createTriggerDialog`
  slot, `CreateTriggerDialogSlot`, Create context-menu items, `+`
  affordance) byte-equivalent — verified by unchanged passing tests:
  `yes`
- Phase 21–25 DROP dialogs (`DropTableDialog`, `DropIndexDialog`,
  `DropConstraintDialog`) byte-equivalent — verified by unchanged
  passing tests: `yes`
- `useDdlPreviewExecution` hook signature unchanged: `yes`
- `sqlx::Transaction::begin/commit` used (NO literal `BEGIN` /
  `COMMIT` strings in Rust source): `yes`
- NO Function CREATE/EDIT UI landed: `yes`
- NO ALTER TRIGGER rename / DISABLE / ENABLE landed: `yes`
- NO event-trigger (DB-level) surface landed: `yes`
- Two disabled-placeholder swap sites (`rows.tsx:401-408`,
  `rows.tsx:648-655`) and the matching regression-guard line
  (`triggerRow.test.tsx:208`) flipped to enabled: `yes`
