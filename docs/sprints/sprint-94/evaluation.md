# Sprint 94 Evaluation Scorecard

**Profile**: `command` (jsdom + RTL; file inspection + orchestrator command outputs).
**Scope**: 글로벌 토스트 시스템 + commit / connection CRUD hookup.

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** | 9/10 | All ACs satisfied. Variant → role mapping (`success`/`info`→`status`, `error`/`warning`→`alert`) at `src/lib/toast.ts:156-158` matches AC-05. Partial-failure phrasing matches the contract verbatim — both inner-loop (`useDataGridEdit.ts:732`) and defensive-catch (`:784`) emit `"Commit failed (executed: N, failed at: K of M): <msg>"`. SQL Preview-modal-survives-close invariant (AC-03) is structurally satisfied: `<Toaster />` is mounted at `App.tsx:276` as a sibling of `<MainArea />`, *not* inside any `<DialogPortal>` (verified by grep — no `DialogPortal` ancestor). Esc handler at `toaster.tsx:40-54` correctly bails out (`return`) before `preventDefault` when the queue is empty, preserving dialog/menu Esc-close. The lone deduction: when a toast is up *and* a dialog is open, Esc dismisses the toast instead of the dialog — see the actionable feedback below; whether that's the right call is debatable but it's not what most users expect from "toast does not regress dialog Esc". |
| **Completeness** | 9/10 | All 6 ACs traceably covered with test assertions. AC-01: `toast.test.ts:26-41` + `toaster.test.tsx:29-43`. AC-02: success toast at `useDataGridEdit.ts:759-761`, partial-failure toast at `:731-733`, defensive-catch toast at `:783-785`; phrasing matches the contract exactly. AC-03: `App.tsx:276` mount + `toaster.tsx:65` `z-100` + regression guard at `toaster.test.tsx:197-205`. AC-04: store-level hookups at `connectionStore.ts:95`, `:107`, `:136-140` cover Sidebar context-menu and dialog flows uniformly. AC-05: role at `toaster.tsx:98`, aria-live at `:101`, dismiss aria-label at `:116`, Esc at `:40-54`; assertions at `toaster.test.tsx:52-88`, `:92-108`, `:110-125`. AC-06: 1679/1679 passing (sprint-93 baseline 1660 → +19 new tests, no regressions). MQL hookup goes one step beyond the contract's "Cmd+S" wording (covers `paradigm === "document"` too), which the brief permits and which the catch-audit (sprint-88) actually demanded. |
| **Reliability** | 8/10 | Per-toast `setTimeout` inside `<ToastItem>` (toaster.tsx:88-94) is correctly scoped — pushing a new toast does not reset peers' timers, and the cleanup function (`clearTimeout` on unmount) plays nicely with `act` + `vi.useFakeTimers` (proven by the sticky-toast test at `toaster.test.tsx:146-159` and the auto-dismiss test at `:129-144`). Caller-supplied id collision → in-place replace (toast.ts:108-113) gives clean update semantics. The `removeConnection` flow captures the connection name *before* the state mutation (`connectionStore.ts:114`) so the toast can name the entity even after the sidebar entry is gone. Window-level keydown listener uses a ref-bound queue (`toastsRef`) so the listener doesn't re-bind on every queue change — good. Minor: the empty `catch {}` callout from sprint-88 was honoured for the MQL branch (now toasts), satisfying the catch-audit rule. Caveats: (1) the `connect` / `disconnect` paths and `addGroup` / `updateGroup` / `removeGroup` paths still don't toast — explicitly out of scope per the contract, but worth flagging for the next sprint; (2) on Esc-with-dialog-open, dialog Esc-close is silently suppressed (see Correctness note). |
| **Verification Quality** | 9/10 | All four required checks satisfied: `pnpm vitest run` 1679/1679 (re-confirmed locally — 93 files, 14.79s), `pnpm tsc --noEmit` exit 0, `pnpm lint` exit 0, grep checks for toast API + role + hookup sites all match. Coverage on new code is 96% / 100% lines (well above the 70% bar). Test inventory reads thoroughly: variant role mapping, aria-live mapping, Esc dismiss, click dismiss, sticky behaviour, queue ordering, in-place update, default durations — every AC has a direct assertion. The contract's "scenario: 동시 (여러 토스트 큐잉)" is covered at `toaster.test.tsx:163-176`. Minor: no integration test for the SQL `useDataGridEdit` partial-failure toast text specifically (the existing commit-error suite still passes but doesn't assert the new toast call); the explicit phrasing assertion is missing, so a future copy change could drift unnoticed. |
| **Overall** | **8.75/10** | |

## Verdict: PASS

All four dimensions clear the 7/10 bar with margin. No P1/P2 findings.

## Sprint Contract Status (Done Criteria)

- [x] **AC-01** Toast API `toast.success/error/info/warning` + `toast.dismiss` callable anywhere — `src/lib/toast.ts:128-147` exports the façade backed by `useToastStore` (no React context required, so it works in store actions like `connectionStore.removeConnection`). Asserted at `src/lib/toast.test.ts:26-41` and `src/components/ui/toaster.test.tsx:29-48`.
- [x] **AC-02** Cmd+S commit success → `toast.success` (`useDataGridEdit.ts:759-761`); partial failure → `toast.error` with "executed: N, failed at: K of M" verbatim (`:731-733`); defensive outer catch mirrors the same shape (`:783-785`). Verified by grep — phrasing exactly matches the contract requirement.
- [x] **AC-03** Failure toast survives SQL Preview close — `<Toaster />` mounted at `App.tsx:276` as a sibling of `<MainArea />`, not inside any `<DialogPortal>`. Container at `toaster.tsx:65` carries `fixed top-4 right-4 z-100`. Regression-guarded by `toaster.test.tsx:197-205` (`z-100` + `fixed` class assertions).
- [x] **AC-04** Connection add / update / remove success → `toast.success` at `connectionStore.ts:95`, `:107`, `:136-140`. Hooking at the store layer covers Sidebar context-menu, ConnectionDialog, and any future programmatic flow uniformly.
- [x] **AC-05** Variant role: `success`/`info` → `role="status"` + `aria-live="polite"`, `error`/`warning` → `role="alert"` + `aria-live="assertive"` (`toaster.tsx:98-101`, `toast.ts:156-158`). Esc dismisses LIFO and *only* `preventDefault`s when the queue is non-empty (`toaster.tsx:40-54`) — verified safe vs. dialog Esc-close. Dismiss button has `aria-label="Dismiss notification"` (`toaster.tsx:116`). Assertions at `toaster.test.tsx:52-125`.
- [x] **AC-06** Regression delta = 0. Sprint-93 baseline: 91 files / 1660 tests. Post-sprint-94: 93 files / 1679 tests (+2 new test files, +19 new tests, zero regressions). `tsc --noEmit` exit 0; `eslint .` exit 0.

## Verification Results (re-confirmed locally)

| # | Command | Result | Evidence |
|---|---------|--------|----------|
| 1 | `pnpm vitest run` | PASS | 93 files / 1679 tests passed (14.79s, jsdom). |
| 2 | `pnpm tsc --noEmit` | PASS | exit 0, no diagnostics. |
| 3 | `pnpm lint` | PASS | `> eslint .` exit 0, no diagnostics. |
| 4 | Toaster outside DialogPortal | PASS | `App.tsx:276` — `<Toaster />` is a direct child of `<div>` inside `<ErrorBoundary>`, not wrapped in a `<DialogPortal>` (grep confirms no `DialogPortal` ancestor anywhere in App.tsx). |
| 5 | Partial-failure phrasing | PASS | `useDataGridEdit.ts:732` and `:784` emit "Commit failed (executed: N, failed at: K of M): <msg>" — verbatim contract match. |
| 6 | No `package.json` change | PASS | `git diff HEAD --stat package.json` returns empty; no `sonner` / `react-hot-toast` / `react-toastify` listed. Diff stat shows only App.tsx, useDataGridEdit.ts, connectionStore.ts under tracked changes (new files are untracked). |
| 7 | `role="alert"` for error/warning, `role="status"` for success/info | PASS | `roleForVariant` at `toast.ts:156-158`; applied at `toaster.tsx:98`. |
| 8 | Esc handler does not regress dialog Esc | PARTIAL PASS | `toaster.tsx:44` early-returns when queue is empty *before* `preventDefault`, so empty-queue Esc still propagates to Radix dialog. Caveat: when both a dialog *and* a toast are open, the toast wins and dialog Esc is suppressed. See feedback below. |

## Feedback for Generator

1. **Esc handler — coexistence with open dialogs (P3, polish)**
   - Current: `toaster.tsx:40-54` swallows Escape whenever the queue is non-empty, regardless of whether a Radix dialog is open. So if the user has the SQL Preview modal open *and* a toast surfaces (e.g. from a background commit), Escape closes the toast and the dialog stays open. The contract did not test for this; the brief only required "doesn't suppress dialog Esc when queue is empty".
   - Expected: Less surprising would be either (a) keep current behaviour but make it discoverable (toast hover dismiss, x-button focus ring), or (b) detect dialog-open state and let dialog Esc win.
   - Suggestion: Add an integration test that pins the current LIFO-wins-over-dialog behaviour, or add a `data-radix-dialog-open` document-attribute check in the keydown handler so dialog Esc takes priority. Either is fine — but the choice should be documented in `docs/sprints/sprint-94/findings.md` so a future sprint doesn't quietly flip it.

2. **Partial-failure copy — assert the exact phrasing in a test (P3)**
   - Current: AC-02 phrasing ("executed: N, failed at: K of M") lives only in inline string literals at `useDataGridEdit.ts:732` and `:784`. The existing `useDataGridEdit.commit-error.test.ts` suite passes but does not pin the toast string.
   - Expected: A future copy edit could drift the wording without any test failure, and AC-02 silently regresses.
   - Suggestion: Add one test in `useDataGridEdit.commit-error.test.ts` that mocks `toast.error` and asserts the call argument matches `/Commit failed \(executed: \d+, failed at: \d+ of \d+\)/`. ~5 lines, locks the AC.

3. **Connection failure path — silent vs. toast (P4, scope-adjacent)**
   - Current: `connectionStore.addConnection` / `updateConnection` / `removeConnection` toast on success but rely on the existing `ConnectionDialog` inline error banner for failures (`ConnectionDialog.tsx:610-617`). A failure from the Sidebar context-menu remove path has no UI affordance.
   - Expected: Per the spec ("commit 실패 등 조용히 일어나던 이벤트를 알림으로 노출"), failure surfaces should also toast.
   - Suggestion: Add a `try/catch` toast for `removeConnection` failure (`tauri.deleteConnection` reject), and consider promoting the `ConnectionDialog` error banner to a toast in a follow-up. Out-of-scope for sprint-94 strictly speaking; flag for the next sprint.

4. **MQL partial-failure phrasing (P4, follow-up)**
   - Current: `useDataGridEdit.ts:680` toasts `Commit failed: <msg>` for the MQL branch — no `executed: N, failed at: K of M` counts.
   - Expected: For consistency with SQL, MQL should also report partial-failure indices when the loop fails partway.
   - Suggestion: Track an `executedDocCount` in the MQL loop and emit the same shape. Trivially additive; defer to next sprint to keep this PR focused.

## Handoff Artifacts

- `findings.md`: this evaluation (compatible with `templates/findings.md`).
- `handoff.md`: transposable from this scorecard + AC table — required check evidence is captured in the "Verification Results" table; AC line citations are in the "Sprint Contract Status" section.
- All P1/P2: 0. All P3/P4: 4 actionable items above, all forward-looking and non-blocking.

## Out-of-Scope Items Honoured

- Group CRUD toasts: not added (per Out of Scope).
- Other dialogs (Import/Export, Schema): untouched.
- `package.json`: unchanged (no `sonner` install — self-implementation chosen, decision documented in findings).
- `CLAUDE.md` / `memory/`: unchanged.
- sprint-88~93 artefacts: unchanged.
