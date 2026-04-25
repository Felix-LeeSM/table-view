# Sprint 93 — Generator Findings

## Changed Files

| File | Purpose |
|------|---------|
| `src/components/datagrid/sqlGenerator.ts` | Added `generateSqlWithKeys` function + `GeneratedSqlStatement` interface returning `{ sql, key? }[]` so the commit caller can map a failing statement back to its pending-edit cell key. `generateSql` is preserved as a backward-compatible wrapper that strips the keys. UPDATE statements carry the `rowIdx-colIdx` cell key, DELETEs carry the `row-{page}-{rowIdx}` row key, INSERTs carry `new-{newRowIdx}-0` so the user can see the offending new row. |
| `src/components/datagrid/useDataGridEdit.ts` | Added `CommitError` interface + `commitError` state + `sqlPreviewStatements` keyed mirror. Filled the SQL branch catch block in `handleExecuteCommit`: an inner per-statement try/catch records `{ statementIndex, statementCount, sql, message, failedKey }` on first reject, keeps `sqlPreview` populated (modal stays open), copies the failed cell key into `pendingEditErrors`, and stops the loop without clearing pending state so the user can fix and retry. Also wrapped the exposed `setSqlPreview` so dismissing the modal clears the keyed list and commit error. `handleCommit` (and the Cmd+S handler) now call `generateSqlWithKeys` and reset `commitError` so a fresh batch opens clean. `handleDiscard` clears the new state too. |
| `src/components/structure/SqlPreviewDialog.tsx` | Added optional `commitError?: SqlPreviewCommitError \| null` prop. When set, renders a `role="alert"` destructive banner with "executed: N, failed at: K of M" + DB message + raw failed SQL. Distinct from the existing `error` prop (which is for SQL-preview generation failures). |
| `src/components/DataGrid.tsx` | Threads `editState.commitError` into the inline SQL preview modal: failed statement gets a destructive border in the list, and a destructive banner below the list shows count + message + raw SQL. |
| `src/components/datagrid/useDataGridEdit.commit-error.test.ts` (new) | Six tests: (1) simple failure, (2) partial failure with the 2nd of 3 rejecting → `statementIndex 1` + "executed: 1" + "failed at: 2", (3) happy path regression, (4) commitError clears on a fresh `handleCommit`, (5) commitError clears when `setSqlPreview(null)` dismisses the modal, (6) static guard reads `useDataGridEdit.ts` via Vite `?raw` import and asserts the SQL branch (sliced from `if (!sqlPreview) return;` to the next `}, [`) contains no empty `} catch (...) {}` block and mentions `setCommitError`, `executed:`, `failed at:`. |

## Commit Error Model

```ts
export interface CommitError {
  statementIndex: number;   // 0-indexed position of the failing statement in sqlPreview.
  statementCount: number;   // total statements in the batch.
  sql: string;              // raw SQL of the failing statement.
  message: string;          // "executed: N, failed at: K of M — <DB message>"
  failedKey?: string;       // pendingEdits/pendingNewRows/pendingDeletedRowKeys key.
}
```

The dialog renders `statementIndex + 1` as the 1-indexed "failed at" label so the count matches what the user reads visually. `failedKey` is also written into `pendingEditErrors` so the inline cell hint lights up after the user dismisses the modal.

## Statement → Key Mapping

Chose **separate function** (`generateSqlWithKeys`) over extending `generateSql`'s signature because:

1. `generateSql` is consumed by three structure editors (`IndexesEditor`, `ColumnsEditor`, `ConstraintsEditor`) that don't need the keys — extending the signature would have forced wrapper code at every call site.
2. The new function shares 100% of the generation logic — the legacy `generateSql` is a one-line wrapper (`map(s => s.sql)`).
3. Keys are consistent with the pending-edit identifiers already used elsewhere in the hook (`rowIdx-colIdx`, `row-{page}-{rowIdx}`, `new-{newRowIdx}-{colIdx}`), so the catch block can route errors directly into `pendingEditErrors` without translation.

## Verification Plan — Required Checks

| # | Command | Result | Evidence |
|---|---------|--------|----------|
| 1 | `pnpm vitest run` | PASS | `Test Files 91 passed (91); Tests 1660 passed (1660)` (15.55s) |
| 2 | `pnpm tsc --noEmit` | PASS | `exit: 0` |
| 3 | `pnpm lint` | PASS | `> eslint .` (no diagnostics) |
| 4 | `grep -nE "} catch \(" src/components/datagrid/useDataGridEdit.ts` | PASS | Two non-empty catch blocks (lines 681, 729). The SQL branch catch at 681 binds `(err)` and writes `setCommitError(...)`; the outer defensive catch at 729 also binds `(err)` and surfaces. The remaining empty `} catch {` at line 660 is in the **MQL branch** (out of scope per spec). |
| 5 | `grep -n "commitError\|statementIndex\|executed:\|failed at" src/components/datagrid/useDataGridEdit.ts src/components/structure/SqlPreviewDialog.tsx` | PASS | 11 matches in `useDataGridEdit.ts` + 12 matches in `SqlPreviewDialog.tsx`. |

## Acceptance Criteria — Line Citations

- **AC-01** `executeQuery` reject sets `commitError`, keeps `sqlPreview` open, flags failed cell key.
  - `useDataGridEdit.ts:691-707` — inner catch sets `setCommitError({ statementIndex: i, statementCount, sql: stmt.sql, message, failedKey: stmt.key })` and writes `stmt.key` into `pendingEditErrors`. No `setSqlPreview(null)` is called in this path — the modal stays open (verified by test 1: `expect(result.current.sqlPreview).not.toBeNull()`).
  - Test evidence: `useDataGridEdit.commit-error.test.ts:138-142` (`commitError !== null`, `statementIndex === 0`, `statementCount === 1`), `:144-148` (`sqlPreview` preserved), `:153-156` (`pendingEditErrors.has("0-1")` true).

- **AC-02** Partial failure: 3 SQLs, 2nd reject → `statementIndex 1`, "executed: 1" + "failed at: 2".
  - `useDataGridEdit.ts:697` constructs `` `executed: ${executedCount}, failed at: ${i + 1} of ${statementCount} — ${message}` ``. `executedCount` increments only after a successful await, so the 2nd-statement reject yields `executed: 1, failed at: 2 of 3`.
  - Test evidence: `useDataGridEdit.commit-error.test.ts:200-205` (`statementIndex === 1`, `statementCount === 3`, message contains `"executed: 1"` + `"failed at: 2"` + `"permission denied"`); `:208` (only 2 `executeQuery` calls — third skipped).

- **AC-03** SqlPreviewDialog displays `commitError` (raw SQL + message + count) with `role="alert"`.
  - `SqlPreviewDialog.tsx:103-119` renders the destructive banner with `role="alert"` `aria-live="assertive"`, the partial-failure count, the DB message, and a `<pre>` with the raw failed SQL.
  - `DataGrid.tsx` (the actual data-grid render site) mirrors the same banner inline and also adds a destructive border to the failed statement in the list.

- **AC-04** Happy path regression: all SQL succeed → `sqlPreview === null`, `pendingEdits.size === 0`, `fetchData` 1 call, `commitError === null`.
  - `useDataGridEdit.ts:709-722` clears all state on success and calls `fetchData()`.
  - Test evidence: `useDataGridEdit.commit-error.test.ts:248-253` asserts all four invariants. Existing happy-path tests (`useDataGridEdit.validation.test.ts:275-299`, `commit-shortcut.test.ts`, etc.) continue to pass — full suite 1660/1660.

- **AC-05** Static regression guard: catch is non-empty.
  - `useDataGridEdit.commit-error.test.ts:339-365` reads `useDataGridEdit.ts` via Vite `?raw` import, slices the SQL branch (from `if (!sqlPreview) return;` to the next `}, [`), runs the empty-catch regex `/\}\s*catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*(?:\/\/[^\n]*\s*)*\}/g`, and asserts zero matches plus positive `setCommitError(`, `executed:`, `failed at:` mentions.

## Assumptions

1. **Single-PR / single-commit per statement**: Statements are run serially without a transaction (mirrors the pre-Sprint-93 behavior). Already-applied statements stay applied on partial failure — there is no rollback. Surface the count instead so the user knows what was committed.
2. **Out-of-scope MQL branch**: The `paradigm === "document"` branch retains its empty catch (line 660 area) since spec/contract explicitly mark MQL as a separate sprint. The static guard slices the SQL branch only so the MQL empty-catch does not trip the assertion.
3. **`SqlPreviewDialog` is not the actual render site for the data grid**: The contract listed it for the new prop but the data grid uses an inline `Dialog` in `DataGrid.tsx`. To honor the contract literally, the prop is added to `SqlPreviewDialog` and `DataGrid.tsx` (the real render site) renders the banner from `editState.commitError` directly. The structure editors' three call sites (`IndexesEditor`, `ColumnsEditor`, `ConstraintsEditor`) keep working unchanged since `commitError` is optional.
4. **Vite `?raw` import is available**: Project already uses it (`DataGridTable.parseFkReference.test.ts:29`), so we can read source files in tests without adding `@types/node` (the project tsconfig does not include node types).
5. **`vi.resetAllMocks()` in `beforeEach`**: switched from `clearAllMocks` because some tests intentionally queue a 3rd `mockImplementationOnce` that the test never consumes (3-statement batch, 2nd rejects). `resetAllMocks` drains queued implementations so the leftover doesn't leak into the next test.

## Risks

- **None active.** All invariants from the contract hold:
  - `executeQuery` signature unchanged.
  - Happy path returns to original state with `fetchData` called once.
  - `CLAUDE.md` and `memory/` untouched.
- **Latent**: The MQL branch's empty catch is still a silent-swallow bug (a separate sprint will address it). If a user hits an Mongo write error today, they still see no surfacing — this sprint deliberately scoped to the SQL branch per spec.
- **Latent**: `sqlPreviewStatements` is kept in sync with `sqlPreview` only at the two write sites (`handleCommit` + the Cmd+S handler). External `setSqlPreview` callers receive a wrapped setter that clears both on `null` but cannot set a non-null `string[]` directly with keys. The hook does not currently expose a typed array-with-keys setter — no consumer needs one today, but if a future sprint moves preview generation outside the hook this contract will need a parallel setter.
