# Generator Handoff — sprint-176

Sprint 176 implements Selective-Attention overlay hardening (AC-176-01, AC-176-02, AC-176-04) plus the first-render flash gate on `StructurePanel` (AC-176-03), and transitions RISK-009 + RISK-035 to `resolved` in the project risk register (AC-176-05).

Date: 2026-04-30

## Changed Files

- `src/components/datagrid/DataGridTable.tsx` — adds `role="status"`, `aria-live="polite"`, `aria-label="Loading"` to the refetch overlay wrapper at line 840-862, plus four React event handlers (`onMouseDown`, `onClick`, `onDoubleClick`, `onContextMenu`) that call `e.preventDefault()` + `e.stopPropagation()`. Spinner classes and `<Loader2 size={24}>` unchanged. Wrapper class string `absolute inset-0 z-20 flex items-center justify-center bg-background/60` preserved verbatim.
- `src/components/document/DocumentDataGrid.tsx` — same hardening as DataGridTable on the refetch overlay at line 330-356. Identical event-handler set, identical class preservation, identical `aria-*` attribute additions.
- `src/components/schema/StructurePanel.tsx` — adds three `useState(false)` flags (`hasFetchedColumns`, `hasFetchedIndexes`, `hasFetchedConstraints`). Each is set to `true` after the corresponding `setColumns` / `setIndexes` / `setConstraints` call inside `fetchData`'s success branch, and also inside the catch branch (so a retry that returns `[]` after a transient error reaches the empty-state copy). Editor render branches at lines 144, 154, 165 now require the flag to be `true` in addition to `!loading && !error && activeSubTab === ...`. Loading row, error banner, and Tabs UI unchanged.
- `src/components/datagrid/DataGridTable.refetch-overlay.test.tsx` — new sibling test file. 5 tests: 3 for AC-176-01 (mouseDown/click swallow, doubleClick swallow, contextmenu swallow), 1 for AC-176-04 (DOM-class + spinner-attribute assertion), 1 regression (when `loading=false` row click handlers fire). All tagged with `[AC-176-0X]` prefix and carry top-of-file Reason + date comment per the 2026-04-28 feedback rule.
- `src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` — new sibling test file. 3 tests: 2 for AC-176-02 (click swallow during refetch, doubleClick swallow during refetch), 1 for AC-176-04. Uses `findMock` resolver pattern (first call resolves, second hangs) to surface the true refetch state (data + loading=true).
- `src/components/schema/StructurePanel.first-render-gate.test.tsx` — new sibling test file. 5 tests for AC-176-03: pre-fetch suppression, post-fetch reveal, tab-switch isolation for indexes, tab-switch isolation for constraints, and rejected-fetch path (error banner appears, empty-state copy does not). Uses typed `vi.fn<...>(...)` mocks for `getTableColumns` / `getTableIndexes` / `getTableConstraints`.
- `docs/RISKS.md` — RISK-009 row transitioned `active → resolved` with the resolution note `Sprint 176 — overlay swallows mouseDown/click/doubleClick/contextmenu in DataGridTable + DocumentDataGrid`. RISK-035 row transitioned `active → resolved` with the resolution note `Sprint 176 — hasFetchedColumns/Indexes/Constraints 게이트가 첫 fetch settle 이전 empty-state 노출 차단`. Resolution Log entries for both risks appended at the bottom (Origin / Resolved in / Fix sections matching the existing format). Header `Last updated:` line bumped to `2026-04-30 (sprint-176 — RISK-009 + RISK-035 transitioned to resolved)`. Summary count table updated (Active 25→23, Resolved 9→11, Total unchanged at 35).
- `docs/sprints/sprint-176/findings.md` — new. Contains the overlay audit table, mechanism note (AC-176-01/02 handler choice, AC-176-04 visual-preservation justification, AC-176-03 per-tab gate rationale), manual smoke steps for the operator, test-coverage table mapping each AC to test names, and verification run summary.
- `docs/sprints/sprint-176/handoff.md` — this file.

## Checks Run

| Check | Command | Outcome |
|-------|---------|---------|
| Sprint-scope vitest | `pnpm vitest run src/components/datagrid/DataGridTable src/components/document/DocumentDataGrid src/components/schema/StructurePanel` | PASS — 217/217 |
| Full vitest | `pnpm vitest run` | PASS — 2426/2427 (1 pre-existing failure in `window-lifecycle.ac141.test.tsx`; verified on `main` via `git stash` toggle to be unrelated to this sprint's surface) |
| TypeScript | `pnpm tsc --noEmit` | PASS — 0 errors |
| ESLint | `pnpm lint` | PASS — 0 errors |
| Audit grep | `grep -RnE 'absolute inset-0' src/components` | 3 lines (2 hardened production overlays + 1 comment-only test docstring) — see `findings.md` audit table |
| RISKS grep | `grep -nE 'RISK-009\|RISK-035' docs/RISKS.md` | both rows in `resolved`; Resolution Log entries naming sprint-176 |

Manual `pnpm tauri dev` smoke is documented in `findings.md` §Manual Smoke for the Evaluator/operator to run; the Generator did not have an interactive Tauri shell available from the sandbox.

## Done Criteria Coverage

| AC | Evidence |
|----|----------|
| AC-176-01 (DataGridTable overlay swallows pointer events) | Tests `[AC-176-01] overlay swallows mouseDown / click on rows during refetch`, `[AC-176-01] overlay swallows doubleClick (no cell-edit entry)`, `[AC-176-01] overlay swallows contextmenu (no context menu opens)` in `src/components/datagrid/DataGridTable.refetch-overlay.test.tsx`. Code at `DataGridTable.tsx:840-862` (overlay wrapper with four handlers). |
| AC-176-02 (DocumentDataGrid overlay swallows pointer events; full-bleed audit listed) | Tests `[AC-176-02] overlay blocks click on rows during refetch`, `[AC-176-02] overlay blocks doubleClick from opening cell editor` in `src/components/document/DocumentDataGrid.refetch-overlay.test.tsx`. Code at `DocumentDataGrid.tsx:330-356`. Audit table in `findings.md` §Overlay Audit. |
| AC-176-03 (StructurePanel suppresses empty-state until first fetch settles) | Tests `[AC-176-03] does not render empty-state copy before first fetch settles`, `[AC-176-03] empty-state copy appears after first fetch resolves with []`, `[AC-176-03] tab switch: 'No indexes found' is hidden until indexes fetch settles`, `[AC-176-03] rejected fetch shows error but no empty-state flash`, `[AC-176-03] tab switch: 'No constraints found' is hidden until constraints fetch settles` in `src/components/schema/StructurePanel.first-render-gate.test.tsx`. Code at `StructurePanel.tsx:36-38` (flag declarations), `:50/54/58` (success-path flips), `:67-69` (catch-path flips), `:144/154/165` (gated render branches). |
| AC-176-04 (spinner DOM unchanged) | DOM-class assertions in `[AC-176-04] spinner DOM (classes, size, position) is unchanged` (one in each new test file). Wrapper preserves `absolute inset-0 z-20 flex items-center justify-center bg-background/60`. Spinner preserves `animate-spin text-muted-foreground` + `width="24"` + `height="24"`. |
| AC-176-05 (RISK-009 + RISK-035 to resolved) | `docs/RISKS.md` table rows for RISK-009 (line 30) and RISK-035 (line 56) now in `resolved` status with sprint-176 resolution notes. Resolution Log entries appended at bottom of `docs/RISKS.md`. Summary count table updated (Active 25→23, Resolved 9→11). |

## Assumptions

- **Mechanism choice for AC-176-01/02**: explicit handler swallow over CSS `pointer-events` toggle. Rationale documented in `findings.md` §Mechanism Note. The contract is silent on mechanism; the contract requires the visible row handlers not to fire and the spinner pixels not to change. Both invariants are enforced by handler swallow with no class change.
- **Per-tab `hasFetched` flag for AC-176-03**: a single global flag would still let "No indexes found" appear on a tab switch from a settled Columns tab to a never-fetched Indexes tab. Per-tab flags close that hole. Code reflects three independent flags rather than one.
- **`role="status"` + `aria-label="Loading"` for test selection**: the overlay needed a stable accessible name for `screen.getByRole("status", { name: "Loading" })`. The `CollectionReadOnlyBanner` already uses `role="status"`; adding `aria-label` disambiguates without changing visuals. ARIA additions are accessibility wins, not regressions.
- **Pre-existing `window-lifecycle.ac141.test.tsx` failure**: confirmed via `git stash` toggle on `main` before this sprint's edits to be a pre-existing regression unrelated to the overlay surface or schema panel. Not in this sprint's write scope; not addressed here.
- **Audit-grep classification of test-file comment**: the line in `DataGridTable.refetch-overlay.test.tsx:142` matches the audit grep but is a comment-only string literal in a test docstring (the line is a continuation comment describing the wrapper class). Listed as `excluded — test file` in the audit table.

## Residual Risk

- **Manual smoke not run from sandbox** — the contract Verification Plan §6 asks for a `pnpm tauri dev` smoke run on a slow refetch. The Generator did not have an interactive Tauri shell. The four gestures (single click, double click, right click, mouseDown drag) are exercised in jsdom via the new tests, and the AC-176-04 visual contract is locked via DOM-class + attribute assertions, so the unit-test layer covers the contract invariants. The operator step list is in `findings.md` §Manual Smoke for the Evaluator's replay.
- **Pre-existing `window-lifecycle.ac141.test.tsx` failure** (1 test) — unrelated to this sprint, verified on `main` before any changes. Not addressed in scope.
- **Snapshot test was deliberately omitted** for AC-176-04 in favour of class + attribute assertions. Class assertion gives the same visual contract with lower maintenance cost (no snapshot churn from unrelated grid-tree edits). The contract permits "snapshot OR DOM-class assertion".

## Attempt 2 — Evaluator feedback addressed

Attempt 1 was scored borderline FAIL on Reliability (6/10 < 7) because the AC-176-01 / AC-176-02 negative tests asserted `expect(onSelectRow).not.toHaveBeenCalled()` after `fireEvent.click(overlay)`. In jsdom the overlay `<div>` is a sibling of `<table>`, so the event never bubbles to a `<tr>` regardless of `stopPropagation` — the assertion would pass even if the production `e.preventDefault()` line were removed. The production handler logic was verified correct by the Evaluator. Attempt 2 fixes the test mechanism without touching production logic (apart from a one-liner `aria-hidden` addition).

### Changes in attempt 2

| File | Change | Reason |
|------|--------|--------|
| `src/components/datagrid/DataGridTable.refetch-overlay.test.tsx` | Rewrote AC-176-01 tests to use `createEvent.<gesture>(overlay)` + `fireEvent(overlay, event)` + `expect(event.defaultPrevented).toBe(true)`. Split the original mouseDown+click test into two separate `it` blocks. Added `aria-hidden="true"` assertion to AC-176-04 DOM test. Added a file-level NOTE explaining the attempt-2 mechanism. | F-1 (vacuous assertion fix; load-bearing assertion is now `defaultPrevented`), F-3 (split for finer diagnostics), F-5 (aria-hidden polish locked in test). |
| `src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` | Same `createEvent` + `defaultPrevented` rewrite as above. Added two new tests: `[AC-176-02] overlay blocks mouseDown from reaching row` and `[AC-176-02] overlay blocks contextmenu from opening menu`. Extracted the `enterRefetchState()` helper to deduplicate the first-fetch-resolve-then-page-forward setup across the now-five tests. Added `aria-hidden="true"` assertion to AC-176-04 DOM test. | F-1, F-2 (DocumentDataGrid was missing mouseDown + contextmenu coverage), F-5. |
| `src/components/datagrid/DataGridTable.tsx` | Added `aria-hidden="true"` to the `Loader2` SVG inside the refetch overlay. | F-5. |
| `src/components/document/DocumentDataGrid.tsx` | Same `aria-hidden="true"` addition as above. | F-5. |
| `docs/sprints/sprint-176/findings.md` | Audit table row 3 now shows the literal comment text. New explanatory note added: `StructurePanel.tsx:130-134` is correctly out-of-audit (flow-layout spinner, not full-bleed overlay). New "Attempt-2 Changelog" section maps each Evaluator finding to the action taken. Verification run summary updated to 220/220. Test coverage table updated to reflect the new test list. | F-4 (audit row literal text), F-6 (StructurePanel inline spinner explanation). |
| `docs/sprints/sprint-176/handoff.md` | This Attempt-2 section. | Per orchestrator instruction. |

### Verification re-run after attempt 2

| Check | Command | Outcome |
|-------|---------|---------|
| Sprint-scope vitest | `pnpm vitest run src/components/datagrid/DataGridTable src/components/document/DocumentDataGrid src/components/schema/StructurePanel` | PASS — 220/220 (attempt 1 was 217/217; net +3 from F-2 + F-3 expansion) |
| TypeScript | `pnpm tsc --noEmit` | PASS — 0 errors |
| ESLint | `pnpm lint` | PASS — 0 errors |

### Findings NOT addressed

None. F-1 and F-2 (P2) are fully addressed. F-3, F-4, F-5, F-6 (P3) are also addressed. No regression on previously-passing AC evidence — every existing assertion still runs and now has additional load-bearing proof via `event.defaultPrevented`.

### Test count delta

| File | Attempt 1 | Attempt 2 | Δ |
|------|-----------|-----------|---|
| `DataGridTable.refetch-overlay.test.tsx` | 5 | 6 | +1 (F-3 split) |
| `DocumentDataGrid.refetch-overlay.test.tsx` | 3 | 5 | +2 (F-2 added mouseDown + contextmenu) |
| `StructurePanel.first-render-gate.test.tsx` | 5 | 5 | 0 |
| Sprint-scope total | 217 | 220 | +3 |
