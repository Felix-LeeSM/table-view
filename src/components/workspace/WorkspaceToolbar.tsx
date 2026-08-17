import RowCapSetting from "@components/settings/RowCapSetting";
import { Button } from "@components/ui/button";
import { useLayoutStore } from "@stores/layoutStore";
import { PanelBottom, PanelLeft } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import AppearanceButton from "./AppearanceButton";
import BackToConnectionsButton from "./BackToConnectionsButton";
import DbSwitcher from "./DbSwitcher";
import DisconnectButton from "./DisconnectButton";
import SafeModeToggle from "./SafeModeToggle";
import { useToolbarRoving } from "./useToolbarRoving";

/**
 * Workspace toolbar — top-of-pane container that hosts the `[DB ▼]` chip
 * and the Disconnect control. Mounted by `MainArea` directly above
 * `<TabBar>`, and unconditionally: nothing about it reacts to a sidebar or
 * dock collapse, which is what lets #2431 park the window-level controls
 * here without prop-drilling tab/connection state.
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
 */

/**
 * The layout cluster (#1734 owner decision 1, narrowed by #2426). A
 * `role="group"` of `aria-pressed` toggles for the two workspace *panels* —
 * the schema sidebar on the left and the dock at the bottom — sitting at the
 * toolbar's leading edge next to each other.
 *
 * #2426 took the History and Operations buttons out. Those two opened
 * *views*, not panels; grouping them with a collapse toggle put three
 * different kinds of control under one `role="group"` label. Both views are
 * now tabs of the bottom dock, so what is left in the cluster is one kind of
 * thing: "hide/show this panel".
 *
 * The dock toggle here and the one in the dock's own tab strip are two
 * buttons for one action. Both read `bottomPanelCollapsed` straight from the
 * store rather than holding a copy, which is what keeps their `aria-pressed`
 * in step (owner requirement).
 */
function LayoutCluster() {
  const { t } = useTranslation("workspace");
  const sidebarCollapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const bottomPanelCollapsed = useLayoutStore((s) => s.bottomPanelCollapsed);
  const toggleBottomPanel = useLayoutStore((s) => s.toggleBottomPanel);
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
      <Button
        variant="ghost"
        size="icon-sm"
        type="button"
        aria-pressed={!bottomPanelCollapsed}
        aria-label={t("toolbar.layout.bottomPanelAriaLabel")}
        title={t("toolbar.layout.bottomPanelTitle")}
        data-testid="workspace-bottom-panel-toggle"
        onClick={toggleBottomPanel}
      >
        <PanelBottom
          className={`h-4 w-4 ${bottomPanelCollapsed ? "text-muted-foreground" : "text-primary"}`}
          aria-hidden="true"
        />
      </Button>
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
      {/* Panel toggles lead the toolbar (owner: "툴바 왼쪽"). They act on the
          window chrome that frames everything else, so they sit outside the
          connection-scoped controls rather than in the trailing group. */}
      <LayoutCluster />
      <DbSwitcher />
      {/* Trailing group, in two tiers. The connection-scoped controls come
          first — Disconnect closes that tier at its trailing edge, adjacent
          to the (keyboard-only) refresh action, and is disabled when the
          focused connection is not currently connected so it never silently
          no-ops.

          #2431 — the two window-level controls sit outside them at the far
          edge, mirroring the panel toggles at the far leading edge: both
          tiers act on the window rather than on the connection. Keeping
          Appearance between Disconnect and Back also stops the two
          "leave" actions from becoming neighbours, and they are emphatically
          not the same action (Back keeps the pool alive). */}
      <div className="ml-auto flex items-center gap-2">
        <RowCapSetting />
        <SafeModeToggle />
        <DisconnectButton />
        <AppearanceButton />
        <BackToConnectionsButton />
      </div>
    </div>
  );
}
