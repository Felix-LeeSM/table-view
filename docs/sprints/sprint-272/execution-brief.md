# Sprint Execution Brief: sprint-272

## Objective

Ship **Trigger READ** end-to-end (and only READ): backend `list_triggers` +
`get_trigger_source` introspection commands, TS wrappers, `schemaStore`
per-`(connId, db, schema, table)` trigger cache, a Triggers child node on
each Table in `SchemaTree`, and a read-only Triggers sub-tab in
`StructurePanel` that renders `pg_get_triggerdef`. PG-only. NO create / drop
UI, NO DDL emission — those are Sprint 273 / 274.

## Task Why

Phase 26 closes TablePlus parity item #6 (Trigger management). Sprint 272 is
the **foundation slice** for the 273 / 274 follow-ups: until the sidebar
surfaces existing triggers and the structure panel renders their definitions,
there is no read affordance to anchor Create / Drop wiring against. Landing
272 as a tight read-only slice also de-risks the bitmask decoder + cache
shape ahead of the larger CREATE form work in 273.

## Scope Boundary

**In scope** — read-only path only:

- `src-tauri/src/models/schema.rs` — `TriggerInfo` struct + serde
  roundtrip test.
- `src-tauri/src/db/traits.rs` — 2 new `RdbAdapter` methods with default
  `Ok(Vec::new())` / `Err(AppError::Unsupported)` impls.
- `src-tauri/src/db/postgres/schema.rs` — PG `list_triggers` SQL +
  `get_trigger_source` + tgtype bitmask decoder.
- `src-tauri/src/commands/rdb/schema.rs` — `list_triggers_inner` /
  `list_triggers` + `get_trigger_source_inner` / `get_trigger_source`
  Tauri handlers (both reuse Sprint 271c `ensure_expected_db` helper).
- `src-tauri/src/db/testing.rs` — `StubRdbAdapter` extension.
- `src/types/schema.ts` — `TriggerInfo` TS mirror.
- `src/lib/tauri/schema.ts` — `listTriggers` + `getTriggerSource` wrappers.
- `src/stores/schemaStore.ts` — `triggers` slice + `getTableTriggers` +
  eviction.
- `src/components/schema/SchemaTree/treeRows.ts` — `NodeId` `trigger`
  variant.
- `src/components/schema/SchemaTree/rows.tsx` — Triggers child row +
  context-menu placeholder.
- `src/components/schema/StructurePanel.tsx` — fourth sub-tab "Triggers".

**Out of scope** (explicitly deferred):

- **NO `CreateTriggerDialog`** — Sprint 273.
- **NO `DropTriggerDialog`** — Sprint 274.
- **NO `create_trigger` Tauri command / `_inner` / `CreateTriggerRequest`** —
  Sprint 273.
- **NO `drop_trigger` Tauri command / `_inner` / `DropTriggerRequest`** —
  Sprint 274.
- **NO PG SQL emitter for `CREATE TRIGGER` or `DROP TRIGGER`** in
  `src-tauri/src/db/postgres/mutations.rs` — 273/274.
- **NO `createTrigger` / `dropTrigger` TS wrappers** in
  `src/lib/tauri/ddl.ts` — 273/274.
- **NO opener wiring** in `useSchemaTreeActions` (`createTriggerDialog` /
  `dropTriggerDialog` slots) — 273/274.
- **NO `CreateTriggerDialogSlot` / `DropTriggerDialogSlot`** in
  `src/components/schema/SchemaTree/dialogs.tsx` — 273/274.
- **NO Function CREATE/EDIT UI** — deferred indefinitely (master spec § 7).
- **NO Event triggers, dependency graph, PL/pgSQL debugger, Mongo change
  streams, MySQL/SQLite triggers, trigger rename, enable/disable, TRUNCATE
  in any future CREATE dialog** — phase-wide deferred per master spec § 7.

## Invariants

- **Sprint 266 DbMismatch contract**: probe runs under
  `state.active_connections.lock().await`, coerces
  `current_database = None` to `""` via `unwrap_or_default()`, and returns
  `AppError::DbMismatch { expected, actual }` BEFORE the trait method is
  invoked. Frontend store mismatch path threads through
  `syncMismatchedActiveDb` **silently** (passive prefetch — no toast;
  mirrors Sprint 271a `getTableIndexes` / `getTableConstraints`).
- **Sprint 271c shared helper** (`ensure_expected_db` in
  `src-tauri/src/commands/rdb/mod.rs`): reused **unchanged** by both new
  `_inner` handlers. Probe call shape is `ensure_expected_db(adapter,
  expected_database).await?`, ordered exactly between
  `active.as_rdb()?` and the trait dispatch — byte-equivalent to the
  Sprint 271c reference in `list_functions_inner` / `get_function_source_inner`.
- **Sprint 214 `useDdlPreviewExecution`** (DDL preview-then-execute hook):
  NOT used in Sprint 272 because 272 ships no DDL. The hook source file
  remains byte-equivalent — only documenting here that 273 will reuse it.
- **schemaStore cache shape**: the new `triggers:
  ByConn<BySchema<ByTable<TriggerInfo[]>>>` slice slots into the existing
  cache layout (mirroring `tableColumnsCache` shape — see
  `src/stores/schemaStore.ts:50–56`). The three existing eviction sites
  (`clearForConnection`, `clearForWorkspace`, `evictSchemaForName`) gain a
  matching purge for `triggers` using the **existing**
  `deleteConn` / `deleteSchema` helpers — no new helpers introduced.
- **Phase 21–25 surfaces unchanged**: existing Columns / Indexes /
  Constraints / Views / Functions tabs in `StructurePanel` and their
  SchemaTree rows render byte-equivalent. `SubTab` enum is **extended**
  (not renamed) to `"columns" | "indexes" | "constraints" | "triggers"`.
- **Non-PG RDB adapters** default to `Ok(Vec::new())` for `list_triggers`
  and `Err(AppError::Unsupported(Paradigm::Relational))` for
  `get_trigger_source`. Document-paradigm adapters return
  `Err(AppError::Unsupported(Paradigm::Relational))` to match the rest of
  the schema introspection surface.

## Done Criteria

(Mirrors contract § Done Criteria.)

1. **AC-272-01** — `cargo test trigger_info_serde_roundtrip` passes; TS
   `TriggerInfo` exported from `src/types/schema.ts` matches the Rust
   `serde(rename_all = "camelCase")` wire shape.
2. **AC-272-02** — `cargo test list_triggers_inner_returns_pg_triggers`
   and `cargo test get_trigger_source_inner_returns_pg_get_triggerdef`
   pass. Probe call-site visible in both `_inner` bodies before the trait
   method dispatch.
3. **AC-272-03** — `src/lib/tauri/schema.ts` exports `listTriggers` and
   `getTriggerSource` with the wire shape
   `expected_database: expectedDatabase ?? null`; JSDoc references
   Sprint 272.
4. **AC-272-04** — `RdbAdapter::list_triggers` default impl returns
   `Ok(Vec::new())`; `RdbAdapter::get_trigger_source` default impl returns
   `Err(AppError::Unsupported(Paradigm::Relational))`. PG impl overrides
   both. `StubRdbAdapter` carries optional `list_triggers_fn` and
   `get_trigger_source_fn` setter helpers.
5. **AC-272-05** — vitest asserts `schemaStore.getTableTriggers` hits the
   cache on the second call (mocked `listTriggers` IPC invoked once);
   eviction helpers reset the slice without disturbing the existing
   `tables`/`views`/`functions` caches.
6. **AC-272-06** — SchemaTree Table row exposes a "Triggers" child
   affordance under the existing per-Table category layout; loading /
   empty / error states match Functions/Views; context-menu placeholder
   renders "View Source" enabled + "Create Trigger…" and "Drop…"
   **disabled** (wired in 273/274).
7. **AC-272-07** — `StructurePanel` `SubTab` enum extended with
   `"triggers"`; the new tab fetches via `getTableTriggers`, gates the
   empty state behind `hasFetchedTriggers`, renders the metadata row +
   `pg_get_triggerdef` monospace `<pre>` block, and re-fetches on the
   existing `refresh-structure` event.
8. **AC-272-08** — backend `cargo test` adds two mismatch-case tests
   (Sprint 271c panic-closure pattern: `current_database_fn = "X"`,
   trait method panics if called, caller passes `Some("Y")`, assert
   `AppError::DbMismatch`); bitmask decoder unit tests for ≥4
   representative tgtype values (e.g. `0x07`, `0x1A`, `0x47`, `0x21`);
   vitest case for `schemaStore` trigger cache (IPC mock invoked once on
   second call).

## Verification Plan

- **Profile**: `mixed`.
- **Required checks**:
  1. `cargo fmt --check`
  2. `cargo clippy --all-targets --all-features -- -D warnings`
  3. `cargo test` (capture new-test count delta vs `main` baseline `e1f4689`)
  4. `pnpm tsc --noEmit`
  5. `pnpm vitest run --no-file-parallelism` (capture count delta;
     monotonically non-decreasing)
  6. `pnpm lint`
  7. **Manual sidebar smoke** (`pnpm tauri dev`): expand a real Table that
     has ≥1 trigger → "Triggers" child row appears; open `StructurePanel`
     for that Table → "Triggers" sub-tab renders `pg_get_triggerdef`.
- **Required evidence**:
  - **Changed files** grouped by surface (models / traits / PG impl /
    commands / store / TS wrappers / UI), each with a one-line purpose.
  - **Per-gate command output** (final ~40 lines): `cargo fmt --check`,
    `cargo clippy`, `cargo test` (with new-test count delta),
    `pnpm tsc --noEmit`, `pnpm vitest run --no-file-parallelism` (with
    test count delta), `pnpm lint`.
  - **AC coverage table** with `file:line` citations for each AC
    (e.g. `AC-272-02` → `src-tauri/src/commands/rdb/schema.rs:NNN-MMM`
    for the probe block + trait dispatch).
  - **Manual smoke evidence** — screenshot or screen-recording reference
    of the sidebar Triggers child row + StructurePanel Triggers tab
    against the fixtures PG seed.

## Evidence To Return

- Changed files and purpose (grouped by surface).
- Checks run and outcomes (per-gate tails, deltas vs `main`).
- Done criteria coverage with evidence (AC coverage table with
  `file:line` citations).
- Assumptions made during implementation (e.g. TRUNCATE-only trigger
  handling — master spec § 6 allows decoder to skip the event OR filter
  the trigger out; Generator picks and documents).
- Residual risk or verification gaps (e.g. fixtures PG seed availability,
  manual-smoke environment notes).

## References

- **Contract**: `docs/sprints/sprint-272/contract.md`
- **Master spec**: `docs/sprints/sprint-272/spec.md` § 2 — Sprint 272
- **Probe helper**: `src-tauri/src/commands/rdb/mod.rs:50` —
  `ensure_expected_db` (Sprint 271c hoist)
- **Reference handlers** (probe shape to mirror):
  `src-tauri/src/commands/rdb/schema.rs:319-348` — `list_functions_inner` /
  `list_functions`; `src-tauri/src/commands/rdb/schema.rs:421-454` —
  `get_function_source_inner` / `get_function_source`.
- **PG style reference**: `src-tauri/src/db/postgres/schema.rs` —
  existing PG queries for functions/views.
- **Sync helper**: `src/lib/api/syncMismatchedActiveDb.ts` — Sprint 271a
  passive-prefetch extraction; reuse the silent (no-toast) path.
- **schemaStore cache shape**: `src/stores/schemaStore.ts:45-56` —
  `ByConn` / `BySchema` / `ByTable` shape; `:455+` —
  `clearForConnection` / `clearForWorkspace` / `evictSchemaForName`
  eviction sites.
- **NodeId variant**: `src/components/schema/SchemaTree/treeRows.ts:91-110`
  — existing `NodeId` union to extend with `trigger`.
- **Sub-tab pattern**: `src/components/schema/StructurePanel.tsx:27` —
  existing `SubTab` enum to extend with `"triggers"`.
- **Relevant files**:
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
