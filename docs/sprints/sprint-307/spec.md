# Feature Spec: Phase 28 Slice A — Unified mongosh Query Editor

## Description

Phase 28 Slice A removes the per-tab `Find / Aggregate` toggle and replaces the MongoDB query input surface with a single mongosh-style editor where the user types `db.<collection>.<method>(<args>).<cursorChain>` expressions. A frontend mini-parser (no JS eval) extracts collection, method, arguments, and cursor-chain options, then routes the call to the matching MongoDB driver path via existing or newly-added Tauri commands. The slice also introduces a `+ Insert ▾` toolbar dropdown with four sections (Query methods / Mutation methods / Filter operators / Aggregate stages) that inserts snippet templates with `<placeholder>` markers at the cursor. This is the architectural foundation for the remaining 12 slices in Phase 28: every later slice (B–M) that interacts with the editor depends on the parser surface defined here.

Lock decisions (encoded only — already grilled and frozen in `docs/archives/roadmaps/memory-roadmap/phase-28-mongo-full-support/memory.md`): toggle removed; mongosh expression input; mini parser (WASM/sidecar preferred per Q14 option 2+, falling back to handwritten whitelist parser if WASM is too expensive — R28.1); supported method set fixed at 13; BSON literal whitelist fixed at 6; `tab.queryMode` field deprecated (not unset on existing tabs; new tabs do not set it; Run dispatch ignores it).

## Sprint Breakdown

Slice A is sub-divided into **A1 → A6** so each sub-slice is independently verifiable. Verification profile in [ ] brackets.

---

### Sprint A1: Parser foundation + BSON literal whitelist
[verification: command]

**Goal**: Stand up a pure-TS (or WASM-backed) parser module that, given a mongosh expression string, returns a structured result: `{ collection, method, args, cursorChain, errors }`. No editor / store / IPC wiring yet — purely a tested module. Decide and lock the parser strategy (WASM sidecar vs handwritten whitelist) and persist the decision in `docs/adr/`. The output of this sub-sprint is the contract every later sub-slice consumes.

**Verification Profile**: `command`

**Acceptance Criteria**:
1. A parser module exists at `src/lib/mongo/mongoshParser.ts` (or sibling under `src/lib/mongo/`) and exports a single `parseMongoshExpression(input: string): ParsedMongoshCall | ParsedMongoshError` function. Calling it from a test file returns the expected discriminated-union shape — verifiable via `pnpm test src/lib/mongo/mongoshParser`.
2. The parser accepts and returns a structured result for every shape in this matrix (each shape covered by at least one unit test):
   - `db.users.find({age: {$gt: 30}})` → method `find`, args `[{age:{$gt:30}}]`, no chain.
   - `db.users.find({}).sort({name: 1}).limit(10).skip(20).toArray()` → method `find`, args `[{}]`, chain `{sort:{name:1}, limit:10, skip:20, toArray:true}`.
   - `db.events.aggregate([{$match: {...}}, {$group: {...}}])` → method `aggregate`, args `[[...]]`, no chain.
   - `db.users.findOne({_id: ObjectId("65abcdef0123456789abcdef")})` → BSON literal `ObjectId` reified into a typed tagged shape.
   - `db.users.countDocuments({})`, `db.users.estimatedDocumentCount()`, `db.users.distinct("country", {})`.
   - `db.users.insertOne({name: "alice"})`, `db.users.insertMany([{...}, {...}])`.
   - `db.users.updateOne({_id: ...}, {$set: {x: 1}})`, `db.users.updateMany({active: true}, {$inc: {n: 1}})`.
   - `db.users.deleteOne({_id: ...})`, `db.users.deleteMany({old: true})`.
   - `db.users.bulkWrite([{ insertOne: { document: {...} } }, { updateOne: { filter: {...}, update: {$set: {...}} } }])`.
3. The BSON literal whitelist parser correctly parses each of these six tag forms and reifies them into a tagged structural shape (NOT a string):
   - `ObjectId("65abcdef0123456789abcdef")`
   - `ISODate("2026-05-14T00:00:00.000Z")`
   - `UUID("550e8400-e29b-41d4-a716-446655440000")`
   - `NumberLong("9223372036854775807")`
   - `NumberDecimal("123.456789012345678901234567890")`
   - `BinData(0, "AQID...")` (subtype int + base64 string)
4. The parser **refuses** each of these inputs with a friendly `ParsedMongoshError` (kind + message), and the test asserts the error kind:
   - Variable declaration: `var x = 1; db.users.find(x)` → kind `unsupported-syntax`, message references "variables".
   - Control flow: `for (...) { db.users.insertOne(...) }` / `while`, `if`.
   - Callback method: `db.users.find({}).forEach(d => print(d))` / `.map(cb)`.
   - Shell helpers: `use admin`, `show dbs`, `show collections`.
   - Cross-DB: `db.getSiblingDB("other").users.find({})`.
   - Unknown method: `db.users.deleteAll({})` (not in the 13-method whitelist).
   - Malformed BSON literal: `ObjectId("not-hex")` → kind `bson-literal`.
   - JS eval is **never** invoked — verifiable by grepping the parser module: `grep -E "\b(eval|Function|new Function)\b" src/lib/mongo/mongoshParser.ts` returns empty.
5. The 13 supported methods are exported as a single `readonly` tuple/array constant from the parser module, used both by the parser itself and by the snippet dictionary in Sprint A4 (single source of truth, verifiable by import inspection).
6. The parser decision (WASM-sidecar vs handwritten whitelist) is recorded in a new ADR file under `docs/archives/decisions/` (filename per ADR convention). Decision body includes: (a) chosen strategy, (b) rationale referencing R28.1, (c) consequences (bundle size, build dependencies). Verifiable by file inspection.
7. `pnpm test src/lib/mongo/mongoshParser` exit 0 with ≥90% line coverage on the parser module (per `.claude/rules/testing.md` "쿼리 파서/빌더: 90%").

**Components to Create/Modify**:
- `src/lib/mongo/mongoshParser.ts` (NEW) — pure parser module.
- `src/lib/mongo/mongoshParser.test.ts` (NEW) — unit suite covering 13 methods × happy / refusal / BSON literal matrix.
- `src/lib/mongo/bsonLiterals.ts` (NEW or fold into parser module) — the 6-literal whitelist + tagged reification types.
- `docs/archives/decisions/00NN-mongosh-parser-strategy/memory.md` (NEW) — strategy ADR.
- (Optional, if WASM chosen) — Rust crate `src-tauri/crates/mongosh-parser/` or `src/lib/mongo/wasm/` glue. Decision in AC#6 determines.

---

### Sprint A2: Backend command surface for the 7 new methods
[verification: command + api]

**Goal**: Add `DocumentAdapter` trait methods and Tauri commands for the methods the backend doesn't already expose: `find_one`, `count_documents`, `estimated_document_count`, `distinct`, `insert_many`, `bulk_write`. The existing `find` / `aggregate` / `insert_document` / `update_document` / `delete_document` / `update_many` / `delete_many` / `drop_collection` commands stay as-is and are re-used. All new commands follow the `_inner(&AppState)` + `#[tauri::command]` wrapper pattern from `src-tauri/src/commands/document/{query,mutate}.rs`.

**Verification Profile**: `command` (cargo test) + `api` (integration test against testcontainers Mongo)

**Acceptance Criteria**:
1. The `DocumentAdapter` trait in `src-tauri/src/db/traits.rs` gains six new methods. Each takes `db`, `collection`, plus method-specific args, and returns a `Result<_, AppError>`:
   - `find_one(db, collection, filter, options)` → `Result<Option<DocumentRow>, AppError>` where `DocumentRow` mirrors a single-doc projection (columns + row).
   - `count_documents(db, collection, filter)` → `Result<i64, AppError>` (exact count).
   - `estimated_document_count(db, collection)` → `Result<i64, AppError>` (O(1) via metadata).
   - `distinct(db, collection, field, filter)` → `Result<Vec<serde_json::Value>, AppError>` (flattened values list).
   - `insert_many(db, collection, docs: Vec<bson::Document>)` → `Result<Vec<DocumentId>, AppError>`.
   - `bulk_write(db, collection, ops: Vec<BulkWriteOp>)` → `Result<BulkWriteResult, AppError>` where `BulkWriteOp` and `BulkWriteResult` are new types in `src-tauri/src/db/types.rs` covering insertOne/updateOne/updateMany/deleteOne/deleteMany/replaceOne sub-ops plus aggregate counters (`inserted_count`, `matched_count`, `modified_count`, `deleted_count`, `upserted_ids`).
2. `MongoAdapter` (in `src-tauri/src/db/mongodb/{queries,mutations}.rs`) implements each new trait method against the live driver. Sub-module placement: read-paths in `queries.rs`, write-paths in `mutations.rs`.
3. Six new Tauri commands exist (snake_case names) and are registered in `src-tauri/src/lib.rs` via the existing `tauri::generate_handler![...]` block:
   - `find_one_document`, `count_documents`, `estimated_document_count`, `distinct_documents`, `insert_many_documents`, `bulk_write_documents`.
4. Each new command, when invoked against a non-document paradigm connection (rdb), returns `AppError::Unsupported`. Each new command, when invoked against a non-existent connection id, returns `AppError::NotFound`. Each new command validates non-empty db + collection up front via `validate_ns` (or its `find_one`-relevant variant). Verifiable by unit tests mirroring the `find_documents` / `update_document` patterns in `src-tauri/src/commands/document/{query,mutate}.rs::tests`.
5. Integration tests in `src-tauri/tests/mongo_integration.rs` cover each new command end-to-end against testcontainers Mongo: insertMany → countDocuments → distinct → findOne → bulkWrite (mixed insert/update/delete) → final state assertions. `cargo mongo-test` exit 0.
6. `cargo clippy --all-targets --all-features -- -D warnings` exit 0 and `cargo fmt --check` exit 0 (per `.claude/rules/rust-conventions.md`).
7. Backend coverage on new code ≥80% (per `.claude/rules/testing.md` "DbAdapter 구현체").

**Components to Create/Modify**:
- `src-tauri/src/db/traits.rs` — six new trait methods.
- `src-tauri/src/db/types.rs` — `DocumentRow`, `BulkWriteOp`, `BulkWriteResult` types.
- `src-tauri/src/db/mongodb/queries.rs` — `find_one_impl`, `count_documents_impl`, `estimated_document_count_impl`, `distinct_impl` bodies + trait wiring.
- `src-tauri/src/db/mongodb/mutations.rs` — `insert_many_impl`, `bulk_write_impl` bodies + trait wiring.
- `src-tauri/src/db/testing.rs` — `StubDocumentAdapter` extended with the 6 new method stubs so existing tests compile.
- `src-tauri/src/commands/document/query.rs` — three new commands (`find_one_document`, `count_documents`, `estimated_document_count`, `distinct_documents`).
- `src-tauri/src/commands/document/mutate.rs` — two new commands (`insert_many_documents`, `bulk_write_documents`).
- `src-tauri/src/lib.rs` — `tauri::generate_handler!` registration.
- `src-tauri/tests/mongo_integration.rs` — integration scenarios.
- `src/lib/tauri/document.ts` — six new TS wrappers calling `invoke<T>(...)` for each new command.
- `src/types/document.ts` + `src/types/documentMutate.ts` — TS types mirroring `DocumentRow`, `BulkWriteOp`, `BulkWriteResult`.

---

### Sprint A3: Editor surface — remove toggle, single mongosh editor
[verification: browser + command]

**Goal**: Replace the `MongoQueryEditor` props/UI so it presents a single mongosh-flavoured CodeMirror editor (no `queryMode` prop). Update `QueryTab.tsx` to stop passing `queryMode`. Update `Toolbar.tsx` to delete the Find/Aggregate `ToggleGroup`. The `tab.queryMode` field on the store stays in the type union (so existing tabs / persisted localStorage don't crash) but is no longer consumed by the editor or toolbar.

**Verification Profile**: `mixed` (browser smoke + RTL unit tests)

**Acceptance Criteria**:
1. The `Find` / `Aggregate` `ToggleGroup` in `src/components/query/QueryTab/Toolbar.tsx` is removed. Asserted by RTL: rendering a document-paradigm `QueryTab` does NOT produce an element with `aria-label="Mongo query mode"`.
2. `MongoQueryEditor` accepts no `queryMode` prop; the `ariaLabel` is the single string `"MongoDB Query Editor"`. The `data-query-mode` attribute on the wrapper `<div>` is removed. Asserted by RTL.
3. `QueryTab.tsx` stops importing and passing `queryMode` to `MongoQueryEditor`. The `onSetQueryMode` toolbar prop is removed from `QueryTabToolbar`. ESLint / TypeScript build passes (`pnpm build` exit 0, `pnpm tsc --noEmit` exit 0).
4. New tabs created via `useWorkspaceStore.addQueryTab(...)` for document paradigm no longer set `queryMode: "find"`. Existing persisted tabs that have `queryMode: "find" | "aggregate"` continue to deserialize without errors (asserted by a store unit test). The store's `setQueryMode` action remains exported for backward-compat but is documented as deprecated via JSDoc.
5. The CodeMirror editor language extension is updated so it tokenizes mongosh-flavoured expressions reasonably (autocomplete extensions stay — Sprint A5 wires the parser-driven snippet keyboard layer). Asserted via a manual browser smoke that the editor accepts and visually highlights `db.users.find({...})` without throwing.
6. The `useMongoAutocomplete` hook is called without a `queryMode` argument (or with a sentinel "unified" mode) — its existing find/aggregate dispatch must collapse to a single dispatch path. Asserted by RTL + a unit test in `src/hooks/useMongoAutocomplete.test.ts(x)`.
7. `pnpm test` exit 0 across the affected files. Existing tab-related tests that asserted toggle behaviour are deleted (verifiable by `grep -r "Find mode\|Aggregate mode" src/components/query/` returning empty).

**UI States**:
- **Loading**: identical to today — the editor mounts immediately; CodeMirror is synchronous.
- **Empty**: empty editor + Run button disabled (the existing `!tab.sql.trim()` gate).
- **Error**: same paradigm-error renderer in `QueryResultGrid` (no change needed in this sub-slice).
- **Success**: same `QueryResultGrid` (rendering changes for new method shapes arrive in A6).

**Components to Create/Modify**:
- `src/components/query/MongoQueryEditor.tsx` — drop `queryMode` prop + label.
- `src/components/query/QueryTab.tsx` — drop `setQueryMode` wiring at the toolbar call site; stop passing `queryMode` to the Mongo editor; update `useMongoAutocomplete` call.
- `src/components/query/QueryTab/Toolbar.tsx` — delete the ToggleGroup block + `onSetQueryMode` prop.
- `src/hooks/useMongoAutocomplete.ts` (+ its test) — collapse the `queryMode` parameter to a unified surface.
- `src/components/query/QueryTab/Toolbar.test.tsx` (NEW or existing) — assert the toggle is gone.
- `src/stores/workspaceStore/types.ts` — JSDoc marking `queryMode` as deprecated on document tabs (no type removal).

---

### Sprint A4: Toolbar `+ Insert ▾` dropdown with 4-section snippet menu
[verification: browser + RTL]

**Goal**: Add a `+ Insert ▾` button to `QueryTabToolbar` (visible only when `isDocument` is true) that opens a popover with four labelled sections — `Query methods`, `Mutation methods`, `Operators`, `Stages`. Each entry is a snippet that, when clicked, is inserted at the editor's current cursor position with `<placeholder>` markers. `Tab` jumps forward through placeholders, `Shift+Tab` jumps backward. Snippet completion is committed (and selection exits placeholder mode) on `Escape`.

**Verification Profile**: `browser` + RTL

**Acceptance Criteria**:
1. A new `+ Insert ▾` button exists on the toolbar with `aria-label="Insert mongosh snippet"` and renders only for `isDocument === true`. RDB tabs do not see this button (RTL assertion).
2. Clicking the button opens a popover anchored to it; the popover has four `role="group"` regions with `aria-label` of `"Query methods"`, `"Mutation methods"`, `"Operators"`, and `"Stages"`. Each region renders a list of buttons (one per snippet entry).
3. Section contents:
   - **Query methods**: `find`, `findOne`, `aggregate`, `countDocuments`, `estimatedDocumentCount`, `distinct`. (6 entries)
   - **Mutation methods**: `insertOne`, `insertMany`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `bulkWrite`. (7 entries)
   - **Operators**: the 13 filter operators from `MONGO_QUERY_OPERATORS` in `src/lib/mongo/mongoAutocomplete.ts` (`$eq $ne $gt $gte $lt $lte $in $nin $exists $regex $or $and $not`) — Q7 order.
   - **Aggregate stages**: at minimum `$match $project $group $sort $limit $skip $unwind $lookup $count $addFields $replaceRoot $facet $out $merge` (existing `MONGO_AGGREGATE_STAGES` constant).
4. Each entry, when clicked, inserts a templated snippet at the editor's cursor. Snippets use a `<placeholder>` marker syntax (e.g. `db.<collection>.find(<filter>).limit(<n>)`). After insertion: the FIRST placeholder is selected; subsequent `Tab` advances selection to the next placeholder; `Shift+Tab` retreats; `Escape` exits placeholder mode and places the cursor after the last placeholder. Asserted by an RTL test driving the CodeMirror editor.
5. If multiple placeholders share the same name (e.g. two `<filter>`), `Tab` cycles in document order (not by name). Renaming a placeholder while it is selected leaves the others untouched.
6. The dropdown is keyboard-navigable: `Arrow Down` / `Arrow Up` moves selection inside a section, `Tab` moves across sections, `Enter` activates the focused entry, `Escape` closes the popover. Asserted by RTL.
7. The popover closes after a snippet is inserted (focus returns to the editor). Asserted by RTL.
8. Snippet entries are sourced from `src/lib/mongo/mongoshSnippets.ts` — a single module that exports the four section arrays. The methods array references the same 13-method constant from Sprint A1 (single source of truth). Verifiable by import-graph inspection.
9. `pnpm test src/components/query/QueryTab/Toolbar` exit 0 covering: button visibility (rdb vs document), popover open/close, section ordering, snippet insertion + placeholder navigation, keyboard navigation.

**UI States**:
- **Closed**: button shows `+ Insert ▾` with a small chevron icon. Focus styling per existing `Button variant="ghost" size="xs"`.
- **Open**: popover anchored below button, 4 sections vertically stacked. Width ≈ toolbar's content area; long sections scroll inside the popover.
- **Inserting**: snippet visible in editor, first placeholder visually selected (CodeMirror selection range).
- **Empty editor + cursor at 0**: snippet inserts at offset 0 — no special-case behaviour.

**Components to Create/Modify**:
- `src/components/query/QueryTab/Toolbar.tsx` — add the `+ Insert ▾` button + popover.
- `src/components/query/QueryTab/InsertSnippetMenu.tsx` (NEW) — the popover component.
- `src/components/query/QueryTab/InsertSnippetMenu.test.tsx` (NEW).
- `src/lib/mongo/mongoshSnippets.ts` (NEW) — snippet definitions + placeholder data shape.
- `src/lib/mongo/snippetEngine.ts` (NEW) or wrapper around CodeMirror snippet API — handles insertion + Tab/Shift+Tab/Escape navigation. (Implementation detail left to Generator; observable behaviour is what AC#4–6 lock.)

---

### Sprint A5: Run dispatch — parser-driven method routing (read paths)
[verification: api + RTL]

**Goal**: Rewire `handleExecute` in `useQueryExecution.ts` for document paradigm so that, instead of branching on `tab.queryMode`, it (a) runs the editor text through `parseMongoshExpression`, (b) verifies the parsed `collection` matches `tab.collection` (or, if `tab.collection` is unset, derives it from the parsed expression), (c) dispatches to the matching Tauri command for the parsed `method`, (d) feeds the result back into `tab.queryState`. Read-path methods only in this sub-sprint: `find`, `findOne`, `aggregate`, `countDocuments`, `estimatedDocumentCount`, `distinct`. Write-path methods land in Sprint A6.

**Verification Profile**: `mixed` (RTL on handleExecute + integration tests against testcontainers Mongo via Tauri IPC layer)

**Acceptance Criteria**:
1. `handleExecute`, for `tab.paradigm === "document"`, calls `parseMongoshExpression(sql)`. On parser error, the tab transitions to `queryState.status = "error"` with `error` set to the parser's `message`. The Run dispatch never reaches IPC. Asserted by RTL.
2. The collection in the parsed expression is reconciled with `tab.collection`:
   - If `tab.collection` is set and differs from parsed, the user sees an `error` queryState with message `"Editor targets collection 'X' but tab is bound to 'Y'."`.
   - If `tab.collection` is unset (free-form query tab), the parsed collection is used directly.
   - The `tab.database` is always taken from the tab.
3. Dispatch matrix for read methods (asserted via per-method RTL tests with mocked `@lib/tauri` module):
   - `find(filter, options?)` + `.sort(...)`/`.limit(N)`/`.skip(N)`/`.toArray()` chain → `findDocuments` with `{filter, sort, limit, skip, projection}` `FindBody`. `.toArray()` is parsed but is a no-op (default behaviour for IPC is "return array").
   - `findOne(filter, options?)` → `findOneDocument` IPC → renders as a single-row grid OR scalar panel (Sprint A6 polish).
   - `aggregate(pipeline)` → `aggregateDocuments` with the pipeline array; `.toArray()` chain is allowed and ignored.
   - `countDocuments(filter)` → `countDocuments` IPC → numeric result.
   - `estimatedDocumentCount()` → `estimatedDocumentCount` IPC → numeric result.
   - `distinct(field, filter?)` → `distinctDocuments` IPC → list result.
4. Result-shape adaptation: `find`/`findOne`/`aggregate` continue to flow through the existing `QueryResult` shape (columns + rows). `countDocuments`/`estimatedDocumentCount` produce a `QueryResult` with one column (`count`, `Int64`) and one row. `distinct` produces a `QueryResult` with one column (`value`) and N rows, one per distinct value. The grid does not need a new branch in this sub-sprint.
5. Query history (`useQueryHistoryStore`) records the **raw mongosh expression** verbatim (not a serialized BSON document) plus `paradigm: "document"`. The persisted `queryMode` field continues to be written for backwards compat but is set to the parsed method name (e.g. `"find"`, `"aggregate"`, `"countDocuments"`) so history filtering / search still works — though no UI surface depends on it.
6. The Mongo aggregate Safe Mode gate (`analyzeMongoPipeline` + `safeModeGate.decide`) is still invoked for `aggregate` calls — STOP-tier `$out`/`$merge` continues to mount `ConfirmDestructiveDialog`, WARN-tier mounts `MqlPreviewModal`. Asserted by RTL re-using the existing `QueryTab.warn-dialog.test.tsx` patterns.
7. `pendingMongoConfirm` retains the **parsed pipeline** (Record<string, unknown>[]), so the confirm-callback re-dispatch uses the post-parse value (not re-parsed from editor text). Asserted by RTL: editing the editor between confirm-prompt and confirm-click does not change the pipeline executed.
8. Backend IPC errors (e.g. namespace empty, driver failure) surface as `queryState.error` exactly as today. Cancel-token flow continues to work for `find`/`aggregate` (the methods that already support it); the new commands either inherit cancel support (preferred) or document the limitation in their TSDoc.

**Components to Create/Modify**:
- `src/components/query/QueryTab/useQueryExecution.ts` — replace the `tab.queryMode === "aggregate"` branch with parser-driven dispatch covering 6 read methods.
- `src/components/query/QueryTab/queryHelpers.ts` — add `dispatchMongoshRead(parsed, tab, …)` helper if extraction reduces complexity. (Optional; observable behaviour drives AC.)
- `src/lib/tauri/document.ts` — confirm the 6 wrappers from A2 are present.
- `src/components/query/QueryTab/useQueryExecution.test.ts(x)` (NEW or extended) — per-method dispatch tests.
- `src/stores/queryHistoryStore.ts` — JSDoc note that `queryMode` for document entries holds the parsed mongosh method name.

---

### Sprint A6: Run dispatch — mutation methods + result rendering polish
[verification: mixed]

**Goal**: Wire the 7 write-path methods (`insertOne`, `insertMany`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `bulkWrite`) into `handleExecute`. Introduce a write-summary modal for mutation results. Add a scalar / list result panel for `countDocuments`/`estimatedDocumentCount`/`distinct` (started in A5 with a fall-through grid; this sub-slice polishes the visual rendering).

**Verification Profile**: `mixed` (browser smoke + RTL + integration)

**Acceptance Criteria**:
1. Dispatch matrix for write methods (asserted via per-method RTL with mocked IPC):
   - `insertOne(doc)` → `insertDocument` → write summary `{insertedIds: [<id>]}`.
   - `insertMany([docs])` → `insertManyDocuments` → write summary `{insertedIds: [...]}` with the full list.
   - `updateOne(filter, update)` → `updateDocument`-style command (resolving the single doc by filter — backend currently keys by `_id`; the dispatch must either translate filter→id via a `findOne` round-trip OR call a new `update_one_by_filter` IPC. Generator chooses; AC requires that single-doc updates with non-`_id` filters succeed end-to-end against testcontainers Mongo).
   - `updateMany(filter, update)` → `updateMany` IPC → write summary `{modifiedCount: N}`.
   - `deleteOne(filter)` → `deleteOne`-style → write summary `{deletedCount: 1 | 0}`.
   - `deleteMany(filter)` → `deleteMany` IPC → write summary `{deletedCount: N}`.
   - `bulkWrite(ops)` → `bulkWriteDocuments` IPC → write summary with per-op breakdown (inserted/modified/deleted/upserted counts).
2. The Safe Mode classifier (`analyzeMongoOperation` / its successor) is invoked for write methods. STOP-tier (empty filter `*-many`, `drop_collection`, `$out`/`$merge`) routes to `ConfirmDestructiveDialog`. WARN-tier (non-empty filter `*-many`) routes to a new write-preview modal (Mongo equivalent of `SqlPreviewDialog`). INFO-tier (`*-one`) runs direct. Asserted by RTL.
3. A new component `WriteSummaryPanel` renders inside the result area for mutation methods. Renders one of three forms:
   - Insert(s): "Inserted N document(s)" + a chevron-expandable list of inserted ids.
   - Update(s): "Modified N document(s) (matched M)" — counts from the IPC response.
   - Delete(s): "Deleted N document(s)".
   - bulkWrite: a table breakdown — one row per op type (`insertOne`, `updateOne`, ...) with the counter for each.
   Asserted by RTL on each form.
4. Scalar result panel: `countDocuments` / `estimatedDocumentCount` render a single large numeric in the result area with a "Count" label, not the grid. `distinct` renders a vertical list panel with the field name as title and one row per distinct value. The grid is hidden in these three cases. Asserted by RTL.
5. `QueryResultGrid` (or a sibling `QueryResultPanel`) routes between `<DataGrid>`, `<WriteSummaryPanel>`, and `<ScalarOrListPanel>` based on the parsed method (or, equivalently, a `resultKind` discriminator added to `QueryResult`).
6. Query history records the raw mongosh expression and a status of `success` / `error` consistent with today. The write-summary's totals are not recorded in history (only the SQL/expression + status + duration).
7. Integration tests in `src-tauri/tests/mongo_integration.rs` (already extended in A2) and a new `e2e/phase-28-slice-A.spec.ts` Playwright file verify the **E28-01 scenario** from `docs/phases/phase-28.md`: a user types `db.users.find({age:{$gt:30}}).limit(10)` in a fresh query tab, hits Run, sees the result grid. Playwright assertion: the grid renders ≥1 row when the seeded dataset is loaded.
8. RDB regression: the `SqlQueryEditor` path is **untouched** by Slice A. Verified by `pnpm test src/components/query/SqlQueryEditor` exit 0 and a smoke E2E that runs a `SELECT 1` against Postgres returning a single-cell grid.
9. `pnpm build` + `pnpm tsc --noEmit` + `pnpm lint` exit 0. `cargo build` + `cargo test` + `cargo clippy --all-targets -- -D warnings` + `cargo fmt --check` all exit 0.

**UI States** (Slice A overall):
- **Loading**: editor mounted, Run button enabled when SQL non-empty; on click → Run shows the spinner (`Loader2`) + "Cancel" label (existing pattern).
- **Empty (no SQL)**: Run disabled.
- **Error (parser)**: red banner with parser message above the result area; result area shows "No results" placeholder.
- **Error (IPC)**: same banner pattern with IPC error message.
- **Success (find / aggregate)**: DataGrid populated.
- **Success (count / estimated / distinct)**: scalar or list panel; no grid.
- **Success (insert/update/delete/bulkWrite)**: WriteSummaryPanel; no grid.

**Components to Create/Modify**:
- `src/components/query/QueryTab/useQueryExecution.ts` — extend with 7 write-path branches.
- `src/components/query/WriteSummaryPanel.tsx` (NEW).
- `src/components/query/WriteSummaryPanel.test.tsx` (NEW).
- `src/components/query/ScalarOrListPanel.tsx` (NEW).
- `src/components/query/ScalarOrListPanel.test.tsx` (NEW).
- `src/components/query/QueryResultGrid.tsx` (MODIFY) — add result-kind discriminator routing.
- `src/types/query.ts` (MODIFY) — `QueryResult` gains an optional `resultKind` field (`"grid" | "scalar" | "list" | "writeSummary"`).
- `e2e/phase-28-slice-A.spec.ts` (NEW) — Playwright E2E for E28-01.

---

## Global Acceptance Criteria

1. **No `tab.queryMode` UI**: `grep -rn "queryMode" src/components/` returns zero references inside `QueryTab.tsx`, `Toolbar.tsx`, and `MongoQueryEditor.tsx`. (The store + types files retain the field for backward-compat per A3 AC#4.)
2. **No JS eval anywhere**: `grep -rE "\beval\b|new Function\b" src/lib/mongo/ src/components/query/` returns zero matches.
3. **Find/Aggregate toggle removed at every entry point**: `grep -rn "Find mode\|Aggregate mode" src/` returns zero matches.
4. **RDB regression zero**: `pnpm test src/components/query/SqlQueryEditor` + `pnpm test src/stores/workspaceStore` + `cargo test --test query_integration` all exit 0 with the same scenario count as the sprint-306 baseline.
5. **Phase 28 AC-28-01 (locked) is observable end-to-end**: from a clean dev launch, a user types `db.<coll>.<method>(<args>)` for each of the 13 methods, clicks Run, and sees a non-error result (grid / scalar / list / write summary as appropriate). Playwright spec from A6 AC#7 + manual smoke confirms.
6. **Persisted state migration**: launching the app with a localStorage payload that still has `queryMode: "find"` on a document tab does not throw, and the editor renders without the toggle. Asserted by a store unit test that loads a synthetic legacy payload.
7. **All new tests pass coverage gates**: Slice A's net Rust + TS additions keep `cargo llvm-cov` coverage at or above the sprint-296 baseline thresholds (per `.claude/rules/testing.md`). React new components ≥80% statements.
8. **Conventions**: `.claude/rules/{react-conventions,rust-conventions,testing}.md` enforced — function components only, `interface` for props, no `any`, `cargo fmt` + `cargo clippy -D warnings` clean, every new file has a header comment with Sprint 307 + reason.

## Data Flow

```
User keystroke
   ↓
CodeMirror state (MongoQueryEditor) — no parser-time invocations
   ↓ (on Run)
parseMongoshExpression(sql)
   ↓                       ↓
 error                  parsed { collection, method, args, chain }
   ↓                       ↓
queryState.error      method dispatch table (in handleExecute)
                          ↓
                 read path  ────┬──── write path
                          ↓                ↓
   ┌─ find          → findDocuments       ┌─ insertOne   → insertDocument
   ├─ findOne       → findOneDocument     ├─ insertMany  → insertManyDocuments
   ├─ aggregate     → aggregateDocuments  ├─ updateOne   → updateDocument-by-filter
   ├─ countDocs     → countDocuments      ├─ updateMany  → updateMany   (warn gate)
   ├─ estimatedCnt  → estimatedDocCount   ├─ deleteOne   → deleteDocument
   └─ distinct      → distinctDocuments   ├─ deleteMany  → deleteMany   (warn gate)
                          ↓               └─ bulkWrite   → bulkWriteDocuments
                 QueryResult                            ↓
                          ↓                 WriteSummaryResult
                  resultKind routing                    ↓
                          ↓                 WriteSummaryPanel render
   ┌────────┬────────┬────────────┐
   ↓        ↓        ↓            ↓
DataGrid  Scalar   List      WriteSummary
(find/    (count)  (distinct) (insert/update/delete/bulk)
 agg)
```

State management additions:
- `mongoshParser.ts` is a pure function — no store.
- `WriteSummaryResult` joins `QueryResult` as a discriminated variant via `resultKind`.
- `tab.queryMode` is **read-only** in the document paradigm now (the store action `setQueryMode` is documented as deprecated and not called from the editor surface).

## Edge Cases

- **Editor empty / whitespace-only**: Run is disabled (existing gate). Parser is not invoked.
- **Unknown method**: `db.users.foo({})` → parser error `unsupported-method` listing the 13 supported names.
- **Cursor chain on non-cursor method**: `db.users.insertOne({}).limit(5)` → parser error `invalid-cursor-chain` (`.limit/.skip/.sort/.toArray` only valid after `find`/`aggregate`).
- **Bare expression without `db.`**: `users.find({})` → parser error `missing-db-prefix`. Future improvement (cross-DB nav) is out of scope.
- **Multiple statements separated by `;`**: parser rejects with `multiple-statements`. (Mongosh allows it; we explicitly don't, mirroring the single-expression contract.)
- **Comments inside the expression**: `db.users.find({/* recent */ active: true})` — supported (JSON-like comment stripping inside arg parser). Out-of-arg comments before `db.` are stripped.
- **Numeric overflow in `NumberLong`**: a `NumberLong("99999999999999999999")` that exceeds 64-bit signed range → parser error `bson-literal: out-of-range NumberLong`.
- **`bulkWrite` with mixed ops including unknown op type**: parser error pointing at the offending sub-op.
- **`updateOne` with empty filter `{}`**: parser allows (Mongo semantics); Safe Mode classifier flags as WARN (existing behaviour).
- **WASM parser load failure (if Q14 option 2+ chosen)**: fall back to a "parser unavailable" banner in the editor; Run is disabled. Verified by an RTL test mocking the WASM-load error.
- **Connection without a default db**: `tab.database` unset on a Mongo connection → parser-validation error before IPC; user sees "Choose a database first."
- **Tab dragged across workspaces while a confirm-dialog is pending**: the pending parsed pipeline is keyed to the tab id, so the re-dispatch on confirm hits the original tab; if the tab is gone, confirm becomes a no-op (existing pattern).
- **`tab.queryMode` migration**: if persisted legacy localStorage has `queryMode: "aggregate"`, the editor still renders correctly (no toggle); Run path runs the parser on whatever the user types.

## Cross-paradigm Impact

- **RDB (`SqlQueryEditor`)**: untouched. Verified by Global AC#4 (zero regression in `SqlQueryEditor` tests + `query_integration` tests).
- **K/V (Redis), Search**: unaffected — placeholders remain.
- **`useQueryEvents`** (`format-sql` / `uglify-sql` listeners): already short-circuit on `tab.paradigm === "document"`. No change needed.
- **`queryHistoryStore`**: the document-tab history entries' `queryMode` field is repurposed to hold the parsed method name (A5 AC#5). RDB entries (`queryMode: "sql"`) are unchanged.

## Critical Files for Implementation

- `src/lib/mongo/mongoshParser.ts` (NEW — the contract everything depends on)
- `src/components/query/QueryTab/useQueryExecution.ts` (MODIFY — the dispatch surface)
- `src/components/query/QueryTab/Toolbar.tsx` (MODIFY — toggle removal + Insert dropdown)
- `src/components/query/MongoQueryEditor.tsx` (MODIFY — queryMode prop removal)
- `src-tauri/src/db/traits.rs` (MODIFY — six new DocumentAdapter methods)
