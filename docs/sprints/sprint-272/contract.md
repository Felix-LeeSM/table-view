# Sprint Contract: sprint-272

## Summary

- **Goal**: Phase 26 Slice 1 — ship **Trigger READ** end-to-end (backend
  `list_triggers` + `get_trigger_source` introspection, TS wrappers,
  `schemaStore` per-`(connId, db, schema, table)` trigger cache, SchemaTree
  Triggers child node on each Table, and a read-only Triggers sub-tab in
  `StructurePanel` displaying `pg_get_triggerdef`). PG-only. NO create / drop
  surfaces — those land in Sprint 273 / 274.
- **Audience**: Generator (implementation), Evaluator (gate verification).
- **Owner**: harness Generator.
- **Verification Profile**: `mixed` — backend `cargo test` + frontend
  `vitest` + `tsc` + `lint` + `cargo clippy` + manual sidebar smoke.

## In Scope

Sprint 272 (per master spec `docs/sprints/sprint-272/spec.md` § 2 — Sprint 272
— Trigger Read). Eight ACs: `AC-272-01` .. `AC-272-08` (listed below
verbatim under § Acceptance Criteria).

Touched surfaces (read-only path only):

- `src-tauri/src/models/schema.rs` — `TriggerInfo` struct + serde roundtrip
  test.
- `src-tauri/src/db/traits.rs` — 2 new `RdbAdapter` methods
  (`list_triggers`, `get_trigger_source`) with default `Ok(Vec::new())` /
  `Err(AppError::Unsupported(Paradigm::Relational))` impls.
- `src-tauri/src/db/postgres/schema.rs` — PG `list_triggers` SQL against
  `pg_catalog.pg_trigger ⨝ pg_proc ⨝ pg_namespace ⨝ pg_class` + tgtype
  bitmask decoder + `get_trigger_source` (`SELECT pg_get_triggerdef(t.oid)`).
- `src-tauri/src/commands/rdb/schema.rs` — `list_triggers_inner` /
  `list_triggers` + `get_trigger_source_inner` / `get_trigger_source` Tauri
  handlers; both call shared `ensure_expected_db` (Sprint 271c hoist) under
  `active_connections.lock()` before dispatch.
- `src-tauri/src/db/testing.rs` — `StubRdbAdapter` extension for the two new
  trait methods.
- `src/types/schema.ts` — `TriggerInfo` TS mirror.
- `src/lib/tauri/schema.ts` — `listTriggers` + `getTriggerSource` wrappers
  (positional, optional last-positional `expectedDatabase?: string`, JSDoc
  references Sprint 272).
- `src/stores/schemaStore.ts` — `triggers: ByConn<BySchema<ByTable<TriggerInfo[]>>>`
  slice + `getTableTriggers(connId, db, table, schema)` action + eviction
  wiring in `clearForConnection`, `clearForWorkspace`, `evictSchemaForName`.
- `src/components/schema/SchemaTree/treeRows.ts` — `NodeId` `trigger`
  variant + `nodeIdToString` clause.
- `src/components/schema/SchemaTree/rows.tsx` — Triggers child row per Table
  with loading / empty / error treatments matching the existing
  Functions/Views row pattern + context-menu placeholder items ("View
  Source"; "Create Trigger…" and "Drop…" are DISABLED placeholder entries
  — wired in 273/274, not 272).
- `src/components/schema/StructurePanel.tsx` — fourth sub-tab "Triggers"
  after Constraints, read-only. Lists name, timing/event summary,
  ROW/STATEMENT, function (`func_schema.func_name(args)`), WHEN clause, and
  `pg_get_triggerdef` in a monospace `<pre>` block. `hasFetchedTriggers`
  gate prevents "No triggers" flash. `refresh-structure` event re-fetches.

## Out of Scope

**Sprint 273 surfaces — explicitly deferred**:
- `CreateTriggerDialog` modal (`src/components/schema/CreateTriggerDialog.tsx`).
- `create_trigger` Tauri command + `_inner` (`src-tauri/src/commands/rdb/ddl.rs`).
- `CreateTriggerRequest` model.
- PG SQL emitter for `CREATE TRIGGER` in `src-tauri/src/db/postgres/mutations.rs`.
- TS wrapper `createTrigger` in `src/lib/tauri/ddl.ts`.
- `useSchemaTreeActions.createTriggerDialog` slot + `handleCreateTrigger` opener.
- `CreateTriggerDialogSlot` in `src/components/schema/SchemaTree/dialogs.tsx`.

**Sprint 274 surfaces — explicitly deferred**:
- `DropTriggerDialog` modal (`src/components/schema/DropTriggerDialog.tsx`).
- `drop_trigger` Tauri command + `_inner`.
- `DropTriggerRequest` model.
- PG SQL emitter for `DROP TRIGGER`.
- TS wrapper `dropTrigger` in `src/lib/tauri/ddl.ts`.
- `useSchemaTreeActions.dropTriggerDialog` slot + `handleDropTrigger` opener.
- `DropTriggerDialogSlot` in `dialogs.tsx`.

**Phase-wide deferred** (per master spec § 7): Event triggers
(`CREATE EVENT TRIGGER`), trigger dependency graph, PL/pgSQL debugger,
Mongo change streams, Function CREATE/EDIT, MySQL/SQLite triggers,
trigger rename (`ALTER TRIGGER … RENAME TO`), enable/disable triggers,
TRUNCATE event triggers in any future CREATE dialog.

## Invariants

- **Phase 21–25 surfaces must not regress**: existing Tables, Indexes,
  Constraints, Views, Functions sub-tabs in `StructurePanel` plus their
  SchemaTree rows render byte-equivalent. Existing tab keys
  (`"columns" | "indexes" | "constraints"`) are extended (not renamed)
  to `"columns" | "indexes" | "constraints" | "triggers"`.
- **Sprint 271c `ensure_expected_db` helper pattern is reused unchanged**:
  both new `_inner` handlers call
  `ensure_expected_db(adapter, expected_database).await?` under the same
  `state.active_connections.lock().await` acquisition that wraps the
  underlying trait method call. Probe ordering and mismatch return shape
  (`AppError::DbMismatch { expected, actual }`) are byte-equivalent to the
  Sprint 271c reference in `src-tauri/src/commands/rdb/schema.rs`
  (e.g. `list_functions_inner` body shape).
- **Sprint 266 DbMismatch contract is honored**: when adapter
  `current_database()` reports `None`, coerced to `""` via
  `unwrap_or_default()`. Mismatch returns before the trait method is
  invoked. On the frontend, `schemaStore.getTableTriggers` mismatch path
  routes through `syncMismatchedActiveDb` **silently** (passive prefetch,
  NO toast — matches Sprint 271a `getTableIndexes` / `getTableConstraints`
  behaviour). User-initiated Retry-toast paths are 273/274 territory.
- **schemaStore cache shape must not break existing eviction calls**: the
  new `triggers` slice slots into the existing `ByConn<BySchema<ByTable<V>>>`
  shape (mirroring `tableColumnsCache` and the Sprint 263/265 per-`(connId,
  db)` cache layout). `clearForConnection(connId)`,
  `clearForWorkspace(connId, db)`, and `evictSchemaForName(connId, db,
  schemaName)` each gain a matching purge for `triggers` — but the existing
  per-cache helper signatures (e.g. `deleteConn`, `deleteSchema`) are
  reused unchanged.
- **Non-PG RDB adapters return empty**: default trait impl is
  `Ok(Vec::new())` for `list_triggers` and `Err(AppError::Unsupported(...))`
  for `get_trigger_source`. Document-paradigm adapters return
  `Err(AppError::Unsupported(Paradigm::Relational))` consistent with the
  rest of the schema introspection surface.
- **Sprint 214 `useDdlPreviewExecution`** is NOT touched in 272 (no DDL
  preview here); the hook remains byte-equivalent.

## Acceptance Criteria

Verbatim from master spec § 3 — Sprint 272.

- **`AC-272-01` — `TriggerInfo` model**: new struct (Rust + TS) carries
  `name`, `schema`, `table`, `timing` (`"BEFORE" | "AFTER" | "INSTEAD OF"`),
  `events` (`Vec<String>` whitelist `["INSERT", "UPDATE", "DELETE"]`,
  multi), `orientation` (`"ROW" | "STATEMENT"`), `function_schema`,
  `function_name`, `arguments` (`Option<String>`), `when_expression`
  (`Option<String>`), `definition` (full `pg_get_triggerdef` string).
  Serde roundtrip test required.
- **`AC-272-02` — Backend reads**: two new commands in
  `src-tauri/src/commands/rdb/schema.rs`:
  - `list_triggers(connection_id, schema, table, expected_database?) -> Vec<TriggerInfo>`
  - `get_trigger_source(connection_id, schema, table, trigger_name, expected_database?) -> String`

  Both call `ensure_expected_db` (Sprint 271c hoist) under
  `active_connections.lock()` before dispatch. PG impl queries
  `pg_catalog.pg_trigger ⨝ pg_proc ⨝ pg_namespace ⨝ pg_class` with
  `NOT t.tgisinternal`, decoding `t.tgtype` bitmask
  (`0x40 → INSTEAD OF`; else `0x02 → BEFORE/AFTER`;
  events from `0x04/0x08/0x10`; TRUNCATE `0x20` skip;
  `0x01 → ROW/STATEMENT`). Results ordered by `t.tgname`. Non-PG RDB
  → default `Ok(Vec::new())`. Non-RDB → `Unsupported(relational)`.
- **`AC-272-03` — TS wrappers**: `src/lib/tauri/schema.ts` exports
  `listTriggers(connectionId, schema, table, expectedDatabase?)` +
  `getTriggerSource(connectionId, schema, table, triggerName,
  expectedDatabase?)`.
- **`AC-272-04` — Trait + adapter wiring**: `RdbAdapter` gains
  `list_triggers(namespace, table)` + `get_trigger_source(namespace, table,
  name)` with default `Ok(Vec::new())` / `Err(Unsupported)`. PG override.
  `StubRdbAdapter` extension for tests.
- **`AC-272-05` — schemaStore cache**: `triggers:
  ByConn<BySchema<ByTable<TriggerInfo[]>>>` slice +
  `getTableTriggers(connId, db, table, schema)` action. Forwards `db` as
  `expectedDatabase`. On `DbMismatch` → silent `syncMismatchedActiveDb`
  (passive prefetch, no toast). Eviction in `clearForConnection` /
  `clearForWorkspace` / `evictSchemaForName`.
- **`AC-272-06` — SchemaTree trigger node**: each Table row gains a child
  "Triggers" affordance. Loading / empty / error states match existing
  Functions/Views row treatments. Right-click context menu placeholder for
  "View Source", "Create Trigger…" (273), "Drop…" (274).
- **`AC-272-07` — StructurePanel Triggers tab**: fourth sub-tab "Triggers"
  after Constraints. Read-only viewer: name, timing/event summary,
  ROW/STATEMENT, function (`func_schema.func_name(args)`), WHEN clause, and
  `pg_get_triggerdef` in monospace pre block. `hasFetchedTriggers` gate
  prevents "No triggers" flash. `refresh-structure` listener re-fetches.
- **`AC-272-08` — Tests**: backend mismatch-case tests for both `_inner`
  fns (Sprint 271c panic-closure pattern). Bitmask decoder unit tests for
  ≥4 representative tgtype values. Vitest case for schemaStore trigger
  cache (IPC mock invoked once on second call).

## Done Criteria

One testable bullet per AC.

1. **AC-272-01** — `cargo test trigger_info_serde_roundtrip` passes; TS
   `TriggerInfo` exported from `src/types/schema.ts` matches the Rust
   `serde(rename_all = "camelCase")` wire shape.
2. **AC-272-02** — `cargo test list_triggers_inner_returns_pg_triggers`
   (against `StubRdbAdapter`) and
   `cargo test get_trigger_source_inner_returns_pg_get_triggerdef` pass.
   Probe call-site visible in both `_inner` bodies before the trait method
   dispatch.
3. **AC-272-03** — `src/lib/tauri/schema.ts` exports `listTriggers` and
   `getTriggerSource` with the wire shape
   `expected_database: expectedDatabase ?? null`; JSDoc one-liner references
   Sprint 272.
4. **AC-272-04** — `RdbAdapter::list_triggers` default impl returns
   `Ok(Vec::new())`; `RdbAdapter::get_trigger_source` default impl returns
   `Err(AppError::Unsupported(Paradigm::Relational))`. PG impl overrides
   both. `StubRdbAdapter` carries optional `list_triggers_fn` and
   `get_trigger_source_fn` setter helpers.
5. **AC-272-05** — vitest case asserts `schemaStore.getTableTriggers` calls
   the mocked `listTriggers` IPC once for the same
   `(connId, db, table, schema)` repeat call; eviction helpers reset the
   slice without disturbing the existing `tables`/`views`/`functions`
   caches.
6. **AC-272-06** — SchemaTree Table row exposes a "Triggers" child affordance
   under the existing per-Table category layout; loading / empty / error
   states render the same components as existing Functions/Views rows;
   context-menu placeholder items render with "Create Trigger…" and "Drop…"
   `disabled` (wired in 273/274), and "View Source" enabled to push a
   read-only viewer.
7. **AC-272-07** — `StructurePanel` `SubTab` enum extended with `"triggers"`;
   the new tab fetches via `getTableTriggers`, gates the empty-state behind
   `hasFetchedTriggers`, renders the metadata table + `pg_get_triggerdef`
   monospace pre block, and re-fetches on the existing `refresh-structure`
   event.
8. **AC-272-08** — backend `cargo test` adds: (i) two mismatch-case tests
   (`list_triggers_inner_db_mismatch`, `get_trigger_source_inner_db_mismatch`)
   using the Sprint 271c panic-closure pattern (`current_database_fn = "X"`,
   caller passes `Some("Y")`, assert `AppError::DbMismatch` AND that the
   underlying trait method was NOT invoked); (ii) bitmask decoder unit
   tests for ≥4 representative tgtype values (e.g. `0x07` =
   ROW/BEFORE/INSERT; `0x1A` = STATEMENT/AFTER/DELETE; `0x47` =
   ROW/INSTEAD OF/INSERT; `0x21` = ROW/BEFORE/TRUNCATE-skip). Vitest:
   schemaStore trigger cache reuses cache on second `getTableTriggers`
   call without re-invoking IPC.

## Design Bar / Quality Bar

- **Probe block** in `list_triggers_inner` / `get_trigger_source_inner` must
  be byte-equivalent to Sprint 271c reference handlers in
  `src-tauri/src/commands/rdb/schema.rs` (e.g. `list_functions_inner`,
  `get_function_source_inner`): probe under
  `state.active_connections.lock().await`, `ensure_expected_db` call before
  the trait dispatch.
- **No `unwrap()`** on adapter / probe paths (Rust convention). Use `?` or
  `unwrap_or_default()`.
- **No `any` (TypeScript)** on wrapper or store signatures.
- **No `console.log`** shipped.
- **PG SQL** for `list_triggers` is parameter-bound (`$1`, `$2`) — no
  string interpolation of `schema` / `table`. Identifiers in error messages
  pass through `pg_get_triggerdef` verbatim.
- **JSDoc**: each new wrapper carries a one-line comment naming the
  parameter and referencing Sprint 272 (mirrors Sprint 271a wrapper docs).
- **Cache eviction**: the three eviction sites (`clearForConnection`,
  `clearForWorkspace`, `evictSchemaForName`) reuse existing `deleteConn` /
  `deleteSchema` helpers — DO NOT introduce new helpers for the trigger
  slice.
- **No `--no-verify`**. No hook skipping (project rule).

## Verification Plan

### Required Checks

1. `cargo fmt --check` — passes.
2. `cargo clippy --all-targets --all-features -- -D warnings` — clean.
3. `cargo test` — passes; new tests include:
   - `list_triggers_inner_*` (happy + mismatch + unknown-connection).
   - `get_trigger_source_inner_*` (happy + mismatch + unknown-connection).
   - `trigger_info_serde_roundtrip`.
   - `decode_tgtype_*` (≥4 representative values).
4. `pnpm tsc --noEmit` — clean.
5. `pnpm vitest run --no-file-parallelism` — passes; new tests include:
   - `schemaStore.test.ts` — trigger cache hit-on-second-call + eviction
     leaves other caches intact.
   - `StructurePanel.test.tsx` (or equivalent) — Triggers tab renders
     `pg_get_triggerdef` content and respects `hasFetchedTriggers` gate.
6. `pnpm lint` — clean.
7. **Manual sidebar smoke** — dev mode (`pnpm tauri dev`) against fixtures
   PG with a seeded trigger:
   - Expand a Table row that has ≥1 trigger → "Triggers" child row appears
     with the trigger name.
   - Open `StructurePanel` for that Table → "Triggers" sub-tab renders the
     metadata row + `pg_get_triggerdef` monospace block.
   - Swap the active db on the same workspace → trigger child + tab
     re-fetch via passive `syncMismatchedActiveDb` (NO toast).

### Required Evidence

Generator must provide in `handoff.md`:

- **Changed files** grouped by surface (models / traits / PG impl /
  commands / store / TS wrappers / UI), each with a one-line purpose.
- **Per-gate command output** (final ~40 lines): `cargo fmt --check`,
  `cargo clippy`, `cargo test` (with new-test count delta vs `main`),
  `pnpm tsc --noEmit`, `pnpm vitest run --no-file-parallelism` (with
  test count delta), `pnpm lint`.
- **AC coverage table** with `file:line` citations for each AC (e.g.
  `AC-272-02` → `src-tauri/src/commands/rdb/schema.rs:NNN-MMM` for the
  probe block + trait dispatch).
- **Manual smoke evidence** — screenshot or screen-recording reference of
  the sidebar Triggers child row + StructurePanel Triggers tab against the
  fixtures PG seed.

Evaluator must cite:

- Actual line numbers of the probe block in **both** `list_triggers_inner`
  and `get_trigger_source_inner`; byte-equivalence to a Sprint 271c
  reference (e.g. `list_functions_inner`).
- cargo test + vitest deltas reconciled vs `main` (`e1f4689`).
- Each AC pass/fail decision linked to a `file:line` citation from the
  evidence table.

## Test Requirements

### Unit Tests (필수)

- **Backend (Rust)**:
  - `list_triggers_inner_db_mismatch` + `get_trigger_source_inner_db_mismatch`
    — Sprint 271c panic-closure pattern: stub adapter
    `current_database_fn = "X"` + the trait method `list_triggers_fn` /
    `get_trigger_source_fn` set to `panic!("must not be called when db mismatches")`,
    caller passes `expected_database = Some("Y")`, assert
    `Err(AppError::DbMismatch { expected: "Y", actual: "X" })`.
  - `decode_tgtype_*` — ≥4 representative bitmask values cover BEFORE/AFTER/
    INSTEAD OF × ROW/STATEMENT × INSERT/UPDATE/DELETE/TRUNCATE-skip.
  - `trigger_info_serde_roundtrip` — JSON deserialise→serialise stable on
    camelCase wire shape.
- **Frontend (vitest)**:
  - `schemaStore.test.ts` — second `getTableTriggers` call on same key
    returns cached array without re-invoking the mocked IPC.
  - One UI test (`StructurePanel.test.tsx` or `SchemaTree/rows.test.tsx`)
    asserting the Triggers tab renders the metadata + `pg_get_triggerdef`
    monospace block and respects the `hasFetchedTriggers` gate.

### Coverage Target

- 신규/수정 코드: 라인 70% 이상 권장.
- CI 전체 기준: 라인 40%, 함수 40%, 브랜치 35%.

### Scenario Tests (필수)

- [x] **Happy path** — Table with ≥1 trigger renders child row + tab content.
- [x] **에러/예외** — `DbMismatch` mismatch + unknown connection.
- [x] **경계 조건** — empty trigger list (`Ok(Vec::new())`, italic
  placeholder); `tgisinternal = true` filtered; TRUNCATE event skipped from
  list; `current_database = None` coerced to `""`.
- [x] **기존 기능 회귀 없음** — `cargo test` + `pnpm vitest` count
  monotonically non-decreasing; existing Columns/Indexes/Constraints/Views/
  Functions tabs + rows render byte-equivalent.

## Test Script / Repro Script

1. Stand up `sprint-272` branch from `main` (`e1f4689`).
2. Land `TriggerInfo` (Rust + TS) + trait method defaults + PG override +
   `StubRdbAdapter` extension.
3. Add `list_triggers_inner` / `get_trigger_source_inner` + Tauri handlers
   with the probe reusing `ensure_expected_db`.
4. Add `listTriggers` / `getTriggerSource` TS wrappers.
5. Extend `schemaStore` with `triggers` slice + `getTableTriggers` +
   eviction.
6. Extend `treeRows.ts` NodeId with `trigger` variant; add Triggers child
   row + context-menu placeholder in `rows.tsx`.
7. Add Triggers sub-tab to `StructurePanel` with `hasFetchedTriggers` gate
   and `refresh-structure` listener.
8. Run all 6 gates (`cargo fmt --check`, `cargo clippy`, `cargo test`,
   `pnpm tsc --noEmit`, `pnpm lint`, `pnpm vitest run --no-file-parallelism`).
9. Manual sidebar smoke against fixtures PG with a seeded trigger.
10. Write `handoff.md` with per-gate tails + AC coverage table + manual
    smoke evidence.

## Ownership

- **Generator**: harness Generator agent.
- **Write scope**:
  - `src-tauri/src/models/schema.rs`
  - `src-tauri/src/db/traits.rs`
  - `src-tauri/src/db/postgres/schema.rs`
  - `src-tauri/src/commands/rdb/schema.rs`
  - `src-tauri/src/db/testing.rs`
  - `src/types/schema.ts`
  - `src/lib/tauri/schema.ts`
  - `src/stores/schemaStore.ts`
  - `src/components/schema/SchemaTree/treeRows.ts`
  - `src/components/schema/SchemaTree/rows.tsx`
  - `src/components/schema/StructurePanel.tsx`
  - Test files alongside each of the above
  - `docs/sprints/sprint-272/handoff.md` (created by Generator at end)
- **Merge order**: single slice (272 is the smallest of the 272/273/274
  trio; no sub-slicing required). One commit covering all of the above,
  Conventional Commits format, `feat(sprint-272): ...`.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- All 8 ACs (`AC-272-01` .. `AC-272-08`) evidenced in `handoff.md` with
  `file:line` citations: `yes`
- Sprint 271c `ensure_expected_db` probe byte-equivalent in both new
  `_inner` handlers: `yes`
- Phase 21–25 surfaces (Tables / Indexes / Constraints / Views / Functions)
  byte-equivalent — verified by unchanged passing tests: `yes`
- NO Sprint 273 / 274 surfaces landed in this contract: `yes`
