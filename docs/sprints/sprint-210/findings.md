# Findings: sprint-210

## Verification Summary

- Profile: `command`
- Checks run:
  - `wc -l src/components/document/DocumentDataGrid.tsx` → **597** (< 600, target satisfied — 951 → 597 = 37.2 % reduction).
  - `wc -l src/components/document/DocumentDataGrid/*.{ts,tsx}` → 175 / 263 / 88 / 112 (no sub-file ≥ 400; max is `useMongoBulkOps.ts` at 263).
  - `ls src/components/document/DocumentDataGrid/{useDocumentGridData.ts,useMongoBulkOps.ts,DocumentBulkDeleteDialog.tsx,DocumentBulkUpdateDialog.tsx}` → all 4 files exist, all non-empty.
  - `git diff --stat src/components/document/DocumentDataGrid.test.tsx src/components/document/DocumentDataGrid.pagination.test.tsx src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` → no output (zero changes to all three regression test files).
  - `pnpm vitest run src/components/document/DocumentDataGrid.test.tsx src/components/document/DocumentDataGrid.pagination.test.tsx src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` → 3 files / 27 tests passed in 7.47 s, exit 0.
  - `pnpm vitest run` → **189 files / 2725 tests passed**, 33.45 s, exit 0. (Spec quoted 189/2737 as the post-209 baseline; the actual current main is 189/2725. The evaluator prompt explicitly flags the 2737 figure as stale, so file-count parity, not test-count parity, is the operative regression bar — and 189 files is preserved exactly.)
  - `pnpm tsc --noEmit` → exit 0 (no type errors).
  - `pnpm lint` → exit 0 (no eslint warnings/errors).
  - `grep -rn "from \"@components/document/DocumentDataGrid/" src/ e2e/` → 0 matches (sub-files internal, no external consumers).
  - `grep -rn "from \"@components/document/DocumentDataGrid\"" src/ e2e/` → 1 match (`src/components/layout/MainArea.tsx:8`), identical to pre-sprint.
- Evidence reviewed:
  - `src/components/document/DocumentDataGrid.tsx` (entry, 597 lines) — toolbar / grid / modal wiring only; bulk-ops & fetch logic delegated to hooks.
  - `src/components/document/DocumentDataGrid/useDocumentGridData.ts` (175 lines) — owns `runFind` dispatch, `fetchIdRef` stale guard, `queryIdRef`, `cancelQuery`, TableData projection.
  - `src/components/document/DocumentDataGrid/useMongoBulkOps.ts` (263 lines) — owns Safe-Mode gate, JSON patch parse + `_id` reject, `invokeDeleteMany`/`invokeUpdateMany`, success/error toasts, `addHistoryEntry`, post-success refetch, dialog open flags.
  - `src/components/document/DocumentDataGrid/DocumentBulkDeleteDialog.tsx` (88 lines) — stateless dialog; copy / classes / aria-label match pre-sprint JSX byte-for-byte.
  - `src/components/document/DocumentDataGrid/DocumentBulkUpdateDialog.tsx` (112 lines) — stateless dialog; placeholder, alert role, button copy match pre-sprint JSX byte-for-byte.
  - Diff comparison vs `git show HEAD:src/components/document/DocumentDataGrid.tsx` (951 lines) for `fetchData`, `handleCancelRefetch`, both bulk handlers, both dialog JSX bodies, and the Add Document handler — all preserved verbatim except for the in-component → in-hook wrapping.

## Findings

(None at P1/P2 severity. Two P3-informational notes recorded below.)

### F-001 (P3 / informational) Spec test-count baseline drift

- Severity: P3 (informational)
- Repro: `pnpm vitest run` after Sprint 210 reports `189 files / 2725 tests`. The contract states the post-209 baseline is `189 files / 2737 tests` and asks for "post-209 baseline 동일" parity.
- Expected: 189 files / 2737 tests (per `contract.md` §Verification Plan check 5).
- Actual: 189 files / 2725 tests.
- Evidence: full vitest run output (run during this evaluation, 33.45 s); evaluator prompt explicitly flags "the 2737 quoted in the spec — that quote is stale; verify against the actual current main" — i.e. 2725 is the live baseline. File-count (189) matches; test-count drift is in non-DocumentDataGrid files unrelated to this sprint and predates the sprint.
- Broken Contract Line: contract.md §Acceptance Criteria `AC-05` references "post-209 baseline 동일" with a 2737 figure that no longer matches main.
- Suggestion: not actionable inside Sprint 210 (this is a contract documentation drift, not a regression introduced by the sprint). The handoff for sprint-210 should record the live baseline (`189/2725`) and the planner for the next sprint should refresh the figure in the contract template.
- Status: open (informational, not blocking)

### F-002 (P3 / informational) `useDocumentGridData.activeFilterCount` is now a separately-passed param

- Severity: P3 (informational, no behaviour impact)
- Repro: `useDocumentGridData` accepts both `activeFilter` and `activeFilterCount` as separate inputs (see `UseDocumentGridDataParams`, lines 36–44).
- Expected: hook could derive `activeFilterCount` internally from `activeFilter` to keep the surface minimal (the entry already does the same `Object.keys` derivation at line 90 of `DocumentDataGrid.tsx`).
- Actual: both are passed as separate props, mildly leaking entry-side memoization concerns into the hook signature. The hook only uses `activeFilterCount` to decide whether to send a filter body to `runFind`; this could be replaced by `Object.keys(activeFilter).length > 0 ? activeFilter : undefined` inside the hook.
- Evidence: `src/components/document/DocumentDataGrid/useDocumentGridData.ts:42–43`, `src/components/document/DocumentDataGrid.tsx:90–104`.
- Broken Contract Line: contract.md §Design Bar "hook 의 인터페이스는 entry 가 필요한 최소 surface 만 노출. 내부 ref/state 누출 금지" — leans toward "minimal surface" but is not violated; the redundancy is symmetrical (entry passes derived value rather than hook leaking internal state).
- Suggestion: in a follow-up sprint, derive `activeFilterCount` inside the hook (or accept only `activeFilter`) so the hook signature matches the "minimal surface" guideline more cleanly. No changes needed for Sprint 210.
- Status: open (informational, not blocking)

## Pass Checklist

- `AC-01` (entry path + public props preserved): **PASS** — `src/components/document/DocumentDataGrid.tsx` still exists; default export is `DocumentDataGrid({ connectionId, database, collection })` (lines 63–67); `MainArea.tsx:8` import unchanged (`grep` confirms 1 match identical to pre-sprint).
- `AC-02` (sub-file layout): **PASS** — all 4 sub-files exist under `src/components/document/DocumentDataGrid/` with non-empty content (175 / 263 / 88 / 112 lines). Each sub-file exports the symbol the entry imports: `useDocumentGridData` (line 55), `useMongoBulkOps` (line 61), `DocumentBulkDeleteDialog` default (line 31), `DocumentBulkUpdateDialog` default (line 33). Entry imports verified at `DocumentDataGrid.tsx:26-29`.
- `AC-03` (entry shrinks meaningfully): **PASS** — `wc -l` reports 597 (< 600) and 951 → 597 = 37.2 % reduction (> 35 %). All 4 sub-files individually < 400 (max 263).
- `AC-04` (regression tests pass unchanged): **PASS** — `git diff --stat` reports 0 changes to all 3 test files; targeted `pnpm vitest run` against the 3 files passes 27/27.
- `AC-05` (project-wide regression bar): **PARTIAL PASS** — `pnpm vitest run` exits 0 with 189 files / 2725 tests (file-count parity preserved; test-count parity flagged as F-001 informational, evaluator prompt confirms 2725 is the live baseline and 2737 in spec is stale); `pnpm tsc --noEmit` exits 0; `pnpm lint` exits 0; `git diff` of the changed paths shows no new `eslint-disable` directive (`grep "eslint-disable"` in changed files returns 0).

### Global ACs (from spec.md)

- **#1 Behavior change = 0**: PASS — verified by 27/27 targeted regression test passes and 2725/2725 full-suite passes.
- **#2 Query-history side-effect ordering preserved**: PASS — verified by direct line-by-line diff of `useMongoBulkOps.ts` (handleConfirmDeleteMany lines 95–147, handleConfirmUpdateMany lines 168–245) and `DocumentDataGrid.tsx` (handleAddSubmit lines 175–219) against `git show HEAD:src/components/document/DocumentDataGrid.tsx`. `addHistoryEntry` payload fields (`sql`, `executedAt`, `duration`, `status`, `connectionId`, `paradigm: "document"`, `queryMode: "find"`, `database`, `collection`, `source: "mongo-op"`) all preserved; call ordering (after toast/UI update, before loading clear in finally) preserved in all 6 history paths.
- **#3 Safe Mode gate semantics preserved**: PASS — `useMongoBulkOps.ts:84–93` (`handleDeleteManyClick`) and `:151–166` (`handleUpdateManyClick`) both call `safeModeGate.decide(analyzeMongoOperation(...))` before opening their dialog; both surface `toast.error(decision.reason)` on `block` and short-circuit before `setDialogOpen(true)`. Argument shapes (`{ kind: "deleteMany", filter }` and `{ kind: "updateMany", filter, patch: {} }`) match the original.
- **#4 `fetchIdRef` stale-response invariant preserved**: PASS — `useDocumentGridData.ts:72–133` carries `fetchIdRef`, `queryIdRef`, the `if (fetchIdRef.current === fetchId)` race guard in catch + finally, and the cancel handler that bumps `fetchIdRef.current++`, calls `setLoading(false)` synchronously, then fires best-effort `cancelQuery(queryId).catch(() => {...})` with an inline justification comment. `AC-180-05-DocumentDataGrid` test passes.
- **#5 Mongo bulk-write commands wiring preserved**: PASS — `useMongoBulkOps.ts:101-106` calls `invokeDeleteMany(connectionId, database, collection, activeFilter)`; `:197-203` calls `invokeUpdateMany(connectionId, database, collection, activeFilter, patch)`. Toast copy `Deleted ${deletedCount} document(s)` / `Updated ${modifiedCount} document(s)` / `Failed to delete: ${detail}` preserved.
- **#6 Public import path stays a single barrel**: PASS — `grep "from \"@components/document/DocumentDataGrid/"` returns 0 external matches; `grep "from \"@components/document/DocumentDataGrid\""` returns the same single match (`MainArea.tsx:8`) as pre-sprint.
- **#7 No silent error swallowing added**: PASS — only one new `.catch(() => {})`-style block exists (`useDocumentGridData.ts:126-131`), and it's a verbatim move of the pre-sprint `cancelQuery` best-effort catch with the same inline justification comment ("best-effort: backend cancel registry may have already evicted the token..."). All other catches re-surface via `setError` / `toast.error` / `setUpdateManyError` / `setAddError`.

## Missing Evidence

- None blocking. Generator's expected handoff packet would benefit from explicitly noting the live `pnpm vitest run` summary (189/2725) so future evaluators don't chase the stale 2737 figure (see F-001).

## Residual Risk

- **Behaviour-preservation source of truth = 3 regression test files.** Sprint 210 inherited the spec-acknowledged risk that any user-visible behaviour *not* covered by the existing tests could silently regress. Spot inspection of dialog copy, toast copy, history payload, Safe-Mode gate, and `fetchIdRef` race confirms byte-for-byte parity in the parts the test suite *doesn't* assert (e.g. dialog button `aria-label`, Tailwind classes), so this risk is rated low but not zero.
- **`useDocumentGridData.activeFilterCount` parameter** (F-002) is a soft-design carry-over: the hook signature is wider than strictly necessary. Not a behavioural defect.
- **Spec test-count baseline (2737) is stale on main.** Live baseline is 2725; this would fail a literal contract reading but passes the evaluator-prompt-amended reading. Sprint 211 planner should refresh.
