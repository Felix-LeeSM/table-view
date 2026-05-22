# Sprint 311 Generator Handoff

Phase 28 Slice A5 — Run dispatch parser-driven (6 read methods).
date 2026-05-14.

## Changed files

- `src/components/query/QueryTab/useQueryExecution.ts` — replaced the
  document-paradigm `JSON.parse(sql)` + `tab.queryMode === "aggregate"`
  branch with `parseMongoshExpression`-driven dispatch covering all 6
  read methods. Added 6 method helpers
  (`runDocumentFind` / `runDocumentFindOne` / `runDocumentCount` /
  `runDocumentEstimatedCount` / `runDocumentDistinct` plus the existing
  `runMongoAggregateNow`) wired through a single `dispatchMongoshCall`
  callback. Aggregate Safe Mode gate retained verbatim; the parsed
  pipeline is stored in `pendingMongoConfirm` / `pendingMongoWarn`
  exactly as before. `recordHistory` now accepts an optional
  `queryMode` override so the parsed method name lands in history
  entries.
- `src/types/query.ts` — `QueryResult.resultKind?:
  "grid" | "scalar" | "list"` (optional; A6 will add `"writeSummary"`).
- `src/stores/workspaceStore/types.ts` — widened `QueryMode` union to
  the 13 mongosh method names plus `"sql"` (read + write super-set so
  history `queryMode` filter UI keeps compiling across Phase 28).
- `src/stores/queryHistoryStore.ts` — JSDoc on `queryMode` documenting
  the new "parsed method name wins" semantics (D-13).
- `src/components/query/QueryTab/useQueryExecution.parserDispatch.test.tsx`
  — new — 17 test cases covering the 10 ACs (find / findOne / aggregate
  / countDocuments / estimatedDocumentCount / distinct dispatch +
  cursor chain mapping + parser error + collection mismatch + free-form
  collection inference + STOP confirm stale-editor isolation + history
  recording for find / aggregate / count).
- `src/components/query/QueryTab.document.test.tsx` — migrated the
  pre-A5 JSON-literal fixtures (find / aggregate / parse-error /
  `$out` matrix) to mongosh expressions. Sprint 188 safe-mode gate
  matrix preserved verbatim, just dispatched through the parser.
  Deleted two now-impossible cases (legacy "Invalid JSON" and "find
  body not an object" — the parser surfaces a richer taxonomy
  upstream).
- `src/components/query/QueryTab.history.test.tsx` — find / aggregate
  history fixtures now feed mongosh expressions.
- `src/components/query/QueryTab.warn-dialog.test.tsx` — Mongo
  aggregate / find dialog cases (`[AC-255-07a/b/c]`) now feed mongosh
  expressions; assertions unchanged.
- `docs/phases/phase-28-decision-log.md` — appended D-10 through D-15
  (dispatch location, cursor-chain projection scope, findOne empty
  render, history queryMode rule, mismatch wording, pending payload
  shape).

## Per-AC evidence (AC-01..AC-10)

- **AC-311-01 (parser-driven dispatch)** — `useQueryExecution.parserDispatch.test.tsx`
  → `[AC-311-01]`, `[AC-311-01b]`. Find with cursor chain maps to
  `FindBody { filter, sort, limit, skip }`; `.toArray()` is a no-op.
- **AC-311-02 (collection mismatch wording)** —
  `[AC-311-04]` (mismatch error wording exact: `"Editor targets
  collection 'orders' but tab is bound to 'users'."`) +
  `[AC-311-04b]` (free-form tab uses parsed collection).
- **AC-311-03 (6-method dispatch matrix)** — `[AC-311-01]` (find),
  `[AC-311-02]` (aggregate), `[AC-311-05]` (countDocuments),
  `[AC-311-06]` (estimatedDocumentCount), `[AC-311-07]` /
  `[AC-311-07b]` (distinct), `[AC-311-08]` / `[AC-311-08b]` (findOne
  including empty grid for null).
- **AC-311-04 (STOP confirm stale-editor isolation)** — `[AC-311-09]`.
  Mutates `tab.sql` between prompt and `confirmMongoDangerous()`;
  asserts IPC re-dispatches the original parsed pipeline.
- **AC-311-05 (history records raw mongosh + parsed method)** —
  `[AC-311-10]` (find), `[AC-311-10b]` (aggregate), `[AC-311-10c]`
  (countDocuments). `entry.sql === raw mongosh` and `entry.queryMode
  === parsed method name`. The `QueryTab.history.test.tsx` find /
  aggregate cases also re-pin this contract.
- **AC-311-06 (IPC error → queryState.error)** — covered by the
  existing parser-error path `[AC-311-03]` plus the existing
  `QueryTab.warn-dialog.test.tsx` `[AC-255-07c]` regression that
  exercises the dispatch failure surface.
- **AC-311-07 (`tab.queryMode` no longer drives dispatch)** —
  `grep -n "tab.queryMode" src/components/query/QueryTab/useQueryExecution.ts`
  shows 7 lines: 4 prose comments documenting the legacy field, 2
  history-fallback uses inside `recordHistory` (lines 238 + 247 deps),
  and 1 comment line referencing the legacy branch removal. **Zero
  reads from the dispatch decision tree.** Confirmed by all 6-method
  dispatch tests passing — they pass legacy `queryMode` values that
  contradict the parsed method (e.g. `tab.queryMode: "find"` while the
  editor types `db.coll.aggregate(...)`) and the parser-decided IPC is
  still invoked.
- **AC-311-08 (baseline vitest regression zero)** — see Checks Run.
  3563 pass / 10 skip (baseline 3548 / 10 + 17 new dispatch tests, –2
  deleted obsolete cases = +15 net).
- **AC-311-09 (tsc / lint / build zero)** — see Checks Run.
- **AC-311-10 (`QueryResult.resultKind` field)** —
  `src/types/query.ts` adds the optional union; `[AC-311-05]` /
  `[AC-311-07]` lock the scalar / list values.

## Autonomous decisions

Logged in `docs/phases/phase-28-decision-log.md` (D-10..D-15):

- **D-10** Dispatch logic stays inline in `useQueryExecution.ts`.
  Helper extraction deferred to A6+ where 5 more methods join.
- **D-11** Cursor chain maps `sort` / `limit` / `skip`; projection is
  a future expansion via A4 snippet `find(filter, projection)`.
  `.toArray()` parsed but ignored.
- **D-12** `findOne` null → empty grid (`columns: []`, `rows: []`).
  A6 will replace with a "No match" panel.
- **D-13** History `queryMode` records the parsed method name. Legacy
  persisted `tab.queryMode` is no longer consulted for history. Filter
  UI keeps working because aggregate entries still carry
  `queryMode: "aggregate"`.
- **D-14** Collection mismatch wording uses the English from contract
  AC-02 verbatim.
- **D-15** Pending confirm payload stores `pipeline: Record<string,
  unknown>[]` only (not the full `ParsedMongoshCall`). Modal consumers
  unchanged.

## Tests added / modified

- **New** `useQueryExecution.parserDispatch.test.tsx` — 17 cases:
  `[AC-311-01]` find dispatch + cursor chain mapping
  `[AC-311-01b]` find with no args
  `[AC-311-02]` aggregate dispatch
  `[AC-311-02b]` aggregate with `.toArray()` ignored
  `[AC-311-03]` parser-error → queryState.error
  `[AC-311-04]` collection mismatch error wording
  `[AC-311-04b]` free-form tab inherits parsed collection
  `[AC-311-05]` countDocuments → scalar
  `[AC-311-06]` estimatedDocumentCount → scalar
  `[AC-311-07]` distinct → list
  `[AC-311-07b]` distinct with filter
  `[AC-311-08]` findOne → single-row grid
  `[AC-311-08b]` findOne(null) → empty grid
  `[AC-311-09]` aggregate STOP confirm stale-editor isolation
  `[AC-311-10]` history records raw mongosh + `queryMode: "find"`
  `[AC-311-10b]` history `queryMode: "aggregate"`
  `[AC-311-10c]` history `queryMode: "countDocuments"`
- **Migrated** `QueryTab.document.test.tsx`: JSON-literal fixtures →
  mongosh expressions, two legacy cases deleted.
- **Migrated** `QueryTab.history.test.tsx`: find / aggregate history
  fixtures → mongosh expressions.
- **Migrated** `QueryTab.warn-dialog.test.tsx`: Mongo aggregate / find
  cases (`[AC-255-07a/b/c]`) → mongosh expressions; gate matrix
  unchanged.

## Checks run

- `pnpm vitest run` — **3563 passed / 10 skipped**, exit 0. Baseline
  was 3548 / 10; +15 net (17 new + −2 obsolete). 287 test files.
- `pnpm tsc --noEmit` — exit 0.
- `pnpm lint` — exit 0.
- `pnpm build` — exit 0 (only vite pre-existing chunk warnings,
  unchanged from baseline).
- `grep -n "tab.queryMode" src/components/query/QueryTab/useQueryExecution.ts`
  — 7 residual matches, all either history-backwards-compat (deps
  array + `recordHistory` fallback) or prose comments documenting the
  legacy field. **Zero dispatch reads** of the field.

## Residual risk

- A5 wires shapes for scalar/list/empty-grid; **A6 will polish
  rendering** — `countDocuments` / `estimatedDocumentCount` currently
  surface as a 1-row grid with column `count: Int64`, `distinct` as a
  1-column grid with column `value: string`. A6 swaps in dedicated
  ScalarPanel / ListPanel components.
- `findOne(null)` currently renders an empty grid; A6 will replace
  with a "No match" panel.
- Write methods (`insertOne` / `insertMany` / `updateOne` /
  `updateMany` / `deleteOne` / `deleteMany` / `bulkWrite`) parse
  cleanly but the dispatcher surfaces an "A6 placeholder" error —
  Sprint 312 wires those + the write-summary modal.
- `projection` is not yet captured from the cursor chain (D-11). Users
  needing it can pass it via the A4 snippet's `find(filter, projection)`
  template — but the current dispatcher reads only `parsed.args[0]`
  for find, so projection is silently ignored. A6 / A1 extension to
  capture `parsed.args[1]` for find is documented as a follow-up.
