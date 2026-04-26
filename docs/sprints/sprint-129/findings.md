# Sprint 129 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | 9/10 | All AC-01..AC-10 satisfied with concrete code evidence. `TableTab` carries `database?` / `collection?` (both optional) at `src/stores/tabStore.ts:33-45`. `DocumentDatabaseTree.handleCollectionOpen` at `src/components/schema/DocumentDatabaseTree.tsx:93-115` writes both new and legacy fields with explicit comments. `MainArea.tsx:33-44` uses new fields with schema/table fallback; outer gate at `MainArea.tsx:202-205` also falls back. `loadPersistedTabs` migration at `tabStore.ts:531-553` is correctly gated by `paradigm === "document"` (RDB tabs unaffected) and idempotent (`t.database ?? t.schema`). |
| Completeness | 9/10 | All 10 acceptance criteria mapped. `Folder`/`FolderOpen` imports removed (only a doc comment mentions the metaphor at line 30); single `DbIcon` rendered at `DocumentDatabaseTree.tsx:310`. Search input at lines 213-231 has `aria-label="Filter databases and collections"`, Escape clears (lines 218-223). Zero-result message at lines 252-260 uses the contract-mandated `No databases match "<query>"` text and is distinct from the existing "No databases visible to this connection" empty state (lines 244-248). Auto-expand on collection match (lines 145-189) goes beyond strict requirements but matches the design bar. |
| Reliability | 9/10 | Migration is idempotent and explicitly leaves RDB tabs untouched (test asserts both `database` and `collection` are `undefined` for paradigm `"rdb"`). MainArea has both inner field-fallback and outer gate-fallback for safety. Search filter is purely client-side (no fetch side effect) and uses `useMemo` keyed on the right deps. `autoExpandedRef` carefully tracks search-only expansions so clearing the query restores the user's manual state. The `eslint-disable-next-line react-hooks/exhaustive-deps` for the auto-expand effect is documented inline with intent and not load-bearing. PG path: `src/components/schema/SchemaTree.tsx`, `src/components/rdb/`, and `src-tauri/` are completely untouched (`git diff --stat` confirms). |
| Verification Quality | 9/10 | All 4 commands run clean: vitest `1957/1957 passed (123 files)` (was 1948 → +9 new), `tsc --noEmit` 0 errors, `lint` 0 errors/0 warnings, `contrast:check` 0 new violations (allowlist 64 unchanged). New tests cover all required scenarios: backfill happy path (`tabStore.test.ts:888-920`), RDB tab no-op (`tabStore.test.ts:922-953`), idempotent (`tabStore.test.ts:955-985`), addTab payload (`DocumentDatabaseTree.test.tsx:74-106`), search aria-label (lines 141-148), case-insensitive `"AD"` → admin only (lines 150-167), zero-result message + sanity-check on the original empty state (lines 169-186), collection-name auto-expand (lines 188-221), Folder icon absence + Database icon presence (lines 223-246), Escape clear (lines 248-267). e2e static compile: no e2e files modified, main `tsc --noEmit` already passes; assumption documented in handoff. |
| **Overall** | **9.0/10** | |

## Verdict: PASS

All four dimensions ≥ 7/10.

## Sprint Contract Status (Acceptance Criteria)

- [x] **AC-01** `TableTab.database?` / `TableTab.collection?` both optional — `src/stores/tabStore.ts:33-45` (JSDoc explicitly notes RDB tabs never set them).
- [x] **AC-02** `DocumentDatabaseTree.addTab` populates `database`/`collection` and (for backwards-compat) `schema`/`table` — `src/components/schema/DocumentDatabaseTree.tsx:93-115`. Test `DocumentDatabaseTree.test.tsx:74-106` asserts all four fields.
- [x] **AC-03** `MainArea.tsx` document case prefers new fields with fallback — `src/components/layout/MainArea.tsx:32-44`. Outer gate also falls back at lines 202-205.
- [x] **AC-04** `loadPersistedTabs` document-tab backfill — `src/stores/tabStore.ts:531-553`. Three migration tests cover backfill / RDB no-op / idempotent.
- [x] **AC-05** Folder/FolderOpen removed → single `Database` icon — `DocumentDatabaseTree.tsx` no longer imports `Folder`/`FolderOpen` (verified by Grep), only a doc comment at line 30 mentions the removed metaphor; `<DbIcon>` at line 310 is the sole row icon. Test at `DocumentDatabaseTree.test.tsx:223-246` asserts `svg.lucide-folder` and `svg.lucide-folder-open` are absent and `svg.lucide-database` count ≥ 2.
- [x] **AC-06** Search input with `aria-label="Filter databases and collections"`, case-insensitive, zero-result message — `DocumentDatabaseTree.tsx:213-231` (input) and 250-260 (zero-result with `aria-live="polite"`). Tests at `DocumentDatabaseTree.test.tsx:141-186`.
- [x] **AC-07** Cross-match (db name OR collection name), collection match auto-expands — `DocumentDatabaseTree.tsx:128-189`. Test at `DocumentDatabaseTree.test.tsx:188-221` (search "user" auto-expands `table_view_test`).
- [x] **AC-08** New unit tests for tabStore (3) and DocumentDatabaseTree (6) — totals match handoff (+9 = 1948 → 1957).
- [x] **AC-09** All 5 verification commands green (vitest 1957/1957, tsc 0, lint 0, contrast 0 new, e2e static compile no regression — no e2e files modified per `git diff --stat HEAD -- e2e/`).
- [x] **AC-10** PG workspace regression-free — `git diff --stat` shows zero changes under `src/components/schema/SchemaTree.tsx`, `src/components/rdb/`, or `src-tauri/`. RDB-paradigm `paradigm === "document"` gate in the migration explicitly preserves `database`/`collection` as `undefined` for RDB tabs (asserted at `tabStore.test.ts:947-952`).

## Verification Command Outcomes

| Command | Outcome |
| --- | --- |
| `pnpm vitest run` | PASS — 1957 tests / 123 files, +9 from baseline 1948, 0 regressions |
| `pnpm tsc --noEmit` | PASS — 0 errors |
| `pnpm lint` | PASS — 0 errors / 0 warnings |
| `pnpm contrast:check` | PASS — 0 new violations (64 allowlisted unchanged) |
| e2e static compile | PASS — no e2e files modified; main `tsc --noEmit` covers the rest |

## Critical Evidence (cited)

1. **`TableTab` shape** — `src/stores/tabStore.ts:33-45`:
   ```ts
   /** Sprint 129 — document-paradigm-specific MongoDB database name. Optional ... */
   database?: string;
   /** Sprint 129 — document-paradigm-specific MongoDB collection name. Optional ... */
   collection?: string;
   ```

2. **DocumentDatabaseTree addTab** — `src/components/schema/DocumentDatabaseTree.tsx:95-112`:
   ```tsx
   addTab({
     type: "table",
     title: `${dbName}.${collectionName}`,
     connectionId,
     closable: true,
     database: dbName,
     collection: collectionName,
     schema: dbName,
     table: collectionName,
     subView: "records",
     paradigm: "document",
   });
   ```

3. **loadPersistedTabs migration** — `src/stores/tabStore.ts:539-552`:
   ```ts
   const paradigm = t.paradigm ?? ("rdb" as const);
   const isDocument = paradigm === "document";
   const database = isDocument ? (t.database ?? t.schema) : t.database;
   const collection = isDocument ? (t.collection ?? t.table) : t.collection;
   return { ...t, isPreview: false, paradigm, sorts: t.sorts ?? [], database, collection };
   ```

4. **MainArea inner case** — `src/components/layout/MainArea.tsx:36-44`:
   ```tsx
   <DocumentDataGrid
     connectionId={tab.connectionId}
     database={tab.database ?? tab.schema!}
     collection={tab.collection ?? tab.table!}
   />
   ```
   Outer gate at `MainArea.tsx:202-205`:
   ```tsx
   {activeTab?.type === "table" &&
     (activeTab.table ?? activeTab.collection) &&
     (activeTab.schema ?? activeTab.database) ? (
   ```

5. **Folder icon removal** — `Grep "Folder|FolderOpen"` in `DocumentDatabaseTree.tsx` finds only one match (the doc comment at line 30: `Sprint 129 — RDB-folder metaphor (Folder/FolderOpen) removed`). No `Folder`/`FolderOpen` import or JSX usage. Single `DbIcon` rendered at line 310.

6. **Search 0-result message** — `DocumentDatabaseTree.tsx:250-260`:
   ```tsx
   {!loadingRoot && databaseList.length > 0 && filteredDatabases.length === 0 && (
     <div ... role="status" aria-live="polite">
       No databases match &quot;{trimmedQuery}&quot;
     </div>
   )}
   ```

7. **Backend / PG untouched** — `git diff --stat HEAD -- src-tauri/` and `git diff --stat HEAD -- src/components/schema/SchemaTree.tsx` and `git diff --stat HEAD -- e2e/` and `git diff --stat HEAD -- src/components/rdb/` all return empty.

## Findings

### P1 (Blocking)
None.

### P2 (Should fix)
None.

### P3 (Nit / Future)
1. **Auto-expand `eslint-disable-next-line react-hooks/exhaustive-deps`** at `DocumentDatabaseTree.tsx:182`. The omission of `expandedDbs` from deps is documented inline and the design avoids the obvious infinite loop, but a future refactor could move auto-expansion into a reducer (or compute the visible expansion set inline) to drop the disable. Not a sprint-129 concern.
2. **DocumentDataGrid alias preserved** — `DocumentDataGrid.tsx` still re-aliases `schema: database, table: collection` for the query store. Explicitly Out of Scope per contract; flagged for S130/S131 as residual risk. Already noted in the handoff.
3. **Auto-expand depends on cached collections** — collections that have never been expanded are never matched on collection name. Documented as design intent ("client-side only, no fetch on type"); aligned with contract design bar.

## Feedback for Generator

None required — the implementation matches the contract verbatim, all required tests are present and pass, all five verification commands are green, and PG/back-end paths are demonstrably untouched. The handoff is thorough (file:line citations, code quotes, residual risks called out with their tracked sprints).

## Handoff Evidence

- Changed files: `src/stores/tabStore.ts`, `src/stores/tabStore.test.ts`, `src/components/schema/DocumentDatabaseTree.tsx`, `src/components/schema/DocumentDatabaseTree.test.tsx`, `src/components/layout/MainArea.tsx` (5 files; matches handoff §Changed Files exactly).
- Test count: 1957 (was 1948, +9). Verified by re-running `pnpm vitest run`.
- Backend untouched: yes (verified).
- SchemaTree untouched: yes (verified).
- e2e specs untouched: yes (verified).
- Open P1/P2: 0 → exit criteria met.
