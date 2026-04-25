# Sprint 100 — Generator Findings

## Goal Recap
Multi-statement query execution → one Tabs panel per statement (Radix
Tabs, keyboard nav included). Each tab trigger shows verb + rows/ms (or
✕ for failure). Single-statement runs render exactly the legacy single
result UI (no Tabs, regression-free).

## Changed Files
- **`src/types/query.ts`** — added `QueryStatementResult` interface
  (`sql / status / result? / error? / durationMs`); extended the
  `QueryState.completed` arm with optional `statements?:
  QueryStatementResult[]`. Single-statement consumers ignore the field
  unchanged.
- **`src/components/query/QueryTab.tsx`** — multi-statement loop now
  collects per-statement results (success/error + per-stmt durationMs)
  into a `statementResults` array. On completion: all-failed →
  `status: "error"` with joined message (legacy shape preserved); any
  success → `status: "completed"` with `result` = last successful result
  AND `statements` = full breakdown. History entry status reflects
  partial failure as `"error"` so the history list still surfaces
  destructive runs.
- **`src/components/query/QueryResultGrid.tsx`** — extracted the legacy
  status-bar + content rendering into `CompletedSingleResult`; added
  `CompletedMultiResult` that drives the Radix Tabs (one
  `<TabsTrigger>` per statement, label `"Statement {n} {verb}"` + a
  `rows`/`ms`/`✕` badge). Failing tabs carry `data-status="error"` plus
  `text-destructive` styling. The router only mounts the Tabs view when
  `statements && statements.length >= 2`; everything else falls through
  to the original single-result UI.
- **`src/components/query/QueryTab.test.tsx`** — replaced the obsolete
  `combines errors from multi-statement execution` assertion (which
  expected `status === "error"` for partial failure) with two tests:
  (1) partial failure stays `completed` with per-statement breakdown
  (`statements[0].status === "success"`, `statements[1].status ===
  "error"`, `result === MOCK_RESULT`); (2) all-fail still collapses to
  `status: "error"` with a joined message. Also added a third happy-path
  case asserting both statements end as `status: "success"` and
  `result === lastResult`. Updated `handles non-Error rejection in
  multi-statement execution` to assert the new `completed + statements[]`
  shape (the raw `String(err)` lands on `statements[1].error`).
- **`src/components/query/QueryResultGrid.multi-statement.test.tsx`**
  (NEW) — 7 cases exercising AC-01..AC-04 + a content-swap regression
  guard.

## AC-by-AC Citations

### AC-01 — Multi-statement → tabs with verb + rows/ms
- Implementation:
  `src/components/query/QueryResultGrid.tsx:240-318` (the multi-result
  branch + `statementVerb` / `statementBadge` helpers at
  `:225-252`).
- Test: `QueryResultGrid.multi-statement.test.tsx:67-91` — asserts
  `getAllByRole("tab").length === 2` and that each trigger contains the
  expected verb + `2 rows` / `11 ms` badges.

### AC-02 — Partial failure highlighted
- Implementation: error-tab marker `data-status="error"` +
  `text-destructive` class at
  `src/components/query/QueryResultGrid.tsx:269-281`; per-stmt error
  banner ("Statement {n} failed") at `:296-306`.
- Test: `QueryResultGrid.multi-statement.test.tsx:94-128` — asserts
  `data-status="error"`, `✕`, and that mouseDown-activating the tab
  reveals `Statement 2 failed` + `relation "missing" does not exist`.

### AC-03 — Single-statement regression-free
- Implementation:
  `src/components/query/QueryResultGrid.tsx:387-401` — the `>= 2` gate
  ensures any caller without `statements` (or with a single entry)
  hits `CompletedSingleResult`.
- Tests:
  - `QueryResultGrid.multi-statement.test.tsx:131-148` — asserts
    `queryByRole("tab") === null` for a `statements`-less completed
    state and for a single-entry `statements`.
  - All 13 pre-existing `QueryResultGrid.test.tsx` cases still pass
    unchanged (no Tabs scaffolding leaks into the single-result path).

### AC-04 — ArrowLeft / ArrowRight keyboard nav
- Implementation: `<Tabs activationMode="automatic">` at
  `src/components/query/QueryResultGrid.tsx:262`; Radix's default
  `TabsList` provides arrow / Home / End handling out of the box.
- Tests: `QueryResultGrid.multi-statement.test.tsx:165-205` — focuses
  the first tab, fires `ArrowRight`, asserts `data-state="active"`
  flips to the second tab; fires `ArrowLeft`, asserts it flips back.

## Behavioral Change Note — Partial Failure Semantics

**Before sprint 100**: a multi-statement run with at least one failure
landed in `queryState = { status: "error", error: errors.join("\n") }`,
losing all per-statement context.

**After sprint 100**:
- *All* statements failing → still `status: "error"` (legacy shape, joined
  message). Single-statement-error consumers (e.g. error banner, history
  list) work unchanged.
- At least one success → `status: "completed"` with `result` mirroring
  the *last successful* statement and `statements` carrying the full
  per-statement breakdown. The Tabs view consumes `statements`; any
  caller still reading just `result` continues to see a valid result.

`addHistoryEntry` still flags partial failure as `status: "error"` so
the history list keeps showing the destructive marker.

## Verification

| Check | Outcome |
| --- | --- |
| `pnpm vitest run` | **PASS** — `Test Files 99 passed (99)`, `Tests 1744 passed (1744)` |
| `pnpm vitest run src/components/query/QueryResultGrid.multi-statement.test.tsx` | **PASS** — 7/7 |
| `pnpm vitest run src/components/query/QueryTab.test.tsx` | **PASS** — 68/68 |
| `pnpm vitest run src/components/query/QueryResultGrid.test.tsx` | **PASS** — 13/13 (regression-free) |
| `pnpm tsc --noEmit` | **PASS** — exit 0, no output |
| `pnpm lint` | **PASS** — exit 0, no output |

Baseline was 1735 tests; sprint 100 added 4 new (`QueryResultGrid`
multi-statement) + 5 new/updated in `QueryTab.test.tsx` (partial-failure
breakdown, all-fail collapse, all-success happy path, plus the rewritten
non-Error rejection test). Total = 1744.

## Risks / Assumptions

1. **`result` fallback for multi-success runs** — set to the *last*
   successful statement's result. This is what the contract requested
   ("마지막 성공 결과는 `result` 로 유지"). Callers ignoring `statements`
   still see a valid `result` shape.
2. **`role="alert"` on the per-statement error banner** — re-uses the
   single-statement error pattern, which means a multi-statement view
   with both a failed statement *and* the user activating it will
   announce the error to screen readers (consistent with
   single-statement behavior).
3. **Radix Tabs `mouseDown` activation** — assumed in tests; established
   pattern across the codebase (e.g. `ImportExportDialog.test.tsx:321`).
   `fireEvent.click` does not work; tests use `fireEvent.mouseDown`.
4. **`data-status` attribute** — used `data-status="error" |
   "success"` (string-typed; matches the `QueryStatementResult.status`
   field). The contract called for either `data-status="error"` or a
   destructive class — we ship both for resilience.
5. **History entry status semantics** — kept partial failure as
   `"error"` in the history list. The contract's invariant is
   "`addHistoryEntry` 단일/다중 모두 발화 보존" (must still fire); status
   choice was Generator's call.

## Out of Scope (Confirmed Untouched)
- `EditableQueryResultGrid.tsx` — read paths only consume one
  `QueryResult` and the multi-statement flow uses the read-only
  `SelectResultArea` per tab (since editability requires a single-table
  SELECT and a fresh history of statements).
- `DocumentDataGrid` / Mongo paradigm — never reaches the multi-statement
  branch.
- Backend (`src-tauri/`) — untouched; statements still execute one-by-one
  via the existing `executeQuery` IPC.
- `splitSqlStatements` — unchanged.
- `memory/`, `CLAUDE.md`, sprints 88–99 outputs — unchanged.
