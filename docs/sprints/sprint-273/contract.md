# Sprint Contract: sprint-273

## Summary

- **Goal**: Phase 26 Slice 2 — ship **Trigger CREATE** end-to-end. Backend
  `create_trigger` Tauri command + PG SQL emitter + identifier validation;
  TS wrapper `createTrigger`; new `CreateTriggerDialog` modal with name +
  timing + events + ROW/STATEMENT + WHEN clause + function picker +
  arguments + Show DDL preview pane; `useSchemaTreeActions` opener wiring
  + `+` affordance on the Triggers child row; round-trip from right-click
  → Apply → trigger surfaces in Sprint 272's read path. PG-only. NO drop
  surface (Sprint 274). NO Function CREATE/EDIT (deferred indefinitely).
- **Audience**: Generator (implementation), Evaluator (gate verification).
- **Owner**: harness Generator.
- **Verification Profile**: `mixed` — backend `cargo test` + frontend
  `vitest` + `tsc` + `lint` + `cargo clippy` + manual round-trip smoke.

## In Scope

Sprint 273 (per master spec `docs/sprints/sprint-272/spec.md` § 3 — Sprint
273 — Trigger CREATE). Eight ACs: `AC-273-01` .. `AC-273-08` (listed
verbatim under § Acceptance Criteria).

Touched surfaces:

- `src-tauri/src/models/schema.rs` — `CreateTriggerRequest` struct +
  camelCase serde + roundtrip test.
- `src-tauri/src/db/traits.rs` — `RdbAdapter::create_trigger` method with
  default `Err(AppError::Unsupported(Paradigm::Relational))` impl.
- `src-tauri/src/db/postgres/mutations.rs` — PG `create_trigger` SQL
  emitter with `validate_identifier` calls, deterministic event ordering,
  INSTEAD OF + STATEMENT / multi-event rejection, single-quote
  re-escape on `function_arguments` (Sprint 272 findings § P3).
- `src-tauri/src/commands/rdb/ddl.rs` — `create_trigger_inner` /
  `create_trigger` Tauri handler reusing Sprint 271c `ensure_expected_db`
  probe + `not_connected` helper under `active_connections.lock()`.
- `src-tauri/src/db/testing.rs` — `StubRdbAdapter::create_trigger_fn`
  setter for test injection.
- `src-tauri/src/lib.rs` — `invoke_handler` registration of the new
  command.
- `src/types/ddl.ts` (or wherever `*Request` mirrors live) —
  `CreateTriggerRequest` TS mirror with camelCase fields.
- `src/lib/tauri/ddl.ts` — `createTrigger(request: CreateTriggerRequest):
  Promise<SchemaChangeResult>` wrapper.
- `src/components/schema/CreateTriggerDialog.tsx` — new modal: name input,
  timing radio (BEFORE / AFTER / INSTEAD OF), events checkboxes (INSERT /
  UPDATE / DELETE; TRUNCATE hidden per master spec § 7), FOR EACH radio
  (ROW / STATEMENT; STATEMENT disabled when timing = INSTEAD OF), WHEN
  textarea (optional), function picker combobox from
  `schemaStore.functions[connectionId][db]` cross-schema with free-text
  fallback, arguments input (optional), Show DDL collapsible pane
  default-OPEN with debounced 250ms refresh, Cancel + Apply footer.
- `src/components/schema/CreateTriggerDialog.test.tsx` — new vitest file:
  open/close, Apply gating, debounced preview, INSTEAD OF disables
  STATEMENT, mismatch toast.
- `src/components/schema/SchemaTree/useSchemaTreeActions.ts` —
  `createTriggerDialog: { schemaName, tableName } | null` slot +
  `handleCreateTrigger(tableName, schemaName)` opener.
- `src/components/schema/SchemaTree/rows.tsx` — Triggers group header
  gains `+` affordance; Triggers child group context-menu "Create
  Trigger…" item flips from disabled placeholder (Sprint 272) to enabled
  `onClick={() => ctx.handleCreateTrigger(...)}` (per Sprint 272 handoff
  § "Disabled-placeholder swap pattern").
- `src/components/schema/SchemaTree/dialogs.tsx` —
  `CreateTriggerDialogSlot` wrapper.

**Pre-work (1 small commit, recommended but not load-bearing)**: Sprint
272 findings § P2 render-path duplication cleanup —
`body.tsx::TriggerGroupSubtree` (lines 536–660) consumes
`buildTriggerRowsForTable` output via the existing `renderVisibleRow`
dispatcher (`rows.tsx:629-663`) rather than duplicating branching logic.
Lands before the `+` affordance is wired to a single source-of-truth.

## Out of Scope

**Sprint 274 surfaces — explicitly deferred**:

- `DropTriggerDialog` modal
  (`src/components/schema/DropTriggerDialog.tsx`).
- `drop_trigger` Tauri command + `_inner`
  (`src-tauri/src/commands/rdb/ddl.rs`).
- `DropTriggerRequest` model.
- PG SQL emitter for `DROP TRIGGER`.
- TS wrapper `dropTrigger` in `src/lib/tauri/ddl.ts`.
- `useSchemaTreeActions.dropTriggerDialog` slot +
  `handleDropTrigger` opener.
- `DropTriggerDialogSlot` in `dialogs.tsx`.

**Function CREATE/EDIT UI**: deferred indefinitely per master spec § 7.
Sprint 273's function picker is **read-only** against
`schemaStore.functions[connectionId][db]`; free-text fallback covers the
race where the cache is not yet populated. NO `CreateFunctionDialog`,
NO `create_function` backend.

**Phase-wide deferred** (per master spec § 7):

- Event triggers (`CREATE EVENT TRIGGER`).
- Trigger dependency graph visualisation.
- PL/pgSQL debugger.
- Mongo change streams.
- MySQL / SQLite trigger support.
- Trigger rename (`ALTER TRIGGER … RENAME TO`).
- Disable / enable triggers (`ALTER TABLE … DISABLE TRIGGER`).
- **TRUNCATE event trigger CREATE** — Sprint 273's events checkbox set is
  `["INSERT", "UPDATE", "DELETE"]` only.

**Sprint 272 surfaces — must not regress**: `list_triggers`,
`get_trigger_source`, `schemaStore.triggers` cache slice,
`StructurePanel` Triggers sub-tab, `SchemaTree` Triggers child row,
`TriggerInfo` model, tgtype bitmask decoder. All of these landed in
Sprint 272 (`PASS`, 8.6/10) and Sprint 273 MUST leave them
byte-equivalent — only the `+` affordance / context-menu "Create
Trigger…" flip are touched on the row side.

## Invariants

- **Sprint 272 read-path surfaces unchanged**: `list_triggers`,
  `get_trigger_source`, `schemaStore.triggers` cache,
  `StructurePanel` Triggers tab, `SchemaTree` Triggers child row,
  `TriggerInfo`, `decode_tgtype`, `decode_tgargs`. Sprint 273 may extend
  context-menu items from disabled placeholder to enabled handler, may
  add a `+` affordance to the Triggers group header, but MUST NOT mutate
  the read SQL, the cache shape, the tab content, or the row renderers
  other than the affordance / context-menu hooks.
- **Sprint 271c `ensure_expected_db` helper reused unchanged**: the new
  `create_trigger_inner` calls `ensure_expected_db(adapter,
  request.expected_database.as_deref()).await?` under the same
  `state.active_connections.lock().await` acquisition that wraps the
  trait dispatch — byte-equivalent to every other handler in
  `src-tauri/src/commands/rdb/ddl.rs` (e.g. `drop_table_inner` at
  `:32-43`). NO new probe variant; NO change to the helper signature.
- **Sprint 214 `useDdlPreviewExecution` reused unchanged**: the new
  `CreateTriggerDialog` consumes the existing
  `useDdlPreviewExecution(request, executor)` lifecycle (preview debounce
  + Safe-Mode dispatch + post-commit refresh). The hook signature MUST
  NOT change. Mirrors `CreateTableDialog` consumption pattern.
- **DbMismatch handling pattern reused**: on user-initiated Apply,
  parse `DbMismatch` via `parseDbMismatch`, run
  `syncMismatchedActiveDb`, surface a Retry toast (Sprint 269 + 271a/c
  user-initiated path). Preview (debounced) mismatches stay **silent**
  to match Sprint 272 passive-prefetch contract.
- **Phase 21–25 CREATE dialogs unchanged**: `CreateTableDialog` (Phase
  21), `CreateIndexDialog` (Phase 22), `CreateConstraintDialog` (Phase
  23), View / Function read dialogs (Phase 24 / 25) MUST render
  byte-equivalent — verified by unchanged passing tests.
- **`validate_identifier` helper reused unchanged**: the new PG SQL
  emitter calls `validate_identifier(name)` on `trigger_name`, `schema`,
  `table`, `function_schema`, `function_name`. NAMEDATALEN-63-byte limit
  + identifier-character whitelist enforced verbatim. NO new helper
  introduced.
- **SQL identifier quoting**: every emitted identifier is wrapped in
  `"..."` (PG `quote_ident` semantics). `validate_identifier` rejects
  embedded double-quotes / NULs so byte-for-byte quoting is safe. NO
  string interpolation of unvalidated identifiers; arguments / WHEN are
  free-text passthrough (PG surfaces parse errors verbatim) with the
  single-quote re-escape on `function_arguments` fixing Sprint 272
  findings § P3.
- **Sprint 272 cache shape**: `schemaStore.triggers:
  ByConn<BySchema<ByTable<TriggerInfo[]>>>`. Post-commit refresh after
  Apply invalidates the `(connId, db, schema, table)` entry so the
  follow-up `getTableTriggers` re-fetches.

## Acceptance Criteria

Verbatim from master spec § 3 — Sprint 273.

- **`AC-273-01` — `CreateTriggerRequest` model**: Rust struct with
  `#[serde(rename_all = "camelCase")]` carrying `connection_id`,
  `schema`, `table`, `trigger_name`, `timing` (whitelist), `events`
  (non-empty subset), `orientation` (whitelist), `when_expression:
  Option<String>`, `function_schema`, `function_name`,
  `function_arguments: Option<String>`, `preview_only: bool`
  (`#[serde(default)]`), `expected_database: Option<String>`
  (`#[serde(default)]`). TS mirror + serde roundtrip test.
- **`AC-273-02` — Backend `create_trigger`**: lives in
  `src-tauri/src/commands/rdb/ddl.rs`.
  `create_trigger_inner(&AppState, &CreateTriggerRequest)` body shape.
  `ensure_expected_db` probe before trait dispatch. PG impl:
  - `validate_identifier` on `trigger_name`, `schema`, `table`,
    `function_schema`, `function_name`.
  - Whitelist `timing` ∈ `{BEFORE, AFTER, INSTEAD OF}`, `orientation` ∈
    `{ROW, STATEMENT}`, `events` ⊆ `{INSERT, UPDATE, DELETE}`.
  - Reject `INSTEAD OF + STATEMENT` and `INSTEAD OF + multi-events`
    (`AppError::Validation`).
  - Emit canonical SQL with deterministic event order (INSERT, UPDATE,
    DELETE) regardless of payload order.
  - Single-quote re-escape on `function_arguments` before embedding
    into the `EXECUTE FUNCTION "schema"."name"(args)` clause.
  - `preview_only: true` → return `SchemaChangeResult { sql }`;
    `preview_only: false` → wrap in `BEGIN/COMMIT` and execute.
- **`AC-273-03` — TS wrapper**: `src/lib/tauri/ddl.ts` exports
  `createTrigger(request: CreateTriggerRequest):
  Promise<SchemaChangeResult>`.
- **`AC-273-04` — `CreateTriggerDialog` modal**: form fields:
  - Trigger name (single-line input).
  - Timing radio: BEFORE / AFTER / INSTEAD OF. INSTEAD OF disables
    STATEMENT.
  - Events checkboxes: INSERT, UPDATE, DELETE.
  - For each radio: ROW / STATEMENT.
  - WHEN clause textarea (optional).
  - Function picker: combobox from
    `schemaStore.functions[connectionId][db]` across schemas (shows
    `schema.name`); free-text fallback.
  - Arguments input (optional, free-text).
  - Show DDL collapsible pane (default OPEN), debounced 250ms refresh.
  - Footer Cancel + Apply (Apply disabled until name / timing / ≥1 event
    / function valid AND `previewSql` non-empty AND `previewLoading`
    false).
- **`AC-273-05` — DDL preview lifecycle**: `useDdlPreviewExecution`
  reuse. `expected_database` threaded into the request. On `DbMismatch`,
  `parseDbMismatch` + `syncMismatchedActiveDb` + Retry toast (Sprint
  271c user-initiated path).
- **`AC-273-06` — Tree opener wiring**: `useSchemaTreeActions` gains
  `createTriggerDialog: { schemaName, tableName } | null` slot +
  `handleCreateTrigger(tableName, schemaName)`. Triggers child row
  group header gains `+` affordance. Context menu "Create Trigger…"
  flips from disabled (Sprint 272) to enabled.
  `src/components/schema/SchemaTree/dialogs.tsx` adds
  `CreateTriggerDialogSlot`.
- **`AC-273-07` — Manual round-trip**: right-click table → Create
  Trigger… → fill BEFORE INSERT FOR EACH ROW WHEN `(NEW.email IS NOT
  NULL)` + pick `audit.log_insert()` → preview pane renders canonical
  SQL → Apply → modal closes → trigger surfaces in Triggers child row
  + `StructurePanel` Triggers tab.
- **`AC-273-08` — Tests**: backend SQL emission fixtures: (i) BEFORE
  INSERT ROW no WHEN no args; (ii) AFTER INSERT OR UPDATE OR DELETE
  STATEMENT; (iii) INSTEAD OF INSERT ROW WHEN with args (single-quote
  arg included to verify escape); (iv) deterministic event order
  (input DELETE, UPDATE, INSERT → canonical INSERT, UPDATE, DELETE
  output). Rejection paths: empty events / invalid timing / invalid
  identifier (each of trigger_name, schema, table, function_schema,
  function_name) / INSTEAD OF+STATEMENT / INSTEAD OF+multi-event each
  return `AppError::Validation`. Backend mismatch test (Sprint 271c
  panic-closure pattern). Vitest: `CreateTriggerDialog` open/close,
  Apply gating, debounced preview (250ms), INSTEAD OF disables
  STATEMENT, mismatch toast (user-initiated Apply path).

## Done Criteria

One testable bullet per AC.

1. **AC-273-01** — `cargo test create_trigger_request_serde_roundtrip`
   passes; TS `CreateTriggerRequest` exported with camelCase field
   names (`connectionId`, `triggerName`, `whenExpression`,
   `functionSchema`, `functionName`, `functionArguments`, `previewOnly`,
   `expectedDatabase`).
2. **AC-273-02** — `cargo test create_trigger_inner_routes_to_trait`
   passes against `StubRdbAdapter`. Probe call-site
   (`ensure_expected_db(adapter, request.expected_database.as_deref())`)
   visible in `create_trigger_inner` body between `as_rdb()?` and the
   trait dispatch.
3. **AC-273-03** — `src/lib/tauri/ddl.ts` exports `createTrigger` with
   signature `(request: CreateTriggerRequest) =>
   Promise<SchemaChangeResult>`; JSDoc references Sprint 273.
4. **AC-273-04** — `CreateTriggerDialog` renders all 8 form fields
   (name, timing radio, events checkboxes, FOR EACH radio, WHEN
   textarea, function picker combobox, arguments input, Show DDL
   collapsible). STATEMENT radio is `disabled` when timing = INSTEAD
   OF. Apply button `disabled` until gate passes.
5. **AC-273-05** — `CreateTriggerDialog` consumes
   `useDdlPreviewExecution` with `expected_database` threaded into the
   request; user-initiated Apply mismatch path runs `parseDbMismatch`
   + `syncMismatchedActiveDb` + Retry toast (vitest assertion).
6. **AC-273-06** — `useSchemaTreeActions` exposes
   `createTriggerDialog` slot + `handleCreateTrigger` handler;
   `dialogs.tsx` mounts `CreateTriggerDialogSlot`; Triggers group
   header renders `+` affordance; "Create Trigger…" context-menu item
   is enabled and wires `onClick` to `handleCreateTrigger`.
7. **AC-273-07** — manual smoke evidence: screenshot or recording of
   the round-trip (BEFORE INSERT ROW + WHEN clause + function picker
   pick → preview → Apply → row appears in tree + tab).
8. **AC-273-08** — backend `cargo test create_trigger` adds:
   (i)–(iv) SQL emission fixtures (≥4 cases), 5 rejection paths
   (`AppError::Validation`), 1 mismatch test (Sprint 271c panic-closure
   pattern). Vitest adds `CreateTriggerDialog.test.tsx` with ≥5 cases
   (open/close, Apply gating, debounced preview, INSTEAD OF disables
   STATEMENT, mismatch toast).

## Design Bar / Quality Bar

- **Probe block** in `create_trigger_inner` is byte-equivalent to every
  other `_inner` in `src-tauri/src/commands/rdb/ddl.rs` (see
  `drop_table_inner` `:32-43` as the reference): lock acquisition →
  `get` → `not_connected` → `as_rdb()?` → `ensure_expected_db` → trait
  dispatch.
- **PG SQL emitter** in `src-tauri/src/db/postgres/mutations.rs`:
  - Identifier validation BEFORE any string concatenation.
  - Whitelists checked via `match` against `&str` constants (no `to_uppercase`
    on user input — caller sends canonical uppercase, mismatches are rejected).
  - Event ordering: collect input events into a `BTreeSet<&str>` or
    sort against the canonical order `["INSERT", "UPDATE", "DELETE"]`,
    join with ` OR `. Single emission order regardless of payload
    order (testable via fixture iv).
  - `function_arguments` single-quote re-escape: every `'` in the
    free-text input is replaced with `''` before embedding into the
    `(args)` clause. Closes Sprint 272 findings § P3.
  - WHEN expression: parenthesised verbatim (`WHEN (<expr>)`); empty
    string ↔ omit clause.
  - `preview_only: false` wraps the single `CREATE TRIGGER` statement
    in `BEGIN; ...; COMMIT;` (mirrors the rest of the Phase 24-26 DDL
    family).
- **No `unwrap()`** on adapter / probe paths. Use `?`,
  `unwrap_or_default()`, `ok_or_else(...)`.
- **No `any` (TypeScript)** on wrapper or dialog signatures.
- **No `console.log`** shipped.
- **JSDoc** on `createTrigger` wrapper + a one-line comment naming the
  parameter and referencing Sprint 273 (mirrors Sprint 271c wrapper
  docs).
- **Debounce 250ms** on preview refresh — match `CreateTableDialog`
  shape (`useDebounce` or equivalent hook); fakeTimers vitest case
  asserts exactly one IPC dispatch per 250ms idle window.
- **Apply gate** computed in one place (the dialog body), not split
  across button + form effect — avoid stale-state bugs.
- **No `--no-verify`**. No hook skipping (project rule
  `.claude/rules/git-policy.md`).

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo test create_trigger` — SQL emission fixtures
   (≥4) + rejection paths (5) + mismatch test pass.
2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D
   warnings` — clean.
3. `cd src-tauri && cargo fmt --check` — passes.
4. `cd src-tauri && cargo test --lib` — full backend green (no
   regression in Sprint 272 trigger tests or any earlier Phase tests).
5. `pnpm tsc --noEmit` — clean.
6. `pnpm vitest run` — passes; new `CreateTriggerDialog.test.tsx` ≥5
   cases included; Sprint 272 trigger tests still green.
7. `pnpm lint` — clean.
8. **Manual round-trip smoke** — `pnpm tauri dev` against fixtures PG:
   - Right-click a Table row → "Create Trigger…" context-menu item
     enabled → modal opens.
   - Fill: trigger name `audit_users_insert`; timing BEFORE; events
     INSERT; FOR EACH ROW; WHEN `(NEW.email IS NOT NULL)`; function
     picker `audit.log_insert`; arguments empty.
   - Show DDL pane renders canonical SQL within 250ms of last keystroke.
   - Apply → modal closes → Triggers child row of `users` now lists
     `audit_users_insert`; `StructurePanel` Triggers tab renders the
     trigger metadata + `pg_get_triggerdef` block.

### Required Evidence

Generator must provide in `handoff.md`:

- **Changed files** grouped by surface (models / traits / PG emitter /
  command handler / store-untouched / TS wrappers / UI / tests), each
  with a one-line purpose.
- **Per-gate command output** (final ~40 lines): `cargo fmt --check`,
  `cargo clippy`, `cargo test` (with new-test count delta vs Sprint 272
  baseline), `pnpm tsc --noEmit`, `pnpm vitest run` (with test count
  delta), `pnpm lint`.
- **6 SQL emission fixture outputs** verbatim — the (i)/(ii)/(iii)/(iv)
  emission cases plus 2 from the 5 rejection cases (e.g. INSTEAD
  OF+STATEMENT, invalid identifier).
- **AC coverage table** with `file:line` citations for each AC (e.g.
  `AC-273-02` → `src-tauri/src/commands/rdb/ddl.rs:NNN-MMM` for the
  probe block + trait dispatch;
  `src-tauri/src/db/postgres/mutations.rs:NNN-MMM` for the SQL emitter).
- **Manual smoke evidence** — screenshot or screen-recording reference
  of the round-trip described in § Required Checks step 8.

Evaluator must cite:

- Actual line numbers of the probe block in `create_trigger_inner`;
  byte-equivalence to `drop_table_inner` at
  `src-tauri/src/commands/rdb/ddl.rs:32-43`.
- cargo test + vitest deltas reconciled vs Sprint 272 baseline.
- Each AC pass/fail decision linked to a `file:line` citation from the
  evidence table.
- Sprint 272 surfaces (read path + cache + tab + child row) verified
  byte-equivalent — i.e. NO regression in Sprint 272 tests.

## Test Requirements

### Unit Tests (필수)

- **Backend (Rust)** in `src-tauri/src/db/postgres/mutations.rs`
  (alongside the emitter) + `src-tauri/src/commands/rdb/ddl.rs`
  (alongside the handler):
  - **SQL emission fixtures** (≥4 cases):
    - (i) BEFORE INSERT FOR EACH ROW, no WHEN, no arguments.
    - (ii) AFTER INSERT OR UPDATE OR DELETE FOR EACH STATEMENT, no
      WHEN, no arguments.
    - (iii) INSTEAD OF INSERT FOR EACH ROW WHEN `(NEW.x IS NOT NULL)`
      with arguments `O'Brien, audit_users` — verifies single-quote
      re-escape (`'O''Brien'`).
    - (iv) deterministic event order — input `events =
      ["DELETE", "UPDATE", "INSERT"]` → emitted SQL contains `INSERT
      OR UPDATE OR DELETE` (canonical order).
  - **Rejection paths** (each returns `AppError::Validation`):
    - empty `events` array.
    - invalid `timing` (e.g. `"DURING"`).
    - invalid `trigger_name` (embedded double-quote / NUL / >63 bytes).
    - invalid `schema` (same).
    - invalid `table` (same).
    - invalid `function_schema` (same).
    - invalid `function_name` (same).
    - INSTEAD OF + STATEMENT.
    - INSTEAD OF + multi-event (`events.len() > 1`).
  - **Mismatch test** —
    `create_trigger_inner_expected_db_mismatch_returns_dbmismatch_and_skips_trait`
    using the Sprint 271c panic-closure pattern: stub adapter
    `current_database_fn = Some("dbA")`, `create_trigger_fn =
    panic!("must not run on mismatch")`, caller passes
    `expected_database = Some("dbB")`, assert `Err(AppError::DbMismatch
    { expected: "dbB", actual: "dbA" })` and the panic did not fire.
  - **Wiring test** — `create_trigger_routes_to_create_trigger_trait_method`
    follows the existing 9 wiring tests' shape
    (`src-tauri/src/commands/rdb/ddl.rs:501-580`): default
    `StubRdbAdapter`, assert returned `sql == "create_trigger"`.
- **Frontend (vitest)** in
  `src/components/schema/CreateTriggerDialog.test.tsx`:
  - **Open/close** — modal mounts with `open=true`, unmounts cleanly on
    Cancel.
  - **Apply gating** — Apply is disabled until name non-empty AND
    timing chosen AND ≥1 event checked AND function picker non-empty
    AND `previewSql` non-empty AND `previewLoading` false; toggle each
    precondition and assert the button's `disabled` state flips.
  - **Debounced preview (250ms)** — fakeTimers; user types rapidly
    into the WHEN field; `createTrigger` mock called exactly once after
    250ms idle (not once per keystroke).
  - **INSTEAD OF disables STATEMENT** — selecting INSTEAD OF radio
    flips the STATEMENT radio to `disabled` and auto-selects ROW.
  - **Mismatch toast (user-initiated Apply)** — mock backend rejects
    Apply with `AppError::DbMismatch { expected, actual }`; assert
    `parseDbMismatch` parses the error, `syncMismatchedActiveDb` runs,
    and a Retry toast surfaces (Sprint 271c user-initiated path).

### Coverage Target

- 신규/수정 코드: 라인 70% 이상 권장.
- CI 전체 기준: 라인 40%, 함수 40%, 브랜치 35%.

### Scenario Tests (필수)

- [x] **Happy path** — BEFORE INSERT ROW + WHEN + function picker →
      preview renders → Apply → trigger surfaces.
- [x] **에러/예외** — empty events / invalid timing / invalid
      identifier / INSTEAD OF + STATEMENT / INSTEAD OF + multi-event
      each rejected with `AppError::Validation`. Apply mismatch path
      surfaces Retry toast.
- [x] **경계 조건** — single-quote in `function_arguments` (re-escape
      verified); deterministic event ordering regardless of input
      order; INSTEAD OF locks STATEMENT radio; debounced preview
      (rapid keystrokes coalesce to one dispatch).
- [x] **기존 기능 회귀 없음** — Sprint 272 trigger tests still green;
      Phase 21–25 CREATE dialogs (`CreateTableDialog` etc.) render
      byte-equivalent; `useDdlPreviewExecution` consumers (column /
      index / constraint / view dialogs) unchanged.

## Test Script / Repro Script

1. Stand up `sprint-273` branch from `main` (post-Sprint-272 head).
2. Pre-work commit (optional but recommended): collapse `body.tsx ↔
   treeRows.ts` render-path duplication per Sprint 272 findings § P2.
3. Land `CreateTriggerRequest` (Rust + TS) + serde roundtrip test.
4. Add `RdbAdapter::create_trigger` trait method with default
   `Err(Unsupported)`; extend `StubRdbAdapter` with
   `create_trigger_fn`.
5. Implement PG emitter in `mutations.rs` with `validate_identifier`,
   whitelist checks, deterministic event order, single-quote re-escape,
   INSTEAD OF rejection paths. Add ≥4 emission fixtures + 5 rejection
   tests.
6. Add `create_trigger_inner` + `create_trigger` Tauri handler in
   `ddl.rs` reusing `ensure_expected_db` + `not_connected`. Add
   wiring test + mismatch test.
7. Register the command in `src-tauri/src/lib.rs` `invoke_handler`.
8. Add `createTrigger` TS wrapper in `src/lib/tauri/ddl.ts` +
   `CreateTriggerRequest` TS mirror.
9. Implement `CreateTriggerDialog.tsx` with all 8 form fields, Apply
   gate, debounced preview, INSTEAD OF disables STATEMENT, function
   picker over `schemaStore.functions[connectionId][db]` cross-schema
   with free-text fallback.
10. Wire `useSchemaTreeActions.createTriggerDialog` slot +
    `handleCreateTrigger` opener; mount `CreateTriggerDialogSlot` in
    `dialogs.tsx`; add `+` affordance on Triggers group header; flip
    "Create Trigger…" context-menu item from disabled to enabled.
11. Add `CreateTriggerDialog.test.tsx` with ≥5 cases (open/close,
    Apply gating, debounced preview, INSTEAD OF disables STATEMENT,
    mismatch toast).
12. Run all 7 automated gates + manual round-trip smoke.
13. Write `handoff.md` with per-gate tails + 6 SQL emission fixture
    outputs + AC coverage table + manual smoke evidence.

## Ownership

- **Generator**: harness Generator agent.
- **Write scope**:
  - `src-tauri/src/models/schema.rs`
  - `src-tauri/src/db/traits.rs`
  - `src-tauri/src/db/postgres/mutations.rs`
  - `src-tauri/src/commands/rdb/ddl.rs`
  - `src-tauri/src/db/testing.rs`
  - `src-tauri/src/lib.rs` (command registration only)
  - `src/types/ddl.ts` (or equivalent `*Request` location)
  - `src/lib/tauri/ddl.ts`
  - `src/components/schema/CreateTriggerDialog.tsx` (new)
  - `src/components/schema/CreateTriggerDialog.test.tsx` (new)
  - `src/components/schema/SchemaTree/useSchemaTreeActions.ts`
  - `src/components/schema/SchemaTree/rows.tsx` (affordance +
    context-menu flip only)
  - `src/components/schema/SchemaTree/dialogs.tsx`
  - Optional pre-work: `src/components/schema/SchemaTree/body.tsx` +
    `src/components/schema/SchemaTree/treeRows.ts` (render-path
    duplication cleanup, 1 small commit before the main slice).
  - `docs/sprints/sprint-273/handoff.md` (created by Generator at end).
- **Merge order**: pre-work commit (optional, 1 small) → main Sprint
  273 commit covering all of the above. Conventional Commits format,
  `feat(sprint-273): ...`.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- All 8 ACs (`AC-273-01` .. `AC-273-08`) evidenced in `handoff.md`
  with `file:line` citations: `yes`
- Sprint 271c `ensure_expected_db` probe byte-equivalent in
  `create_trigger_inner`: `yes`
- Sprint 272 surfaces (`list_triggers`, `get_trigger_source`,
  `schemaStore.triggers`, StructurePanel Triggers tab, SchemaTree
  Triggers child row, `TriggerInfo`, `decode_tgtype`) byte-equivalent
  — verified by unchanged passing tests: `yes`
- Phase 21–25 CREATE dialogs (`CreateTableDialog`,
  `CreateIndexDialog`, `CreateConstraintDialog`) byte-equivalent —
  verified by unchanged passing tests: `yes`
- NO Sprint 274 surfaces (`DropTriggerDialog`, `drop_trigger`,
  `DropTriggerRequest`) landed in this contract: `yes`
- NO Function CREATE/EDIT UI landed: `yes`
- NO TRUNCATE event in CREATE dialog: `yes`
- NO ALTER TRIGGER rename / DISABLE / ENABLE landed: `yes`
