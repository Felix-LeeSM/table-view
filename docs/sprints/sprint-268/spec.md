# Feature Spec: Sprint 267 Followup — 4-Sub-Sprint Cleanup (Sprint 268–271)

## Description

Sprint 267 closed the DbMismatch UX gap and the `switch_active_db` serialization
invariant, but left four residual items: Sprint 264 OoS #1 (intra-DB autocomplete
collision), Sprint 267 OoS #1 (passive mismatch toast — no explicit Retry),
Sprint 175's retired AC ≥30% cold-boot target, and Sprint 266 OoS #1
(`expected_database` guard exists only on `execute_query`). This feature wraps
those up in dependency order, each as its own integer sprint.

## Sprint Breakdown

### Sprint 268: Autocomplete cache schema-qualification

**Goal**: Eliminate last-writer-wins collision in `useSqlAutocomplete`'s column
lookup when two schemas in the same DB hold a table of the same name
(`public.users` vs `auth.users`). After this sprint, autocomplete for `SELECT`,
`UPDATE SET`, `INSERT cols`, `WHERE`, and `JOIN ON` returns columns from the
schema the user actually qualified — and surfaces a deterministic ambiguity
policy when the user typed an unqualified name.

**Verification Profile**: command (vitest)

**Acceptance Criteria**:

1. **AC-268-01 — collision regression test**: A vitest case mounts the
   autocomplete hook against a fixture in which `(connId="c1", db="db1")` holds
   both `public.users {id, name}` and `auth.users {id, login_ip}`. Looking up
   `ns["public.users"]` exposes only `{id, name}`; looking up `ns["auth.users"]`
   exposes only `{id, login_ip}`. The current implementation lets the
   second-loaded schema overwrite the bare `ns["users"]` key — the new test
   must FAIL on `a3f7efc` and PASS after the fix.

2. **AC-268-02 — unqualified key behaviour is specified**: For a bare lookup
   (`ns["users"]`) when the same DB holds multiple schemas with the table, the
   hook returns the union of column candidates (deduped by column name) OR
   registers no bare entry at all when ambiguous — exactly one policy is chosen
   and documented in a comment, with a vitest case that pins it. The
   "single-writer-wins" behaviour must NOT survive.

3. **AC-268-03 — single-schema parity preserved**: When `(connId="c1", db="db1")`
   has `public.users` only, `ns["users"]` and `ns["public.users"]` both expose
   `{id, name}` exactly as today. Existing Sprint 264 cross-DB isolation cases
   keep passing unchanged.

4. **AC-268-04 — fully-quoted aliasing follows the same rule**: For a Postgres
   dialect mount, `ns['"public"."users"']` and `ns['"auth"."users"']` return
   their schema-correct column sets (not the cross-schema overwrite).

5. **AC-268-05 — regression gate**: `pnpm vitest run --no-file-parallelism`
   baseline preserved (≥ Sprint 267 count plus new cases), `pnpm tsc --noEmit`,
   `pnpm lint` all clean.

**Components to Create/Modify**:
- `src/hooks/useSqlAutocomplete.ts`: change `cachedColumnsByName` (line ~183)
  from `Record<tableName, ColumnInfo[]>` into a shape that preserves schema
  identity; update both bare-name and schema-qualified registration paths so
  the bare path applies the chosen ambiguity policy.
- `src/hooks/useSqlAutocomplete.test.ts`: add the 4 cases above.

---

### Sprint 269: DbMismatch toast Retry button

**Goal**: Convert the passive "Active DB synced to 'X'. Re-run the query if
needed." toast (Sprint 267 AC-267-02) into an actionable toast with an explicit
Retry button that re-dispatches the same query against the now-synced
`activeDb`.

**Verification Profile**: command (vitest)

**Acceptance Criteria**:

1. **AC-269-01 — Retry button visible on mismatch toast**: When
   `syncMismatchedActiveDb` fires after a backend `DbMismatch`, the toast
   surface renders a clickable "Retry" affordance alongside the message. The
   toast remains visible until either the auto-dismiss timeout expires OR the
   user clicks Retry / dismiss.

2. **AC-269-02 — Retry re-runs the same statement**: Clicking Retry
   re-dispatches the exact SQL the user originally executed (single-statement
   path) or the exact batch (multi-statement path) against the same tab. After
   Retry, the tab's query state transitions to `running`, then to `success` or
   `error`. The frontend store's `activeDb` is already synced, so the retry's
   `expected_database` matches — verified by absence of a second `DbMismatch`.

3. **AC-269-03 — Retry availability lifetime**: Retry is only clickable while
   the toast is visible. Repeated clicks during dispatch are ignored (no
   double-fire).

4. **AC-269-04 — Non-mismatch errors are unchanged**: Existing query failures
   that are not `DbMismatch` continue to render without a Retry button.

5. **AC-269-05 — Regression gate**: vitest + tsc + lint clean; cargo unchanged.

**Components to Create/Modify**:
- Toast plumbing (sonner-based or project's wrapper) — extend with optional
  `action: { label: string; onClick: () => void }` shape.
- `src/components/query/QueryTab/useQueryExecution.ts`: when the catch detects
  `parseDbMismatch`, capture the originating `stmt` / `statements` + dispatch
  closure, then push the toast with a Retry action that invokes
  `runRdbSingleNow(stmt)` or `runRdbBatchNow(statements, joinedSql)` after the
  sync completes.
- Test files cover action button shape, click-dispatch path, and Sprint 267
  specificity gate.

---

### Sprint 270: Cold-boot skeleton placeholders (perceived performance)

**Goal**: Replace the empty pre-hydrate render of the sidebar and main area
with skeleton placeholders so the user sees app chrome immediately on first
paint instead of a blank window during the IPC round-trip that populates
`connections`. Sprint 175 closed measured cold-boot at 1404 ms with the AC
unmet (≥30% improvement); this sprint targets perceived performance via
visible activity at first paint.

**Verification Profile**: mixed (vitest render-order + browser visual)

**Acceptance Criteria**:

1. **AC-270-01 — Sidebar skeleton at first paint**: Before `loadConnections`
   completes (i.e. while `connections` is empty AND the initial hydration has
   not yet returned), the sidebar column renders skeleton placeholders
   (rectangular shimmer blocks) representing 3–6 connection rows. The current
   "No connections yet" empty card is NOT shown during this window; it only
   renders after hydration confirms `connections.length === 0`.

2. **AC-270-02 — Main area skeleton at first paint**: While the workspace is
   in its pre-hydrate state AND there is no active tab, the main area renders
   skeleton placeholders shaped roughly like the welcome / empty card. After
   hydration completes, the real `EmptyState` swaps in.

3. **AC-270-03 — Swap to real content is smooth**: When hydration completes,
   the skeletons disappear and the real component mounts. There is no flash
   of an intermediate "empty" state. Verified by a vitest case that mounts the
   workspace under a delayed-resolve mock for `loadConnections` and asserts
   the skeleton → content transition order.

4. **AC-270-04 — Post-hydrate behaviour unchanged**: After hydration, all
   existing sidebar / main-area behaviour is byte-equivalent. When hydration
   is already complete, skeletons must NOT re-render.

5. **AC-270-05 — Regression gate**: vitest + tsc + lint clean. Cold-boot
   summary line values are not required to change — success criterion is the
   visible skeleton at first paint, not a numerical measurement.

**Components to Create/Modify**:
- `src/components/ui/skeleton.tsx`: shadcn/ui Skeleton primitive if not
  already vendored.
- Sidebar component(s) covering the pre-hydrate branch.
- Main area / EmptyState wrapper distinguishing pre-hydrate vs post-hydrate.
- `src/stores/connectionStore.ts`: expose an observable `hasLoadedOnce`
  boolean flipped to `true` at the end of `loadConnections` (success or error).
- Test files for skeleton render, swap order, post-hydrate non-re-render.

---

### Sprint 271: Propagate `expected_database` guard to remaining RDB commands

**Goal**: Apply Sprint 266's opt-in `expected_database` guard pattern to every
remaining RDB introspection / data Tauri command so a tab whose backend pool
was swapped between user click and dispatch cannot return schema or data from
the wrong database. Mismatch surfaces as `AppError::DbMismatch` and reuses the
Sprint 267 + Sprint 269 sync + Retry flow.

**Verification Profile**: mixed (cargo test + vitest + audit checklist)

**Acceptance Criteria**:

1. **AC-271-01 — Audit checklist published**: A static enumeration of every
   RDB command in `src-tauri/src/commands/rdb/{schema,query,ddl}.rs` (or
   wherever they reside) is included in the sprint contract. Each row marks:
   (a) already guarded by Sprint 266, (b) added in this sprint, or (c)
   intentionally skipped with rationale. Minimum coverage: `list_schemas`,
   `list_tables`, `get_table_columns`, `list_schema_columns`,
   `get_table_indexes`, `get_table_constraints`, `list_views`,
   `list_functions`, `get_view_definition`, `get_view_columns`,
   `get_function_source`, `list_postgres_types`, `query_table_data`,
   `execute_query_dry_run`, and the DDL handlers.

2. **AC-271-02 — Backend handler accepts `expected_database`**: Every command
   marked (b) accepts an optional `expected_database: Option<String>`
   parameter. When `None`, behaviour is byte-equivalent to pre-sprint. When
   `Some(expected)`, the handler probes `adapter.current_database().await`
   inside the same `active_connections` lock acquisition and returns
   `AppError::DbMismatch { expected, actual }` when they diverge — before any
   concrete IPC effect runs.

3. **AC-271-03 — Tauri command + TS wrapper exposes the opt-in parameter**:
   For each migrated command, the `#[tauri::command]` signature, the TS
   wrapper, and the wrapper's JSDoc all carry the new parameter as an optional
   last-positional `expectedDatabase?: string`. Existing call sites compile
   unchanged.

4. **AC-271-04 — Callers forward the active db**: Every store / hook that
   calls a migrated wrapper forwards the relevant `(connId, db)` coordinate
   as `expectedDatabase`.

5. **AC-271-05 — Mismatch surfaces reuse the Sprint 267 sync helper**: When
   any migrated command rejects with `AppError::DbMismatch`, callers route
   through `syncMismatchedActiveDb` (or an equivalent shared helper if
   extracted). Sprint 269's Retry surface is reused where the call site is
   user-initiated; fully-automated calls are sync-only.

6. **AC-271-06 — Backend regression tests**: Each migrated command's `tests`
   module gains at least one mismatch case: when the adapter reports
   `current_database = "X"` and the call passes `expected_database = Some("Y")`,
   the handler returns `AppError::DbMismatch { expected: "Y", actual: "X" }`
   and does NOT invoke the underlying trait method.

7. **AC-271-07 — Frontend integration tests**: At least one vitest case per
   migrated caller layer (introspection, table data, DDL) exercises the
   mismatch path end-to-end.

8. **AC-271-08 — Sub-slicing allowed**: If the migration cannot land in a
   single landable PR, the Generator may split Sprint 271 into ordered slices
   under a single sprint folder. Each slice individually passes all gates.

9. **AC-271-09 — Regression gate**: `pnpm vitest run --no-file-parallelism`,
   `pnpm tsc --noEmit`, `pnpm lint`,
   `cargo clippy --all-targets --all-features -- -D warnings`,
   `cargo test` all pass.

**Components to Create/Modify**: Backend handlers in `src-tauri/src/commands/rdb/`,
TS wrappers in `src/lib/tauri/`, caller stores/hooks, backend + frontend tests,
optional helper extraction `src/lib/api/syncMismatchedActiveDb.ts`.

---

## Global Acceptance Criteria (apply across all four sub-sprints)

1. Every sub-sprint passes `pnpm vitest run --no-file-parallelism`,
   `pnpm tsc --noEmit`, `pnpm lint`. Sub-sprints with backend changes
   additionally pass `cargo clippy --all-targets --all-features -- -D warnings`
   and `cargo test`. vitest case count baseline is monotonically
   non-decreasing.
2. No new ADR. Sprint 268 closes Sprint 264 OoS #1; Sprint 269 closes Sprint
   267 OoS #1; Sprint 270 closes Sprint 175 perceived-performance gap; Sprint
   271 closes Sprint 266 OoS #1.
3. Each sub-sprint's commit follows Conventional Commits and the sprint-folder
   naming rule.
4. No `unwrap()` (Rust), no `any` (TypeScript), no `console.log` shipped.

## Data Flow

### Sprint 268
`schemaStore.tableColumnsCache[connId][db][schema][table]` → `useSqlAutocomplete`
rebuilds `cachedColumnsByName` per schema → CodeMirror `SQLNamespace`. New
shape preserves schema in the cache lookup so `pickColumns(objectName, qualified)`
returns the schema-correct set.

### Sprint 269
Backend `AppError::DbMismatch` → catch in `useQueryExecution` →
`parseDbMismatch` → `syncMismatchedActiveDb` → toast with `action: { Retry, onClick }`.
User click → re-invoke `runRdbSingleNow(stmt)` / `runRdbBatchNow(stmts, joinedSql)`
exactly as original dispatch, except `workspaceDb` is now synced.

### Sprint 270
First paint: `connections === []` AND `hasLoadedOnce === false` → skeleton
variants. `loadConnections` resolves → `hasLoadedOnce = true` and `connections`
populated → React rerenders → skeleton swaps.

### Sprint 271
Caller reads `(connId, db)` → passes `db` as `expectedDatabase` to TS wrapper
→ wrapper forwards as `expected_database: db ?? null` to `invoke` → handler
probes `adapter.current_database()` under lock → match: proceed; mismatch:
return `AppError::DbMismatch`. Frontend catches → `parseDbMismatch` →
`syncMismatchedActiveDb`.

## Edge Cases

### Sprint 268
- Three or more same-named tables across schemas in the same DB — chosen
  policy scales beyond two.
- Same table name AND a view with the same name in another schema — fix must
  not regress view exposure or accidentally union views and tables.
- Identifier case sensitivity (Postgres mixed-case) — quoted alias lookup
  preserves schema identity.

### Sprint 269
- Toast already dismissed before sync completes — fire-and-forget; no retry
  if `verifyActiveDb` failed.
- User clicks Retry twice rapidly — guarded by running-state check on the tab.
- Multi-statement batch where only one statement triggered mismatch — Retry
  re-runs the entire batch.
- Tab closed before Retry click — retry closure guards with
  `useWorkspaceStore.getState()` lookup that no-ops on missing tab.

### Sprint 270
- Connections already persisted (warm second mount, e.g. Back-to-Connections
  re-entry) — `hasLoadedOnce` persists; skeletons do not re-flash.
- `loadConnections` rejects — skeleton swaps to error state, NOT empty card.
  `hasLoadedOnce` flips on error too.
- Very fast hydration (< 50ms) — skeleton may render for a single frame and
  disappear. Acceptable.
- Persisted-only connection (no active) — post-hydrate falls through to
  `EmptyState` as today.

### Sprint 271
- Adapter reports `current_database = None` — `unwrap_or_default()` to `""`.
- DDL handler with saturated Request struct — Generator may add
  `expected_database` to the struct (Serde `#[serde(default)]`) or as a
  sibling param to `#[tauri::command]`. Choice documented per slice.
- `cancel_query` is db-agnostic — audit marks (c) and skips. Same for
  `verify_active_db`.
- Concurrent swap mid-introspection — Sprint 267 invariant
  (`active_connections.lock()`) holds.
- Document-paradigm reuse — `as_rdb()?` guard rejects document connections
  before the probe runs.

## Visual Direction (Sprint 270 only)

Skeleton aesthetic mirrors shadcn/ui's Skeleton primitive — neutral muted
background, low-contrast pulse animation, no spinner. Sidebar: vertically
stacked rectangles ~32 px height, ~80% column width. Main area: square block
for the logo (~80×80), two line blocks for the message (60% and 40% widths),
a button-sized block. Animation subtle. Dark and light theme variants both
meet the same contrast target as existing `border-border` and `bg-muted`.

## Verification Hints

- **Sprint 268**: `pnpm vitest run src/hooks/useSqlAutocomplete.test.ts`.
- **Sprint 269**: vitest in `src/components/query/QueryTab.dbMismatch.test.tsx`
  asserts a Retry button mounts inside the toast and re-invokes
  `executeQuery` on click.
- **Sprint 270**: vitest with delayed-resolve `loadConnections` mock asserts
  the render order; manual browser verification under devtools network
  throttle.
- **Sprint 271**: `cargo test commands::rdb` for backend mismatch cases plus
  `pnpm vitest run` for caller-layer integration.
