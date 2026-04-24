# Sprint 66 Evaluation — Phase 6 plan C (Mongo P0 read path)

## Sprint 66 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness (35%) | 9/10 | `MongoAdapter::find` + `infer_collection_fields` are real implementations; `_id`-first + sentinel flattening + `estimated_document_count` match the contract. 4 commands all dispatch through `as_document()?` (lines 58/78/97 of `browse.rs`, line 30 of `query.rs`). Integration test `test_mongo_adapter_infer_and_find_on_seeded_collection` exercises the full seeded path and passed (3/3 in `mongo_integration`). Unit coverage is strong (flatten_cell + infer columns + modal type + project_row + unsupported guards). Only small nit: `aggregate`/`insert`/`update`/`delete` stub messages still say "not implemented until Sprint 66" which is misleading now that Sprint 66 has landed — should point at Sprint 68/69. |
| Completeness (25%) | 8/10 | All 13 Done-Criteria items satisfied (see matrix below). The contract's Out-of-Scope items are honored — aggregate/insert/update/delete stay as Unsupported stubs (4 remaining, verified via `grep Err\(AppError::Unsupported` in `mongodb.rs` → 4 hits, matching spec). Minor completeness gap: the generator chose a brand-new `DocumentDataGrid.tsx` rather than reusing `DataGridTable` paradigm-aware; the contract's item #10/#11 reads as "reuse DataGridTable" but the execution brief is permissive ("기존 DataGridTable을 재사용하되..." + "generator 재량"). Since `useDataGridEdit` still got the paradigm guard for forward compatibility (Sprint 69), this is acceptable but leaves two grid code paths to reconcile later. |
| Reliability (20%) | 8/10 | Stale-guard via module-scoped `requestCounters` Map is solid — synchronous compare cannot tear under React batching (validated by `loadCollections stale response does not overwrite a newer response` + the runFind counterpart). Empty-namespace validation is uniform (both `find` and `infer_collection_fields` call `validate_ns`). Legacy tab migration is centralized in `loadPersistedTabs` (single write site). The `DocumentDatabaseTree` duplicates most of `SchemaTree`'s icon/expand/selection pattern rather than sharing a `TreeNode` primitive — acceptable for P0, but future refactors will have to deduplicate. Small concern: `DocumentDataGrid` lives at `src/components/DocumentDataGrid.tsx` (top-level) rather than under `src/components/datagrid/` with the RDB grid; easy to miss when Sprint 69 tries to converge. |
| Verification Quality (20%) | 9/10 | All 8 required checks run locally and passed. Docker compose mongo + postgres + mysql + redis already running from prior session; PGPORT override not needed because host 5432 was already healthy from the pre-existing `postgres` container. mongo_integration shows `admin` in `list_databases` + the new seeded test passed (3 / 3). Evidence cross-checked with grep on `list_mongo_databases` (found in `lib.rs::generate_handler!` line 48 and `browse.rs` line 53), sentinel flattening (`mongodb.rs::flatten_cell` lines 504-510), and `estimated_document_count` (line 369). |
| **Overall** | **8.5/10** | |

## Verdict: PASS

All four dimensions ≥ 7/10 per the System rubric. Weighted: 0.35·9 + 0.25·8 + 0.20·8 + 0.20·9 = 3.15 + 2.0 + 1.6 + 1.8 = **8.55 / 10**.

## Verification Commands

| # | Command | Result |
|---|---|---|
| 1 | `cd src-tauri && cargo fmt --all -- --check` | **pass** (exit 0, no diff) |
| 2 | `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` | **pass** (exit 0, 0 warnings) |
| 3 | `cd src-tauri && cargo test --lib` | **pass** — 215 / 215 |
| 4 | `docker compose -f docker-compose.test.yml up -d mongodb postgres` + `./scripts/wait-for-test-db.sh` | **pass** — mongo:7 + postgres + mysql + redis all healthy (pre-existing session) |
| 5 | `cargo test --test schema_integration --test query_integration --test mongo_integration` | **pass** — schema 14 / 14, query 17 / 17, mongo 3 / 3 (including the new seeded infer+find test) |
| 6 | `pnpm tsc --noEmit` | **pass** (exit 0) |
| 7 | `pnpm lint` | **pass** (exit 0) |
| 8 | `pnpm vitest run` | **pass** — 60 files / 1133 tests |

Key cargo integration output snippets:

```
running 3 tests
test test_mongo_adapter_ping_without_connect_returns_error ... ok
test test_mongo_adapter_infer_and_find_on_seeded_collection ... ok
test test_mongo_adapter_connect_ping_list_disconnect_happy_path ... ok
test result: ok. 3 passed; 0 failed; 0 ignored
```

vitest summary:

```
Test Files  60 passed (60)
     Tests  1133 passed (1133)
```

## Contract-specific evidence

- `grep 'list_mongo_databases\|list_mongo_collections\|infer_collection_fields\|find_documents'` on `src-tauri/src/lib.rs` → 4 hits at lines 48-51. All four commands registered in `tauri::generate_handler!`.
- `grep 'impl DocumentAdapter for MongoAdapter'` at `src-tauri/src/db/mongodb.rs:219`. `find` at line 299 is a real implementation (not `Err(AppError::Unsupported)`); `infer_collection_fields` at line 262 likewise. Only 4 `Err(AppError::Unsupported(` call sites remain in the file (lines 394/407/421/434) — all for `aggregate`/`insert_document`/`update_document`/`delete_document`, matching the spec.
- `mongo_integration.rs` seeds three documents via `seed_client` + `insert_many` (lines 179-181), runs `infer_collection_fields` (asserts `_id` first + nullability, lines 183-222), runs `find` with sort on `_id` (lines 224-291, asserts `rows.len() == 3`, `raw_documents.len() == 3`, `profile` sentinel `"{...}"`, `tags` sentinel `"[2 items]"`, missing-field null, `total_count >= 3`), then drops the collection on teardown (line 293).
- `MongoAdapter::find` serialises nested Document → `"{...}"` (`flatten_cell` line 506) and Array → `"[N items]"` (line 507) via a dedicated helper. Scalars go through `into_canonical_extjson` so `Int64` comes through as `{"$numberLong":"..."}`, `ObjectId` as `{"$oid":"..."}`.
- `DocumentQueryResult.total_count` is filled from `coll.estimated_document_count().await?` at `mongodb.rs:368-372` (capped at `i64::MAX` for signed transport).
- `src/lib/tauri.ts` has all four wrappers at lines 337-385 — `listMongoDatabases`, `listMongoCollections`, `inferCollectionFields`, `findDocuments`. `src/types/document.ts` defines `DatabaseInfo`, `CollectionInfo`, `DocumentColumn`, `FindBody`, `DocumentQueryResult`, and both `DOCUMENT_SENTINELS` + `isDocumentSentinel`.
- `src/stores/documentStore.ts` exposes the four required actions (`loadDatabases`, `loadCollections`, `inferFields`, `runFind`) + `clearConnection`. The stale guard uses a module-scoped `requestCounters: Map<string, number>` — not in Zustand state, so synchronous increment/compare is guaranteed. 7 unit tests in `documentStore.test.ts`; 2 of them are explicit stale-response drops (`loadCollections stale response does not overwrite a newer response`, `runFind stale response does not overwrite a newer response`).
- `DocumentDatabaseTree.tsx` lives at `src/components/schema/` and is a 2-level tree: databases → collections with expand-on-first-click and `onDoubleClick` → `useTabStore.addTab({ paradigm: "document", ... })` (line 91-100). 5 tests in `DocumentDatabaseTree.test.tsx`, including double-click-opens-document-paradigm-TableTab and store-cache-populates-on-expand.
- `SchemaPanel.tsx` has the paradigm branch at lines 104-114: `isDocument = selected.paradigm === "document"` → `<DocumentDatabaseTree>` vs `<SchemaTree>`. Covered by `SchemaPanel.test.tsx::renders DocumentDatabaseTree when connection paradigm is document` (line 144).
- `TableTab.paradigm?: Paradigm` at `tabStore.ts:47`. Legacy migration in `loadPersistedTabs` at line 305 (`paradigm: t.paradigm ?? ("rdb" as const)`). Two new tests: `migrates legacy TableTabs without paradigm to rdb` (line 510) + `preserves a persisted paradigm=document TableTab on load` (line 542).
- `DataGridTable` RDB path untouched. Sentinel guard lives in `useDataGridEdit.ts::handleStartEdit` at line 232 (`if (paradigm === "document") return;`). `paradigm` is optional + defaults to RDB so existing RDB callers do not need a diff (line 81-82). 2 new tests in `useDataGridEdit.paradigm.test.ts`.
- MainArea routes document-paradigm tabs to `DocumentDataGrid` at `MainArea.tsx:25-35`; RDB path unchanged.

## Done Criteria Coverage

- [x] **DC1** — `infer_collection_fields` real impl, `_id` first, sample override. `mongodb.rs:262-297` + 6 unit tests in the same file (flatten_cell_{replaces,preserves}, infer_columns_from_{empty,puts_id_first,picks_modal_type}, project_row_fills_absent_fields).
- [x] **DC2** — `find` real impl, flattened rows, sentinels, raw_documents. `mongodb.rs:299-385` + seeded integration test asserts `rows[0][profile_idx] == "{...}"` and `rows[2][tags_idx] == "[2 items]"`.
- [x] **DC3** — `total_count = estimated_document_count`. `mongodb.rs:368-372`.
- [x] **DC4** — 4 commands registered, dispatch through `as_document()?`. `lib.rs:48-51` + `browse.rs:62/82/103` + `query.rs:35-37`.
- [x] **DC5** — `mongo_integration.rs` seed + infer + find. `test_mongo_adapter_infer_and_find_on_seeded_collection` passes (3/3 with compose stack up).
- [x] **DC6** — `src/lib/tauri.ts` wrappers + `src/types/document.ts` types. Verified.
- [x] **DC7** — documentStore 4 actions + stale-guard tests. `documentStore.test.ts` (7 tests, 2 explicit stale-guard).
- [x] **DC8** — `DocumentDatabaseTree` + ≥2 tests. Component exists; 5 tests cover render, expand-lazy-load, double-click-opens-tab, loading state, cache population.
- [x] **DC9** — SchemaPanel paradigm branch + test. Verified at `SchemaPanel.tsx:104` + `SchemaPanel.test.tsx:144`.
- [x] **DC10** — `TableTab.paradigm` + legacy migration + ≥2 tests. Verified at `tabStore.ts:47,305` + two new tests.
- [x] **DC11** — Sentinel cell renderer + edit block + test. Renderer in `DocumentDataGrid.tsx:172-207` (muted italic for sentinel / null). Edit block in `useDataGridEdit.ts:232`. Test `useDataGridEdit.paradigm.test.ts::handleStartEdit is a no-op when paradigm === 'document'`.
- [x] **DC12** — End-to-end automated path. `mongo_integration` seeded happy path + `DocumentDatabaseTree.test.tsx::double-clicking a collection opens a document-paradigm TableTab` + `useDataGridEdit.paradigm.test.ts`.
- [x] **DC13** — 8-check regression gate. All 8 green locally.

## Regression guard (Sprint 65 invariants)

- `mongo_integration::test_mongo_adapter_connect_ping_list_disconnect_happy_path` still passing (Sprint 65 happy path preserved).
- 4 remaining `DocumentAdapter` stubs (`aggregate`/`insert_document`/`update_document`/`delete_document`) still return `AppError::Unsupported`; unit tests `aggregate_returns_unsupported` / `insert_document_returns_unsupported` / `update_document_returns_unsupported` / `delete_document_returns_unsupported` still passing (`cargo test --lib` 215/215 — the previous two Unsupported-stub tests for `find` / `infer_collection_fields` were correctly removed by the generator when those methods lit up).
- `Paradigm` enum + `ConnectionConfigPublic.paradigm` serde shape unchanged from Sprint 65 (no diff in `models/connection.rs` that touches those fields).
- `SchemaTree` test suite unchanged, still 100% passing in the vitest run.
- `DataGridTable` RDB path unchanged; the `useDataGridEdit.paradigm.test.ts::defaults to rdb` test asserts that leaving `paradigm` unset preserves full edit semantics.

## Feedback for Generator

1. **[Stub wording]**: Four `Unsupported` error strings in `mongodb.rs` still say "not implemented until Sprint 66" even though Sprint 66 shipped. Update to point at the actual target sprint so operational telemetry stays truthful.
   - Current: `"MongoAdapter::aggregate is not implemented until Sprint 66"` at lines 394, 407, 421, 434.
   - Expected: Reference the real target sprint (Sprint 68 for aggregate, Sprint 69 for insert/update/delete) or drop the sprint identifier and just say "not yet implemented".
   - Suggestion: Change to `"MongoAdapter::aggregate is deferred to Sprint 68"` / `"...insert_document is deferred to Sprint 69"` etc.

2. **[File placement]**: `DocumentDataGrid.tsx` lives at `src/components/DocumentDataGrid.tsx` (top-level) instead of under `src/components/datagrid/` alongside `DataGridTable.tsx` and `useDataGridEdit.ts`. This splits the grid surface across two directories and will make Sprint 69's "merge the two grids" job harder to locate.
   - Current: `src/components/DocumentDataGrid.tsx`.
   - Expected: `src/components/datagrid/DocumentDataGrid.tsx` so a future engineer `ls`ing the datagrid folder sees the paradigm split in one place.
   - Suggestion: Move the file + update imports in `MainArea.tsx`; wait for Sprint 67 if the move collides with Quick Look wiring.

3. **[UI duplication]**: `DocumentDatabaseTree.tsx` re-implements icon rendering, expand state, aria-expanded plumbing, and selection highlighting that `SchemaTree.tsx` already has. Sprint 66 doesn't require a refactor, but the duplication is obvious enough to flag before a third tree variant shows up.
   - Current: `DocumentDatabaseTree` has ~250 lines of markup that mirror `SchemaTree`'s structure verbatim.
   - Expected: Extract a shared `TreeNode` primitive (icon + chevron + expand + aria) before Sprint 68.
   - Suggestion: In Sprint 68 or 69 add a `components/schema/TreeNode.tsx` and migrate both trees; not a Sprint 66 blocker.

4. **[Sentinel detection locality]**: `DocumentDataGrid.tsx:174-176` inlines its own sentinel regex (`typeof cell === "string" && (cell === "{...}" || /^\[\d+ items\]$/.test(cell))`) instead of using the shared `isDocumentSentinel()` helper from `src/types/document.ts`. If the sentinel shape ever changes (say, a third `"<binary>"` form), there are now two places to update.
   - Current: Inline regex duplication at `DocumentDataGrid.tsx:174-176`.
   - Expected: Import and call `isDocumentSentinel(cell)` from `@/types/document`.
   - Suggestion: One-line import + replace; no behavioural change.

5. **[Pagination UX edge]**: `DocumentDataGrid` guards `Next` with `page >= totalPages`, where `totalPages = Math.max(1, Math.ceil(total_count / pageSize))`. Because `total_count` comes from `estimated_document_count`, paging can end up "off by one" for a freshly-written collection with >300 docs whose estimate is stale. The page indicator would show `1 / 1` even though a `Next` click might surface more rows. Residual-risk-level; not a Sprint 66 blocker but worth a TODO comment near the totalPages derivation pointing at the estimate's eventual-consistency nature.
   - Suggestion: Add a JSDoc `@remarks` note in `DocumentDataGrid.tsx` near `totalPages`.

## Residual Risk (carried forward)

- **Write path still Unsupported**: `aggregate`/`insert_document`/`update_document`/`delete_document` are all `AppError::Unsupported`. Any UI that evolves toward writes hits this wall.
- **No deep-nested inference**: Nested documents/arrays collapse to sentinels in both grid cells and inferred columns. Quick Look (Sprint 67) will surface the full BSON.
- **Estimated count only**: `total_count` drifts from reality on large or recently-mutated collections.
- **Skip-based pagination**: `DocumentDataGrid` uses `skip = (page - 1) * pageSize` which scales O(n) with page number — fine for P0 P300 preview, pathological at 10k+.
- **Two grid code paths**: `DocumentDataGrid` and `DataGridTable` will need to reconcile before Sprint 69 lands write support.
