import RowCapSetting from "@components/settings/RowCapSetting";
import { Button } from "@components/ui/button";
import { useLayoutStore } from "@stores/layoutStore";
import { Activity, History, PanelLeft } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import DbSwitcher from "./DbSwitcher";
import DisconnectButton from "./DisconnectButton";
import SafeModeToggle from "./SafeModeToggle";
import { useOperationsConnection } from "./useOperationsConnection";
import { useToolbarRoving } from "./useToolbarRoving";

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
  // #1734 — the panel's open state now lives in `layoutStore`, so the button
  // can advertise `aria-pressed`. The click still goes through the custom
  // event so the Cmd+Shift+C binding in `App.tsx` stays the same channel.
  const visible = useLayoutStore((s) => s.globalLogVisible);
  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      aria-pressed={visible}
      aria-label={t("toolbar.history.ariaLabel")}
      title={t("toolbar.history.title")}
      data-testid="workspace-history-toggle"
      onClick={() =>
        window.dispatchEvent(new CustomEvent("toggle-global-query-log"))
      }
    >
      <History
        className={`h-4 w-4 ${visible ? "text-primary" : "text-muted-foreground"}`}
        aria-hidden="true"
      />
      <span className="ml-1 text-xs">{t("toolbar.history.label")}</span>
    </Button>
  );
}

/**
 * #1054 — Operations flyout toggle. Mirrors `HistoryButton`'s event
 * channel: dispatches `toggle-operations-panel`, which `MainArea`
 * listens for and mounts `<OperationsPanel>`. Hidden entirely when the
 * driving connection has no `operations.*` capability so the toolbar
 * never offers a dead button (ui-parity §3: no disabled-only entry).
 */
function OperationsButton() {
  const { t } = useTranslation("workspace");
  const drv = useOperationsConnection();
  // Hook order is fixed — read the flag before the capability early-return.
  const visible = useLayoutStore((s) => s.operationsVisible);
  if (!drv) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      aria-pressed={visible}
      aria-label={t("toolbar.operations.ariaLabel")}
      title={t("toolbar.operations.title")}
      data-testid="workspace-operations-toggle"
      onClick={() =>
        window.dispatchEvent(new CustomEvent("toggle-operations-panel"))
      }
    >
      <Activity
        className={`h-4 w-4 ${visible ? "text-primary" : "text-muted-foreground"}`}
        aria-hidden="true"
      />
      <span className="ml-1 text-xs">{t("toolbar.operations.label")}</span>
    </Button>
  );
}

/**
 * #1734 owner decision 1 — the layout cluster. A `role="group"` of
 * `aria-pressed` toggles for the workspace panels, at the trailing
 * (top-right) edge of the toolbar.
 *
 * Surface mapping (measured, prototype → this app):
 *   - prototype "left panel"  → `Sidebar`, the schema-tree column mounted by
 *     `WorkspacePage` next to `MainArea`. It had no collapse before; the
 *     toggle below is the new one.
 *   - prototype "bottom panel" → the two bottom-docked flyouts `MainArea`
 *     already owns, `GlobalQueryLogPanel` and `OperationsPanel`. Their
 *     buttons are grouped in here rather than duplicated, and they gained
 *     the `aria-pressed` state they were missing.
 * Quick Look stays out of the cluster (owner decision 2) — it is a
 * grid-scoped panel and lives in the grid toolbar as a labelled button.
 */
function LayoutCluster() {
  const { t } = useTranslation("workspace");
  const sidebarCollapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  return (
    <div
      role="group"
      aria-label={t("toolbar.layout.groupAriaLabel")}
      className="flex items-center gap-0.5 rounded-md border border-border px-0.5"
    >
      {/* Icon + tooltip, no text label — the repo's toolbar convention for a
          state toggle (frontend guidance: "버튼은 가능한 lucide icon +
          tooltip"), and it keeps the toolbar from growing a third caption. */}
      <Button
        variant="ghost"
        size="icon-sm"
        type="button"
        aria-pressed={!sidebarCollapsed}
        aria-label={t("toolbar.layout.sidebarAriaLabel")}
        title={t("toolbar.layout.sidebarTitle")}
        data-testid="workspace-sidebar-toggle"
        onClick={toggleSidebar}
      >
        <PanelLeft
          className={`h-4 w-4 ${sidebarCollapsed ? "text-muted-foreground" : "text-primary"}`}
          aria-hidden="true"
        />
      </Button>
      <OperationsButton />
      <HistoryButton />
    </div>
  );
}

export default function WorkspaceToolbar() {
  const { t } = useTranslation("workspace");
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Roving tabindex: the toolbar is a single tab stop; ArrowLeft/Right +
  // Home/End move focus across its controls (WAI-ARIA toolbar pattern).
  const { onKeyDown } = useToolbarRoving(toolbarRef);
  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label={t("toolbar.ariaLabel")}
      onKeyDown={onKeyDown}
      className="flex h-9 items-center gap-2 border-b border-border bg-secondary px-2"
    >
      <DbSwitcher />
      {/* Disconnect lives at the trailing edge of the toolbar, adjacent
          to the (keyboard-only) refresh action. Disabled when the focused
          connection is not currently connected, so it never silently
          no-ops. */}
      <div className="ml-auto flex items-center gap-2">
        <LayoutCluster />
        <RowCapSetting />
        <SafeModeToggle />
        <DisconnectButton />
      </div>
    </div>
  );
}
