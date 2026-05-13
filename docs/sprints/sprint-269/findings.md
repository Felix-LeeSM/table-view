# Sprint 269 Evaluation Findings

**Evaluator:** Sprint 269 Evaluator (harness)
**Date:** 2026-05-13
**Verification profile:** `command`
**Working tree:** `/Users/felix/Desktop/study/view-table`

## Verification Plan Execution

All four required checks were re-run against the working tree at evaluation
time. All four passed.

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm vitest run --no-file-parallelism src/lib/toast.test.ts src/components/ui/toaster.test.tsx src/components/query/QueryTab.dbMismatch.test.tsx` | **3 files / 34 tests passed** (2.07s) |
| 2 | `pnpm vitest run --no-file-parallelism` (full regression) | **260 files / 3217 tests passed** (186.27s). Baseline 3205 → 3217 (+12 monotonic, matches Generator's delta). |
| 3 | `pnpm tsc --noEmit` | exit 0, no output |
| 4 | `pnpm lint` | exit 0, no warnings |

Backend assertion: `git status src-tauri/` is clean — no Rust file touched
this sprint (`cargo` correctly skipped per contract §5).

## Code-Level Verification (Citation Audit)

### (a) Toast shape — AC-269-01

`src/lib/toast.ts`:
- **L21–24** — `ToastAction` interface exported with `label: string` + `onClick: () => void`. Properly named, properly exported.
- **L41** — `Toast.action?: ToastAction` declared optional on the persisted shape.
- **L63** — `ToastOptions.action?: ToastAction` declared optional on the caller-facing shape.
- **L120–123** — `push()` constructs the `Toast` in two branches: omits `action` entirely when `options?.action === undefined` (Sprint 94 byte-equivalence preserved) and includes it inline when supplied. This matches the contract's "Absent ⇒ field omitted (not `null`)" pin (contract §Design Bar).
- **L145–164** — `toast.success/error/info/warning/dismiss/clear` façade untouched. Signature `(message, options?)` byte-identical to Sprint 94. All four variant defaults in `DEFAULT_DURATIONS` (L83–88) unchanged. `roleForVariant` (L173–175) byte-identical (warning → alert; error → alert; info/success → status).

**Verdict:** AC-269-01 satisfied. No `null` leakage. No backward-incompat. No `any`.

### (b) Action button rendering — AC-269-01, AC-269-02

`src/components/ui/toaster.tsx`:
- **L115–132** — Retry button block. Conditional render gated on `toast.action` truthy.
- **L122** — `type="button"` present (prevents form submission inside a `<form>` ancestor — pinned in contract §Design Bar).
- **L123–127** — `onClick={() => { toast.action?.onClick(); onDismiss(); }}` — invokes the action callback synchronously, then calls `onDismiss()`. Order matches contract pin: "invoke `action.onClick()` synchronously, THEN call the existing `onDismiss()`".
- **L128** — Class string uses `focus-visible:ring-2 focus-visible:ring-ring/50` matching the dismiss button (L137) — keyboard accessibility parity preserved.
- **L130** — Accessible name = `toast.action.label` (visible text content; no separate `aria-label` needed when text is sufficient, per WAI-ARIA APG).
- **L115** (conditional) — Renders **before** the dismiss X (L133–140). Reading order: message → retry → dismiss, matching the contract pin "Inside `ToastItem`, render the action button BEFORE the dismiss `X` button".
- **L152–157** `VARIANT_CLASSES` and **L159–171** `VariantIcon` byte-identical to Sprint 94 — no styling drift.

**Verdict:** AC-269-01 and AC-269-02 rendering contract met. Click handler invokes callback synchronously then dismisses (no race window in which a second click could reach the same closure on the still-rendered toast).

### (c) Catch-site closure capture — AC-269-02, AC-269-03

`src/components/query/QueryTab/useQueryExecution.ts`:

**Single-statement path** (L405–488):
- **L446–470** catch branch on `parseDbMismatch(message)`.
- **L447–449** lexical capture: `capturedTabId`, `capturedConnectionId`, `capturedStmt = stmt`. Three local consts ⇒ the closure references frozen values, not the param identifier that may rebind on re-entry.
- **L450** `void syncMismatchedActiveDb(capturedConnectionId, onSynced)` — sync helper is fire-and-forget; the toast is pushed only inside the `onSynced` callback (i.e., only when verify resolved with a non-empty actual db). **Verify-failed-silent invariant preserved** (Sprint 267 invariant — confirmed by the new test at L477–514).
- **L451–467** `toast.warning(...)` with `action.onClick` that:
  1. Looks up live tab via `findLiveIdleTab(capturedTabId, capturedConnectionId)`.
  2. If `null`, returns (no-op).
  3. Reads current single-helper via `runRdbSingleRef.current`.
  4. Re-dispatches `void fn(capturedStmt)`.

**Batch path** (L497–620):
- **L511** `mismatchToastPushed` flag ensures **one Retry toast per batch**.
- **L547–572** main mismatch branch: lexically captures `capturedTabId`, `capturedConnectionId`, `capturedStatements = statements`, `capturedJoinedSql = joinedSql`. Toast `onClick` re-invokes `runRdbBatchRef.current(capturedStatements, capturedJoinedSql)` only if `findLiveIdleTab` returns non-null.
- **L573–579** else-branch — subsequent mismatch statements in the same batch still re-run idempotent verify+sync but suppress the toast. Smart: this preserves the connectionStore convergence guarantee without queue-spamming.

**Helper functions:**
- **L385–399** `findLiveIdleTab(tabId, connectionId)`:
  - L387 looks up `workspaces[connectionId]`; returns `null` if absent (handles full-connection close).
  - L389–395 iterates every `(connId, db)` slot (because the tab may have moved when active db flipped). For each found tab: returns `null` if `type !== "query"` (defensive) OR if `queryState.status === "running"`. **Atomically enforces both guards** required by AC-269-03.
- **L372–377** `runRdbSingleRef`/`runRdbBatchRef` decouple closure identity from `useCallback` deps so the Retry click always reaches the current render's helper (no stale closure).
- **L491** + **L622** refs synced after each render — current identity always reachable.

**Verdict:** AC-269-02 and AC-269-03 both fully satisfied. Single and batch paths cleanly separated. Closed-tab AND already-running guards are evaluated separately inside `findLiveIdleTab` — the two AC-269-03 branches are independently verified by separate tests.

### (d) Specificity-preservation test — AC-269-04

`src/components/query/QueryTab.dbMismatch.test.tsx` **L227–232** (within the existing "does NOT call verifyActiveDb when the error is not a DbMismatch" case): augmented with a positive assertion `queueAfter.every((t) => t.action === undefined)` that no toast in the queue carries an action field on the non-mismatch error path. The existing Sprint 267 specificity case stays green AND now actively pins the absence of the new Retry surface — exactly what the contract §Test Requirements `AC-269-04 specificity` line demanded.

### Sprint id annotation on every new test

Verified every new test carries a Sprint 269 + date marker:
- `src/lib/toast.test.ts` L112, L125 — `// Sprint 269 (2026-05-13)`.
- `src/components/ui/toaster.test.tsx` L207 — block header `// Sprint 269 (2026-05-13)`; each `it()` prefix `"Sprint 269:"`.
- `src/components/query/QueryTab.dbMismatch.test.tsx` L227, L236–241 — block header + every new `it()` named `"AC-269-XX"` / `"Sprint 269:"`.

### Discipline checks

- `any` / `as any` / `<any>` scan across all 6 changed files: **0 hits**.
- `console.(log|debug|info|warn|error)` scan across all 3 production files: **0 hits**.
- `git status src-tauri/` at evaluation time: **clean**. No Rust file touched.
- Out-of-scope drift scan: no Skeleton primitive, no sonner import, no `useSqlAutocomplete` touch, no `VARIANT_CLASSES` edit, no `roleForVariant` edit, no per-variant default duration edit. The change set is precisely the contract's in-scope surface.

## Done Criteria Coverage

| Criterion | Status | Evidence |
|-----------|--------|----------|
| DC-1 Toast shape pinned | PASS | `src/lib/toast.ts` L21–24 (ToastAction), L41 (Toast.action?), L63 (ToastOptions.action?), L117–123 (push omit-when-absent). Tests `src/lib/toast.test.ts` L115–123 + L128–135. |
| DC-2 Action button rendering pinned | PASS | `src/components/ui/toaster.tsx` L115–132. Tests `src/components/ui/toaster.test.tsx` L212–226 (type=button + name), L228–239 (click fires once), L241–255 (click dismisses), L257–268 (no-action → 1 button only). |
| DC-3 Re-dispatch semantics pinned | PASS | `useQueryExecution.ts` L446–470 (single), L547–572 (batch); ref-backed retry; live-tab + running guards via `findLiveIdleTab` L385–399. Tests AC-269-02 single L269–312, batch L314–370. |
| DC-4 Specificity gate preserved | PASS | `QueryTab.dbMismatch.test.tsx` L227–232 positive assertion supplementing existing Sprint 267 case. |
| DC-5 Verification gate clean | PASS | vitest 3217 / 3217 (≥3205 baseline + 12); tsc clean; lint clean; `src-tauri/` untouched. |

## Invariant Audit

| Invariant | Status |
|-----------|--------|
| Sprint 267 specificity (non-mismatch → no Retry) | PASS — test at L201–233 augmented with positive `action === undefined` assertion. |
| Sprint 267 sync chain unchanged | PASS — `verifyActiveDb` → `setActiveDb` → `clearForConnection` still fires in `syncMismatchedActiveDb` (L50–55). |
| Verify-failed-silent invariant | PASS — `onSynced` only invoked inside try-block after non-empty `actual`; catch block (L56–61) intentionally silent. New test at L477–514 actively pins this. |
| `roleForVariant` mapping unchanged | PASS — toast.ts L173–175 byte-identical. |
| Backward-compatible toast API | PASS — `toast.test.ts` L128–135 pins `action` field absent (not `null`) on toasts pushed without options.action. |
| No double-fire (running guard + dismiss-on-click) | PASS — onClick L123–127 dismisses synchronously after invoke; running guard inside `findLiveIdleTab` L393. |
| Toast queue identity (in-toast-only) | PASS — no notification-center surface added. |
| No new ADR, no `unwrap()`, no `any`, no `console.log` | PASS — scans clean. |

## Sprint Contract Status

- [x] AC-269-01 Retry button visible on mismatch toast — `QueryTab.dbMismatch.test.tsx` L243–267.
- [x] AC-269-02 Retry re-runs same statement (single + batch) — L269–312 + L314–370.
- [x] AC-269-03 Retry availability lifetime + double-click guard (closed-tab + already-running) — L372–410 + L412–475.
- [x] AC-269-04 Non-mismatch errors unchanged — L201–233 augmented (positive `action === undefined` assertion at L231–232).
- [x] AC-269-05 Regression gate — vitest 3217, tsc clean, lint clean, src-tauri untouched.

## Scorecard

| Dimension | Score | Justification |
|-----------|-------|---------------|
| **Correctness** | **9/10** | Catch-site closure capture, ref-decoupled retry helpers, atomic `findLiveIdleTab` guards. Verify-failed-silent preserved. `mismatchToastPushed` batch flag is a smart edge-case handling pin. Per-(connId, db) tab walk in `findLiveIdleTab` correctly handles mid-flight active-db flip. |
| **Completeness** | **10/10** | Every DC and AC has cited test coverage; specificity test augmented with positive assertion exactly as contract demanded; both AC-269-03 sub-branches separately verified; Sprint 267 invariants all retained. |
| **Code Quality** | **9/10** | Zero `any`, zero `console.*`, no out-of-scope drift; comments on every non-obvious decision (ref rationale at L366–377, `mismatchToastPushed` rationale at L506–510, `else if` repeat-mismatch suppression at L573–579). Minor: import of `useRef` is now used at the head of the file (was previously only `useCallback`, `useMemo`, `useState`) — verified at line 1 of `useQueryExecution.ts`, no unused import. |
| **Testing** | **10/10** | 12 new test cases (2 toast unit + 4 toaster component + 6 dbMismatch integration), each with sprint-id + date annotation. Specificity case augmented rather than duplicated. Both Retry guard branches (closed-tab vs already-running) are verified independently — the contract specifically required separate cases. Test count delta exactly matches Generator's claim (3205 → 3217). |
| **Contract Compliance** | **10/10** | Verification profile (`command`) fully executed; all four required checks ran green at evaluator time; cited line numbers match contract §Required Evidence requirements (a)/(b)/(c)/(d). No backend churn, no scope creep. |
| **Overall** | **9.6/10** | |

## Verdict: PASS

All required checks pass at re-execution time. All five acceptance criteria
are evidenced with cited file:line references. All seven invariants from
the contract hold. Discipline scans (no `any`, no `console.*`, no
out-of-scope drift) are clean. Zero `P1` / `P2` findings.

The work is ready to commit under `feat(sprint-269)`.

## Optional Polish (Non-Blocking)

These are nits — none reach `P3`. Documented for completeness:

1. **Closure capture redundancy.** In `runRdbSingleNow` at L447–449, `capturedTabId` and `capturedConnectionId` mirror `tab.id` and `tab.connectionId`. The local consts protect against the (extremely unlikely) case where `tab` rebinds during the await; the explicit capture is defensive but not load-bearing. Acceptable trade-off for readability of intent.
2. **`else if` repeat-suppression branch** (L573–579) could be simplified to drop the inner `parseDbMismatch(message)` re-check since the outer guard already exists in the parent `else if`. Compiler will inline this; pure style.
3. **Test file header comment** in `toaster.test.tsx` still cites "Sprint 94" as the file's birth marker (L7–15). This is correct (the file existed pre-269), but a one-line addendum noting Sprint 269 augmentation at the file header would speed future readers. Optional.

None of these affect verdict; all are below the threshold for `Feedback for Generator`.

## Handoff Evidence Fields (for handoff.md)

- **Verification profile:** command
- **Tests:** 3217 / 3217 (baseline 3205 + 12 new, monotonic non-decreasing)
- **Type check:** clean (`pnpm tsc --noEmit` exit 0)
- **Lint:** clean (`pnpm lint` exit 0)
- **Backend:** untouched (`git status src-tauri/` clean)
- **Scope drift:** none
- **Sprint 267 invariants:** all preserved (specificity + verify-failed-silent + clearForConnection chain)
- **New ADR introduced:** none (as required)
- **Files changed:** 6 (3 production, 3 test)
- **Net diff:** +556 / −10 lines (per `git diff --stat`)
