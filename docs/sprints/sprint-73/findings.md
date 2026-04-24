# Sprint 73 Findings — Phase 6 plan E-2 (Frontend Find/Aggregate UI)

## Sprint 73 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | 9/10 | Every AC maps to concrete code + passing test. `handleExecute` branches (`src/components/query/QueryTab.tsx:119-262`) are clean and respect the existing stale-guard via `queryId` equality. `QueryEditor` Compartment reconfigure (`src/components/query/QueryEditor.tsx:103,121-126,216-224`) survives paradigm flips — verified by `viewAfter === viewBefore` assertion in the new `reconfigures the language in-place when paradigm flips (editor survives)` test. `runAggregate` (`src/stores/documentStore.ts:162-178`) is a faithful copy of `runFind` with a distinct key prefix (`agg:`/`aggregate:`) that prevents collision. |
| Completeness | 9/10 | All 13 ACs satisfied. 30 new tests (min 6) across four files. Format/uglify guards (`src/components/query/QueryTab.tsx:455,485`) hide SQL-only UI on document tabs. `loadPersistedTabs` migrator (`tabStore.ts:349-363`) handles legacy persisted tabs. `clearConnection` now scrubs aggregate cache + counters (`documentStore.ts:185,198,210`). Out-of-scope items (MQL Preview, insert/update/delete, sidebar entry points) correctly deferred to Sprint 80. |
| Reliability | 8/10 | stale-guard pattern applied consistently in document branch (`QueryTab.tsx:194-218,227-252`) — the `useTabStore.setState` callback re-reads current state and only commits if `queryState.status === "running" && queryId === current.queryId`. Store-level `setQueryMode` guards against paradigm drift (rdb + non-sql writes rejected, `tabStore.ts:317`). Referential equality preserved on no-op `setQueryMode` (`tabStore.ts:318`). JSON parse error uses existing `QueryState: "error"` slot (no new error UI). Minor nit: the `setQueryMode` action doesn't also bar `"sql"` writes on document tabs, so a document tab could in theory be set back to `"sql"` — but addQueryTab already gates the paradigm→mode combo, and the UI only exposes find/aggregate, so this is not reachable in practice. |
| Verification Quality | 9/10 | All 4 generator-scope checks re-executed PASS (tsc 0 err, lint 0 err, scoped vitest 4/4 files 119/119 passed, cargo clippy 0 warn). Full vitest: 72 files / 1389 passed (+101 vs Sprint 72 baseline). `git diff --stat HEAD -- src-tauri/` empty. Sprint 74 locked paths (`DocumentDataGrid*`, `QuickLookPanel*`, `BsonTreeViewer*`) all diff-empty. `DataGrid.tsx` / `datagrid/**` modifications confirmed to be Sprint 74's `pendingEditErrors` / validation-hint work — zero Sprint 73 overlap (grep for `paradigm/queryMode/findDocuments/aggregateDocuments/QueryMode` under `datagrid/**` returned only pre-existing Sprint 66 references in `useDataGridEdit.ts`). |
| **Overall** | **9/10** | Strong implementation. Compartment handling is textbook, stale-guard is real (not cargo-culted), and the AC coverage is exhaustive. Minor polish opportunities noted below. |

## Verdict: PASS

## Sprint Contract Status (Done Criteria)

- [x] AC-01 `QueryTab.paradigm: Paradigm` + `queryMode: "sql"|"find"|"aggregate"` with defaults rdb/sql. `src/stores/tabStore.ts:54` (`QueryMode` type), `:57-82` (interface), `:264-294` (addQueryTab default logic). Test: `tabStore.test.ts:290` ("addQueryTab without opts defaults to paradigm=rdb + queryMode=sql").
- [x] AC-02 `addQueryTab(connId)` back-compat + `addQueryTab(connId, opts)` + `setQueryMode`. `tabStore.ts:128-139` (types), `:264-294` (impl), `:310-321` (setQueryMode). Tests: `addQueryTab with document + aggregate preserves the opts`, `setQueryMode toggles between find and aggregate...`, `setQueryMode on an rdb tab rejects non-sql modes`.
- [x] AC-03 `aggregateDocuments` wrapper + `invoke("aggregate_documents", ...)` → `Promise<DocumentQueryResult>`. `src/lib/tauri.ts:392-404`. Test coverage via `documentStore.test.ts:192` verifying mock invoke args.
- [x] AC-04 `documentStore.runAggregate` stale-guard mirrors `runFind`. `documentStore.ts:162-178`. Test: `runAggregate stale response does not overwrite a newer response` (total_count 77 survives even after the late slow write tries to stamp 999).
- [x] AC-05 `QueryEditor` swaps `@codemirror/lang-json` for document paradigm, preserves SQL for rdb, uses `Compartment.reconfigure`. `QueryEditor.tsx:46-64` (builders), `:103` (compartment ref), `:121-126` (initial extension), `:216-224` (reconfigure on `[paradigm, schemaNamespace]`). Tests: `uses the SQL language extension by default`, `swaps to the JSON language when paradigm=document`, `reconfigures the language in-place when paradigm flips (editor survives)` — asserts `viewAfter === viewBefore`.
- [x] AC-06 Find/Aggregate toggle renders only on document tabs; clicks dispatch `setQueryMode`. `QueryTab.tsx:587-606` (shadcn `<ToggleGroup>` / `<ToggleGroupItem>`). Tests: `renders the Find | Aggregate toggle only for document paradigm`, `clicking the Aggregate toggle calls setQueryMode and flips tab state`.
- [x] AC-07 `handleExecute` branches by paradigm + queryMode. `QueryTab.tsx:119-262` (document block: ctx check → JSON.parse → aggregate vs find dispatch). Tests: `rdb paradigm routes handleExecute through executeQuery (regression)`, `document+find calls findDocuments with the parsed filter`, `document+aggregate calls aggregateDocuments with the pipeline array`.
- [x] AC-08 JSON parse failure surfaces `Invalid JSON: ...` in `queryState.error` (reuses existing QueryState error slot). `QueryTab.tsx:131-139`. Tests: `surfaces an Invalid JSON error when the body can't be parsed`, `document tabs survive a successful run followed by a JSON error (idempotent)`.
- [x] AC-09 Mod-Enter is paradigm-agnostic. `QueryEditor.tsx:133-139` has no paradigm branch. Existing `calls onExecute on Mod-Enter keypress` test covers rdb; the execute-btn path in document tests exercises the same `onExecute` callback wiring.
- [x] AC-10 `src-tauri/**` diff 0. Confirmed via `git diff --stat HEAD -- src-tauri/` → empty output.
- [x] AC-11 Sprint 74 locked paths diff 0 for Sprint 73 scope. `git diff --stat HEAD -- src/components/DocumentDataGrid.tsx ... BsonTreeViewer.test.tsx` → empty. `DataGrid.tsx` + `datagrid/**` have uncommitted changes from a parallel Sprint 74 agent (`pendingEditErrors`, validation-hint), but grep verified zero Sprint 73 concerns (`paradigm`/`queryMode`/`findDocuments`/`aggregateDocuments`/`QueryMode`) appear there — paradigm refs in `useDataGridEdit.ts` predate to Sprint 66.
- [x] AC-12 30 new tests (tabStore 8 + documentStore 4 + QueryEditor 5 + QueryTab 13). Exceeds the min 6 by 5×.
- [x] AC-13 All 4 generator-scope checks PASS. Full vitest suite 1389/1389.

## Verification Re-run Evidence

| Check | Result |
|---|---|
| `pnpm tsc --noEmit` | PASS — 0 type errors (silent exit). |
| `pnpm lint` | PASS — ESLint 0 errors / 0 warnings. |
| `pnpm vitest run src/stores/tabStore.test.ts src/stores/documentStore.test.ts src/components/query/QueryEditor.test.tsx src/components/query/QueryTab.test.tsx` | PASS — 4 files / 119 tests. |
| `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` | PASS — 0 warn, `Finished dev profile`. |
| `pnpm vitest run` (full suite) | PASS — 72 files / 1389 tests. |
| `git diff --stat HEAD -- src-tauri/` | empty. |
| `git diff --stat HEAD -- src/components/DocumentDataGrid*.tsx src/components/shared/QuickLookPanel*.tsx src/components/shared/BsonTreeViewer*.tsx` | empty. |

## Feedback for Generator (Polish — non-blocking)

1. **runAggregate cache key encodes entire pipeline as JSON** — `documentStore.ts:163` uses `JSON.stringify(pipeline)` as part of the cache key. For large pipelines (10+ stages with dense stage objects) this can produce multi-KB keys and re-serialize on every invocation.
   - Current: `cacheKey = agg:${connectionId}:${database}:${collection}:${JSON.stringify(pipeline)}`.
   - Expected (nice-to-have): a short hash (e.g. 64-bit FNV or a stable fingerprint) for cache keys so very large pipelines don't bloat the in-memory map.
   - Suggestion: deferrable to Sprint 80 when the full MQL preview arrives; not required for PASS.

2. **`setQueryMode` allows redundant `"sql"` writes on document tabs** — `tabStore.ts:310-321` only bars non-sql writes on rdb tabs; a document tab can technically be `setQueryMode(id, "sql")` which would desync paradigm/mode.
   - Current: `if (t.paradigm === "rdb" && mode !== "sql") return t;` — no symmetric guard for document paradigm rejecting `"sql"`.
   - Expected: also reject `"sql"` on document tabs for parity.
   - Suggestion: add `if (t.paradigm === "document" && mode === "sql") return t;` on line 318. Unreachable in current UI (the ToggleGroup only exposes `find`/`aggregate`), but the invariant should be store-enforced. This is a paranoid defense; not a bug under current surface area.

3. **JSON-parse error path doesn't record history entry** — the SQL path always calls `addHistoryEntry` (success or error). The document JSON-parse failure path (`QueryTab.tsx:131-139`) updates `queryState` to error but returns before any history entry is logged.
   - Current: `updateQueryState(..., "error", "Invalid JSON: ...") ; return;` — no `addHistoryEntry`.
   - Expected: consistent history coverage so users can recover the malformed body from the history panel.
   - Suggestion: `addHistoryEntry({ sql, executedAt: Date.now(), duration: 0, status: "error", connectionId })` before returning. Low urgency — arguably right to exclude un-executed input, but the contract doesn't specify either way.

4. **Context-missing error isn't caught in history either** — same pattern as (3): `QueryTab.tsx:121-128` rejects tabs lacking db/collection without logging history. Same trade-off as above.

5. **Compartment single-compartment handles both paradigm + schemaNamespace** — one Compartment reused for SQL namespace updates and paradigm flips. Works today because every reconfigure rebuilds the full extension via `buildLangExtension(paradigm, schemaNamespace)`. If someone later adds a third axis (e.g. themes), they'll have to remember to merge it through this same Compartment or introduce a second one. Consider a brief code comment at `QueryEditor.tsx:103` flagging this single-compartment invariant (already mentioned in the handoff but worth in-source).
   - Current: comment at `QueryEditor.tsx:99-102` mentions Sprint 73 merging paradigm into the same Compartment as schemaNamespace.
   - Expected: could add a one-liner noting "any future axis must also be folded here or given its own Compartment".
   - Suggestion: cosmetic; skip unless touching the file again.

6. **Test naming nitpick** — `QueryEditor.test.tsx:409` ("flips the aria-label when paradigm changes") actually tests flipping queryMode within the document paradigm, not paradigm flips. Rename to `flips the aria-label when queryMode changes within document paradigm` for accuracy. Not a correctness issue.

## Parallel Agent Contamination Audit

- `src/components/DataGrid.tsx` diff: single-line addition of `pendingEditErrors={editState.pendingEditErrors}` prop forwarding — pure Sprint 74 work.
- `src/components/datagrid/DataGridTable.tsx`, `sqlGenerator.{ts,test.ts}`, `useDataGridEdit.ts` diffs: all related to type-aware NULL editor, validation hint, and pendingEditErrors — pure Sprint 74 work.
- Greps for `paradigm|queryMode|findDocuments|aggregateDocuments|QueryMode` in `src/components/datagrid/**` return only pre-existing Sprint 66 `paradigm?: "rdb" | "document" | ...` guards in `useDataGridEdit.ts`. Zero Sprint 73 contamination.
- `src/components/datagrid/DataGridTable.validation-hint.test.tsx` + `useDataGridEdit.validation.test.ts` untracked — Sprint 74 artifact.

Sprint 73 write-scope adherence: clean.

## Handoff Artifact Notes

- This findings file doubles as the handoff; the Generator's own `handoff.md` is the source of truth for file-level details. No additional handoff artifact needed.
