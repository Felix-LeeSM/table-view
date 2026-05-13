# Phase 26 — Trigger Management: Master Spec (Sprint 272 / 273 / 274)

## 1. Feature Description

Phase 26 closes TablePlus parity item #6 by adding **PostgreSQL Trigger
management** end-to-end: read, create, drop. Triggers join the existing
Phase 24/25 family of schema-object surfaces (Tables, Indexes, Constraints,
Views, Functions) and reuse the same DDL preview-then-execute lifecycle
(`useDdlPreviewExecution`, Sprint 214), Safe-Mode dispatch, and
`expected_database` mismatch guard (Sprint 271c).

Delivered as three sequential sub-sprints (272 / 273 / 274) so each lands
independently testable value:
- **272** ships read-only trigger introspection (sidebar surfaces existing triggers).
- **273** lets users create triggers with full PG semantics (timing / events /
  row-or-statement / WHEN clause / function picker / arguments).
- **274** lets users drop triggers with typing-confirm + CASCADE + Safe Mode
  parity to `DropTableDialog` (Sprint 235).

PG-only this phase. Event triggers (DB-level), trigger dependency graph,
PL/pgSQL debugger, Mongo change streams, and Function CREATE/EDIT are
explicitly **out of scope** (see § 7).

## 2. Sprint Breakdown

### Sprint 272 — Trigger Read
Backend `list_triggers` + `get_trigger_source` introspection commands, TS
wrappers, `schemaStore` per-`(connId, db, schema, table)` trigger cache, a
Triggers child node on each Table in `SchemaTree`, and a read-only Triggers
tab in `StructurePanel` showing each trigger's metadata and
`pg_get_triggerdef` source.

### Sprint 273 — Trigger CREATE
`CreateTriggerDialog` modal — name + timing (BEFORE / AFTER / INSTEAD OF) +
events (multi-select: INSERT, UPDATE, DELETE; TRUNCATE row is hidden) +
FOR EACH (ROW | STATEMENT) + optional WHEN expression + function picker +
arguments + name + Show DDL preview pane. Backend
`create_trigger(CreateTriggerRequest)` returns `SchemaChangeResult { sql }`.
Reuses `useDdlPreviewExecution` (Sprint 214) and Sprint 271c
`expected_database` field guard pattern.

### Sprint 274 — Trigger DROP
`DropTriggerDialog` — typing-confirm input + CASCADE checkbox + Show DDL
preview + Safe-Mode danger dispatch (mirrors `DropTableDialog` Sprint 235 /
Sprint 271c shape). Backend `drop_trigger(DropTriggerRequest)` emits
`DROP TRIGGER "name" ON "schema"."table" [CASCADE]`.

## 3. Per-sprint Acceptance Criteria

### Sprint 272 — Trigger Read

**Verification Profile**: `mixed` (cargo + vitest + manual sidebar smoke).

- **AC-272-01 — `TriggerInfo` model.** New struct (Rust + TS) carries
  `name`, `schema`, `table`, `timing` (`"BEFORE" | "AFTER" | "INSTEAD OF"`),
  `events` (`Vec<String>` whitelist `["INSERT", "UPDATE", "DELETE"]`,
  multi), `orientation` (`"ROW" | "STATEMENT"`), `function_schema`,
  `function_name`, `arguments` (`Option<String>`), `when_expression`
  (`Option<String>`), `definition` (full `pg_get_triggerdef` string).
  Serde roundtrip test required.

- **AC-272-02 — Backend reads.** Two new commands in
  `src-tauri/src/commands/rdb/schema.rs`:
  - `list_triggers(connection_id, schema, table, expected_database?) -> Vec<TriggerInfo>`
  - `get_trigger_source(connection_id, schema, table, trigger_name, expected_database?) -> String`

  Both call `ensure_expected_db` (Sprint 271c hoist) under
  `active_connections.lock()` before dispatch. PG impl queries
  `pg_catalog.pg_trigger ⨝ pg_proc ⨝ pg_namespace ⨝ pg_class` with
  `NOT t.tgisinternal`, decoding `t.tgtype` bitmask (`0x40 → INSTEAD OF`;
  else `0x02 → BEFORE/AFTER`; events from `0x04/0x08/0x10`; TRUNCATE
  `0x20` skip; `0x01 → ROW/STATEMENT`). Results ordered by `t.tgname`.
  Non-PG RDB → default `Ok(Vec::new())`. Non-RDB → `Unsupported(relational)`.

- **AC-272-03 — TS wrappers.** `src/lib/tauri/schema.ts` exports
  `listTriggers(connectionId, schema, table, expectedDatabase?)` +
  `getTriggerSource(connectionId, schema, table, triggerName, expectedDatabase?)`.

- **AC-272-04 — Trait + adapter wiring.** `RdbAdapter` gains
  `list_triggers(namespace, table)` + `get_trigger_source(namespace, table, name)`
  with default `Ok(Vec::new())` / `Err(Unsupported)`. PG override.
  `StubRdbAdapter` extension for tests.

- **AC-272-05 — schemaStore cache.** `triggers: ByConn<BySchema<ByTable<TriggerInfo[]>>>`
  slice + `getTableTriggers(connId, db, table, schema)` action. Forwards
  `db` as `expectedDatabase`. On `DbMismatch` → silent
  `syncMismatchedActiveDb` (passive prefetch, no toast). Eviction in
  `clearForConnection` / `clearForWorkspace` / `evictSchemaForName`.

- **AC-272-06 — SchemaTree trigger node.** Each Table row gains a child
  "Triggers" affordance. Loading / empty / error states match existing
  Functions/Views row treatments. Right-click context menu placeholder
  for "View Source", "Create Trigger…" (273), "Drop…" (274).

- **AC-272-07 — StructurePanel Triggers tab.** Fourth sub-tab "Triggers"
  after Constraints. Read-only viewer: name, timing/event summary,
  ROW/STATEMENT, function (`func_schema.func_name(args)`), WHEN clause,
  and `pg_get_triggerdef` in monospace pre block. `hasFetchedTriggers`
  gate prevents "No triggers" flash. `refresh-structure` listener
  re-fetches.

- **AC-272-08 — Tests.** Backend mismatch-case tests for both `_inner`
  fns (Sprint 271c panic-closure pattern). Bitmask decoder unit tests
  for ≥4 representative tgtype values. Vitest case for schemaStore
  trigger cache (IPC mock invoked once on second call).

### Sprint 273 — Trigger CREATE

**Verification Profile**: `mixed`.

- **AC-273-01 — `CreateTriggerRequest` model.** Rust struct with
  `#[serde(rename_all = "camelCase")]`: `connection_id`, `schema`,
  `table`, `trigger_name`, `timing` (whitelist), `events` (non-empty
  subset), `orientation` (whitelist), `when_expression: Option<String>`,
  `function_schema`, `function_name`, `function_arguments: Option<String>`,
  `preview_only: bool` (`#[serde(default)]`), `expected_database: Option<String>`
  (`#[serde(default)]`). TS mirror + serde roundtrip.

- **AC-273-02 — Backend `create_trigger`.** Lives in
  `src-tauri/src/commands/rdb/ddl.rs`. `_inner(&AppState, &CreateTriggerRequest)`
  body shape. `ensure_expected_db` probe before dispatch. PG impl:
  - `validate_identifier` on `trigger_name`, `schema`, `table`,
    `function_schema`, `function_name`.
  - Whitelist `timing` / `orientation` / `events`.
  - Reject `INSTEAD OF + STATEMENT` or `INSTEAD OF + multi-events`.
  - Emit canonical SQL deterministic event order (INSERT, UPDATE, DELETE)
    regardless of payload order.
  - `preview_only: true` → return SQL only. `preview_only: false` →
    wrap in `BEGIN/COMMIT`.

- **AC-273-03 — TS wrapper.** `src/lib/tauri/ddl.ts` exports
  `createTrigger(request: CreateTriggerRequest): Promise<SchemaChangeResult>`.

- **AC-273-04 — `CreateTriggerDialog` modal.** Form fields:
  - Trigger name (single-line input).
  - Timing radio: BEFORE / AFTER / INSTEAD OF. INSTEAD OF disables STATEMENT.
  - Events checkboxes: INSERT, UPDATE, DELETE.
  - For each radio: ROW / STATEMENT.
  - WHEN clause textarea (optional).
  - Function picker: combobox from `schemaStore.functions[connectionId][db]`
    across schemas (shows `schema.name`), free-text fallback.
  - Arguments input (optional, free-text).
  - Show DDL collapsible pane (default OPEN), debounced 250ms refresh.
  - Footer Cancel + Apply (Apply disabled until name/timing/≥1 event/
    function valid AND previewSql non-empty AND previewLoading false).

- **AC-273-05 — DDL preview lifecycle.** `useDdlPreviewExecution` reuse.
  `expected_database` threaded into request. On `DbMismatch`,
  `parseDbMismatch` + `syncMismatchedActiveDb` + Retry toast (Sprint 271c
  user-initiated path).

- **AC-273-06 — Tree opener wiring.** `useSchemaTreeActions` gains
  `createTriggerDialog: { schemaName, tableName } | null` slot +
  `handleCreateTrigger(tableName, schemaName)`. Triggers child row gets
  `+` affordance. Context menu "Create Trigger…". `SchemaTree/dialogs.tsx`
  adds `CreateTriggerDialogSlot`.

- **AC-273-07 — Manual round-trip.** Right-click table → Create Trigger…
  → fill BEFORE INSERT FOR EACH ROW WHEN `(NEW.email IS NOT NULL)` + pick
  `audit.log_insert()` → preview pane renders canonical SQL → Apply →
  modal closes → trigger surfaces in Triggers child + StructurePanel tab.

- **AC-273-08 — Tests.** Backend SQL emission fixtures: (i) BEFORE INSERT
  ROW no WHEN no args; (ii) AFTER INSERT OR UPDATE OR DELETE STATEMENT;
  (iii) INSTEAD OF INSERT ROW WHEN with args; (iv) rejection paths
  (empty events, invalid timing, invalid identifier, INSTEAD OF+STATEMENT,
  INSTEAD OF+multi-event). Backend mismatch test. Vitest: modal open/close,
  Apply gating, debounced preview, mismatch toast.

### Sprint 274 — Trigger DROP

**Verification Profile**: `mixed`.

- **AC-274-01 — `DropTriggerRequest` model.** Rust + TS struct:
  `connection_id`, `schema`, `table`, `trigger_name`, `cascade: bool`
  (`#[serde(default)]`), `preview_only: bool` (`#[serde(default)]`),
  `expected_database: Option<String>` (`#[serde(default)]`). camelCase
  wire shape with serde roundtrip.

- **AC-274-02 — Backend `drop_trigger`.** Lives in
  `src-tauri/src/commands/rdb/ddl.rs`. Same `_inner(&AppState, &DropTriggerRequest)`
  shape. `ensure_expected_db` probe. PG SQL:
  `DROP TRIGGER "name" ON "schema"."table"` (+ trailing ` CASCADE` when
  `cascade == true`). `validate_identifier` on all identifiers.

- **AC-274-03 — TS wrapper.** `src/lib/tauri/ddl.ts` exports
  `dropTrigger(request: DropTriggerRequest): Promise<SchemaChangeResult>`.

- **AC-274-04 — `DropTriggerDialog` modal.** Structural parity with
  `DropTableDialog` (Sprint 235): typing-confirm byte-for-byte input,
  CASCADE checkbox, Show DDL pane, Apply destructive variant + Safe Mode
  warn-tier `ConfirmDestructiveDialog`. `useDdlPreviewExecution` drives
  lifecycle. Post-commit refresh invalidates triggers cache.

- **AC-274-05 — Tree opener wiring.** `useSchemaTreeActions` gains
  `dropTriggerDialog: { schemaName, tableName, triggerName } | null` slot
  + `handleDropTrigger(triggerName, tableName, schemaName)`. Triggers
  child row context menu `danger` Drop… item. `DropTriggerDialogSlot`
  in dialogs.tsx.

- **AC-274-06 — Round-trip.** Right-click trigger row → Drop… → type
  name → CASCADE off → Show DDL renders `DROP TRIGGER "t" ON "schema"."table"`
  → Apply → Safe-Mode warn confirms → trigger disappears.

- **AC-274-07 — Tests.** Backend SQL emission for `cascade: false` and
  `cascade: true`. Identifier-validation rejection. Backend mismatch test.
  Vitest: typing-confirm gate, CASCADE toggle invalidates preview,
  mismatch toast, Safe-Mode confirm path.

## 4. Components to Create / Modify

### Backend (Rust)

- `src-tauri/src/models/schema.rs` — `TriggerInfo` (272), `CreateTriggerRequest` (273), `DropTriggerRequest` (274) + serde roundtrip tests.
- `src-tauri/src/db/traits.rs` — 4 new `RdbAdapter` methods with `Unsupported` / empty defaults.
- `src-tauri/src/db/postgres/schema.rs` — PG `list_triggers` + `get_trigger_source` + tgtype bitmask decoder.
- `src-tauri/src/db/postgres/mutations.rs` — PG `create_trigger` + `drop_trigger` SQL emitters.
- `src-tauri/src/commands/rdb/schema.rs` — `list_triggers` + `get_trigger_source` handlers (272).
- `src-tauri/src/commands/rdb/ddl.rs` — `create_trigger` (273) + `drop_trigger` (274) handlers.
- `src-tauri/src/db/testing.rs` — `StubRdbAdapter` extensions.

### Frontend (TypeScript)

- `src/types/schema.ts` — 3 new interfaces.
- `src/lib/tauri/schema.ts` — 2 new wrappers (272).
- `src/lib/tauri/ddl.ts` — 2 new wrappers (273, 274).
- `src/stores/schemaStore.ts` — `triggers` cache slice + `getTableTriggers` + eviction.
- `src/components/schema/SchemaTree/treeRows.ts` — `NodeId` `trigger` variant.
- `src/components/schema/SchemaTree/rows.tsx` — trigger rows + context menu.
- `src/components/schema/SchemaTree/useSchemaTreeActions.ts` — 2 new dialog slots + openers.
- `src/components/schema/SchemaTree/dialogs.tsx` — 2 new slot wrappers.
- `src/components/schema/StructurePanel.tsx` — fourth sub-tab "Triggers" (272).
- `src/components/schema/CreateTriggerDialog.tsx` — new modal (273).
- `src/components/schema/DropTriggerDialog.tsx` — new modal (274).

### Tests

- Rust unit tests alongside each new `_inner` and PG SQL emitter.
- TS vitest for schemaStore, modals, schemaTree opener wiring.

## 5. Data Flow

**Read (272)**: User expands Table row → `schemaStore.getTableTriggers` →
cache miss → `tauri.listTriggers(connId, schema, table, db)` → handler
runs `ensure_expected_db` under lock → PG `pg_trigger` join + tgtype
decode → `TriggerInfo[]` → cached + rendered.

**Create (273)**: User opens dialog → debounced
`tauri.createTrigger({…, previewOnly: true, expectedDatabase: db})` →
PG `_inner` validates + emits SQL → preview pane renders → Apply runs
Safe-Mode (typically safe) → commit with `previewOnly: false` →
post-refresh invalidates trigger cache.

**Drop (274)**: User opens dialog → typing-confirm gate → preview
debounced → Apply → Safe-Mode warn (danger) → ConfirmDestructiveDialog →
commit → cache invalidate.

## 6. Edge Cases

### Sprint 272

- 0 triggers on table → empty array cached, italic placeholder rendered.
- Internal triggers (`tgisinternal = true`) → SQL filter excludes.
- INSTEAD OF on view → decoder recognises `0x40`, renders verbatim.
- TRUNCATE event triggers (`tgtype & 0x20`) → decoder skips event from
  list (or filters entire trigger out — Generator picks).
- `expected_database` mismatch on prefetch → silent
  `syncMismatchedActiveDb`, no toast.

### Sprint 273

- Empty events array → backend `AppError::Validation`. Frontend disables Apply.
- INSTEAD OF + STATEMENT → backend rejects. Dialog disables STATEMENT radio.
- INSTEAD OF + multi-events → backend rejects.
- Function arguments with quotes/escapes → free-text passthrough, PG verbatim error.
- WHEN clause with semicolons → free-text passthrough, parenthesised.
- Cross-schema trigger function → picker `schema.name` disambiguation,
  backend emits `EXECUTE FUNCTION "audit"."log_insert"(args)`.
- Function picker prefetch race → free-text fallback for `function_schema`
  + `function_name`.
- Duplicate trigger name → PG verbatim error in `previewError`.
- `expected_database` mismatch on Apply → user-initiated Retry toast.

### Sprint 274

- Drop non-existent trigger → PG verbatim error.
- CASCADE toggle → invalidates preview cache.
- Typing-confirm against name with embedded quotes → `validate_identifier`
  rejects so byte-for-byte match is canonical.
- Whitespace-only typing-confirm → comparison without trim → stays invalid.
- `expected_database` mismatch on Apply → user-initiated Retry toast.

## 7. Out of Scope (Phase 26)

- Event triggers (`CREATE EVENT TRIGGER`).
- Trigger dependency graph visualisation.
- PL/pgSQL debugger.
- Mongo change streams.
- **Function CREATE/EDIT UI** — defer to a later sprint.
- MySQL / SQLite trigger support.
- Trigger rename (`ALTER TRIGGER … RENAME TO`).
- Disable / enable triggers (`ALTER TABLE … DISABLE TRIGGER`).
- TRUNCATE event triggers in CREATE dialog.

## 8. Verification Hints

- Backend: `cd src-tauri && cargo test list_triggers && cargo test get_trigger_source && cargo test create_trigger && cargo test drop_trigger && cargo test trigger_bitmask`.
- Backend lint: `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`.
- Frontend: `pnpm tsc --noEmit && pnpm vitest run --no-file-parallelism && pnpm lint`.
- Manual: dev mode against fixtures PG, seed a trigger, exercise round-trip.
