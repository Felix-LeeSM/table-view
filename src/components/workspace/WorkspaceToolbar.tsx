import ConnectionSwitcher from "./ConnectionSwitcher";
import DbSwitcher from "./DbSwitcher";
import SchemaSwitcher from "./SchemaSwitcher";

/**
 * Sprint 127 — workspace toolbar. Top-of-pane container that hosts the
 * `[Conn ▼] [DB ▼] [Schema ▼]` triad. Mounted by `MainArea` directly
 * above `<TabBar>` so it sits between the back-to-connections row and
 * the open-tabs strip without prop-drilling tab/connection state.
 *
 * The component itself is paradigm-agnostic — every paradigm shows the
 * same three slots. Children read tab + connection state directly from
 * zustand selectors; there is no orchestration here.
 */
export default function WorkspaceToolbar() {
  return (
    <div
      role="toolbar"
      aria-label="Workspace toolbar"
      className="flex h-9 items-center gap-2 border-b border-border bg-secondary px-2"
    >
      <ConnectionSwitcher />
      <DbSwitcher />
      <SchemaSwitcher />
    </div>
  );
}
