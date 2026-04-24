# Feature Spec: Seven UX Hardening Sprints (Sprint 74–79)

## Description
Harden the Table View editing and navigation surface by fixing six long-standing UX issues: date/NULL re-entry, type-aware empty-input coercion, per-tab sort persistence, compact VS Code-style tab bar, connection grouping workflow, and the Connection dialog layout plus Test Connection feedback. The work is sequenced foundation → core → polish so that type-system fixes land before tab/store refactors and before visual polish. (Item 7 — retrospective memorize — is handled by the orchestrator outside the sprint loop.)

## Sprint Breakdown

### Sprint 74: Type-Aware Editing and NULL Re-entry
**Goal**: Cells typed as date/datetime/timestamp/numeric/boolean/uuid accept only values the column's type permits, and exiting NULL via a printable key returns to an input that matches the column type — never a bare `text` input with a seeded character.
**Verification Profile**: mixed (browser + command)
**Acceptance Criteria**:
1. When an editor is in the NULL-chip state on a `date`, `datetime`, `timestamp`, `time`, `numeric`, `integer`, `boolean`, or `uuid` column, pressing a printable key replaces the NULL chip with a typed editor (`date` picker for date, `datetime-local` for datetime/timestamp, `time` for time, numeric-only for numeric types, a two-value selector or short text for boolean, text with UUID hint for uuid) — not a generic text input seeded with the raw character.
2. For typed editors that cannot meaningfully accept a single keystroke (date/datetime/time/boolean/uuid), the printable keypress opens an empty, focused, typed input instead of forcing the literal character in; for numeric/integer editors the keystroke is accepted only when it is a legal first character for that type, otherwise it is swallowed.
3. `Cmd/Ctrl+Backspace` inside any typed editor returns the cell to the NULL chip state, preserving behaviour documented in ADR 0009.
4. Unit tests for the edit hook cover the NULL → date, NULL → integer, NULL → boolean, and NULL → text transitions and assert the resulting editor type and seeded value.

**Components to Create/Modify**:
- `src/components/datagrid/useDataGridEdit.ts`: expose a column-type-aware helper that derives both the HTML input flavour and the legal seed value given a keystroke; extend `setEditNull`/`setEditValue` contract so the NULL → typed-editor flip does not lose the column type.
- `src/components/datagrid/DataGridTable.tsx`: route the NULL-chip printable-key branch through the type-aware helper, including the seeded value, and render the correct input element for the column's data type.
- `src/components/datagrid/useDataGridEdit.*.test.ts` and `src/components/datagrid/DataGridTable.editing-visual.test.tsx`: add coverage for each typed transition.

### Sprint 75: Empty-input Coercion and Type Validation on Commit
**Goal**: Editing a non-string column and clearing the input coerces to SQL NULL, and the commit path coerces user strings to the column's type (`"1"` → integer, `"t"`/`"true"` → boolean) with a readable inline error for mismatched input.
**Verification Profile**: mixed (browser + command)
**Acceptance Criteria**:
1. Committing an empty-string edit on any column whose data type is not textual (not `text`, `varchar`, `char`, `citext`, `string`, or JSON) produces a `SET col = NULL` statement in the SQL preview — not `SET col = ''`. Textual columns continue to preserve the explicit empty-string intent from ADR 0009.
2. Committing a value like `"1"` on an integer column, `"true"`/`"t"`/`"1"`/`"false"`/`"f"`/`"0"` on a boolean column, or a recognised ISO string on a date/timestamp column serialises it with the correct SQL literal (no quotes around numbers, unquoted boolean literals, properly-quoted date literal) in the generated statement.
3. Committing a value that cannot be coerced to the column type (e.g. `"abc"` for integer) does not produce a SQL statement for that cell; instead the cell surfaces an inline, type-specific validation hint next to the editor and the offending pending edit stays open for correction.
4. The SQL generator has unit coverage for each supported type branch: integer, numeric, boolean, date/time, uuid, text, and the textual empty-string-preserving path.

**Components to Create/Modify**:
- `src/components/datagrid/sqlGenerator.ts`: accept the column's data type when rendering a literal and emit NULL for empty-non-textual, typed literals for numeric/boolean/date, and quoted strings only for textual/unknown types.
- `src/components/datagrid/useDataGridEdit.ts`: validate pending edits against the column's data type on commit, surface a per-cell error entry for mismatches, and gate statement generation on validation success.
- `src/components/datagrid/DataGridTable.tsx`: render the inline validation hint under the active editor when a pending edit on the cell has a type error.
- `src/components/datagrid/sqlGenerator.test.ts` and the edit hook tests: cover the new coercion rules and error surfacing.

### Sprint 76: Per-tab Sort State
**Goal**: Sort state lives on the tab, so switching between table tabs restores each tab's own column sort order.
**Verification Profile**: mixed (browser + command)
**Acceptance Criteria**:
1. Applying a sort on table tab A, switching to table tab B (which has no sort), and returning to tab A shows tab A's sort preserved in both the column header indicator and the result ordering.
2. Two open tabs against the same table but different connections can hold independent sort states that do not leak across tabs.
3. Closing and reopening a table tab via the "reopen last closed" action restores its last sort state.
4. Persisted tabs (localStorage) carry their sort state across reloads for table tabs; legacy persisted tabs without sort metadata default to "no sort" without throwing.
5. Store-level unit tests cover adding/removing sorts, switching tabs, and the migration path for legacy persisted tabs.

**Components to Create/Modify**:
- `src/stores/tabStore.ts`: extend `TableTab` with a sort-state field, add an action to update it, and migrate legacy persisted tabs in `loadPersistedTabs`.
- `src/components/DataGrid.tsx`: read the active tab's sort state from the store instead of local `useState`, and write changes back through the store action. Preserve the "unmount per tab switch" pattern without regressing existing filter/page behaviour.
- `src/stores/tabStore.test.ts` and `src/components/DataGrid.test.tsx`: cover per-tab sort isolation and persistence.

### Sprint 77: VS Code–style Ephemeral Tabs and Compact Tab Bar
**Goal**: The tab bar is visibly shorter (TablePlus-like), newly-opened tabs are ephemeral until promoted, and opening another table while an ephemeral tab is active replaces that tab instead of stacking.
**Verification Profile**: mixed (browser + command)
**Acceptance Criteria**:
1. The tab row's rendered height is demonstrably reduced relative to the previous sprint (tab bar padding and font-size are tightened; the overall tab-bar height is at most the height used in TablePlus-class tools — one compact line with icon + title + close glyph).
2. Opening a table from the schema tree creates an ephemeral tab rendered with italic, muted text; opening a second table in the same connection while the ephemeral tab is still ephemeral replaces it in place (same tab index, no duplicate entry) instead of adding a new tab.
3. Double-clicking an ephemeral tab, or performing a meaningful interaction inside it (editing a cell, adding/deleting a row, running a query, changing a filter, page, or sort), promotes the tab to a regular tab — italic/muted styling disappears and future opens no longer replace it.
4. Query tabs are never ephemeral; they are always regular tabs from creation.
5. Ephemeral state survives page reloads only for tabs that were already promoted; newly-persisted ephemeral tabs come back as regular tabs (parity with VS Code — no ephemeral-after-reload footgun).
6. Tab bar tests cover the compact height (via computed style), the replace-in-place behaviour, and the promote-on-interaction path.

**Components to Create/Modify**:
- `src/components/layout/TabBar.tsx`: tighten vertical metrics and confirm the italic/muted preview styling matches the "ephemeral" semantics (existing `isPreview` field already drives it — audit and extend).
- `src/stores/tabStore.ts`: review `addTab` replace-in-place logic so the second table open reliably overwrites the ephemeral tab; ensure `promoteTab` is invoked by every "meaningful interaction" path (edits, adds, deletes, page/filter/sort change, query run).
- `src/components/DataGrid.tsx`, `src/components/datagrid/useDataGridEdit.ts`, `src/components/query/*`: promote the active tab on the interactions listed above (most wiring already exists — audit coverage).
- `src/components/layout/TabBar.test.tsx` and `src/stores/tabStore.test.ts`: extend coverage for the new behaviour.

### Sprint 78: Connection Groups Workflow
**Goal**: Users can create, rename, colour, and collapse connection groups, and assign connections to them via drag or context menu. Group metadata persists across reloads.
**Verification Profile**: mixed (browser + command)
**Acceptance Criteria**:
1. A visible action in the Sidebar (e.g. a "New Group" affordance or connection context menu entry) creates a new group with a user-provided name and an optional colour selected from the existing connection-colour palette; the group appears in the sidebar immediately.
2. Each group renders a collapsible header that shows its name, its colour as a leading accent, and its connection count; the collapsed/expanded state persists per group across reloads.
3. A connection can be assigned to a group by dragging it onto the group header and by a context-menu entry "Move to group › …" that lists existing groups plus "No group"; either path updates the sidebar and persists the change.
4. A connection can be dragged out of a group back to the ungrouped root region, with a visible drop target for that region.
5. Deleting a group leaves its connections intact but ungrouped; a confirmation prompt clearly states that only the group is removed.
6. Group state round-trips through the Tauri persistent store (or localStorage fallback, matching the existing convention) — reloading the app restores name, colour, collapsed flag, and connection assignments.
7. Sidebar and store tests cover create/rename/colour/delete, drag assignment, context-menu assignment, and the "no group" drop region.

**Components to Create/Modify**:
- `src/components/layout/Sidebar.tsx`, `src/components/connection/ConnectionList.tsx`, `src/components/connection/ConnectionGroup.tsx`, `src/components/connection/ConnectionItem.tsx`: extend the existing group UI with a create-group affordance, a colour swatch, a context-menu assignment path, and a clearly-visible "ungrouped" drop zone.
- `src/stores/connectionStore.ts`: ensure `addGroup`/`updateGroup`/`moveConnectionToGroup` cover the new flows and that colour + collapsed persist through `listGroups`/`saveGroup`.
- `src-tauri/src/commands/*` and `src-tauri/src/models/*`: surface colour + collapsed fields on `ConnectionGroup` if missing; keep IPC contract stable.
- `src/types/connection.ts`: confirm `ConnectionGroup` shape covers name/colour/collapsed (already present; verify).
- Tests: `src/stores/connectionStore.test.ts`, `src/components/connection/ConnectionGroup.test.tsx`, `src/components/connection/ConnectionList.test.tsx`, and an E2E flow in `e2e/` if a group-flow spec does not yet exist.

### Sprint 79: Connection Dialog Layout and Test-Connection Feedback
**Goal**: The Connection dialog fills its container without a right-side dead band, and the Test Connection button reports success/failure plus latency immediately next to itself without forcing the user to scroll.
**Verification Profile**: browser
**Acceptance Criteria**:
1. The Connection dialog renders with content filling the dialog width — there is no visible empty vertical band on the right, and inputs extend to the dialog's inner horizontal padding on all sizes the dialog can take.
2. Clicking "Test Connection" surfaces the result (success with latency in milliseconds, or error message) within the same scroll region as the button — either inline directly next to or below the button, or as a short-lived toast attached to it — with no scrolling required.
3. While a test is in progress, the button shows a loading indicator and the adjacent status region shows "Testing…"; on completion the status region updates to the success/failure message.
4. The inline result is dismissible or auto-clears when the user changes any form field, so stale results do not confuse a later save.
5. Dialog tests cover the layout (no unused right-side region) and the inline-test-result behaviour (visible without scroll, updates on success and failure).

**Components to Create/Modify**:
- `src/components/connection/ConnectionDialog.tsx`: remove the redundant inner width wrapper so the dialog body fills its container; move or mirror the Test Connection status into the footer area adjacent to the button; add a latency value to the success branch.
- `src/stores/connectionStore.ts` / `src/lib/tauri.ts`: if `testConnection` does not already return a latency figure, extend the IPC response shape (backend-safe addition) so the UI can display it.
- `src-tauri/src/commands/*`: include a latency field in the test-connection response if missing.
- `src/components/connection/ConnectionDialog.test.tsx`: cover the inline feedback and the no-dead-band layout.

## Global Acceptance Criteria
1. No existing Vitest, `tsc --noEmit`, `cargo test`, `cargo clippy`, or `pnpm lint` checks regress.
2. All new behaviour has test coverage at least matching the existing file's style (component-level RTL assertions for UI, pure store tests for state changes, sql-generator unit tests for SQL-shape changes).
3. ADR 0009's tri-state contract (`string | null` for `editValue` / `pendingEdits`) is preserved; nothing in Sprint 74 or 75 collapses NULL and empty string for textual columns.
4. No new `any` in TypeScript; no new `unwrap()` in Rust (outside tests); no new arbitrary px values disallowed by ADR 0008.
5. All user-visible copy and tooltips respect dark mode.

## Data Flow
- **Sprints 74 / 75**: stays in-process inside `useDataGridEdit` → `sqlGenerator` → existing `execute_query` Tauri command. No new IPC.
- **Sprint 76**: sort state lives on the `TableTab` in `tabStore`, flows through `DataGrid` via store read, and rides existing `queryTableData` calls.
- **Sprint 77**: pure client state in `tabStore`; no IPC.
- **Sprint 78**: existing `saveGroup`/`listGroups`/`moveConnectionToGroup` IPC commands; extend payload if colour/collapsed are not already persisted. Group data persists through the Tauri backend store.
- **Sprint 79**: extends `test_connection` IPC response with a latency field if not already present; rest is UI-local.

## UI States
- **Loading**: per-cell editor shows no spinner (instant); Test Connection button shows inline "Testing…" with latency reserved space.
- **Empty**: grouped-connections sidebar shows the existing "no connections" and "drag to create groups" hints; a group with zero connections shows an explicit "Empty group" hint inside the collapsed body.
- **Error**: type-mismatch on commit shows an inline hint under the active editor, does not auto-close the editor, and colour-codes the cell; Test Connection failure shows red inline with the error text.
- **Success**: successful commit closes the editor, refreshes data, and clears the per-cell error; successful Test Connection shows green inline with latency (e.g. "Connected · 42 ms").

## Edge Cases
- NULL chip on a boolean column where only `true`/`false`/`null` are legal — typing a digit should not seed a literal digit into a text input.
- Empty-string on a textual column must still serialise as `''`, preserving ADR 0009 tri-state intent.
- Closing and reopening a tab via the reopen-history path must not leak sort state from another tab with the same table name but different connection.
- Creating an ephemeral tab, editing a cell, then closing without saving — the tab should have been promoted on edit start, so it must not be silently overwritten by the next "open table" action.
- Dragging a connection onto its own group header (no-op) should not flash a drop-active state.
- Deleting a group while a connection inside it is focused should leave the connection focused and ungrouped.
- Test Connection clicked repeatedly in quick succession: only the latest result is shown; earlier pending results are discarded.
- Connection dialog in a language/locale where field labels are longer — the dialog must still not show a right-side dead band.

## Visual Direction
- Tab bar: TablePlus-class compact — one tight line of padding top/bottom, 12–13 px label text, small icon, muted accent underline on active tab, italic + reduced-opacity text on ephemeral tabs.
- Group headers: subtle, uppercase or small-caps tag with a coloured leading dot; content under a collapsed group hides without animation jank.
- NULL chip and inline validation hints: muted/destructive token use, not raw colour codes.

## Verification Hints
- Sprint 74: `pnpm vitest run src/components/datagrid/useDataGridEdit` and manual browser check opening a date column, pressing Cmd+Backspace, then pressing `a`.
- Sprint 75: `pnpm vitest run src/components/datagrid/sqlGenerator.test.ts` — assert generated SQL shapes for each type branch.
- Sprint 76: `pnpm vitest run src/stores/tabStore.test.ts src/components/DataGrid.test.tsx` and manual tab-switch with sorts.
- Sprint 77: `pnpm vitest run src/components/layout/TabBar.test.tsx src/stores/tabStore.test.ts`; browser: open two tables in succession and confirm replacement; double-click to promote.
- Sprint 78: `pnpm vitest run src/stores/connectionStore.test.ts src/components/connection/ConnectionGroup.test.tsx`; browser: create group, drag connection in, reload.
- Sprint 79: `pnpm vitest run src/components/connection/ConnectionDialog.test.tsx`; browser: open dialog, confirm no right-side dead band, click Test Connection, confirm inline feedback without scroll.
- Across all sprints: `pnpm tsc --noEmit && pnpm lint && cd src-tauri && cargo clippy && cargo test`.
