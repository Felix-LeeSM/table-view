# Feature Spec: Provider-aware Query Autocomplete & Highlighting

## Description

Query tabs currently treat SQL generically (single StandardSQL dialect) and render MongoDB JSON without any awareness of MQL operators, BSON type tags, or collection field names; saved query history rows are rendered through `SqlSyntax` regardless of paradigm and load back into the editor as plain text with no memory of which paradigm/mode authored them. This feature closes the provider gap end-to-end: SQL tabs switch to the active connection's dialect (Postgres / MySQL / SQLite) with dialect-appropriate reserved-word highlighting and schema-qualified identifier completion; MongoDB tabs gain MQL operator, pipeline stage, accumulator, and BSON extended-JSON type-tag completion plus JSON-on-top highlighting of the same; every history entry persists paradigm + queryMode + (mongo) database/collection metadata so double-click/restore flows land on the correct tab shape; and the inline history row previews + global query log render each entry's query in its authoring paradigm's highlighter.

## Sprint Breakdown

### Sprint 82: RDB provider-aware SQL autocomplete and highlighting

**Goal**: SQL query tabs resolve the active connection's `db_type` and configure the editor with a dialect-appropriate highlighter + completion set, so Postgres, MySQL, and SQLite users see their own reserved words, identifier quoting, and dialect-only keywords in both the full editor and the schema-driven autocomplete namespace.

**Verification Profile**: mixed

**Acceptance Criteria**
1. When a query tab's connection is PostgreSQL, the editor highlights Postgres-only keywords (e.g. `RETURNING`, `ILIKE`, `WITH ORDINALITY`) as keywords, recognizes `"` as an identifier quote, and the autocomplete popup surfaces these keywords as candidates; when the connection is MySQL, backtick (`` ` ``) identifier quoting is highlighted and MySQL-only keywords (e.g. `REPLACE INTO`, `DUAL`) are completed; when SQLite, the editor highlights SQLite-specific forms (`AUTOINCREMENT`, `PRAGMA`, `IIF`) — verified by rendering test fixtures and asserting keyword class names in the DOM.
2. Schema-driven autocomplete continues to surface every table, view, and column that the schema store holds for the active connection, but identifier candidates are quoted/lowercased according to dialect defaults (e.g. Postgres prefers lowercase, MySQL offers backtick-quoted identifiers when needed) — verified by asserting the completion option `label` / `apply` fields for a cached table with mixed-case name across all three dialects.
3. Switching a tab's active connection (or the connection's `db_type` changing) reconfigures the editor's language extension in place without destroying the CodeMirror view — verified by rendering the editor, swapping connection dialect, and asserting the same `EditorView` instance is still mounted and the new dialect's keyword list is live.
4. Tabs whose connection paradigm is not `rdb` are unaffected by this sprint — the document (MongoDB) path still receives the JSON extension, with no SQL dialect code paths touched.
5. No regression in existing SQL autocomplete behavior for an ambiguous / unknown dialect: the editor falls back to the current StandardSQL configuration when `db_type` cannot be resolved (tab with no connection, disconnected state), and the existing test suite for `QueryEditor` + `useSqlAutocomplete` passes unchanged.

**Components to Create/Modify**
- `src/components/query/QueryEditor.tsx`: accept a dialect signal (derived from the tab's connection) and configure the SQL language extension per dialect while preserving the Compartment-based in-place reconfigure.
- `src/components/query/QueryTab.tsx`: resolve the dialect for the current tab from `connectionStore` and forward it to the editor; unaffected on the document path.
- `src/hooks/useSqlAutocomplete.ts` (or a sibling hook): extend so identifier casing / quoting of completion entries reflects the active dialect; preserve the existing override shape used by tests.
- `src/components/query/QueryEditor.test.tsx`: add dialect-swap cases (pg/mysql/sqlite, plus fallback) that assert keyword class in rendered content and editor-view identity survival across reconfigure.

### Sprint 83: MongoDB provider autocomplete and highlighting

**Goal**: Document (MongoDB) query tabs gain MQL-aware autocomplete and highlighting on top of the JSON language — query operators, pipeline stages, accumulators, BSON extended-JSON type tags, plus field-name hints sourced from the active collection's cached document samples — so users writing `$match`, `$group`, `$sum`, `$oid`, `$date`, etc. see the same ergonomics SQL users enjoy.

**Verification Profile**: mixed

**Acceptance Criteria**
1. With a document-paradigm tab open in `find` mode, typing `$` inside a JSON object position offers MongoDB query operators (at minimum `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$and`, `$or`, `$nor`, `$not`, `$exists`, `$type`, `$regex`, `$elemMatch`, `$size`, `$all`) as completion candidates with a visible "operator" descriptor — verified by triggering autocomplete in a test and reading the candidate set.
2. In `aggregate` mode, typing `$` at the start of a stage object offers pipeline stages (at minimum `$match`, `$project`, `$group`, `$sort`, `$limit`, `$skip`, `$unwind`, `$lookup`, `$count`, `$addFields`, `$replaceRoot`, `$facet`, `$out`, `$merge`); typing `$` inside a `$group`/`$project` accumulator position offers accumulators (`$sum`, `$avg`, `$min`, `$max`, `$push`, `$addToSet`, `$first`, `$last`, `$count`) — verified by asserting the candidate set differs between the find and aggregate positions.
3. Typing `$` inside a value position (e.g. an object value whose key is a normal field) offers BSON extended-JSON type tags (`$oid`, `$date`, `$numberLong`, `$numberDouble`, `$numberInt`, `$numberDecimal`, `$binary`, `$regularExpression`, `$timestamp`, `$minKey`, `$maxKey`, `$symbol`, `$code`) — verified by reading candidate labels.
4. When the active tab points at a document collection whose schema store has cached field names (from a recent find/aggregate execution), those field names appear as autocomplete candidates at JSON key positions in both `find` filter and `$match` stage bodies — verified with a store that is seeded with a known field set.
5. The JSON highlighting layer visually distinguishes recognized MongoDB operator/stage/accumulator/type-tag strings from ordinary JSON keys (e.g. via a dedicated token class) so the editor reads as MQL, not just raw JSON — verified by rendering a fixture and asserting a distinct class/attribute on the operator tokens.
6. RDB tabs are untouched — the SQL completion and highlighting path from Sprint 82 remains byte-for-byte the same for rdb paradigm tabs, verified by a regression test that the rdb completion set contains no `$`-prefixed entries.

**Components to Create/Modify**
- `src/components/query/QueryEditor.tsx`: add a MongoDB-aware completion source layered on top of the JSON extension for document paradigm; expose a mode-aware candidate set (find vs aggregate); add a highlight decoration / syntax tag for MQL operator strings.
- `src/hooks/useMongoAutocomplete.ts` (new or equivalent sibling): produce the operator/stage/accumulator/type-tag candidate set, plus collection-field candidates pulled from existing document state.
- `src/components/query/QueryTab.tsx`: resolve the collection field source for the active document tab and forward it to the editor.
- `src/components/query/QueryEditor.test.tsx`: add MongoDB completion cases covering find operators, aggregate stages/accumulators, BSON type tags, and field-name completion; add a visual highlight assertion.

### Sprint 84: History entries remember paradigm, queryMode, and document target

**Goal**: Every query history entry written during execution carries the authoring tab's paradigm + queryMode and (for document paradigm) database/collection, and restoring a history entry (double-click / load) opens or reuses a tab whose shape matches the entry so the editor lands on the correct language, autocomplete set, and execution path.

**Verification Profile**: mixed

**Acceptance Criteria**
1. Executing a query in an RDB tab records a history entry whose paradigm is `"rdb"` and whose `queryMode` is `"sql"`; executing in a document+find tab records `paradigm: "document"`, `queryMode: "find"`, plus the target `database` + `collection`; executing in a document+aggregate tab records `paradigm: "document"`, `queryMode: "aggregate"`, plus database/collection — verified by asserting `useQueryHistoryStore.getState().entries[0]` after each simulated run.
2. Both per-tab history and the global query log carry the same paradigm/mode/db/collection metadata — verified by checking the first entry in `globalLog` after a run.
3. Loading a history entry whose paradigm matches the active tab's paradigm replaces the editor text and queryMode (documents) without opening a new tab; loading an entry whose paradigm does not match the active tab creates a new query tab with the recorded paradigm + queryMode + database + collection (when present), and focuses it — verified by the resulting tab store state after the restore action.
4. Legacy history entries persisted before this sprint (no paradigm field) are treated as `paradigm: "rdb"` / `queryMode: "sql"` at read time, and the store migration does not throw or drop entries — verified by seeding the store with a legacy entry shape and asserting the restored entry defaults.
5. The in-tab history list, the double-click row action, and the dedicated "Load into editor" button all behave consistently under (3) — verified by RTL tests exercising each restoration path.

**Components to Create/Modify**
- `src/stores/queryHistoryStore.ts`: extend `QueryHistoryEntry` with `paradigm`, `queryMode`, and optional `database`/`collection`; keep backward-compat deserialization for legacy persisted entries.
- `src/components/query/QueryTab.tsx`: every `addHistoryEntry(...)` call records the new fields sourced from the tab's current `paradigm`/`queryMode`/`database`/`collection`; restore actions route through a paradigm-aware "open or update tab" helper.
- `src/stores/tabStore.ts`: helper (or extended `addQueryTab`/load-into-tab behavior) that accepts a paradigm+queryMode+db+collection+sql payload and either mutates the active tab in place (same paradigm) or creates a new tab (different paradigm).
- `src/stores/queryHistoryStore.test.ts` and `src/components/query/QueryTab.test.tsx`: new cases for recording and restoring across all three shapes + legacy migration.

### Sprint 85: History viewers highlight per paradigm

**Goal**: Every place that previews a saved query — the inline history panel under a query tab, the global query log panel, and the expanded entry view — renders the query with paradigm-appropriate highlighting (SQL via the existing `SqlSyntax` tokenizer when `paradigm === "rdb"`, JSON + MQL-operator emphasis when `paradigm === "document"`), so users can scan historical work without loading each entry.

**Verification Profile**: mixed

**Acceptance Criteria**
1. A per-tab history row whose entry is `paradigm: "rdb"` renders through the existing SQL highlighter and preserves the existing truncation, hover, and load affordances — verified by rendering a tab with a seeded RDB entry and asserting SQL keyword class names in the DOM.
2. A per-tab history row whose entry is `paradigm: "document"` renders the query body with JSON highlighting (strings, numbers, punctuation, booleans) plus a distinct class/attribute on MongoDB operator strings (e.g. `$match`, `$sum`, `$oid`) so an operator is visually separable from a normal field name — verified by rendering a seeded document entry and asserting the distinguishing class on at least one operator token.
3. The global query log panel applies the same per-paradigm highlighting to every entry it lists; entries whose paradigm is unknown/legacy fall back to the SQL highlighter — verified by rendering the panel with one entry of each shape and asserting the expected renderer class signature per row.
4. When an entry is expanded (global log full-text view), the expanded body uses the same paradigm-aware renderer as the collapsed row — verified by expanding a document entry in a test and asserting the operator-token class in the expanded element.
5. All previous renderings are read-only; no existing editor or store gets mutated by the viewers — verified by asserting store identity across renders and by ESLint-level checks on props (no write accessors).

**Components to Create/Modify**
- `src/components/shared/SqlSyntax.tsx` (and/or a new sibling `src/components/shared/QuerySyntax.tsx`): introduce a paradigm-dispatching wrapper so consumers pass a `paradigm` (plus optional `queryMode`) and receive SQL or JSON+MQL highlighted output.
- `src/components/shared/MongoSyntax.tsx` (new or equivalent): tokenize JSON and tag MQL operator/stage/accumulator/type-tag strings with a distinguishing class, reusing the operator set from Sprint 83.
- `src/components/query/QueryTab.tsx`: swap the in-tab history row preview to the new paradigm-aware wrapper.
- `src/components/query/GlobalQueryLogPanel.tsx`: swap the collapsed row text and expanded `<pre>` to the new paradigm-aware wrapper, with a legacy-SQL fallback.
- Corresponding test files for each touched component.

## Global Acceptance Criteria

1. No regression in the full vitest suite as of the Sprint 76 baseline — every prior passing test still passes after each sprint, and new tests are added for each criterion.
2. `pnpm tsc --noEmit` and `pnpm lint` remain at zero errors / zero warnings after each sprint.
3. `src-tauri/**` is not modified by any sprint in this spec — autocomplete and highlighting are frontend-only; backend Tauri command surfaces are unchanged.
4. Persisted user data from prior versions (tabs in `table-view-tabs`, history entries) loads without error after each sprint and defaults to RDB/SQL where paradigm information is missing.
5. The CodeMirror editor instance survives dialect + paradigm swaps without teardown — referential equality of the `EditorView` holds across both Sprint 82 and Sprint 83 reconfigure paths.

## Data Flow

- **Dialect resolution (Sprint 82)**: tab → `connectionStore.connections[tab.connectionId].db_type` → dialect enum → passed as prop into the editor's language compartment.
- **MQL candidate source (Sprint 83)**: static operator/stage/accumulator/type-tag lists live in a new frontend module; collection field candidates come from the existing document store (`raw_documents` / columns) and may be augmented by a schema-store-level cache if a lightweight store entry is added.
- **History metadata flow (Sprint 84)**: `QueryTab.handleExecute` reads `tab.paradigm`, `tab.queryMode`, `tab.database`, `tab.collection` at the moment of execution and passes them to `addHistoryEntry`; `queryHistoryStore` stores them alongside the existing fields.
- **Restore flow (Sprint 84)**: double-click / load button calls a new helper on `tabStore` that reads the entry's paradigm and either updates the active tab (same paradigm) or calls `addQueryTab(connectionId, { paradigm, queryMode, database, collection })` and seeds `sql` via `updateQuerySql`.
- **Viewer dispatch (Sprint 85)**: wrappers read `entry.paradigm` and select the right tokenizer/renderer; no IPC.

No Tauri `invoke` surface changes across all four sprints.

## UI States

- **Loading (Sprint 82–83)**: autocomplete sources that depend on the schema/document store show no candidates while the store is empty; no spinner is required — the popup simply omits them. Keywords/operators from static lists are always available.
- **Empty (Sprint 84–85)**: an RDB tab with an empty history list renders nothing new (existing behavior). A document tab that has never executed a query renders the same empty state; the global log empty state remains the existing "No queries executed yet".
- **Error (Sprint 82–83)**: a tab whose connection cannot be resolved (disconnected, unknown `db_type`) falls back to StandardSQL / generic JSON; no error banner is shown inside the editor.
- **Success (Sprint 82–85)**: keyword/operator tokens are visibly colored; autocomplete popup lists the expected candidates; history rows show paradigm-appropriate coloration.

## Edge Cases

- Tab whose connection was deleted between creation and execution → dialect resolver returns `null`, fall back to StandardSQL; history records record `paradigm: "rdb"` if the tab already had that field, or `"rdb"` by migration default.
- User changes a connection's `db_type` in-place via the connection dialog while a query tab is open → editor reconfigures on next render; the CodeMirror view is reused, not recreated.
- Aggregate pipeline with a stage whose keys are both a stage operator and a field name (e.g. `$count` as both a stage and an accumulator) → completion surfaces the candidate with a descriptor disambiguating stage vs accumulator; selecting either inserts the correct string.
- Nested `$expr` in a find filter — type-tag and aggregation-expression completion should work inside nested scope; simplest-correct behavior is: inside any object value, operators + type tags are offered; the Evaluator does not require deep-context scope analysis.
- Document tab whose target collection has no cached documents yet → field-name candidates are empty but static operator/stage/accumulator candidates are still offered.
- History entry whose `sql` field is not valid JSON under `paradigm: "document"` (e.g. corrupted) → the JSON+MQL renderer degrades to rendering the raw text inside a `<pre>`, not throwing.
- Legacy history entry from before Sprint 84 → migration defaults to RDB/SQL; loading it creates/updates an RDB tab.
- Very long query text (> 10k chars) in a history row → existing truncation at 80 chars still applies; the paradigm-aware renderer is only invoked on the truncated or expanded slice, not the full body, to avoid tokenizer cost.
- User toggles find ↔ aggregate on a document tab that already has content — existing Sprint 73 behavior is preserved; only the active candidate set changes.

## Verification Hints

- Run `pnpm vitest run src/components/query/QueryEditor.test.tsx src/hooks/useSqlAutocomplete.test.ts src/hooks/useMongoAutocomplete.test.ts src/stores/queryHistoryStore.test.ts src/components/query/QueryTab.test.tsx src/components/query/GlobalQueryLogPanel.test.tsx src/components/shared/SqlSyntax.test.tsx src/components/shared/MongoSyntax.test.tsx` per sprint (subset as each sprint adds files) to validate the sprint's AC set in isolation.
- Manual browser: open a Postgres tab, type `RETURNING` and confirm it's highlighted as a keyword; open a MySQL tab, type `REPLACE INTO`; open a MongoDB find tab, type `{ "$` and confirm the operator popup; switch to aggregate, type `[{"$` and confirm stage popup; run queries in each and confirm the history list renders each with its own coloration.
- Evidence the Evaluator should require: (a) DOM assertions for keyword class on dialect-specific tokens, (b) candidate-set equality assertions for the MQL operator/stage/accumulator/type-tag lists, (c) `QueryHistoryEntry` shape assertions post-execution for each of the three tab shapes, (d) referential-equality assertion on `EditorView` across dialect and paradigm swaps, (e) `src-tauri/**` diff empty at every sprint boundary.
