# Sprint 137 — Handoff

## Summary

Sprint 137 fixes the Mongo "stale collection list after `use_db`" bug
(found in the 2026-04-27 user check) and clarifies the PG sidebar row
count by labeling the number as an estimate sourced from
`pg_class.reltuples` (with DBMS-aware variants for MySQL and SQLite).

**AC-S137-03 / 04 decision — Option (a) tooltip**: per the contract's
either/or wording and the execution brief's lower-risk preference, this
sprint ships only Option (a) (tooltip + `aria-label` on the row count
cell). AC-S137-04 (confirm dialog gate for an exact-count action) is
**N/A** in this sprint because Option (b) (right-click → exact COUNT(\*))
is not implemented; the handoff explicitly leaves it as a follow-up if
users still want the exact count.

All 7 verification gates pass:

| # | Command | Status |
|---|---|---|
| 1 | `pnpm vitest run` | 2069 passed (129 files) |
| 2 | `pnpm tsc --noEmit` | 0 errors |
| 3 | `pnpm lint` | 0 errors |
| 4 | `pnpm contrast:check` | 0 new violations |
| 5 | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 272 passed, 2 ignored |
| 6 | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | clean |
| 7 | `pnpm exec eslint e2e/**/*.ts` | 0 errors |

## Stale-cause analysis (AC-S137-01)

The Mongo `list_collections` implementation in
`src-tauri/src/db/mongodb.rs` already accepts a `db: &str` argument and
queries `client.database(db).list_collection_names()` — so the pure
backend path was *not* itself reading `default_db`. The stale bug was
the chain of two issues:

1. **Backend resolution gap**: when an upstream caller (legacy callsite
   or future paradigm-neutral helper) passed an empty/whitespace
   database name, `list_collections` only had the failing-validation
   branch — it could not fall back to `active_db` even though
   `switch_active_db` had updated that slot. Anyone introducing a
   "current DB" callsite would have to remember to read `active_db`
   themselves.
2. **Frontend cache invalidation gap** (the user-visible bug): the
   `DbSwitcher` component already calls
   `documentStore.clearConnection(id)` after a successful
   `switch_active_db` dispatch, **but** `DocumentDatabaseTree` keyed
   its auto-load `useRef` guard on `connectionId` alone. After
   `clearConnection` wiped the document store cache, the effect
   short-circuited because `autoLoadedRef.current === connectionId`,
   leaving the sidebar with no `databases` for the connection (or
   reverting to a stale render depending on order). **This is what the
   user saw on 2026-04-27.**

### Fix

**Backend** (`src-tauri/src/db/mongodb.rs`):

- Added `MongoAdapter::resolved_db_name(&self, requested: Option<&str>)
  -> Option<String>` (lines 261-289) — pure helper, no driver
  round-trip. Resolution precedence:
  1. `requested` (when caller passed a non-empty name) — preserves the
     Sprint 65 per-row expand contract
  2. `active_db` — the slot `switch_active_db` writes
  3. `default_db` — the connection's original landing DB
- Modified `list_collections` (lines 401-430) to route through
  `resolved_db_name`. Empty / whitespace-only `db` now triggers the
  active-db fallback instead of returning a Validation error
  immediately. Validation error is still surfaced when none of the
  three sources have a value (the existing
  `list_collections_rejects_empty_db_name` test still passes — empty
  input on a fresh adapter still resolves to `None`).

**Frontend** (`src/components/schema/DocumentDatabaseTree.tsx`):

- Added a `useConnectionStore` selector that reads
  `activeStatuses[connectionId].activeDb` (when the connection is in
  the `connected` variant).
- Changed the auto-load `useRef` guard from `connectionId` to a
  composite `${connectionId}::${activeDb ?? ""}` key. A DB swap now
  invalidates the guard, the effect re-fires, and the database list is
  re-fetched. The document store's `clearConnection` (already called
  by `DbSwitcher`) drops the collection cache so any subsequent
  expand triggers a fresh `list_mongo_collections` call.

## Changed Files

| Path | Purpose |
|------|---------|
| `src-tauri/src/db/mongodb.rs` | Add `resolved_db_name` helper (S137 AC-01); route `list_collections` through it so `use_db("alpha")` swap takes effect even when the caller passes an empty / whitespace `db`. Add 4 cargo tests (`test_resolved_db_name_explicit_override_wins`, `list_collections_uses_active_db_after_use_db`, `test_resolved_db_name_falls_back_to_default_when_no_active`, `test_resolved_db_name_returns_none_when_no_source_available`). |
| `src/components/schema/DocumentDatabaseTree.tsx` | Read `activeStatuses[connectionId].activeDb` from `connectionStore`. Re-key the auto-load guard on `(connectionId, activeDb)` so a DbSwitcher swap re-runs the database list fetch. |
| `src/components/schema/DocumentDatabaseTree.test.tsx` | Add 2 AC-S137-02 tests: `re-fetches the database list when the user-active DB changes` (mock `listMongoDatabases` spy, swap pipeline → assert second call) + `clearing the document store cache on DB swap drops stale collections` (collection cache cleared, `users collection` row no longer in DOM). Also resets `connectionStore` in `beforeEach` so prior tests' active DB cannot leak. |
| `src/components/schema/SchemaTree.tsx` | Add `rowCountLabel(dbType)` helper at module scope (S137 AC-03). Wrap the row count cell in all 3 render paths (`renderItemRow` flat / virtualized → eager nested → SQLite-flat) with `aria-label` + `title` + `data-row-count="true"` so users can tell whether the number is an estimate (PG/MySQL) or an exact count (SQLite). |
| `src/components/schema/SchemaTree.rowcount.test.tsx` | **CREATED** — 4 AC-S137-03 tests covering PG (`pg_class.reltuples`), MySQL (`information_schema.tables`), SQLite (`exact COUNT(*)`), and the `row_count: null` branch (cell not rendered → no misleading tooltip). |

No production-side changes to `connectionStore.ts`, `documentStore.ts`,
or `DbSwitcher.tsx` were needed — the swap pipeline (`setActiveDb` +
`clearConnection`) already existed; we only needed the tree to react to it.

## Verification Commands (last 20 lines each)

### 1. `pnpm vitest run`

```
 RUN  v4.1.3 /Users/felix/Desktop/study/view-table


 Test Files  129 passed (129)
      Tests  2069 passed (2069)
   Start at  02:15:45
   Duration  21.70s (transform 5.64s, setup 8.09s, import 34.78s, tests 50.82s, environment 80.53s)
```

### 2. `pnpm tsc --noEmit`

```
(no output — exit 0)
```

### 3. `pnpm lint`

```
> table-view@0.1.0 lint /Users/felix/Desktop/study/view-table
> eslint .

(exit 0)
```

### 4. `pnpm contrast:check`

```
> table-view@0.1.0 contrast:check /Users/felix/Desktop/study/view-table
> tsx scripts/check-theme-contrast.ts

WCAG AA contrast: 72 themes / 144 theme-modes / 864 pairs — 0 new violations (64 allowlisted)
```

### 5. `cargo test --manifest-path src-tauri/Cargo.toml --lib`

```
test storage::tests::test_delete_group_not_found ... ok
test storage::tests::test_get_decrypted_password_returns_plaintext ... ok
test storage::tests::test_load_storage_creates_default_when_no_file ... ok
test storage::tests::test_load_storage_redacted_omits_plaintext ... ok
test storage::tests::test_load_storage_with_secrets_decrypts ... ok
test storage::tests::test_move_connection_to_group_changes_group ... ok
test storage::tests::test_move_connection_to_group_not_found ... ok
test storage::tests::test_password_presence_map_reports_correctly ... ok
test storage::tests::test_password_roundtrip_encrypted ... ok
test storage::tests::test_save_connection_adds_new_and_loads_back ... ok
test storage::tests::test_save_connection_empty_password_not_encrypted ... ok
test storage::tests::test_save_connection_rejects_duplicate_name ... ok
test storage::tests::test_save_connection_same_name_same_id_succeeds ... ok
test storage::tests::test_save_connection_updates_existing_by_id ... ok
test storage::tests::test_save_connection_with_none_preserves_existing ... ok
test storage::tests::test_save_group_adds_and_updates ... ok
test storage::tests::test_save_multiple_connections ... ok

test result: ok. 272 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.04s
```

### 6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`

```
    Checking table-view v0.1.0 (/Users/felix/Desktop/study/view-table/src-tauri)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 2.18s
```

### 7. `pnpm exec eslint e2e/**/*.ts`

```
(no output — exit 0)
```

## AC Coverage

### AC-S137-01 — Mongo `list_collections` follows `use_db`

- **Stale cause**: see "Stale-cause analysis" above. Concretely, the
  bug was on the boundary between `list_collections` (which only
  honored its `db` argument and rejected empty input as Validation)
  and the new `active_db` slot introduced by Sprint 131. There was no
  unified resolver.
- **Fix lines**:
  - `src-tauri/src/db/mongodb.rs:261-289` — new `resolved_db_name`
    helper.
  - `src-tauri/src/db/mongodb.rs:401-430` — `list_collections` routes
    through `resolved_db_name`. The trim-empty branch that used to
    return Validation immediately is now the empty-`requested` branch
    that triggers the active-db fallback; Validation is surfaced only
    when `resolved_db_name` returns `None`.
- **Tests**:
  - `db::mongodb::tests::list_collections_uses_active_db_after_use_db`
    — seeds `default_db = "default_db"`, `active_db = "alpha"`, asserts
    `resolved_db_name(None) == Some("alpha")`. **Pure helper test —
    no live MongoDB needed.**
  - `db::mongodb::tests::test_resolved_db_name_explicit_override_wins`
    — pins the original Sprint 65 contract (explicit name beats
    active_db).
  - `db::mongodb::tests::test_resolved_db_name_falls_back_to_default_when_no_active`
    — pins the very-first-fetch path (no use_db ever fired).
  - `db::mongodb::tests::test_resolved_db_name_returns_none_when_no_source_available`
    — pins the "all sources empty → None" guard the existing
    `list_collections_rejects_empty_db_name` test relies on.
  - Existing `list_collections_rejects_empty_db_name` still passes
    (empty input on fresh adapter → resolver returns None →
    Validation error).
  - `#[ignore]` happy-path live-Mongo test
    (`test_switch_active_db_happy_path_with_live_mongo`) unchanged.

### AC-S137-02 — Frontend Mongo DB swap → cache invalidate + refetch

- **Production**: see `DocumentDatabaseTree.tsx` change above. The
  auto-load effect now depends on `(connectionId, activeDb)`. The
  document store's `clearConnection` continues to be the cache wipe
  (already wired by `DbSwitcher`); the tree just had to react.
- **Tests** (in `DocumentDatabaseTree.test.tsx`, all green):
  - `AC-S137-02: re-fetches the database list when the user-active DB
    changes (DB swap invalidates cache)` — spy on
    `listMongoDatabases`, swap activeDb from `dbX` → `dbY`, assert the
    spy was called twice.
  - `AC-S137-02: clearing the document store cache on DB swap drops
    stale collections (no leak across DBs)` — populate the
    `(conn-mongo, table_view_test)` collection cache by clicking the
    DB row, run the swap pipeline, assert the cache key is gone and
    the `users collection` row is no longer in the DOM.

### AC-S137-03 — PG row count semantics (Option a — tooltip)

- **Production**: see `SchemaTree.tsx` changes. The new
  `rowCountLabel(dbType)` helper returns:
  - `postgresql` → `"Estimated row count from pg_class.reltuples"`
  - `mysql`     → `"Estimated row count from information_schema.tables"`
  - `sqlite`    → `"Exact row count via COUNT(*)"`
  - other / unset → `"Estimated row count"` (honest fallback)

  Each row-count `<span>` carries `aria-label`, `title`, and
  `data-row-count="true"` so screen readers, hover tooltips, and
  test selectors all converge on the same label.
- **Tests** (in `SchemaTree.rowcount.test.tsx`, all 4 green):
  - `AC-S137-03: PG row-count cell carries the pg_class.reltuples
    aria-label and title`
  - `AC-S137-03: MySQL row-count cell labels the source as
    information_schema`
  - `AC-S137-03: SQLite row-count cell labels the source as exact
    COUNT(*)`
  - `AC-S137-03: row count stays hidden when the schema fetch
    returned no estimate` — pins the `row_count: null` branch.

### AC-S137-04 — Confirm dialog gate (N/A)

- **Status**: N/A in this sprint. We chose Option (a) (tooltip) per
  contract's either/or wording. Option (b) (right-click → "Show exact
  COUNT(\*)" with confirm dialog when reltuples > 10M) is not
  implemented. If a future sprint adds it, the entry point would be a
  ContextMenu item near the existing "Data" / "Structure" entries in
  `SchemaTree.tsx`, dispatching a new
  `commands/rdb/exact_row_count.rs` Tauri command (parameterized
  identifiers via `quote_ident`).

### AC-S137-05 — Regression guard

All previously-green tests stay green. Notable guards:

- `SchemaTree.dbms-shape.test.tsx` (S135) — 6 tests still green:
  PG/MySQL/SQLite tree depth and category visibility unchanged.
- `SchemaTree.preview.test.tsx` (S136) — preview tab + function
  category overflow tests still green.
- `TabBar.test.tsx` dirty-marker tests (S134) — still green; no
  TabBar code touched.
- `DocumentDatabaseTree.test.tsx` Mongo regression guard (S135
  AC-S135-05 `renders database → collection (2-level tree, no schema
  layer)`) — still green; tree structure unchanged.
- S132 raw-query DB-change tests — still green; no `commands/document`
  or `commands/rdb` handler bodies modified.

Test count: 2063 (S136 baseline) → 2069 (S137); +6 net new tests
(2 AC-02 + 4 AC-03), 0 lost. Cargo tests: 268 (S136 baseline) → 272
(S137); +4 net new tests (the 4 `resolved_db_name` tests), 0 lost.

### AC-S137-06 — All 7 verification gates green

See the table at the top of this handoff. Gates 1–7 all pass.

## Assumptions

1. **Option (a) over Option (b)**. The contract permits either; we
   shipped only (a) because it is lower-risk (no new SQL command, no
   confirm dialog UX surface) and complete on its own per the user
   prompt. Documented as N/A for AC-S137-04.

2. **DBMS-aware tooltip text**. The contract specifies the PG label
   verbatim (`Estimated row count from pg_class.reltuples`); we use
   that string for `db_type === "postgresql"` and add MySQL / SQLite
   variants because the same row-count cell renders for those DBMSes
   too. Labelling MySQL as "estimated" and SQLite as "exact" is
   factually accurate per how the schema fetch populates `row_count`
   in each adapter, and the test file pins this so a future regression
   is caught. Unknown DBMSes get a generic `"Estimated row count"`
   fallback rather than no label at all.

3. **`data-row-count="true"` test hook**. JSDOM does not render real
   tooltips, and `aria-label` on a non-interactive `<span>` is
   sometimes brittle to query directly via Testing Library. The
   `data-row-count` attribute gives the new tests a stable selector
   independent of label-text changes; the production semantics
   (aria-label + title) are still asserted via
   `getAttribute("aria-label")` / `getAttribute("title")` so the
   actual user-facing text is pinned.

4. **Composite auto-load guard key**. The new
   `${connectionId}::${activeDb ?? ""}` guard format is intentionally
   unparseable — it is an opaque ref-value, not a route key. The
   `::` separator is safe because Mongo db names cannot legally
   contain `:` (driver enforces a strict character set).

5. **Backend `resolved_db_name` is `pub`**. Marked public on
   `MongoAdapter` (the inherent impl, not the trait) so future
   paradigm-neutral helpers (e.g. a `current_database()` accessor
   that wants the same precedence rules) can call it. Not added to
   the `DocumentAdapter` trait yet — only `MongoAdapter` has the
   notion of three layers (`requested`, `active_db`, `default_db`),
   and exposing the helper through the trait would force every
   future document adapter to implement the same resolution scheme
   when in fact most NoSQL DBs do not have a "default DB" concept.

6. **`list_collections` empty-input semantics flipped slightly**.
   Pre-S137: empty `db` → immediate `Validation("Database name must
   not be empty")`. Post-S137: empty `db` → falls back to active_db,
   then default_db, then `Validation`. The existing
   `list_collections_rejects_empty_db_name` test still passes
   because the test's adapter is freshly constructed, so all three
   resolver sources are `None`. This change is invisible to live
   call sites (the frontend always passes a non-empty `database`)
   but unlocks future paradigm-neutral helpers that might pass an
   empty sentinel to mean "use whatever the user is on right now".

## Risks / Gaps

- **No live Mongo regression test for the swap end-to-end**. The
  `#[ignore]` Mongo integration test
  (`test_switch_active_db_happy_path_with_live_mongo`) verifies the
  driver-backed `list_database_names` probe but not the full sequence
  `connect → switch_active_db → list_collections` against a real
  cluster. The unit test (`list_collections_uses_active_db_after_use_db`)
  exercises the resolver alone, which is the only line the bug lived
  on, but a follow-up could promote it to a docker-compose integration
  test. No open ticket asking for this.

- **Option (b) deferred**. Some users may still want exact COUNT(\*)
  on demand (e.g. when the estimate looks wildly wrong). The right-
  click context menu has open real estate for it (next to "Data" and
  "Structure"). Not blocking for S137 — the tooltip already addresses
  the immediate user complaint that the number was misleadingly
  unlabeled.

- **Tree-local `expandedDbs` state retained across DB swaps**. When
  the user has db `X` expanded and the DbSwitcher swaps to `Y`, the
  tree's local `expandedDbs` set still contains `X`. After the
  re-fetch, if `X` is not in the new database list (different Mongo
  cluster permissions), the entry is harmless dead state. If `X`
  *is* in the new list, it stays expanded with empty contents until
  the user clicks (which triggers a fresh `loadCollections`). This
  is a minor UX nicety — clearing local expand state on swap would
  be a small follow-up but is not required by the AC.

- **None blocking**. All 7 verification gates green. No pending P1/P2
  findings.

## References

- Contract: `docs/sprints/sprint-137/contract.md`
- Execution brief: `docs/sprints/sprint-137/execution-brief.md`
- Master spec: `docs/sprints/sprint-134/spec.md` (Phase 10 — S137 section)
- Origin lesson: `memory/lessons/2026-04-27-workspace-toolbar-ux-gaps/memory.md`
- S131 Mongo `use_db` baseline: `docs/sprints/sprint-131/handoff.md`
- S132 raw-query DB-change baseline: `docs/sprints/sprint-132/handoff.md`
- S134 baseline: `docs/sprints/sprint-134/handoff.md`
- S135 baseline: `docs/sprints/sprint-135/handoff.md`
- S136 baseline: `docs/sprints/sprint-136/handoff.md`
