# Sprint 93 Evaluation Scorecard

**Evaluator role**: 평가자 (Evaluator) for sprint-93
**Verification Profile**: `command` — file inspection + accept orchestrator-confirmed command outputs (no Playwright)
**Date**: 2026-04-25

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** (35%) | 9/10 | SQL branch catch correctly captures (a) `setCommitError` with `statementIndex`, `statementCount`, `sql`, `message` (`useDataGridEdit.ts:693-699`), (b) does NOT clear `sqlPreview` (no `setSqlPreview(null)` in the inner catch; loop returns early at `:710`), (c) writes `stmt.key` into `pendingEditErrors` when present (`:700-705`). Partial-failure formatting at `:697` matches the spec exactly: `` `executed: ${executedCount}, failed at: ${i + 1} of ${statementCount} — ${message}` ``. `executedCount` only increments after a successful await (`:680`), so the 2nd-of-3 reject yields `executed: 1, failed at: 2 of 3` — verified by test `:222-224`. The MQL branch empty catch at `useDataGridEdit.ts:660` is **untouched and out-of-scope** as required. |
| **Completeness** (25%) | 9/10 | All 5 ACs satisfied with file:line evidence (see Sprint Contract Status below). Generator added a defensive outer `} catch (err)` at `:729` that also routes to `setCommitError` — beyond strict scope, but it cleanly closes the "what if a sync throw escapes the inner loop" hole and is consistent with the no-empty-catch invariant. The new `commitError` prop is wired to both `SqlPreviewDialog.tsx` (the contracted target) and `DataGrid.tsx` (the actual render site). `setSqlPreviewExposed` wrapper (`:386-392`) cleans `commitError` on dismiss, and `handleDiscard` clears it (`:776`) — full state-machine coverage. |
| **Reliability** (20%) | 9/10 | Partial-failure path stops at first reject (`:710`) — correct, since `executeQuery` runs serially without a transaction and already-applied statements cannot be rolled back. Tracking `executedCount` only after `await` succeeds (`:680`) ensures the count reflects truly committed statements. `pendingEdits` / `pendingDeletedRowKeys` / `pendingNewRows` are NOT cleared on failure, so the user can fix the row and retry. `sqlPreviewStatements` mirror is kept in lockstep with `sqlPreview` at every write site (`handleCommit:589-590`, Cmd+S handler `:869-870`). Fall-back at `:671-672` (`sqlPreviewStatements ?? sqlPreview.map(...)`) defends against state skew. Error message formatter handles non-Error / non-string rejects (`:687-692`). |
| **Verification Quality** (20%) | 9/10 | Orchestrator-confirmed: `pnpm vitest run` 1660/1660 PASS, `pnpm tsc --noEmit` exit 0, `pnpm lint` exit 0. Six tests cover: simple failure (`:112-164`), partial failure with exact 1-indexed wording assertions (`:166-234`), happy-path regression with all 4 invariants (`:236-279`), commitError reset on fresh commit (`:281-312`), commitError reset on modal dismiss (`:314-343`), and a static guard via Vite `?raw` import (`:345-379`). Static guard slices the SQL branch only (avoiding a false trip on the MQL empty catch) and runs both an empty-catch regex check AND positive `setCommitError(`/`executed:`/`failed at:` token assertions — durable against future refactors. |
| **Overall** | **9.0/10** | All dimensions clear the 7/10 threshold. |

## Verdict: **PASS**

## Sprint Contract Status (Done Criteria)

- [x] **AC-01** — `executeQuery` reject sets `commitError` (a) records statement idx + DB message + raw SQL, (b) does NOT clear `sqlPreview`, (c) writes failed cell key into `pendingEditErrors`.
  - Source: `src/components/datagrid/useDataGridEdit.ts:681-711` (catch block).
  - Assertion: `useDataGridEdit.commit-error.test.ts:140-142` (commitError fields), `:152-154` (sqlPreview preserved), `:157-160` (pendingEditErrors flagged).
- [x] **AC-02** — Partial failure: 3 SQLs, 2nd reject → `statementIndex 1`, "executed: 1" + "failed at: 2".
  - Source: `src/components/datagrid/useDataGridEdit.ts:697` (message template) + `:680` (executedCount increment after success).
  - Assertion: `useDataGridEdit.commit-error.test.ts:219-224` (`statementIndex === 1`, `statementCount === 3`, message contains `"executed: 1"`, `"failed at: 2"`, `"permission denied"`); `:227` (`mockExecuteQuery` called exactly 2× — third skipped).
- [x] **AC-03** — `SqlPreviewDialog` renders `commitError` in destructive `role="alert"` slot with raw SQL + count.
  - Source: `src/components/structure/SqlPreviewDialog.tsx:103-119` (banner with `role="alert"`, `aria-live="assertive"`, count + message + `<pre>` raw SQL).
  - Mirror render site: `src/components/DataGrid.tsx:486-525` — failed statement gets destructive border (`:493-497`), banner below with same structure (`:506-525`).
  - Assertion: AC-01/AC-02 tests cover the underlying `commitError` shape; render-side assertion is implicit (the same prop populates both surfaces) and the banner is not gated, so any test mounting `SqlPreviewDialog` with `commitError != null` would surface it. **Minor gap**: no RTL test directly mounts `SqlPreviewDialog` with a non-null `commitError` to assert `role="alert"` + visible text. Hook-level coverage is strong, but a dialog-level RTL test would close the loop.
- [x] **AC-04** — Happy path: all SQL succeed → `sqlPreview === null`, `pendingEdits.size === 0`, `fetchData` 1×, `commitError === null`.
  - Source: `src/components/datagrid/useDataGridEdit.ts:713-728` (success cleanup: `setSqlPreview(null)`, `setSqlPreviewStatements(null)`, `setCommitError(null)`, clears all pending state, calls `fetchData()`).
  - Assertion: `useDataGridEdit.commit-error.test.ts:273-278` asserts all four invariants. Full suite remains 1660/1660 PASS — pre-existing happy-path tests not regressed.
- [x] **AC-05** — Static regression guard: catch block non-empty.
  - Source: `src/components/datagrid/useDataGridEdit.commit-error.test.ts:345-379`.
  - Mechanism: imports `useDataGridEdit.ts?raw` (Vite raw loader; project already uses this pattern per generator finding #4), slices the SQL branch from `if (!sqlPreview) return;` to the next `}, [`, runs `/\}\s*catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*(?:\/\/[^\n]*\s*)*\}/g` and asserts zero matches. Adds positive `setCommitError(` / `executed:` / `failed at:` token assertions to defend the fix shape itself, not just "non-empty".

## Verification Results (orchestrator-confirmed)
- `pnpm vitest run`: 1660/1660 tests pass (91 files) — Verified.
- `pnpm tsc --noEmit`: exit 0 — Verified.
- `pnpm lint`: exit 0 — Verified.

## Static Verification (file inspection)

- **SQL branch catch is non-empty**: `useDataGridEdit.ts:681 (} catch (err))` opens, body runs `:687-710` with `setCommitError(...)`, conditional `setPendingEditErrors(...)` update, and explicit early `return`. Confirmed by Grep.
- **MQL branch (`paradigm === "document"`) NOT modified**: `useDataGridEdit.ts:660 (} catch {)` empty catch with comment `// Mirror the RDB branch: surface via fetchData's error path.` is preserved as-is. Out of scope per contract — confirmed.
- **Partial-failure wording matches exactly**: `:697` template emits `executed: ${executedCount}, failed at: ${i + 1} of ${statementCount} — ${message}`. With `executedCount` incremented only post-await (`:680`), the 2nd-of-3 reject path emits `executed: 1, failed at: 2 of 3` — confirmed by test `:222-223`.
- **`sqlPreview` is NOT cleared on failure**: inner catch at `:681` does not call `setSqlPreview(null)`; the only places that clear it are the success path (`:714`), the wrapped exposed setter (`:386-392`, only when caller passes `null`), and `handleDiscard` (`:760-777`). Confirmed.

## Required-Check Greps
- `} catch (` matches in `useDataGridEdit.ts`: lines 681 (SQL inner — populated), 729 (defensive outer — populated). Empty `} catch {` at 660 is the MQL branch — out of scope.
- `commitError | statementIndex | executed: | failed at` matches: 11 in `useDataGridEdit.ts`, 12 in `SqlPreviewDialog.tsx` (per generator finding, spot-checked).

## Feedback for Generator

1. **Test gap (low priority)** — `SqlPreviewDialog` `commitError` rendering has no direct RTL test.
   - Current: AC-03 is verified via the hook's `commitError` state; the dialog's `role="alert"` banner is not asserted by a render-mounted test.
   - Expected: An RTL test that mounts `<SqlPreviewDialog sql="..." loading={false} error={null} commitError={{ statementIndex: 1, statementCount: 3, sql: "UPDATE ...", message: "executed: 1, failed at: 2 of 3 — permission denied" }} ... />` and asserts `screen.getByRole("alert")` contains the message + raw SQL.
   - Suggestion: Add ~15 lines to `SqlPreviewDialog.test.tsx` (or create one if absent). Keeps the alert role + text wiring under regression guard at the component boundary.

2. **Out-of-scope MQL branch (latent risk, not blocking)** — `useDataGridEdit.ts:660` still has the silent-swallow `} catch {}` for the document paradigm.
   - Current: Generator correctly left it (out of scope per contract).
   - Expected: A follow-up sprint to fix it.
   - Suggestion: File a tracking issue or add to `docs/RISKS.md` as `active` so the same bug class doesn't ship for Mongo write errors.

3. **Defensive outer catch wording (nit)** — `:729` outer catch sets `sql: statements[executedCount]?.sql ?? ""`. If `executedCount === statementCount` (last successful await before a sync throw on cleanup), the index is past the array end and `sql` becomes `""`.
   - Current: Edge case has no test, but the message string still includes `failed at: ${executedCount + 1} of ${statementCount}` which is mildly confusing if `executedCount === statementCount`.
   - Expected: Either floor the index to `statementCount - 1` for `sql` lookup, or document that the defensive catch is for sync throws only (which currently it is — per the comment).
   - Suggestion: Low priority. Comment at `:730-735` already explains the intent; consider adding a one-line test that triggers the outer catch (e.g., by making `setSqlPreview` throw inside `act`) to lock in the behaviour.

## Handoff Artifacts

- **Findings**: `docs/sprints/sprint-93/findings.md` (generator-authored, accepted as-is — accurate and verifiable).
- **Evaluation**: this file (`docs/sprints/sprint-93/evaluation.md`).
- **Open P1/P2 findings**: 0.
- **Required checks passing**: yes (vitest, tsc, lint, grep).
- **Acceptance criteria evidence**: linked above with file:line citations.
