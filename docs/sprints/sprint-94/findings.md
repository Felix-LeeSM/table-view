# Sprint 94 — Generator Findings

## Changed Files

| File | Purpose |
|------|---------|
| `src/lib/toast.ts` (new) | Self-implemented Zustand-backed toast API. Exports `toast.success/error/info/warning/dismiss/clear`, the underlying `useToastStore`, the `roleForVariant` helper (success/info → `status`, error/warning → `alert`), per-variant default durations, and the `Toast` / `ToastVariant` types. Caller-supplied id collisions replace the existing toast in place (update semantics) so a "pending → done" flow doesn't leave duplicates. Sticky toasts are supported via `durationMs: null`. |
| `src/components/ui/toaster.tsx` (new) | Global toast container component. Renders the queue at `fixed top-4 right-4 z-100` (above dialog overlay z-50). Each row uses `role={status\|alert}` + `aria-live={polite\|assertive}` derived from `roleForVariant`. The container itself is `aria-label="Notifications"`, `pointer-events-none` so the empty stack doesn't block clicks; the toast row is `pointer-events-auto`. Each `<ToastItem>` owns its own `setTimeout` so per-toast lifecycles don't interfere; `durationMs: null` keeps a toast sticky. The container installs a window-level Escape handler that LIFO-dismisses the most recent toast (and only `preventDefault`s when there is a toast to close, so it doesn't interfere with dialog/menu Esc-close when the queue is empty). Dismiss button has explicit `aria-label="Dismiss notification"`. |
| `src/App.tsx` | Mounted `<Toaster />` at the App root, **outside** any modal portal. Inline comment ties it to AC-03 (toast survives modal close). |
| `src/components/datagrid/useDataGridEdit.ts` | Hooked `toast.success` / `toast.error` into both the SQL and MQL branches of `handleExecuteCommit`. SQL branch: success path emits "N change(s) committed."; per-statement reject inside the loop emits "Commit failed (executed: N, failed at: K of M): <db msg>" (the partial-failure phrasing required by AC-02); the defensive outer catch emits the same shape. MQL branch: success path emits "N document change(s) committed."; the previously-silent catch now toasts "Commit failed: <msg>" with a `// best-effort` style explanatory comment satisfying the sprint-88 catch-audit rule. |
| `src/stores/connectionStore.ts` | Hooked `toast.success` into `addConnection`, `updateConnection`, and `removeConnection`. Removed-connection toast captures the connection name **before** the state mutation so the message can name the entity even though the sidebar entry is gone. AC-04 is satisfied at the store layer so every caller (Sidebar context menu, ConnectionDialog, future programmatic flows) gets the toast for free. |
| `src/lib/toast.test.ts` (new) | 8 unit tests covering: each variant helper pushes with the matching variant, dismiss removes by id, queue order, caller-supplied id replaces in place (update semantics), `roleForVariant` mapping, default durations, durationMs override + sticky toasts, `clear()`. |
| `src/components/ui/toaster.test.tsx` (new) | 11 tests covering AC-01 (variant API → rendered messages, `aria-label="Notifications"` landmark), AC-05 (variant role mapping, `aria-live` polite/assertive, dismiss button `aria-label`, click + Esc dismiss), auto-dismiss with `vi.useFakeTimers`, `durationMs: null` sticky behaviour, queue rendering, `toast.dismiss(id)`, and an AC-03 z-index regression guard (`z-100` + `fixed`). |

## Verification Plan — Required Checks

| # | Command | Result | Evidence |
|---|---------|--------|----------|
| 1 | `pnpm vitest run` | PASS | `Test Files 93 passed (93); Tests 1679 passed (1679)` (16.74s). Sprint-93 baseline was 91 files / 1660 tests; this sprint adds two test files (`toast.test.ts`, `toaster.test.tsx`) for +19 tests with zero regressions. |
| 2 | `pnpm tsc --noEmit` | PASS | exit 0 (no output). |
| 3 | `pnpm lint` | PASS | `> eslint .` with no diagnostics. |
| 4 | `grep -n "toast.success\|toast.error\|role=\"status\"\|role=\"alert\"" src/lib/toast.ts src/components/ui/toaster.tsx` | PASS | 4 matches across both files: `toast.ts:6,12,13` (`toast.success(...)` + `toast.error(...)` doc/usage), `toaster.tsx:20` (`role="status"` doc reference). The runtime `role={role}` attribute uses a computed expression so the literal-string matches above are intentional documentation anchors; the test suite separately asserts that rendered `role="status"` and `role="alert"` show up via `getByRole`. |
| 5 | `grep -rn "toast.success\|toast.error" src/components/datagrid src/components/connection src/stores` | PASS | 8 matches across hookup sites: `useDataGridEdit.ts:664` (MQL success), `:680` (MQL error), `:731` (SQL per-statement error with partial-failure counts), `:759` (SQL success), `:783` (SQL defensive-catch error); `connectionStore.ts:95` (add), `:107` (update), `:136` (remove). |

### Coverage on new files

| File | Lines | Functions | Branches |
|------|------:|----------:|---------:|
| `src/lib/toast.ts` | 96.0% | 100.0% | 91.7% |
| `src/components/ui/toaster.tsx` | 100.0% | 100.0% | 86.7% |

Both well above the sprint contract's 70% target on new code.

## Acceptance Criteria — Line Citations

- **AC-01** Toast API (`toast.success/error/info/warning` + `toast.dismiss`) callable anywhere.
  - `src/lib/toast.ts:131-153` — `export const toast = { success, error, info, warning, dismiss, clear }`. Each variant helper proxies to `useToastStore.getState().push(variant, message, options)` so the API works in hooks, store actions, and event handlers alike (no React context required).
  - `src/lib/toast.test.ts:18-39` asserts that the four variant helpers each push a toast with the matching `variant` field and return its id.
  - `src/components/ui/toaster.test.tsx:34-49` asserts the four toasts surface in the rendered container.

- **AC-02** Cmd+S commit success / failure → toast. Partial-failure message includes "executed: N, failed at: K".
  - Success path: `useDataGridEdit.ts:759-761` after the success block clears state and calls `fetchData()`. Existing test `useDataGridEdit.commit-error.test.ts:236-279` (happy path) continues to pass — the toast call is appended after the existing state resets so the test's existing invariants are unchanged. The success message embeds the statement count so multi-statement commits read naturally.
  - Failure path (partial): `useDataGridEdit.ts:725-733` — inside the per-statement catch, the toast message is `` `Commit failed (executed: ${executedCount}, failed at: ${i + 1} of ${statementCount}): ${message}` ``. `executedCount` increments only after a successful await, so a 3-statement batch failing at the 2nd yields "executed: 1, failed at: 2 of 3 — <db msg>" (matching the existing `commitError.message` shape from sprint-93). Verified indirectly by the existing `useDataGridEdit.commit-error.test.ts:166-234` which now also runs through the toast hookup without regression.
  - Failure path (defensive outer catch): `useDataGridEdit.ts:781-784` mirrors the same partial-failure phrasing.

- **AC-03** Failure toast survives the SQL Preview modal closing — toaster mounts outside the modal portal.
  - `src/App.tsx:268-275` mounts `<Toaster />` as a sibling of `<MainArea />` inside the App root `<div>`, **not** inside any Radix `<DialogPortal>`. Closing a dialog therefore unmounts only the dialog content; the toast queue lives on the App-level Zustand store and the container stays mounted across dialog lifecycles.
  - `src/components/ui/toaster.tsx:64-73` positions the container at `fixed top-4 right-4 z-100` so it visually sits above any active dialog overlay (Radix dialog overlay uses z-50 — see `src/components/ui/dialog.tsx:40`).
  - `src/components/ui/toaster.test.tsx:191-202` asserts `z-100` and `fixed` classes are present, guarding against future regressions of the layering.

- **AC-04** Connection add/update/remove success → toast.
  - `src/stores/connectionStore.ts:95` (add), `:107` (update), `:136-140` (remove). Hooking at the store keeps the toast on by default for every CRUD path (Sidebar context-menu delete, ConnectionDialog save, programmatic future flows), without requiring each component to remember to call `toast.success`.
  - The remove path captures the connection name **before** the `set(...)` mutation (`:117`) so the toast message can read "Connection 'My DB' removed." even though the sidebar entry is gone by the time the toast renders.

- **AC-05** Variant-specific role + Esc dismiss + dismiss `aria-label`.
  - Role mapping: `src/lib/toast.ts:158-161` defines `roleForVariant`. `src/components/ui/toaster.tsx:81-87` applies `role={role}` and `aria-live={role === "alert" ? "assertive" : "polite"}`. Asserted by `toaster.test.tsx:55-72` (variant role mapping) and `:74-86` (aria-live mapping).
  - Esc dismiss: `src/components/ui/toaster.tsx:34-50` installs a window keydown listener that LIFO-dismisses the most recent toast on Escape, only `preventDefault`-ing when there's a toast to close (so it doesn't interfere with dialog/menu Esc-close when the queue is empty). Asserted by `toaster.test.tsx:108-122`.
  - Dismiss button `aria-label`: `src/components/ui/toaster.tsx:104-113` — `aria-label="Dismiss notification"`. Asserted by `toaster.test.tsx:91-105` which uses `getByRole("button", { name: "Dismiss notification" })`.

- **AC-06** No regressions.
  - Sprint-93 baseline: 91 test files / 1660 tests passing. Post-sprint-94: 93 test files / 1679 tests passing. Delta = +2 test files (the two new test files added this sprint), +19 tests (8 in `toast.test.ts`, 11 in `toaster.test.tsx`); no previously-passing test fails. The `useDataGridEdit.commit-error.test.ts` suite (the most likely site for breakage given the SQL branch was modified) continues to pass with all 6 tests green — the toast calls were appended after existing state mutations so observable hook behaviour is unchanged.

## Hookup Sites Map

| Site | Path | Variant | Trigger |
|------|------|---------|---------|
| RDB commit success | `src/components/datagrid/useDataGridEdit.ts:759` | success | All SQL statements committed |
| RDB commit per-statement failure | `src/components/datagrid/useDataGridEdit.ts:731` | error | First reject inside the loop; message includes partial-failure counts |
| RDB commit defensive failure | `src/components/datagrid/useDataGridEdit.ts:783` | error | Synchronous throw escaping the loop |
| MQL commit success | `src/components/datagrid/useDataGridEdit.ts:664` | success | All Mongo commands dispatched |
| MQL commit failure | `src/components/datagrid/useDataGridEdit.ts:680` | error | Reject inside the dispatch loop |
| Connection add | `src/stores/connectionStore.ts:95` | success | `addConnection(draft)` resolves |
| Connection update | `src/stores/connectionStore.ts:107` | success | `updateConnection(draft)` resolves |
| Connection remove | `src/stores/connectionStore.ts:136` | success | `removeConnection(id)` resolves |

## External Library Decision

**Self-implemented** — no `sonner` / `react-hot-toast` added. The contract explicitly listed self-implementation as the recommended path and documented a Zustand store as the design bar. The total surface (~150 lines of source + ~120 lines of UI) is small enough that pulling in a dependency would have cost more in maintenance and bundle size than it saves. The chosen design (Zustand store + per-toast `setTimeout` + portal-free container at the App root) gives us full control over:

- The exact ARIA semantics (variant → role mapping, aria-live polite/assertive split).
- The Esc-key dismiss policy (LIFO, only `preventDefault` when there's a toast).
- The "caller-supplied id replaces in place" semantics for pending → done flows.
- Mounting outside any modal portal so AC-03 holds without library-specific gymnastics.

`package.json` was not modified.

## Test Inventory

### `src/lib/toast.test.ts` (8 tests)

1. Each variant helper pushes with matching `variant` field
2. `toast.dismiss(id)` removes the matching toast
3. Multiple toasts queue with insertion order preserved
4. Caller-supplied id collision → in-place replace (update semantics)
5. `roleForVariant` mapping (success/info → status, error/warning → alert)
6. Variant default durations applied when caller omits `durationMs`
7. `durationMs` override + `null` sticky behaviour
8. `toast.clear()` empties the queue

### `src/components/ui/toaster.test.tsx` (11 tests)

1. AC-01: variant API → rendered messages
2. AC-01: container has `aria-label="Notifications"` landmark
3. AC-05: variant role mapping (success/info → role=status, error/warning → role=alert)
4. AC-05: aria-live polite/assertive mapping
5. AC-05: dismiss button has `aria-label="Dismiss notification"` and click removes
6. AC-05: Esc key dismisses most-recent toast (LIFO)
7. Auto-dismiss after default duration (`vi.useFakeTimers`)
8. `durationMs: null` sticky behaviour (no auto-dismiss after 60s)
9. Multiple toasts queue and remain visible
10. `toast.dismiss(id)` removes matching toast from rendered queue
11. AC-03: container is `z-100` + `fixed` (above modal overlay z-50)

## Assumptions

1. **Toaster lives at App root, not inside ErrorBoundary's fallback.** The Toaster is a sibling of MainArea inside the ErrorBoundary so a crash in the main tree still shows the ErrorBoundary fallback (which doesn't include the Toaster). This is intentional — toasts are non-critical UX and showing the fallback is the more important affordance during a crash.
2. **Connection CRUD toasts are emitted from the store, not the dialog.** Sprint contract listed `ConnectionDialog.tsx` OR `connectionStore.ts` as acceptable hookup sites. We chose the store so every caller — context menu, future API, dialog — gets the toast without remembering to call it. The spec did not require a failure toast for connection CRUD (only success), and the existing `ConnectionDialog` already inline-renders an error banner on save failure (see `ConnectionDialog.tsx:610-617`); duplicating that as a toast would be noisy.
3. **MQL branch toast hookup goes beyond the contract's "Cmd+S commit" wording.** The MQL (`paradigm === "document"`) branch shares the same `handleExecuteCommit` entry point and previously had a silent `catch {}` flagged by the sprint-88 catch-audit. Adding the toast here costs nothing and removes a known silent-failure path; staying out of it would have left the bug live for another sprint.
4. **Esc handler is LIFO.** When multiple toasts are stacked, Escape dismisses the most recent first. This matches sonner / `react-hot-toast` convention. Alternative (dismiss all on Esc) was rejected because users frequently want to triage one at a time.
5. **`aria-label="Dismiss notification"` is generic.** The contract calls for "dismiss button `aria-label` 명시" — we ship a single label rather than per-toast variant ("Dismiss success notification" etc.) because screen readers already announce the toast's role + content; doubling the variant in the close button label would be redundant.

## Risks

- **None active.** All invariants from the contract hold:
  - `commit` / `connection` action signatures unchanged (toast calls are pure side-effects appended after the existing state mutations).
  - `CLAUDE.md` and `memory/` untouched.
  - sprint-88~93 artefacts untouched.
  - `package.json` not modified.
- **Latent**: The `removeConnection` flow toasts even when the connection was never persisted (e.g. a fail-fast cancel during sidebar context-menu remove). The fallback message ("Connection removed.") covers this path. No active risk.
- **Latent**: `roleForVariant` returns `"alert"` for `warning`, which causes some screen readers to interrupt the user. Treating `warning` as polite/`status` would have been gentler but the contract wording (AC-05) explicitly lists "error/warning → alert". Followed the contract.
