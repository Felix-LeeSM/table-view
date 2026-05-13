# Sprint Contract: sprint-269

## Summary

- Goal: Convert the passive "Active DB synced to 'X'. Re-run the query if
  needed." toast (Sprint 267 AC-267-02) into an actionable toast that carries
  an explicit **Retry** button. Clicking Retry re-dispatches the exact same
  statement / batch the user originally executed, this time against the
  now-synced `activeDb`. Closes Sprint 267 OoS #1.
- Audience: Generator (implementation) → Evaluator (verification).
- Owner: Sprint 269 Generator.
- Verification Profile: `command`

## In Scope

- **Toast surface** (`src/lib/toast.ts` + `src/components/ui/toaster.tsx`):
  extend the existing self-implemented Zustand-backed queue with an **optional**
  `action` field on `Toast` + `ToastOptions`. Render the action button inside
  `ToastItem` immediately before the existing dismiss `X`.
- **Mismatch catch path** (`src/components/query/QueryTab/useQueryExecution.ts`):
  inside `syncMismatchedActiveDb` (or its call sites — Generator's choice; see
  Done Criteria #4), capture the originating `stmt` (single) or
  `(statements, joinedSql)` (batch) closure at the moment of `parseDbMismatch`
  detection and push the toast with a `Retry` action that re-invokes
  `runRdbSingleNow(stmt)` / `runRdbBatchNow(statements, joinedSql)`.
- **Retry closure guards**: closure must no-op when the tab no longer exists
  (`useWorkspaceStore.getState().tabs.find(t => t.id === tabId)` returns
  undefined) **AND** when the tab is currently `running` (prevent
  double-dispatch / race with another in-flight query in the same tab).
- **Tests**:
  - `src/lib/toast.test.ts` — pin the `action` field shape + backward-compat
    (existing call sites with no `action` keep working).
  - new `src/components/ui/toaster.test.tsx` (or extend existing if present) —
    pin the Retry button JSX: accessible name, `type="button"`, click fires
    `onClick()` AND dismisses the toast.
  - `src/components/query/QueryTab.dbMismatch.test.tsx` — add cases for
    AC-269-01 / AC-269-02 / AC-269-03 / AC-269-04 (see Test Requirements
    below). Existing 3 Sprint 267 cases remain green.

## Out of Scope

- Sprint 270 (cold-boot skeleton placeholders) — no `Skeleton` primitive
  introduced here.
- Sprint 271 (propagate `expected_database` guard to other RDB commands) — no
  backend handler changes; `cargo` is unchanged this sprint.
- Sprint 268 (autocomplete cache schema-qualification) — already landed; do
  not touch `useSqlAutocomplete`.
- Toast queue rework beyond the new optional `action` field. The
  `(variant, message, options)` signature, per-variant default durations,
  `roleForVariant`, dismiss-by-id semantics, and Esc-dismisses-LIFO behaviour
  stay byte-identical.
- Sonner / external toast library introduction — the spec mentions sonner
  in passing but production uses a self-implemented store; we extend that.
- Visual / theming change to `VARIANT_CLASSES`. The Retry button reuses
  existing button styling primitives only.

## Invariants

- **Sprint 267 specificity**: non-`DbMismatch` errors continue to render
  without a Retry button. The existing `parseDbMismatch(message)` gate is the
  only branch that pushes the action-bearing toast.
- **Sprint 267 sync + clearForConnection**: `verifyActiveDb` → `setActiveDb`
  → `clearForConnection` chain fires unchanged (the toast with Retry replaces
  the passive `toast.warning(...)` call; sync side effects are not gated on
  the user clicking Retry).
- **`roleForVariant` mapping unchanged**: the mismatch toast remains
  `variant: "warning"` → `role="alert"` → `aria-live="assertive"`.
- **Backward-compatible toast API**: every existing `toast.success(...)` /
  `toast.error(...)` / `toast.info(...)` / `toast.warning(...)` call site
  compiles unchanged. The new `action` parameter is optional on `ToastOptions`
  and absent from `Toast` when not supplied.
- **Best-effort verify-failure invariant** (Sprint 267): if `verifyActiveDb`
  rejects, the catch block stays silent — no Retry toast surfaces. A failed
  verify must not strand the user with a Retry whose first action would race
  an unsynced backend.
- **No double-fire**: clicking Retry while the tab is already `running` is
  a no-op (running-state guard inside the closure). The toast is dismissed
  the moment the click handler fires, so a second click can't reach a stale
  closure.
- **Toast queue identity**: action button is in-toast only. Once dismissed
  (auto-timeout or manual X / Retry click), the action is unrecoverable from
  the toast surface — there is no separate notification center.
- **No new ADR**, no `unwrap()` (none added; sprint is TS-only), no `any`
  (TypeScript), no `console.log` shipped.

## Acceptance Criteria

- `AC-269-01` — **Retry button visible on mismatch toast.** When
  `syncMismatchedActiveDb` fires after a backend `DbMismatch`, the toast row
  surfaces a Retry button (accessible name = `"Retry"`, `type="button"`)
  alongside the existing dismiss X. The toast otherwise behaves as a normal
  `warning` toast (auto-dismiss timer, role, aria-live).

- `AC-269-02` — **Retry re-runs the same statement.** Clicking Retry
  re-dispatches the exact SQL the user originally executed:
  - Single-statement path → `runRdbSingleNow(stmt)` with the captured `stmt`.
  - Multi-statement path → `runRdbBatchNow(statements, joinedSql)` with the
    captured `(statements, joinedSql)`.
  After Retry, the tab's `queryState.status` transitions to `"running"`. The
  frontend store's `activeDb` is already synced before the Retry click, so
  the retry's `expected_database` matches and no second `DbMismatch` is
  observed in the test.

- `AC-269-03` — **Retry availability lifetime + double-click guard.** Retry
  is clickable only while the toast is mounted; clicking dismisses the toast.
  The retry closure additionally guards: (a) tab no longer exists in
  `useWorkspaceStore.getState().tabs` → no-op; (b) tab is currently in
  `queryState.status === "running"` → no-op. Rapid double-click cannot
  produce two dispatches (the toast is dismissed on the first click; even if
  a second click reached the same closure synchronously, the running-state
  guard would no-op it).

- `AC-269-04` — **Non-mismatch errors are unchanged.** Existing query
  failures whose message does NOT satisfy `parseDbMismatch` continue to
  render through `failQuery` without surfacing any toast Retry. The existing
  Sprint 267 specificity test (third case in `QueryTab.dbMismatch.test.tsx`)
  remains green and is supplemented with a positive assertion that no toast
  with an `action` field was pushed.

- `AC-269-05` — **Regression gate.**
  - `pnpm vitest run --no-file-parallelism` passes; case count is monotonic
    non-decreasing vs Sprint 268 baseline (3205).
  - `pnpm tsc --noEmit` clean.
  - `pnpm lint` clean.
  - No backend change; `cargo` not run this sprint.

## Design Bar / Quality Bar

- **Pinned: Toast shape.** `Toast` interface gains
  `action?: { label: string; onClick: () => void }`. `ToastOptions` accepts
  the same optional `action` field. When `options.action` is supplied, `push`
  copies it onto the persisted `Toast`. Absent ⇒ field omitted (not `null`)
  so existing serialization stays byte-equivalent.
- **Pinned: Action button rendering.** Inside `ToastItem`, render the action
  button BEFORE the dismiss `X` button. The button must:
  - Have `type="button"` (prevents accidental form submission if a toast
    happens to surface inside a `<form>` context).
  - Carry the `label` text as its accessible name (the visible text is the
    `label`; no separate `aria-label` needed when the text is sufficient).
  - On click, invoke `action.onClick()` synchronously, THEN call the existing
    `onDismiss()` so the toast disappears the moment the retry begins
    (prevents a stale toast lingering after the new query is in flight).
  - Use the same `pointer-events-auto`, `focus-visible:ring-2` pattern as
    the dismiss button (keyboard accessible, screen-reader reachable).
- **Pinned: Re-dispatch closure capture.** Inside
  `useQueryExecution.ts`, both `runRdbSingleNow` and `runRdbBatchNow` catch
  blocks already detect `parseDbMismatch(message)`. After
  `void syncMismatchedActiveDb(tab.connectionId)`, push the toast with a
  Retry `onClick` that:
  ```ts
  // single-statement path
  () => {
    const ws = useWorkspaceStore.getState();
    const t = ws.tabs.find((x) => x.id === tab.id);
    if (!t || t.type !== "query") return;
    if (t.queryState.status === "running") return;
    void runRdbSingleNow(stmt);  // closure captures `stmt` at catch time
  }
  ```
  and analogously for the batch path with `runRdbBatchNow(statements, joinedSql)`.
  The passive `toast.warning(...)` call inside `syncMismatchedActiveDb` is
  REPLACED by a Retry-bearing toast pushed from the catch site (so the
  closure has lexical access to `stmt` / `statements` / `joinedSql`). To
  preserve Sprint 267's "verify-failed = silent" invariant, the catch site
  pushes the Retry toast only after observing `parseDbMismatch`; the
  best-effort `verifyActiveDb` failure path inside `syncMismatchedActiveDb`
  must remain silent.
- **Pinned: Retry availability lifetime.** Action is in-toast only. After
  auto-dismiss / manual X / Retry click, the retry is unrecoverable from
  the toast surface — there is no notification center / history surface
  introduced in this sprint.
- **Pinned: Specificity preservation.** Non-mismatch errors (`syntax error`,
  network failure, etc.) must NOT receive a Retry action. The existing
  `if (parseDbMismatch(message))` branch is the SOLE call site that pushes
  a toast with `action`.

## Verification Plan

### Required Checks

1. **Targeted vitest** — fast feedback loop for the changed files:
   ```
   pnpm vitest run --no-file-parallelism \
     src/lib/toast.test.ts \
     src/components/ui/toaster.test.tsx \
     src/components/query/QueryTab.dbMismatch.test.tsx
   ```
2. **Full vitest** — regression gate covering the whole suite:
   ```
   pnpm vitest run --no-file-parallelism
   ```
3. **Type check** — `pnpm tsc --noEmit` (Toast interface change must propagate
   without `any`).
4. **Lint** — `pnpm lint` (zero errors).
5. **No backend run** — `cargo` is intentionally skipped; the sprint touches
   no Rust file. Generator must confirm in evidence that `src-tauri/` is
   untouched.

### Required Evidence

- Generator must provide:
  - **File diffs** for every changed file with one-line purpose annotations
    (toast.ts, toaster.tsx, useQueryExecution.ts, plus test files).
  - **Test count delta** versus the Sprint 268 baseline of **3205** cases.
    State the new total explicitly (e.g. `3205 → 3209`) and list the new
    test names with file:line.
  - **Full output tail** for `pnpm vitest run --no-file-parallelism` (last
    20–30 lines including the summary), `pnpm tsc --noEmit`, `pnpm lint`.
  - **Acceptance criteria coverage table**: AC-269-01 … AC-269-05 → test
    name → file:line that demonstrates it.
- Evaluator must cite (with file path + line number):
  - `(a)` the line where the `Toast` (or `ToastOptions`) interface gains the
    `action?: { label: string; onClick: () => void }` field.
  - `(b)` the line in `ToastItem` (toaster.tsx) where the Retry button JSX
    renders, plus the click handler that calls `action.onClick()` and then
    `onDismiss()`.
  - `(c)` the line(s) in `useQueryExecution.ts` where the catch closure
    captures `stmt` (single) and `(statements, joinedSql)` (batch) and pushes
    the Retry toast.
  - Verification that AC-269-04's specificity is preserved (the test that
    asserts a non-mismatch error pushes NO action-bearing toast).

## Test Requirements

### Unit Tests (필수)

- **toast.ts** (new case): pin that `toast.warning(message, { action: {...} })`
  persists the `action` on the resulting `Toast`. Also pin that the existing
  call sites (no `action`) result in a `Toast` whose `action` is `undefined`.
- **toaster.tsx** (new component test, or extend an existing toaster test
  file if one already exists — Generator audits and reports): pin that:
  1. When a toast carries an `action`, the row renders a button whose
     accessible name equals `action.label`, with `type="button"`.
  2. Clicking that button fires `action.onClick` exactly once.
  3. Clicking that button dismisses the toast (it disappears from the queue).
  4. When the toast has no `action`, only the dismiss X is rendered (the
     button count is exactly 1, not 2).
- **QueryTab.dbMismatch.test.tsx** (extend existing 3 Sprint 267 cases):
  - `AC-269-01`: render → mismatch error → assert a button with accessible
    name "Retry" appears.
  - `AC-269-02 single`: render → mismatch on single statement → click Retry
    → assert `mockExecuteQuery` is called a second time with the same `stmt`
    and the now-synced `expectedDatabase`.
  - `AC-269-02 batch`: render → multi-statement with one stmt hitting
    mismatch → click Retry → assert `mockExecuteQuery` is called the
    expected number of times for the re-run batch.
  - `AC-269-03 closed-tab`: render → mismatch → close/remove the tab from
    `useWorkspaceStore` → click Retry → assert no further `executeQuery`
    call (closure no-ops).
  - `AC-269-03 already-running`: render → mismatch → manually set
    `queryState.status = "running"` on the tab → click Retry → assert no
    further `executeQuery` call.
  - `AC-269-04 specificity` (augment existing third case): assert that the
    pushed toast (if any) does NOT carry an `action` for non-mismatch errors.

### Coverage Target

- 신규/수정 코드 (toast.ts, toaster.tsx, useQueryExecution.ts diff): 라인
  70% 이상.
- CI 전체 기준 (라인 40%, 함수 40%, 브랜치 35%) 유지.

### Scenario Tests (필수)

- [x] Happy path — single-statement mismatch → click Retry → success.
- [x] Happy path — multi-statement batch mismatch → click Retry → batch re-runs.
- [x] 에러/예외 — non-mismatch error → no Retry surface (Sprint 267 invariant).
- [x] 경계 조건 — tab closed before Retry click → closure no-ops.
- [x] 경계 조건 — tab already in `running` state → closure no-ops (double-fire guard).
- [x] 경계 조건 — `verifyActiveDb` rejects → no Retry toast surfaces (Sprint 267
      best-effort invariant preserved).
- [x] 기존 기능 회귀 없음 — existing toast call sites (`toast.success`,
      `toast.info`, `toast.error`, `toast.warning` without `action`) compile
      and behave unchanged; existing 3 Sprint 267 cases stay green.

## Test Script / Repro Script

1. `pnpm install` (if dependencies stale).
2. `pnpm vitest run --no-file-parallelism src/lib/toast.test.ts src/components/ui/toaster.test.tsx src/components/query/QueryTab.dbMismatch.test.tsx`
   — fast loop for the changed surface.
3. `pnpm vitest run --no-file-parallelism` — full regression gate; confirm
   test count ≥ 3205 (Sprint 268 baseline) + new cases.
4. `pnpm tsc --noEmit` — type check.
5. `pnpm lint` — ESLint clean.
6. (Manual, optional, NOT required for evaluator) Launch `pnpm tauri dev`,
   connect to a Postgres, swap the active db out-of-band (e.g. via psql
   `SET search_path` / `\c another_db` on the same pool), execute a query
   in the existing tab, observe the Retry toast, click it, confirm the
   re-dispatched query succeeds.

## Ownership

- Generator: Sprint 269 implementation agent. Writes production diff + new
  tests; does NOT touch `src-tauri/`.
- Write scope:
  - `src/lib/toast.ts`
  - `src/lib/toast.test.ts`
  - `src/components/ui/toaster.tsx`
  - `src/components/ui/toaster.test.tsx` (create if absent)
  - `src/components/query/QueryTab/useQueryExecution.ts`
  - `src/components/query/QueryTab.dbMismatch.test.tsx`
- Merge order: single landable commit. Conventional Commits prefix
  `feat(sprint-269)`. Sprint folder
  `docs/sprints/sprint-269/{contract.md,execution-brief.md,handoff.md}`
  follows the existing sprint-naming rule.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (vitest + tsc + lint)
- Acceptance criteria evidence linked in `handoff.md` (each AC → test name +
  file:line)
- Sprint 267 invariants verified: existing 3 Sprint 267 cases pass unchanged;
  verify-failed-silent path still silent.
- No backend churn: `git status src-tauri/` clean against the sprint base.
