# Sprint 137 Evaluation

## Independent Verification

Each command was re-run from a clean shell against the exact tree the
Generator handed off. Last 20 lines of each captured below.

### 1. `pnpm vitest run`

```
 RUN  v4.1.3 /Users/felix/Desktop/study/view-table


 Test Files  129 passed (129)
      Tests  2069 passed (2069)
   Start at  02:20:24
   Duration  21.38s (transform 5.43s, setup 8.22s, import 34.75s, tests 50.45s, environment 77.63s)
```

### 2. `pnpm tsc --noEmit`

```
(no output — exit 0)
```

### 3. `pnpm lint`

```
> table-view@0.1.0 lint /Users/felix/Desktop/study/view-table
> eslint .

(no warnings — exit 0)
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

test result: ok. 272 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.03s
```

Targeted `mongodb::*` re-run confirmed all four new tests pass:

```
test db::mongodb::tests::list_collections_uses_active_db_after_use_db ... ok
test db::mongodb::tests::test_resolved_db_name_explicit_override_wins ... ok
test db::mongodb::tests::test_resolved_db_name_falls_back_to_default_when_no_active ... ok
test db::mongodb::tests::test_resolved_db_name_returns_none_when_no_source_available ... ok
```

### 6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`

```
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.32s
```

### 7. `pnpm exec eslint e2e/**/*.ts`

```
(no output — exit 0)
```

## AC Verdict

| AC | Verdict | Evidence |
|---|---|---|
| AC-S137-01 | PASS | `mongodb.rs:290-304` adds `resolved_db_name` (precedence: requested → active_db → default_db). `list_collections` (line 430-437) routes through it: empty/whitespace `db` falls back to active_db instead of returning `Validation` immediately. `list_collections_uses_active_db_after_use_db` test seeds `default_db="default_db"` + `active_db="alpha"` and asserts `resolved_db_name(None) == Some("alpha")`. The pre-existing `list_collections_rejects_empty_db_name` still passes (fresh adapter → all sources None → Validation surfaced). See "Stale-cause" note below. |
| AC-S137-02 | PASS | `DocumentDatabaseTree.tsx:53-56` reads `activeStatuses[connectionId].activeDb`. Auto-load guard re-keyed to `${connectionId}::${activeDb ?? ""}` (line 77). Two new tests in `DocumentDatabaseTree.test.tsx`: `re-fetches the database list when the user-active DB changes` (asserts `listMongoDatabases` called twice across a swap) + `clearing the document store cache on DB swap drops stale collections` (asserts cache key `conn-mongo:table_view_test` is `undefined` after swap and `users collection` row absent from DOM). `beforeEach` resets `connectionStore` to prevent cross-test leak. |
| AC-S137-03 | PASS | `SchemaTree.tsx:60-73` adds `rowCountLabel(dbType)` returning DBMS-specific strings: PG="Estimated row count from pg_class.reltuples", MySQL="Estimated row count from information_schema.tables", SQLite="Exact row count via COUNT(*)", default="Estimated row count". Wrapped on all 3 render paths (lines 1050-1057, 1366-1370, 1712-1720) — flat, eager-nested, and SQLite-flat. Each cell carries `aria-label` + `title` + `data-row-count="true"`. 4 new tests in `SchemaTree.rowcount.test.tsx` pin each branch, including the `row_count: null` suppression. |
| AC-S137-04 | N/A (DECLARED) | Generator chose Option (a) tooltip per the contract's "둘 중 하나" wording. Handoff explicitly marks AC-04 N/A. Contract permits this — line 42 says "옵션 (a) 만 선택 시 N/A로 명시". |
| AC-S137-05 | PASS | `SchemaTree.dbms-shape.test.tsx` (S135 6 tests) + `SchemaTree.preview.test.tsx` (S136) + `DocumentDatabaseTree.test.tsx` AC-S135-05 guard all green. `commands/document` and `commands/rdb` handler bodies untouched, so S132 raw-query DB-change detection unchanged. Test count: 2063 → 2069 (+6 net). Cargo: 268 → 272 (+4). |
| AC-S137-06 | PASS | All 7 verification commands green (see "Independent Verification" above). |

## Scorecard

| Dimension | Score | Notes |
|---|---|---|
| Correctness | 8/10 | Backend `resolved_db_name` precedence is sound and matches the documented contract: explicit override → active_db → default_db. The frontend cache-invalidation fix correctly diagnoses the user-visible bug (auto-load guard short-circuit; verified by reading `DbSwitcher.tsx:188` which already calls `clearConnection`). The composite key `${id}::${activeDb ?? ""}` is well-chosen for stability across `null`/`""` transitions. **However**: per the master-spec-quoted symptom ("uses stored default db, not the value `use_db` set"), the *real* live-app callsite for `list_collections` always passes a non-empty `db` from the user-clicked row, so the backend `resolved_db_name` change is defensive-not-curative. Generator's stale-cause analysis is honest about this in the handoff. The fix is still correct; it is just slightly mis-targeted vs. how the contract phrased AC-01. Not docking heavily because the user-visible behavior is fixed by the AC-02 path and the AC-01 fix unlocks future paradigm-neutral helpers without breakage. |
| Completeness | 8/10 | All in-scope ACs satisfied. AC-04 N/A is contract-permitted and explicitly declared. The 4 cargo tests for `resolved_db_name` are meaningful: `explicit_override_wins` pins the S65 contract, `list_collections_uses_active_db_after_use_db` pins the S137 fix, `falls_back_to_default_when_no_active` pins the unswapped path, `returns_none_when_no_source_available` pins the Validation guard. Two vitest AC-S137-02 tests cover both the spy-based re-fetch and the DOM-level stale-leak. Four AC-S137-03 tests cover all three DBMSes plus the `row_count: null` branch. Coverage is honest and not gold-plated. |
| Reliability | 8/10 | The `connectionStore.setState({ activeStatuses: {}, connections: [] })` in `DocumentDatabaseTree.test.tsx:beforeEach` is a defensive isolation move that prevents flake from cross-test leakage — exactly what a tight test suite should look like. The `beforeKey`-then-`expect(undefined)` assertion in the swap test is a real guard against regressing to "stale paint" rather than just asserting the spy. The `data-row-count="true"` test hook is independent of label-text changes, so future copy edits won't break the selector. The composite guard key uses `::` separator which is safe (Mongo db names cannot contain `:`). Only minor gap: tree-local `expandedDbs` isn't cleared on swap (handoff acknowledges this); a stale `X` expanded in the tree post-swap stays as dead state until clicked. Not a regression but a small UX gap. |
| Verification Quality | 9/10 | All 7 gates green and reproduced by Evaluator independently. New tests are user-facing queries (`getByLabelText`, DOM attribute reads), not implementation details. The cargo tests are pure-helper unit tests — fast, deterministic, no live MongoDB required, but they correctly seed adapter internals via direct `Mutex` access in `#[cfg(test)]` to exercise the resolver in isolation. Vitest count delta (+6) and cargo count delta (+4) match the handoff exactly. Live-Mongo `#[ignore]` test acknowledged in handoff as a follow-up gap. |

**Overall: 33/40 → all dimensions ≥ 7 → PASS**

## Findings

### P1
*(none)*

### P2
*(none)*

### P3

1. **Backend `resolved_db_name` is defensive against a callsite that does not currently exist.**
   The active-db swap pipeline always feeds the user-clicked database name verbatim through `list_mongo_collections(connection_id, database)` (see `src/lib/tauri.ts:345-349`), so the **backend** never actually sees the empty-`db` path that the new fallback unlocks. The user-visible bug was exclusively the frontend cache/guard issue (`DocumentDatabaseTree` auto-load `useRef` keyed only on `connectionId`), and *that* is what the AC-S137-02 fix addresses. The AC-S137-01 fix is still correct and well-tested, but it is forward-looking rather than load-bearing. **Suggestion**: in a future sprint, either (a) add a single integration test that exercises an empty `db` end-to-end via the Tauri command surface to lock in the semantic change, or (b) document the empty-input contract in the `DocumentAdapter` trait so future paradigm-neutral helpers know the active-db fallback is part of the API. Generator's handoff already flags this in "Assumptions #6" — no action needed this sprint.

2. **Tree-local `expandedDbs` set retained across DB swap.**
   When the user has db `X` expanded and the DbSwitcher swaps to db `Y`, the tree's local `expandedDbs` state still contains `X`. The handoff acknowledges this in "Risks / Gaps". If `X` happens to also exist in `Y`'s database list (rare cross-cluster scenario), the row stays expanded with no contents until a click triggers `loadCollections`. The first click then drives a fresh fetch, so there's no stale data risk — only a short-lived empty rendered state. **Suggestion**: a 1-line `setExpandedDbs(new Set())` in the same effect that re-keys the auto-load guard would clean this up. Not blocking, low priority.

3. **DBMS-aware `rowCountLabel` extends the contract slightly.**
   The contract (AC-S137-03) specifies the PG label verbatim. Generator added MySQL ("information_schema.tables") and SQLite ("exact COUNT(*)") variants because the same row-count cell renders for those DBMSes. The labels are factually accurate — MySQL's `information_schema.tables.TABLE_ROWS` is documented as approximate for InnoDB, and SQLite's adapter does run `SELECT COUNT(*)` for `row_count`. This expansion is in the spirit of the AC ("사용자가 숫자의 의미를 알 수 있어야 함") rather than scope creep. The test file pins each branch, so a future regression is caught. **Suggestion**: none — this is a thoughtful extension. If a future stylist wants to debate the SQLite copy, it's a one-line change.

4. **`#[ignore]` live-Mongo regression test for the full swap sequence.**
   `test_switch_active_db_happy_path_with_live_mongo` exercises only the driver-backed `list_database_names` probe, not the full `connect → switch_active_db → list_collections` chain that AC-01's stale-collection bug actually lived on. The unit test (`list_collections_uses_active_db_after_use_db`) exercises the resolver in isolation, which is sufficient because the resolver is the only line the bug lived on, but a live-driver integration test in `src-tauri/tests/mongo_integration.rs` would lock in the user-visible behavior end-to-end. **Suggestion**: add a docker-compose-gated integration test in a follow-up sprint. Handoff already calls this out.

## Verdict: PASS

All 7 verification gates green; AC-S137-01..06 satisfied (AC-04 contract-permitted N/A); 0 P1 / 0 P2 findings; all 5 scorecard dimensions ≥ 7. Recommend merge per the S134 → S135 → S136 → **S137** → S138 order.
