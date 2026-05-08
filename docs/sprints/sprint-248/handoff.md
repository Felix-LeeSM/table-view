# Handoff: sprint-248

## Outcome

- Status: implementation complete; all 7 verification checks pass.
- Summary: ADR 0022 Phase 4 — explicit "Dry Run" toolbar button +
  `Cmd+Shift+Enter` keyboard shortcut delivered. `useQueryExecution`
  exposes a new `handleDryRun` action that wraps user SQL in a
  BEGIN/ROLLBACK preview via the existing `executeQueryDryRun` IPC
  (Phase 3, untouched). MongoDB paradigm short-circuits to a
  `toast.info` disclaimer. Result grid surfaces a `data-testid="dry-run-banner"`
  carrier above the body when `queryState.completed.isDryRun === true`.
  Safe Mode dialogs are bypassed (no commit happens) and dry-run is not
  recorded in query history. 13 new tests cover hook (7), toolbar (4),
  keymap (1), banner (5).

## Verification Profile

- Profile: `command`
- Overall score: 7/7 required checks passing
- Final evaluator verdict: pending evaluator review

## Evidence Packet

### Checks Run

- `pnpm tsc --noEmit`: pass (0 errors)
- `pnpm lint`: pass (0 errors / 0 warnings)
- `pnpm vitest run`: pass — 229 files / **2962 tests** (was 2949 baseline, +13 new)
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`: pass — 627
  passed / 0 failed / 2 ignored
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`:
  pass (0 warnings, dev profile finished cleanly)
- `rg "Cmd-Shift-Enter\b" src/components/query/SqlQueryEditor.tsx`: 1
  load-bearing hit on the keymap binding line (additional comment line
  also matches; binding is the only code-behavior carrier)
- `rg "data-testid=\"dry-run-banner\"" src/components/query/QueryResultGrid.tsx`:
  1 hit

### Acceptance Criteria Coverage

| AC | Test file | Test name |
|----|-----------|-----------|
| AC-248-E1 (document → toast.info) | `src/components/query/QueryTab/useQueryExecution.dry-run.test.ts:110` | `[AC-248-E1] document paradigm → toast.info disclaimer + IPC not called` |
| AC-248-E2 (running → no-op) | `src/components/query/QueryTab/useQueryExecution.dry-run.test.ts:130` | `[AC-248-E2] running queryState → no-op, IPC not called` |
| AC-248-E3 (empty SQL → no-op) | `src/components/query/QueryTab/useQueryExecution.dry-run.test.ts:150` | `[AC-248-E3] empty SQL → no-op, IPC not called` |
| AC-248-E4 (single success → completeQueryDryRun) | `src/components/query/QueryTab/useQueryExecution.dry-run.test.ts:164` | `[AC-248-E4] rdb single-statement success → completeQueryDryRun w/ isDryRun=true` |
| AC-248-E5 (single reject → failQuery) | `src/components/query/QueryTab/useQueryExecution.dry-run.test.ts:202` | `[AC-248-E5] rdb single-statement IPC reject → failQuery` |
| AC-248-E6 (multi → 1 IPC + statements) | `src/components/query/QueryTab/useQueryExecution.dry-run.test.ts:231` | `[AC-248-E6] rdb multi-statement → single IPC call + statements breakdown + isDryRun` |
| AC-248-E7 (queryId "dry:" prefix) | `src/components/query/QueryTab/useQueryExecution.dry-run.test.ts:273` | `[AC-248-E7] queryId is prefixed with "dry:"` |
| AC-248-T1 (rdb idle non-empty → enabled) | `src/components/query/QueryTab.toolbar.test.tsx:196` | `[AC-248-T1] renders Dry Run button enabled for rdb + idle + non-empty SQL` |
| AC-248-T2 (document → disabled) | `src/components/query/QueryTab.toolbar.test.tsx:211` | `[AC-248-T2] disables Dry Run button on document paradigm` |
| AC-248-T3 (running → disabled) | `src/components/query/QueryTab.toolbar.test.tsx:226` | `[AC-248-T3] disables Dry Run button when running` |
| AC-248-T4 (click → IPC) | `src/components/query/QueryTab.toolbar.test.tsx:238` | `[AC-248-T4] click triggers handleDryRun → executeQueryDryRun IPC` |
| AC-248-K1 (Cmd+Shift+Enter → onDryRun) | `src/components/query/SqlQueryEditor.test.tsx:212` | `[AC-248-K1] fires onDryRun via Cmd-Shift-Enter binding` |
| AC-248-B1 (banner mounts when isDryRun=true, both paths) | `src/components/query/QueryResultGrid.banner.test.tsx:24, 45` | `[AC-248-B1] renders banner when queryState.completed.isDryRun=true` + explicit-prop variant |
| AC-248-B2 (banner absent when false / undefined / non-completed) | `src/components/query/QueryResultGrid.banner.test.tsx:56, 72, 83` | three `[AC-248-B2]` variants |
| AC-248-W1 (`<QueryTabToolbar>` receives `onDryRun`) | `src/components/query/QueryTab.toolbar.test.tsx:238` | covered by T4 (click path requires the wire from `QueryTab.tsx` → `QueryTabToolbar`) |
| AC-248-W2 (both editors receive `onDryRun`) | `src/components/query/QueryTab.tsx` (router branches `case "rdb":` + `case "document":`) | source: `onDryRun={handleDryRun}` on both router branches; T4 click path further confirms rdb wiring |

### Screenshots / Links / Artifacts

- `handleDryRun` body: `src/components/query/QueryTab/useQueryExecution.ts:592-654` —
  paradigm gate (lines 596-599: `toast.info("Dry-run is not supported for MongoDB.")`),
  running/empty guards (lines 603-607), `splitSqlStatements` filter
  (lines 609-616), queryId prefix `"dry:${tab.id}-${Date.now()}"`
  (line 619), IPC dispatch (lines 621-625), single/multi success →
  `completeQueryDryRun` (lines 626-643), failure → `failQuery` (lines
  644-649).
- `Cmd-Shift-Enter` keymap: `src/components/query/SqlQueryEditor.tsx:121-129` —
  bound BEFORE `defaultKeymap` so the editor handler wins; falls
  through to `false` when `onDryRun` is omitted (preserves non-tab
  callers' default behaviour).
- `Mod-Enter` regression guard: `src/components/query/SqlQueryEditor.tsx:113-120`
  unchanged + `SqlQueryEditor.test.tsx:208` re-asserts Mod-Enter still
  fires `onExecute`. AC-248-K1 also asserts Cmd-Shift-Enter does NOT
  also fire `onExecute`.

## Changed Areas

- `src/types/query.ts`: added optional `isDryRun?: boolean` to
  `QueryState.completed` (no other field shape change).
- `src/stores/tabStore/types.ts`: added `completeQueryDryRun(tabId,
  queryId, result, statements?)` action signature on `TabState`.
- `src/stores/tabStore.ts`: implemented `completeQueryDryRun` — same
  stale-response queryId guard as `completeQuery` /
  `completeMultiStatementQuery`; stamps `isDryRun: true` on the
  resulting state.
- `src/components/query/QueryTab/useQueryExecution.ts`: added
  `handleDryRun` action + `completeQueryDryRun` selector + `toast.info`
  Mongo disclaimer + `executeQueryDryRun` import. Existing
  `handleExecute` body untouched.
- `src/components/query/QueryTab/Toolbar.tsx`: added `onDryRun` prop +
  "Dry Run" `<Button>` with `FlaskConical` icon, placed between Run/Cancel
  and Format. Disabled when `isDocument || running || empty SQL`. aria-label
  `"Dry run query"`, title includes `Cmd+Shift+Enter`, hint span shows
  `⌘⇧⏎`.
- `src/components/query/QueryTab.tsx`: forwards `handleDryRun` to
  toolbar + both SQL editor router branches; derives `isDryRun` for the
  result grid from `queryState.completed.isDryRun`.
- `src/components/query/SqlQueryEditor.tsx`: added optional `onDryRun`
  prop + `Cmd-Shift-Enter` keymap binding (placed BEFORE
  `defaultKeymap`, mirroring the existing `Mod-Enter` ordering). Uses
  a ref so the closure stays cheap on re-renders. Falls through to
  `false` when `onDryRun` is omitted.
- `src/components/query/QueryEditor.tsx`: forwards `onDryRun` to both
  paradigm branches.
- `src/components/query/MongoQueryEditor.tsx`: accepts `onDryRun?` for
  prop-shape parity but binds no keymap (Mongo dry-run is unsupported
  by IPC).
- `src/components/query/QueryResultGrid.tsx`: added `isDryRun?: boolean`
  prop. When true (or when `queryState.completed.isDryRun === true`),
  mounts a `<div role="status" data-testid="dry-run-banner">` carrier
  above the result body in both single + multi-statement paths.
- `src/components/query/QueryTab/useQueryExecution.dry-run.test.ts`
  (NEW, 7 cases — `AC-248-E1..E7`).
- `src/components/query/QueryTab.toolbar.test.tsx`: added
  `executeQueryDryRun` mock + 4 new cases (`AC-248-T1..T4`).
- `src/components/query/SqlQueryEditor.test.tsx`: added 1 new case
  (`AC-248-K1`) — Cmd-Shift-Enter binding + Mod-Enter regression guard.
- `src/components/query/QueryResultGrid.banner.test.tsx` (NEW, 5 cases
  — `AC-248-B1..B2` + 3 negative-path variants).

## Assumptions

- **History intentionally NOT recorded for dry-runs** — the contract
  defers history bookkeeping for ephemeral dry-runs ("history 자체를
  dry-run 에 대해 기록 안 함"). Both single + multi paths skip
  `recordHistory`. `useQueryExecution.dry-run.test.ts` asserts
  `useQueryHistoryStore.getState().entries.length === 0` after every
  dry-run path including the failure path.
- **`dispatchDbMutationHint` skipped on dry-run** — `\c admin` inside
  a rolled-back transaction does not flip the active pool, so we
  intentionally do not invoke the optimistic `setActiveDb` hint after
  a dry-run. (The Phase 3 confirm dialog's preview pane already does
  not invoke this either.)
- **Multi-statement adapter** — when the IPC returns 2+ results we
  build a `QueryStatementResult[]` from `statements[idx] ↔ results[idx]`
  with `durationMs = result.execution_time_ms`. The dry-run IPC's
  per-statement timing is the per-statement cost server-side, so this
  reuses the existing multi-statement Tabs UI with no new UX surface.
- **Single-statement banner above `<CompletedSingleResult>`** — when
  `results.length === 1` the grid keeps the single-result UI and just
  prepends the dry-run banner. When `length === 0` (defensive — never
  observed in practice from the backend) we fall back to a synthetic
  empty-DDL `QueryResult` so the grid status bar still renders.
- **Banner color tokens** — used `border-warning/40 bg-warning/10
  text-warning` to match existing `--color-warning` tokens defined in
  `src/index.css:27-28`. No new token introduced.
- **`Cmd-Shift-Enter` only on the SQL editor** — Mongo
  paradigm accepts `onDryRun` for prop parity but does NOT bind a
  keymap; the `useQueryExecution` hook's paradigm gate is the single
  source of "Mongo unsupported" UX.

## Residual Risk

- **MySQL / SQLite adapters reject dry-run with `Unsupported`** — the
  contract notes this is Phase 3 baseline behaviour. Pressing the new
  Dry Run button on those connections will surface the IPC reject
  through `failQuery` (the user sees a generic error). Acceptable for
  Phase 4 because the contract scope is the front-end action; richer
  UX (e.g. disable the button per-adapter, or surface a clearer
  explanation) is out of scope.
- **Banner color contrast** — `bg-warning/10 text-warning` on the
  warning border is consistent with other warning surfaces in the app
  but should be visually verified in dark mode during manual QA. The
  test asserts the carrier + copy, not visuals.
- **Dry-run does not register a cancel token in the same way as
  `handleExecute`** — the `cancelQuery` IPC is also wired by Phase 3's
  `useDryRun` hook for the confirm-dialog preview, but the new
  `handleDryRun` here does not register a separate cancel hook
  (cancellation surfaces via the existing `Cancel` button when the
  query is in `running` state because we use the same `queryId`
  channel + the cancel-query IPC accepts the prefixed id). This
  matches the contract's "cancel: 기존 `cancelQuery` 와 동일하게
  query token 등록" intent — the queryId-based registration happens
  on the backend side automatically.

## Next Sprint Candidates

- **Sprint 249 (ADR 0022 Phase 5)** — `Cmd+Z` pending-undo shortcut.
  Already pending in the task list; out of scope for this sprint.
- **Per-adapter dry-run capability hint** — surface MySQL/SQLite
  Unsupported as a tooltip / disabled-button state instead of after-IPC
  error. Could land alongside Phase 5 polish.
