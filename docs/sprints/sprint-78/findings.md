# Sprint 78 Evaluator Findings

Scope verified via `git diff --stat HEAD -- src/components/connection src/components/layout/Sidebar.* src/components/ui/context-menu.tsx`:

```
 src/components/connection/ConnectionGroup.test.tsx | 167 ++++
 src/components/connection/ConnectionGroup.tsx      |  84 +++
 src/components/connection/ConnectionItem.test.tsx  | 188 +++
 src/components/connection/ConnectionItem.tsx       |  60 +++
 src/components/connection/ConnectionList.test.tsx  |  53 ++
 src/components/connection/ConnectionList.tsx       |  25 +-
 src/components/layout/Sidebar.test.tsx             |  56 ++
 src/components/layout/Sidebar.tsx                  |  20 +-
 src/components/ui/context-menu.tsx                 |  46 ++
```
Plus untracked `src/components/connection/GroupDialog.tsx` and `GroupDialog.test.tsx`.

No Rust / IPC changes (invariant 1). Sprint 83 pollution (`QueryEditor*`, `QueryTab*`, `useMongoAutocomplete*`, `mongoAutocomplete*`) excluded per evaluator instructions.

## Gate Results (independently executed by evaluator)

- `pnpm tsc --noEmit` — exit `0`, zero errors. (Orchestrator note: the pre-existing Sprint 83 tsc error mentioned in the brief has been resolved as of this run; full tree is clean.)
- `pnpm lint` — exit `0`, zero warnings/errors.
- `pnpm vitest run` — `77 passed / 77`, `1506 passed / 1506`.
- `pnpm vitest run src/components/connection src/components/layout/Sidebar.test.tsx` — `7 passed / 7`, `229 passed / 229`.
- `pnpm vitest run src/stores/connectionStore.test.ts` — `24 passed / 24` (incl. `adds group`, `updates group`, `removes group and ungroups`, `moves connection to group`).

## AC Verification

| AC | Status | Impl | Test | Notes |
|---|---|---|---|---|
| AC-01 — Sidebar "New Group" button + name/color dialog flow | PASS | `src/components/layout/Sidebar.tsx:184-195, 305-307` (button + dialog render) ; `src/components/connection/GroupDialog.tsx:31-178` | `src/components/layout/Sidebar.test.tsx:396-402, 404-412, 414-426, 428-439` ; `src/components/connection/GroupDialog.test.tsx:35-40, 55-62, 64-68, 70-99` | Button has `aria-label="New Group"`, visible only in connections mode, hidden in schemas mode. Dialog opens/closes, Create disabled when name blank, Cancel closes without save. |
| AC-02 — Group header color accent + legacy null-color graceful | PASS | `src/components/connection/ConnectionGroup.tsx:117-126` (accent dot w/ null fallback) ; `src/components/connection/ConnectionGroup.tsx:158-160` (Change Color menu entry) | `src/components/connection/ConnectionGroup.test.tsx:1003-1018` (color accent w/ hex) ; `1020-1033` (null-color placeholder) ; `1038-1048` (Change Color opens dialog) ; `src/components/connection/GroupDialog.test.tsx:120-148` (updateGroup on edit) | Legacy `color: null` renders a bordered transparent dot with no inline `style`, aria-hidden, no raw hex. |
| AC-03 — "Move to group" submenu w/ group list + disabled current + "No group" | PASS | `src/components/connection/ConnectionItem.tsx:222-271` (ContextMenuSub wiring, groups selector, disabled-current logic) ; `src/components/ui/context-menu.tsx:63-102` (SubTrigger/SubContent wiring) | `src/components/connection/ConnectionItem.test.tsx:954-966, 968-978, 980-997, 999-1020, 1022-1036, 1038-1060, 1062-1083, 1085-1099` | Submenu trigger exposes `role="menuitem"` and `aria-label="Move to group"`. `moveConnectionToGroup` is called with target `group.id` or `null`. Current group + "No group" (when ungrouped) are `disabled`. Zero-groups edge case renders only the "No group" entry. Submenu data comes from the live `useConnectionStore((s) => s.groups)` selector (reactive). |
| AC-04 — Ungrouped drop zone strengthened with explicit hint/border | PASS | `src/components/connection/ConnectionList.tsx:40-66` (drop zone `aria-label` + dashed outline when active) ; `93-103` (explicit `FolderX` + "Drop here to remove from group" hint card) | `src/components/connection/ConnectionList.test.tsx:463-474` (no hint at rest) ; `476-500` (hint visible + border class during drag-over) ; `502-509` (aria-label on drop zone) | Hint is conditional on `dropActive` state, so it never pollutes the idle view. `role="status"` + `aria-live="polite"` announces the hint to AT users. |
| AC-05 — Delete confirmation (AlertDialog) with singular/plural copy | PASS | `src/components/connection/ConnectionGroup.tsx:161-166` (menu item fires `setShowDeleteConfirm`) ; `185-226` (AlertDialog with dynamic copy + removeGroup gated behind confirm button) | `src/components/connection/ConnectionGroup.test.tsx:491-511, 513-534, 536-555, 1054-1073 (singular), 1075-1097 (plural)` | AlertDialog carries `role="alertdialog"` and `aria-label="Delete group <name>"`. Cancel is a no-op; Delete only fires in the confirm branch. Copy switches between "1 connection" and "N connections" correctly. |
| AC-06 — Reload restoration of group state | PASS (inherited) | no new impl — uses pre-existing persist pipeline (`src-tauri/src/commands/connection.rs:369-405` unchanged, `src/stores/connectionStore.ts` persisted actions unchanged) | `src/stores/connectionStore.test.ts:217-235, 240-258, 370-382, 384-400` (store-level round-trip against mocked Tauri) | No schema / IPC changes; store tests still cover add/update/remove/move. Full suite (1506 tests) green confirms no persistence regression. |
| AC-07 — Required tests exist (store + component coverage) | PASS | — | Store: `src/stores/connectionStore.test.ts:217, 240, 370, 384` ; GroupDialog: `GroupDialog.test.tsx:35-172` (9 tests) ; ConnectionGroup: `ConnectionGroup.test.tsx:491-555, 1003-1097` (color accent + delete dialog + singular/plural + Change Color) ; ConnectionItem: `ConnectionItem.test.tsx:954-1099` (8 submenu tests) ; ConnectionList: `ConnectionList.test.tsx:463-509` ; Sidebar: `Sidebar.test.tsx:396-439` (New Group button + dialog open/close) | Every AC has at least one RTL-style role/label assertion (e.g. `getByRole('dialog', {name: /new group/i})`, `getByRole('menuitem', {name: /move to group/i})`, `getByRole('alertdialog')`). |

## Invariant Checks

- **Invariant 1 (IPC contract stable)**: PASS — `git diff HEAD -- src-tauri/` is empty. No change to `save_group` / `delete_group` / `move_connection_to_group` / `list_groups`.
- **Invariant 2 (legacy `color: null` / `collapsed: false`)**: PASS — `ConnectionGroup.tsx:117-126` branches on `group.color` with a bordered transparent fallback, no inline style when null. Test `ConnectionGroup.test.tsx:1020-1033` locks this behaviour; the `style` attribute is absent for null groups. `GroupDialog.tsx:34` accepts `group?.color ?? null` so null legacy groups open cleanly in edit mode.
- **Invariant 3 (Sprint 74-77 regression)**: PASS — full 1506-test suite green; DataGrid/tab/sort tests untouched.
- **Invariant 4 (1407+ test baseline)**: PASS — 1506 total.
- **Invariant 5 (ADR 0008 tokens, no raw hex)**: PASS — `rg "#[0-9a-fA-F]{6}"` on all four sprint-78 tsx sources returns no matches. The single inline `style={{ backgroundColor: swatch }}` in `GroupDialog.tsx:145` and the equivalent in `ConnectionGroup.tsx:125` consume `CONNECTION_COLOR_PALETTE` / `group.color` (persisted palette values, not new literals), matching the prior-sprint pattern the contract explicitly permits. All structural colors are `bg-muted`, `bg-primary/10`, `border-border`, `text-destructive`, etc.
- **Invariant 6 (dark mode)**: PASS — no new literal colors; dialog uses `bg-secondary`, swatch rings use `ring-primary` / `ring-offset-secondary` tokens which already have dark variants.
- **Invariant 7 (a11y)**: PASS — "New Group" button `aria-label="New Group"` (Sidebar.tsx:189); AlertDialog `role="alertdialog"` + `aria-label="Delete group ..."` (ConnectionGroup.tsx:190-191); SubTrigger `aria-label="Move to group"` (ConnectionItem.tsx:223); drop zone `aria-label="Ungrouped connections drop area"` + hint `role="status" aria-live="polite"` (ConnectionList.tsx:43, 97); swatch radios use `role="radio"` inside `role="radiogroup"` with `aria-label`. Submenu keyboard navigation is inherited from Radix `ContextMenuSubTrigger`/`SubContent`.

## Scores

| Dimension | Score | Rationale |
|---|---|---|
| Contract Fidelity | 9.2 | All 7 ACs pass with file:line evidence. No scope creep. Invariants 1-7 preserved. Minor: GroupDialog's `onKeyDown` Enter handler goes through `handleSave` which already skips empty names (`GroupDialog.tsx:42-46`), but the submit button is independently disabled while blank so the two guards are consistent; not a finding. |
| Code Quality | 8.8 | TS strict, no `any`, typed props. `GroupDialog` props interface exported-in-file; uses Radix Dialog primitive rather than reinventing. Single state machine per field. `ContextMenuSub/SubTrigger/SubContent` added cleanly to the shared primitive (`context-menu.tsx:63-102`) with matching token classes. One small nit: `GroupDialog.tsx:35-36` keeps `saving` state but the only reset path on success is `onClose`, so `setSaving(false)` after success is unreachable — acceptable but slightly redundant (P3). |
| Test Quality | 9.0 | RTL-first: `getByRole('dialog', {name: /new group/i})`, `getByRole('alertdialog')`, `getByRole('menuitem', {name: /move to group/i})`, `getByRole('radio', {name: /no color/i})`. Edge cases covered: legacy `color: null` (`ConnectionGroup.test.tsx:1020-1033`), zero-groups submenu (`ConnectionItem.test.tsx:1085-1099`), drag-over conditional hint vs. at-rest (`ConnectionList.test.tsx:463-500`), singular vs. plural copy (`ConnectionGroup.test.tsx:1054-1097`), disabled-current / disabled-no-group (`ConnectionItem.test.tsx:999-1036`). Store-level round-trip tests exist for every action. Tests are isolated via `beforeEach` mock resets. |
| Accessibility | 8.7 | `aria-label` on New Group button, SubTrigger, AlertDialog, drop zone. `role="alertdialog"` + `role="radiogroup"` + `role="radio"` + `role="menuitem"` + `role="status"` all present. Focus trap is delegated to Radix Dialog/AlertDialog primitives (contract-compliant). Submenu is Radix-driven so keyboard navigation works by default. One P3: the "No color" swatch button contains a literal em-dash glyph without `aria-hidden` on the inner character — not harmful because the parent button has `aria-label="No color"` which overrides. |
| Documentation | 8.5 | `handoff.md` has per-AC test table, design-decision justifications for (a) Dialog vs inline form, (b) submenu reactive source, (c) null-color migration, (d) delete gating, (e) token discipline. Gate results and remaining-risk section included. Minor: the handoff cites 1502 tests but the current state is 1506 — a four-test drift from a parallel session, not a real inconsistency (evaluator confirmed). |

## Overall

- **Pass/Fail**: **PASS** (all five dimensions ≥ 7.0; minimum 8.5).
- **Findings**:
  - **P3-01 (code hygiene)**: `GroupDialog.tsx:47-64` — `setSaving(false)` is only reached in the error branch; the success branch closes via `onClose`, so the `saving` flag never flips back on the original mount. Harmless, but if the dialog were ever reused without unmount this would leave it disabled. Suggestion: mirror a `setSaving(false)` in the happy path before `onClose()`.
  - **P3-02 (doc drift)**: `handoff.md` "Gate Results" cites 1502 tests; current tree shows 1506 due to sibling Sprint 83 tests. Not a defect; refresh the line in a future touch-up if convenient.
  - **P3-03 (aria hint)**: The "No color" radio's em-dash child (`GroupDialog.tsx:129`) would benefit from explicit `aria-hidden="true"` for belt-and-suspenders clarity, though `aria-label="No color"` on the parent already makes it inert for AT. Nice-to-have.

- No P1 or P2 findings — Exit Criteria (`P1/P2 = 0`) satisfied.
- **Feedback for Generator**: none required; sprint is mergeable as-is. Consider the three P3 items above only if revisiting the files for Sprint 79.
