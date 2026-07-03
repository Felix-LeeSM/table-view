import { History } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import DbSwitcher from "./DbSwitcher";
import DisconnectButton from "./DisconnectButton";
import SafeModeToggle from "./SafeModeToggle";
import RowCapSetting from "@components/settings/RowCapSetting";

/**
 * Workspace toolbar — top-of-pane container that hosts the `[DB ▼]` chip
 * and the Disconnect control. Mounted by `MainArea` directly above
 * `<TabBar>` so it sits between the back-to-connections row and the
 * open-tabs strip without prop-drilling tab/connection state.
 *
 * Connection swap path: Home → double-click. Schema selection is unified
 * into the sidebar tree (`SchemaTree`), which folds the schema row away on
 * `dbType`s without that layer (mysql / sqlite). The toolbar carries no
 * schema chip — active schema is implicit in the tab title for relational
 * tabs and irrelevant for document tabs.
 *
 * The toolbar itself is paradigm-agnostic — every paradigm shows the same
 * slots. Children read tab + connection state directly from zustand
 * selectors; there is no orchestration here.
 *
 * The History button surfaces the existing `GlobalQueryLogPanel` (already
 * reachable via Cmd+Shift+C) as a visible toolbar entry point. It
 * dispatches the same custom event that `App.tsx` wires for the keyboard
 * shortcut so the toggle channel has one source of truth.
 */
function HistoryButton() {
  const { t } = useTranslation("workspace");
  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      aria-label={t("toolbar.history.ariaLabel")}
      title={t("toolbar.history.title")}
      data-testid="workspace-history-toggle"
      onClick={() =>
        window.dispatchEvent(new CustomEvent("toggle-global-query-log"))
      }
    >
      <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <span className="ml-1 text-xs">{t("toolbar.history.label")}</span>
    </Button>
  );
}

export default function WorkspaceToolbar() {
  const { t } = useTranslation("workspace");
  return (
    <div
      role="toolbar"
      aria-label={t("toolbar.ariaLabel")}
      className="flex h-9 items-center gap-2 border-b border-border bg-secondary px-2"
    >
      <DbSwitcher />
      {/* Disconnect lives at the trailing edge of the toolbar, adjacent
          to the (keyboard-only) refresh action. Disabled when the focused
          connection is not currently connected, so it never silently
          no-ops. */}
      <div className="ml-auto flex items-center gap-2">
        <HistoryButton />
        <RowCapSetting />
        <SafeModeToggle />
        <DisconnectButton />
      </div>
    </div>
  );
}
