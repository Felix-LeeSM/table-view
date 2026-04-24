# Sprint 78 — Connection Groups Workflow (Handoff)

Fills the UX gap in Connection Groups: adds a discoverable creation entry point
in the Sidebar, a dedicated `GroupDialog` (create/edit), a color accent on the
group header, a "Move to group" submenu on each connection, a strengthened
ungrouped drop zone, and an `AlertDialog` guard on deletion. The data model,
IPC, persistence, drag-assign, and reload restoration from Sprints 74/77 are
left untouched.

## Changed / Added Files

| Path                                                      | Kind | Δ lines |
| --------------------------------------------------------- | ---- | ------: |
| `src/components/connection/GroupDialog.tsx`               | +new |    +179 |
| `src/components/connection/GroupDialog.test.tsx`          | +new |    +173 |
| `src/components/connection/ConnectionGroup.tsx`           | mod  |     +84 |
| `src/components/connection/ConnectionGroup.test.tsx`      | mod  |    +167 |
| `src/components/connection/ConnectionItem.tsx`            | mod  |     +60 |
| `src/components/connection/ConnectionItem.test.tsx`       | mod  |    +188 |
| `src/components/connection/ConnectionList.tsx`            | mod  |     +25 |
| `src/components/connection/ConnectionList.test.tsx`       | mod  |     +53 |
| `src/components/layout/Sidebar.tsx`                       | mod  |     +20 |
| `src/components/layout/Sidebar.test.tsx`                  | mod  |     +56 |
| `src/components/ui/context-menu.tsx`                      | mod  |     +46 |

No Rust / IPC changes. `connectionStore` unchanged — all actions
(`addGroup`, `updateGroup`, `removeGroup`, `moveConnectionToGroup`) already
existed from prior sprints and are reused as-is.

## Gate Results (last lines)

- `pnpm vitest run`
  ```
  Test Files  77 passed (77)
       Tests  1502 passed (1502)
    Duration  12.89s
  ```
- `pnpm tsc --noEmit` — 3 pre-existing errors, all out-of-scope
  (`src/components/query/QueryTab.test.tsx` x2,
  `src/hooks/useMongoAutocomplete.test.ts` x1 — Sprint 83 WIP, untracked).
  Scoped check on Sprint 78 files: clean.
- `pnpm lint` — 3 pre-existing errors on the same files above.
  Scoped check (`pnpm eslint src/components/connection
  src/components/layout/Sidebar.tsx src/components/layout/Sidebar.test.tsx
  src/components/ui/context-menu.tsx`): clean (0 issues).

## AC → Test Evidence

| AC     | Behaviour                                     | Test file                                              | Test name(s) |
| ------ | --------------------------------------------- | ------------------------------------------------------ | ------------ |
| AC-01  | Sidebar "New Group" button opens dialog       | `src/components/layout/Sidebar.test.tsx`               | `renders New Group button in connections mode`; `opens GroupDialog when New Group clicked`; `closes GroupDialog via onClose` |
| AC-01  | GroupDialog creation flow                     | `src/components/connection/GroupDialog.test.tsx`       | `renders New Group title when creating`; `exposes a palette of 10 color swatches + a 'No color' radio`; `disables the Create button when the name is blank`; `calls addGroup with name and selected color on submit`; `submits with null color when 'No color' is selected`; `submits on Enter key inside the name input`; `calls onClose when Cancel is clicked` |
| AC-02  | Header color accent + null-graceful           | `src/components/connection/ConnectionGroup.test.tsx`   | `renders a color accent dot with the group color`; `renders a null-color accent (bordered, transparent) for legacy groups` |
| AC-02  | Edit color via existing group                 | `src/components/connection/GroupDialog.test.tsx`       | `renders Edit Group title when a group is supplied`; `calls updateGroup when editing an existing group` |
| AC-02  | "Change Color" menu entry                     | `src/components/connection/ConnectionGroup.test.tsx`   | `opens the GroupDialog in edit mode when 'Change Color' is clicked` |
| AC-03  | "Move to group" submenu                       | `src/components/connection/ConnectionItem.test.tsx`    | `renders a 'Move to group' submenu trigger`; `lists each group in the submenu`; `always lists a 'No group' option`; `disables the current group in the submenu`; `disables 'No group' when the connection is already ungrouped`; `calls moveConnectionToGroup with the target group id on click`; `calls moveConnectionToGroup with null when 'No group' is picked`; `renders submenu with only 'No group' when no groups exist` |
| AC-04  | Ungrouped drop zone hint                      | `src/components/connection/ConnectionList.test.tsx`    | `does not render the drop hint at rest (no active drag)`; `renders an explicit 'Drop here to remove from group' hint during drag-over`; `root drop zone carries an aria-label for ungrouped drop region` |
| AC-05  | Delete confirmation (AlertDialog)             | `src/components/connection/ConnectionGroup.test.tsx`   | `opens an AlertDialog (not calls removeGroup) when Delete Group is clicked`; `calls removeGroup only after confirming the delete dialog`; `does NOT call removeGroup when the delete dialog is cancelled`; `uses singular copy when the group holds exactly one connection`; `uses plural copy when the group holds multiple connections` |
| AC-06  | Reload restoration                            | covered by Sprint 74/77 tests in `src/stores/connectionStore.test.ts` (re-run passing: 1502/1502) | — |
| AC-07  | New component tests                           | see all rows above (total +3 new test files covered + 4 modified) | — |

## Design Decisions

- **Dialog vs inline form (AC-01)** — chose a single `GroupDialog` component
  (reused for both "create" and "edit") instead of an inline inputrow in the
  Sidebar. A dialog gives enough room for the 10-swatch palette + "No color"
  radio, keeps the Sidebar header uncluttered, and matches the pattern of the
  existing `ImportExportDialog`. The dialog takes an optional `group` prop: when
  present the UI switches to Edit mode and calls `updateGroup`; otherwise it
  calls `addGroup`.
- **Submenu source (AC-03)** — the "Move to group" submenu reads its group list
  from the live `useConnectionStore((s) => s.groups)` selector at render time,
  so the menu automatically reflects new / renamed / deleted groups without a
  refresh. A snapshot array was rejected because it would go stale after each
  `addGroup` call. The current group is rendered as a `disabled` menu item
  (with a Check glyph) so users can always see "where am I" without losing
  menu alignment.
- **Null-color migration (AC-02)** — legacy groups that saved `color: null`
  render with a transparent-fill, `border-border` 2-px swatch instead of a
  solid dot. This avoids a fallback-to-palette-slot-0 surprise, keeps the
  header accessible (aria-hidden), and makes "no color" visually distinct
  without introducing a second code path in `ConnectionGroup`.
- **Delete gating (AC-05)** — the prior `removeGroup` call was direct-fire from
  the ContextMenu; replaced with an `AlertDialog` (`role="alertdialog"`,
  aria-label) whose copy dynamically picks "1 connection" vs "N connections"
  so the destructive-action wording scales. `removeGroup` is only invoked in
  the confirm branch; cancel is a no-op.
- **Token discipline (ADR 0008)** — all new UI uses Tailwind design tokens
  (`bg-background`, `text-foreground`, `border-border`, `text-destructive`).
  The palette swatches carry inline `backgroundColor: hex` *only* because
  `CONNECTION_COLOR_PALETTE` is a known reused constant from prior sprints
  (not a new hex literal) — matches the same pattern already in
  `ConnectionGroup.tsx`.

## Remaining Risks / Gaps

- `src/components/query/QueryTab.test.tsx` and
  `src/hooks/useMongoAutocomplete.test.ts` have 6 pre-existing `tsc`/`lint`
  errors from the in-flight Sprint 83 MongoDB autocomplete work (untracked).
  Not touched in this sprint. Full test suite still passes because these are
  type-only / unused-import issues, not runtime failures.
- Drag-over visual reuses the existing Sprint 74 state machine; no new drag
  events were wired. The hint box only appears while the ungrouped drop zone
  is `isOver`.
- `GroupDialog` uses `aria-label` of the form `Color <hex>` for each swatch
  radio. If the palette ever gets renamed slots (e.g. `--palette-emerald`),
  labels should follow the token name instead — tracked as a future enhancement
  rather than a bug, since the current palette is stable and unchanged.
- No Rust / schema migration needed. `ConnectionGroup.color` was already
  nullable in SQLite.
