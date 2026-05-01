import { History } from "lucide-react";
import { Button } from "@components/ui/button";
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
 *
 * Post-Sprint-187 hotfix — the History button surfaces the existing
 * `GlobalQueryLogPanel` (already reachable via Cmd+Shift+C) as a
 * visible toolbar entry point. It dispatches the same custom event
 * that `App.tsx` wires for the keyboard shortcut so we keep one source
 * of truth for the toggle channel.
 */
function HistoryButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      aria-label="Toggle query history"
      title="Query history (Cmd/Ctrl+Shift+C)"
      data-testid="workspace-history-toggle"
      onClick={() =>
        window.dispatchEvent(new CustomEvent("toggle-global-query-log"))
      }
    >
      <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <span className="ml-1 text-xs">History</span>
    </Button>
  );
}

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
        <HistoryButton />
        <SafeModeToggle />
        <DisconnectButton />
      </div>
    </div>
  );
}
