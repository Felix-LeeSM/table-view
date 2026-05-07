# Sprint 231 — Handoff

## Summary

P0 production-data-protection regression closed. The `QueryTab` editor's
raw RDB query path (`useQueryExecution.handleExecute` single + multi
statement branches) now runs every statement through the same Safe Mode
gate (`useSafeModeGate` + `analyzeStatement` + `decideSafeModeAction`) that
already protects the Mongo aggregate path, the grid commit path, and the
DDL editor path. Production users can no longer execute `UPDATE … SET …`,
WHERE-less DELETE, or DROP TABLE without explicit confirmation.

## Changed files

| File | Purpose |
|------|---------|
| `src/components/query/QueryTab/useQueryExecution.ts` | Added `safeModeGate` (renamed from `mongoGate`), `pendingRdbConfirm` state + `confirmRdbDangerous` / `cancelRdbDangerous` callbacks. Extracted `runRdbSingleNow(stmt)` and `runRdbBatchNow(stmts, joinedSql)` helpers (mirroring `runMongoAggregateNow`). Inserted single-pass gate over all statements with `block > confirm > allow` priority. |
| `src/components/query/QueryTab.tsx` | Destructured the three new return fields from `useQueryExecution` and mounted a second `<ConfirmDangerousDialog>` keyed on `pendingRdbConfirm`. `sqlPreview` joins `statements` with `;\n` so the user sees the entire batch verbatim. |
| `src/components/query/QueryTab.safe-mode.test.tsx` | New file — 8 vitest cases covering the AC-231-01..03 matrix (block / allow / confirm / multi-stmt / cancel). 1 case demonstrates TDD red→green. |
| `src/components/query/__tests__/queryTabTestHelpers.ts` | Added `useSafeModeStore.setState({ mode: "strict" })` to `resetQueryTabStores` so persisted localStorage mode can't leak between cases. |
| `docs/PLAN.md` | Updated row 6 from placeholder `231+ (TBD)` to `**231** ✓ feature` with summary; appended row 7 with the deferred Phase 27 polish backlog. |
| `docs/sprints/sprint-231/findings.md` | AC-231-04 + AC-231-05 audit memos. |
| `docs/sprints/sprint-231/handoff.md` | This file. |
| `docs/sprints/sprint-231/tdd-evidence/red-state.log` | Captured failing-state output of the 8 new cases against pre-fix code. |

## Vitest before / after

| | Files | Tests |
|---|---|---|
| Before (Sprint 230 baseline) | 219 | 2838 |
| After  (Sprint 231) | 220 | 2846 |
| Delta | +1 | +8 |

## AC ↔ test case mapping

| AC | Case (`QueryTab.safe-mode.test.tsx` line) |
|----|-------------------------------------------|
| AC-231-01 (single statement matrix) | `[AC-231-01a]` block strict-prod (line 158) ; `[AC-231-01b]` warn-prod confirm (line 209) ; `[AC-231-01c]` off-prod block prod-auto (line 234) ; `[AC-231-01d]` non-prod allow (line 256) ; `[AC-231-01e]` strict-prod safe SELECT allow (line 192) |
| AC-231-02 (multi statement) | `[AC-231-02a]` strict-prod multi block (line 273) ; `[AC-231-02b]` warn-prod multi confirm-then-run (line 290) |
| AC-231-03 (cancel) | `[AC-231-03]` cancel clears state, no execute (line 354) |
| AC-231-04 (audit) | `findings.md §1` — no leak; diff = 0. |
| AC-231-05 (env dropdown) | `findings.md §2` — present + accessible; diff = 0. |
| AC-231-06 (TDD evidence) | `tdd-evidence/red-state.log` — 6 of 8 fail pre-fix. |
| AC-231-07 (regression-free) | 4-set verification + clippy + cargo test PASS (see below). |
| AC-231-08 (PLAN row) | `docs/PLAN.md:157` updated to `**231** ✓`. |

## 16 verification check results

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm vitest run` | PASS — 220 files / 2846 tests / 0 failed |
| 2 | `pnpm tsc --noEmit` | PASS — exit 0 |
| 3 | `pnpm lint` | PASS — exit 0 |
| 4 | `cargo build` | PASS — exit 0 |
| 5 | `cargo clippy --all-targets --all-features -- -D warnings` | PASS — exit 0 |
| 6 | `cargo test` | PASS — `create_table` 16/16, `create_index` 11/11, `add_constraint` 12/12, `list_types` 2/2 |
| 7 | `git diff --stat src/components/structure/useDdlPreviewExecution.ts` | 0 |
| 8 | `git diff --stat src/components/structure/SqlPreviewDialog.tsx` | 0 |
| 9 | `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` | 0 |
| 10 | `git diff --stat src/stores/{connectionStore,schemaStore,safeModeStore}.ts` | 0 |
| 11 | `git diff --stat src/lib/safeMode.ts src/lib/sql/sqlSafety.ts` | 0 |
| 12 | `git diff --stat` for Sprint 230 frozen files (Header/IndexesTabBody/ForeignKeysTabBody/useFkReferencePicker/usePostgresTypes/postgresTypes/CreateTableTypeCombobox) | 0 |
| 13 | `grep -nE 'safeModeGate\|useSafeModeGate' useQueryExecution.ts` | 5 hits ≥ 2 |
| 14 | `grep -nE 'analyzeStatement' useQueryExecution.ts` | 2 hits ≥ 1 |
| 15 | `grep -nE 'pendingRdbConfirm' useQueryExecution.ts QueryTab.tsx` | 10 hits ≥ 3 |
| 16 | Sprint 226–230 vitest fixture (`useDataGridEdit.safe-mode.test.ts` 7-case suite, etc.) | PASS unchanged |

## Audit results

- **AC-231-04** — `findings.md §1`. No leak. `useDataGridPreviewCommit.ts`
  is already correctly gated at `handleExecuteCommit` line 419–443 before
  any `executeQueryBatch` dispatch. File diff = 0.
- **AC-231-05** — `findings.md §2`. `ConnectionDialogBody.tsx:250–280`
  renders the environment dropdown (`<Select>` with `aria-label="Environment"`
  and `htmlFor="conn-environment"` label). `ENVIRONMENT_OPTIONS` includes
  `production`. Coverage in `ConnectionDialog.test.tsx:555–629`. File
  diff = 0.

## TDD red→green capture

`docs/sprints/sprint-231/tdd-evidence/red-state.log` shows the 8 new
cases run against pre-fix code:

```
× [AC-231-01a] production + strict + WHERE-less DELETE → block, …
× [AC-231-01b] production + warn  + WHERE-less DELETE → confirm dialog, …
× [AC-231-01c] production + off   + DROP TABLE         → block (prod-auto)
× [AC-231-02a] production + strict + multi (safe + dangerous) → block
× [AC-231-02b] production + warn  + multi (UPDATE + DELETE) → confirm-then-run
× [AC-231-03] cancel pendingRdbConfirm → dialog cleared, …
✓ [AC-231-01d] development + strict + DROP TABLE → allow (env-gated)
✓ [AC-231-01e] production + strict + safe SELECT → allow

Tests  6 failed | 2 passed (8)
```

Failure mode for the 6 red cases:
`AssertionError: expected "vi.fn()" to not be called at all, but actually been called N times`
— the pre-fix `executeQuery` mock was hit because no gate was wired in.

After the fix: **8 / 8 PASS**.

## Assumptions

- `useSafeModeStore.mode` initial value is `"strict"` (matches Sprint 185
  contract + Sprint 188 lessons + persisted default).
- The user's reported regression connection had `environment: "production"`.
  If `environment` were `null` / `development` / `staging`, the gate
  intentionally returns `allow` per `decideSafeModeAction` design — the
  user must tag the connection appropriately. (Surfaced in
  `findings.md §2` for follow-up consideration.)
- `splitSqlStatements` preserves order across N statements (Sprint 36
  invariant).
- `dispatchDbMutationHint` should fire only when SQL actually hit the
  backend — block / cancel paths skip it (active_db can't have flipped).

## Residual risk

1. **Analyzer gaps** — `analyzeStatement` does not detect every dangerous
   variant (CTE-prefixed DELETE/UPDATE, MERGE, PG `DELETE … USING …`,
   REPLACE INTO). Frozen by contract; backlog for a hardening sprint.
2. **Multi-statement reason** — header shows only the first dangerous
   statement's reason. Full batch is rendered verbatim in the preview
   pane, so visual exposure is preserved.
3. **No cancel toast** — `cancelRdbDangerous` clears state silently
   (running invariant: never entered `running`). Polish sprint backlog.
4. **Test mock for `verifyActiveDb`** — `QueryTab.safe-mode.test.tsx`
   stubs `verifyActiveDb`; assumes it's not exercised by the gate path
   (only by post-execute `dispatchDbMutationHint`).
