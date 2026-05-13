# Sprint Execution Brief: sprint-269

## Objective

- Add an explicit **Retry** button to the DbMismatch toast surfaced by
  `syncMismatchedActiveDb`, so a user whose tab tripped Sprint 266's
  `expected_database` guard can re-run the exact same statement / batch
  in one click instead of hunting for the originating tab and SQL.

## Task Why

- Closes Sprint 267 OoS #1. Sprint 267 surfaced a passive
  `toast.warning("Active DB synced to 'X'. Re-run the query if needed.")`
  after auto-syncing the frontend store, but left the user with no
  affordance to actually re-run. The originating tab + the exact statement
  are already in scope at catch time — capturing them in the toast's
  `action.onClick` turns a passive notification into a one-click recovery,
  the workflow TablePlus users expect.

## Scope Boundary

- IN: `src/lib/toast.ts` (`Toast` + `ToastOptions` gain optional `action`),
  `src/components/ui/toaster.tsx` (`ToastItem` renders Retry button before
  dismiss X), `src/components/query/QueryTab/useQueryExecution.ts` (catch
  blocks capture `stmt` / `(statements, joinedSql)` and push Retry toast
  in place of the existing passive `toast.warning`). Tests in
  `toast.test.ts`, new/extended `toaster.test.tsx`,
  `QueryTab.dbMismatch.test.tsx`.
- OUT: Sprint 270 skeleton placeholders. Sprint 271 `expected_database`
  guard propagation. Sprint 268 autocomplete cache (already landed). No
  toast queue rework beyond the new optional `action` field. No sonner
  introduction. No backend / `cargo` change. No new ADR. No `VARIANT_CLASSES`
  styling change.

## Invariants

- Sprint 267 specificity: non-`DbMismatch` errors continue to render with
  NO Retry action (`parseDbMismatch` is the sole gate).
- Sprint 267 sync chain unchanged: `verifyActiveDb` → `setActiveDb` →
  `clearForConnection` still fires. The action-bearing toast REPLACES the
  passive `toast.warning(...)` inside the sync flow; the catch-site is now
  responsible for pushing the toast (so the Retry closure has lexical
  access to `stmt` / `statements` / `joinedSql`).
- Sprint 267 verify-failed-silent invariant preserved: if `verifyActiveDb`
  rejects, no Retry toast is surfaced.
- `roleForVariant` mapping unchanged: mismatch toast remains `warning` →
  `role="alert"` → `aria-live="assertive"`.
- Backward-compatible toast API: every existing `toast.success(...)` /
  `toast.error(...)` / `toast.info(...)` / `toast.warning(...)` call site
  compiles + behaves unchanged.
- No double-fire: clicking Retry while the tab is already `running` is a
  no-op (running-state guard inside the closure); the toast is dismissed
  on the first click so a second synchronous click can't reach a stale
  closure either way.
- Retry availability lifetime: action button is in-toast only; once
  dismissed (auto / X / Retry click), retry is unrecoverable.
- No `unwrap()` (none added), no `any` (TS), no `console.log` shipped.

## Done Criteria

1. **Toast shape pinned.** `Toast` interface in `src/lib/toast.ts` gains an
   optional `action?: { label: string; onClick: () => void }` field;
   `ToastOptions` accepts the same. `push` copies `options.action` onto the
   persisted `Toast` when supplied; absent ⇒ field omitted. Existing call
   sites compile unchanged.
2. **Action button rendering pinned.** `ToastItem` in
   `src/components/ui/toaster.tsx` renders the action button BEFORE the
   dismiss X. Button has `type="button"`, accessible name equals
   `action.label`, focus-visible ring matches the dismiss button. Click
   invokes `action.onClick()` synchronously, then calls the existing
   `onDismiss()` so the toast disappears the moment retry begins.
3. **Re-dispatch semantics pinned.** Both `runRdbSingleNow` and
   `runRdbBatchNow` catch blocks in
   `src/components/query/QueryTab/useQueryExecution.ts` detect
   `parseDbMismatch(message)`, capture `stmt` (single) or
   `(statements, joinedSql)` (batch), call
   `void syncMismatchedActiveDb(tab.connectionId)`, and push the toast with
   Retry. The Retry `onClick` re-invokes `runRdbSingleNow(stmt)` /
   `runRdbBatchNow(statements, joinedSql)` only if the tab still exists in
   `useWorkspaceStore.getState().tabs` AND `queryState.status !== "running"`.
4. **Specificity gate preserved.** Non-mismatch errors push NO
   action-bearing toast. The existing Sprint 267 specificity test stays
   green and is augmented with a positive assertion (no action field
   observed on any pushed toast for the non-mismatch case).
5. **Verification gate clean.** `pnpm vitest run --no-file-parallelism`
   passes with case count ≥ 3205 (Sprint 268 baseline) plus new cases;
   `pnpm tsc --noEmit` and `pnpm lint` clean. `src-tauri/` untouched.

## Verification Plan

- Profile: `command` (vitest + tsc + lint; no backend).
- Required checks:
  1. `pnpm vitest run --no-file-parallelism src/lib/toast.test.ts src/components/ui/toaster.test.tsx src/components/query/QueryTab.dbMismatch.test.tsx`
     (targeted, fast loop).
  2. `pnpm vitest run --no-file-parallelism` (full regression gate).
  3. `pnpm tsc --noEmit`.
  4. `pnpm lint`.
- Required evidence:
  - Generator: file diffs + per-file purpose; new test count delta vs Sprint
    268 baseline 3205; new test names with `file:line`; full output tail
    for each of the four checks above.
  - Evaluator must cite line numbers of (a) `Toast` / `ToastOptions`
    `action` field declaration in `src/lib/toast.ts`; (b) the Retry button
    JSX + click handler in `src/components/ui/toaster.tsx`; (c) the catch
    closure capture sites for `stmt` and `(statements, joinedSql)` in
    `src/components/query/QueryTab/useQueryExecution.ts`; (d) the test
    asserting non-mismatch errors push no `action`-bearing toast.

## Evidence To Return

- Changed files and purpose (5 files: 3 production + 2–3 test).
- Checks run and outcomes (4 checks, all green).
- Done criteria coverage with evidence (AC-269-01 … AC-269-05 → test
  name → file:line).
- Test count delta vs baseline 3205.
- Assumptions made during implementation (e.g. whether `toaster.test.tsx`
  pre-existed or was created fresh; whether the toast was pushed from
  inside `syncMismatchedActiveDb` or moved to the catch site — Generator
  must note this choice).
- Residual risk or verification gaps (e.g. manual browser verification not
  required for evaluator; document any observed flake in vitest run if
  it occurred and how it was handled).

## References

- Contract: `docs/sprints/sprint-269/contract.md`
- Master spec: `docs/sprints/sprint-268/spec.md` (`### Sprint 269` section +
  global ACs + Sprint 269 edge cases)
- Sprint 267 baseline: `docs/sprints/sprint-267/` (handoff + tests)
- Relevant files:
  - `src/lib/toast.ts` — `Toast`, `ToastOptions`, `push`, `roleForVariant`
  - `src/components/ui/toaster.tsx` — `Toaster`, `ToastItem`,
    `VARIANT_CLASSES`
  - `src/components/query/QueryTab/useQueryExecution.ts` —
    `syncMismatchedActiveDb`, `runRdbSingleNow`, `runRdbBatchNow`
  - `src/components/query/QueryTab.dbMismatch.test.tsx` — Sprint 267
    integration test file to extend
  - `src/lib/toast.test.ts` — Sprint 94 toast unit tests to extend
  - `src/lib/api/dbMismatch.ts` — `parseDbMismatch` gate
  - `src/lib/api/verifyActiveDb.ts` — sync helper
