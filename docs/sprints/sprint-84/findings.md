# Sprint 84 Evaluation Scorecard

_Evaluator pass on the uncommitted working tree at `/Users/felix/Desktop/study/view-table`._
_Sprint 83 is committed at `abc2372`; all files in this evaluation are the Sprint 84 delta._

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness (35%) | 9/10 | `QueryHistoryEntry` is extended at `src/stores/queryHistoryStore.ts:18-33` with `paradigm`/`queryMode` declared required and `database?`/`collection?` optional. `addHistoryEntry` defaults `paradigm ?? "rdb"` / `queryMode ?? "sql"` (`queryHistoryStore.ts:89-90`). `filteredGlobalLog` normalises entries on the read path via `.map(normaliseEntry)` at `queryHistoryStore.ts:74-79, 127`, so legacy shapes injected via `setState` emerge as `rdb/sql`. `loadQueryIntoTab` (`tabStore.ts:356-407`) implements all spawn branches (no active / non-query active / different connection / different paradigm) via a single `canInPlace` predicate and performs an in-place `updateQuerySql` + `setQueryMode` when the active tab matches. All 5 `addHistoryEntry` callers in `QueryTab.tsx` at `:263-273, :300-310, :358-368, :395-405, :471-481` pass `paradigm/queryMode/database/collection`. Double-click (`QueryTab.tsx:818`) and "Load into editor" button (`QueryTab.tsx:840`) both invoke the same `handleLoad` closure at `QueryTab.tsx:805-813`, which routes through `loadQueryIntoTab` with `entry.paradigm ?? "rdb"` / `entry.queryMode ?? "sql"` fallbacks. Document in-place preserves the tab's `database`/`collection` (tabStore.ts:398-407) matching the execution brief's explicit assumption. Docked a point because `addQueryTab`'s "RDB forces sql" guard (`tabStore.ts:306-307`) causes `loadQueryIntoTab` to spawn a new tab with `queryMode: "sql"` even when the caller passed `queryMode: "aggregate"` with `paradigm: "rdb"`; the subsequent `updateQuerySql` writes sql but `queryMode` can drift silently. Not exercised by the contract (paradigm/mode pairs are always consistent in practice), so P3. |
| Completeness (25%) | 10/10 | All 11 Done Criteria and 13 ACs have concrete evidence. Exactly 19 net new tests across three files (`5 + 7 + 7`), clearing the ≥10 bar. Each AC maps to at least one test. Scope boundary respected: `src-tauri/` diff empty, `QueryEditor.tsx`, `QueryEditor.test.tsx`, `useSqlAutocomplete.ts`, `useMongoAutocomplete.ts`, `sqlDialect.ts`, `mongoAutocomplete.ts`, `GlobalQueryLogPanel.tsx`, `QueryLog.tsx`, `DataGrid.tsx`, `DocumentDataGrid.tsx`, `BsonTreeViewer.tsx`, `QuickLookPanel.tsx` diff empty. |
| Reliability (20%) | 9/10 | Full suite at 1525 pass (baseline 1506 + 19). No throws on legacy shape (`AC-05` test at `queryHistoryStore.test.ts:393-422`). Defensive reads in `QueryTab.tsx:808-809` + defensive normalise in `queryHistoryStore.ts:74-79` form the two-layer guard the contract asks for. Edge cases (no active tab, table tab active, different connection, different paradigm) all tested (`tabStore.test.ts:405-531`). Only concern: the documentation comment at `loadQueryIntoTab` describes 5 branch numbers (1..5) but the function's docblock earlier in the interface (`tabStore.ts:152-167`) says "4-branch". Cosmetic (P3); implementation is correct. |
| Verification Quality (20%) | 10/10 | All required commands executed with actual output. `pnpm tsc --noEmit` → exit 0. `pnpm lint` → exit 0. `pnpm vitest run src/stores/queryHistoryStore.test.ts src/stores/tabStore.test.ts src/components/query/QueryTab.test.tsx` → 3 files / 150 tests passed. `pnpm vitest run` → 77 files / 1525 tests passed. `git diff --stat HEAD -- src-tauri/` empty. `git diff --stat HEAD -- <forbidden paths>` empty. Test literal touch-ups in `QueryLog.test.tsx` / `GlobalQueryLogPanel.test.tsx` are compile-fix additions of the now-required `paradigm`/`queryMode` fields (the source renderer files are untouched), which is consistent with the contract's "renderer changes → Sprint 85" out-of-scope note. |
| **Overall** | **9.35/10** | Weighted: `0.35*9 + 0.25*10 + 0.20*9 + 0.20*10 = 9.35`. |

## Verdict: PASS

All four dimensions clear the ≥7/10 bar. No P1 findings. Full verification suite passes.

## AC Coverage

- **AC-01** (RDB entry has `paradigm:"rdb"`, `queryMode:"sql"`, no db/coll) — `queryHistoryStore.test.ts:292-317` ("records an rdb/sql entry with paradigm + queryMode (AC-01)") and `QueryTab.test.tsx:1382-1406` ("records rdb/sql metadata on history entry after RDB execute"). Both green.
- **AC-02** (Document+find entry carries `paradigm:"document"`, `queryMode:"find"`, `database`/`collection`) — `queryHistoryStore.test.ts:320-346` + `QueryTab.test.tsx:1409-1438`. Both green.
- **AC-03** (Document+aggregate entry) — `queryHistoryStore.test.ts:349-370` + `QueryTab.test.tsx:1441-1464`. Both green.
- **AC-04** (`globalLog[0]` mirrors `entries[0]` metadata) — asserted explicitly in both `queryHistoryStore.test.ts:312-316, 340-345, 368-369` and `QueryTab.test.tsx:1402-1405, 1430-1437`. Both green.
- **AC-05** (Legacy entry seeded via `setState` normalises to `rdb/sql` in `filteredGlobalLog`, no throw) — `queryHistoryStore.test.ts:393-422`. Green.
- **AC-06** (Same paradigm + same connection → in-place; no new tab; same id; sql updated) — `tabStore.test.ts:449-468`. Green.
- **AC-07** (Different paradigm / no active / table tab / different connection → new tab + focus) — `tabStore.test.ts:405-423, 427-446, 471-509, 512-531` (four separate tests) + `QueryTab.test.tsx:1560-1624`. All green.
- **AC-08** (Document restore propagates `database`/`collection` onto new tab + flips `queryMode` on in-place) — `tabStore.test.ts:471-509` (new-tab branch, lines 504-506), `tabStore.test.ts:535-562` (find→aggregate in-place), `QueryTab.test.tsx:1619-1622`. Green.
- **AC-09** (Double-click and "Load into editor" button both route through `loadQueryIntoTab`) — `QueryTab.test.tsx:1471-1514` (double-click in-place), `:1518-1554` (button in-place), plus cross-paradigm routing in `:1560-1624`. All observe the store-level transitions unique to `loadQueryIntoTab`. Green.
- **AC-10** (Mongo entry loaded while RDB tab is active does not corrupt the RDB tab) — `tabStore.test.ts:471-509` (asserts `originalTab.sql === "SELECT 1"` + `paradigm: "rdb"` untouched) and `QueryTab.test.tsx:1605-1612`. Green.
- **AC-11** (`pnpm tsc --noEmit`, `pnpm lint` → 0 errors / 0 warnings) — Re-run by evaluator, both exit 0.
- **AC-12** (`git diff --stat HEAD -- src-tauri/` empty) — Re-run by evaluator, empty.
- **AC-13** (≥10 new tests, total suite at Sprint 83 baseline 1506 or higher with regression 0) — Evaluator counted 5 + 7 + 7 = 19 new tests. Full suite 1525/1525 pass. Green.

## Findings

- **P3 (Cosmetic) — Branch-count language mismatch.** `tabStore.ts:152-167` calls `loadQueryIntoTab` a "paradigm-aware" restore helper and the implementation comment (`tabStore.ts:365-373`) enumerates 5 numbered branches, but the contract docblock text says "4-branch" in a couple of places. The behaviour is correct (the five cases collapse into two effective outcomes via `canInPlace`); only the inline numbering is inconsistent.
  - Suggestion (post-sprint): unify the wording to "two outcomes (spawn / in-place) guarded by `canInPlace`" or align the numbering by merging cases 3 and 4 (both are "different connection/paradigm") into a single bullet.
- **P3 (Theoretical only) — `loadQueryIntoTab(rdb, aggregate)` would silently drop `queryMode`.** If a caller ever passed `paradigm: "rdb"` with `queryMode: "aggregate"` (nonsensical but type-permitted), `addQueryTab`'s RDB guard at `tabStore.ts:306-307` forces `"sql"`. The subsequent `updateQuerySql` call writes sql but never surfaces the requested `queryMode`. No caller in the current code path constructs such a pair (history entries are built from real tab state), so this is not reachable today.
  - Suggestion (optional hardening): add an `expect.assert` / comment in `loadQueryIntoTab` that rdb always implies sql, mirroring the `setQueryMode` guard. Purely defensive; can wait for Sprint 85 or later.
- **P3 (Style) — Test-file compile fixups touched renderer tests.** `QueryLog.test.tsx` and `GlobalQueryLogPanel.test.tsx` are test-only (no source change) but outside the contract's Write scope bullet list. The Generator documented this as an explicit assumption in the evidence packet. The contract lists the renderer *source* files as forbidden, not their sibling tests, and failing to add the required fields would break TS compile (AC-11). Accepted as a pragmatic TS-compile follow-through, but future contracts should either (a) list tests as allowed or (b) use a type-level escape hatch inside the store for test harnesses.

## Evidence for `handoff.md`

- **Changed source**: `src/stores/queryHistoryStore.ts`, `src/stores/tabStore.ts`, `src/components/query/QueryTab.tsx`
- **Changed tests**: `src/stores/queryHistoryStore.test.ts`, `src/stores/tabStore.test.ts`, `src/components/query/QueryTab.test.tsx`
- **Compile-fix tests**: `src/components/query/QueryLog.test.tsx`, `src/components/query/GlobalQueryLogPanel.test.tsx` (paradigm/queryMode field injection for 14 + 17 literal entries respectively; renderer source untouched)
- **Key implementation pointers**:
  - `QueryHistoryEntry.paradigm/queryMode` declaration: `src/stores/queryHistoryStore.ts:18-33`
  - `AddHistoryEntryPayload` (optional paradigm/queryMode on input): `src/stores/queryHistoryStore.ts:42-48`
  - Payload defaulting: `src/stores/queryHistoryStore.ts:89-90`
  - Read-path normalise: `src/stores/queryHistoryStore.ts:74-79, 127`
  - `loadQueryIntoTab` interface: `src/stores/tabStore.ts:152-167`
  - `loadQueryIntoTab` impl: `src/stores/tabStore.ts:356-407`
  - 5 `addHistoryEntry` callers (paradigm/queryMode/database/collection): `src/components/query/QueryTab.tsx:263-273, 300-310, 358-368, 395-405, 471-481`
  - `loadQueryIntoTab` selector: `src/components/query/QueryTab.tsx:74`
  - History row `handleLoad` closure: `src/components/query/QueryTab.tsx:805-813`
  - Double-click handler: `src/components/query/QueryTab.tsx:818`
  - "Load into editor" button: `src/components/query/QueryTab.tsx:840`
- **Verification (evaluator-run)**:
  - `pnpm tsc --noEmit` → exit 0, no output
  - `pnpm lint` → exit 0, no output
  - `pnpm vitest run src/stores/queryHistoryStore.test.ts src/stores/tabStore.test.ts src/components/query/QueryTab.test.tsx` → 3 files / 150 tests passed, duration 1.21s
  - `pnpm vitest run` → 77 files / 1525 tests passed, duration 12.43s
  - `git diff --stat HEAD -- src-tauri/` → empty
  - `git diff --stat HEAD -- src/components/datagrid/ src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/BsonTreeViewer.tsx src/components/shared/QuickLookPanel.tsx src/hooks/useSqlAutocomplete.ts src/hooks/useMongoAutocomplete.ts src/lib/sqlDialect.ts src/lib/mongoAutocomplete.ts src/components/query/QueryEditor.tsx src/components/query/QueryEditor.test.tsx src/components/query/GlobalQueryLogPanel.tsx src/components/query/QueryLog.tsx` → empty
- **Residual risk**: None blocking. Two P3 notes (cosmetic doc wording + theoretical unreachable code path) can be addressed opportunistically during Sprint 85.
