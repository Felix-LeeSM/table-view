import DbSwitcher from "./DbSwitcher";
import DisconnectButton from "./DisconnectButton";
import SafeModeToggle from "./SafeModeToggle";

/**
 * Sprint 127 — workspace toolbar. Top-of-pane container that hosts the
 * `[DB ▼]` chip and the Sprint 134 Disconnect control. Mounted by
 * `MainArea` directly above `<TabBar>` so it sits between the
 * back-to-connections row and the open-tabs strip without prop-drilling
 * tab/connection state.
 *
 * Sprint 134 — `<ConnectionSwitcher>` was removed (the popover was too
 * large and its `onValueChange` only routed tabs without a real swap
 * — see `memory/lessons/2026-04-27-workspace-toolbar-ux-gaps`). The
 * single connection-swap path is now Home → double-click.
 *
 * Sprint 135 — `<SchemaSwitcher>` was removed. Schema selection is now
 * SoT-unified into the sidebar tree (`SchemaTree`), which folds the
 * schema row away on `db_type`s without that layer (mysql / sqlite).
 * The toolbar no longer carries a schema chip at all — the active
 * schema is implicit in the tab title (`schema.table`) for relational
 * tabs and irrelevant for document tabs.
 *
 * The toolbar itself is paradigm-agnostic — every paradigm shows the
 * same slots. Children read tab + connection state directly from
 * zustand selectors; there is no orchestration here.
 */
export default function WorkspaceToolbar() {
  return (
    <div
      role="toolbar"
      aria-label="Workspace toolbar"
      className="flex h-9 items-center gap-2 border-b border-border bg-secondary px-2"
    >
      <DbSwitcher />
      {/* Sprint 134 — Disconnect lives at the trailing edge of the
          toolbar, adjacent to the (keyboard-only) refresh action.
          Disabled when the focused connection is not currently
          connected, so it never silently no-ops. */}
      <div className="ml-auto flex items-center gap-2">
        <SafeModeToggle />
        <DisconnectButton />
      </div>
    </div>
  );
}
