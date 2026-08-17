import GlobalQueryLogPanel from "@components/query/GlobalQueryLogPanel";
import { useTablistRoving } from "@components/shared/tablist/useTablistRoving";
import { Button } from "@components/ui/button";
import OperationsPanel from "@components/workspace/OperationsPanel";
import { useOperationsConnection } from "@components/workspace/useOperationsConnection";
import { type BottomPanelTab, useLayoutStore } from "@stores/layoutStore";
import { PanelBottom } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

interface BottomPanelProps {
  /**
   * Receives the Details tab body once it mounts. `MainArea` holds the node
   * and republishes it over `BottomPanelDetailsSlotContext` so the grid can
   * portal its `QuickLookPanel` in — see `bottomPanelSlot.ts`.
   */
  onDetailsSlotChange: (element: HTMLDivElement | null) => void;
}

/**
 * The workspace's bottom dock (#2426). One bordered region holds the three
 * workspace-level views — query History, server Operations, and the selected
 * row's Details — behind a small tab strip, replacing the two bottom flyouts
 * that `MainArea` used to stack and the Quick Look panel the grid used to
 * mount inline.
 *
 * Tab-strip styling is deliberately NOT the treatment the editor `TabBar`
 * uses one layer above (owner: "두 층이 구별되게"). The editor tabs carry a
 * 2px underline plus a `bg-background` fill on the active tab at `text-sm`;
 * this strip is a fixed `h-7` row of `text-xs` tabs with a *1px* underline
 * and no fill, drawn with `-mb-px` so the active mark replaces the strip's
 * own rule instead of stacking on it.
 *
 * The Operations tab is capability-gated the same way its old toolbar button
 * was: a connection without `operations.*` gets no tab at all rather than a
 * dead one (ui-parity §4, static unsupported = hidden).
 */
export default function BottomPanel({ onDetailsSlotChange }: BottomPanelProps) {
  const { t } = useTranslation("layout");
  const collapsed = useLayoutStore((s) => s.bottomPanelCollapsed);
  const storedTab = useLayoutStore((s) => s.bottomPanelTab);
  const detailsAvailable = useLayoutStore((s) => s.detailsAvailable);
  const selectBottomTab = useLayoutStore((s) => s.selectBottomTab);
  const toggleBottomPanel = useLayoutStore((s) => s.toggleBottomPanel);
  const setCollapsed = useLayoutStore((s) => s.setBottomPanelCollapsed);
  const operationsConnection = useOperationsConnection();

  const tabs: BottomPanelTab[] = operationsConnection
    ? ["history", "operations", "details"]
    : ["history", "details"];
  // The stored pick can name a tab this connection has no capability for
  // (swap to a Redis connection while Operations is open). Fall back for the
  // render only — the store keeps the pick so swapping back restores it.
  const activeTab: BottomPanelTab = tabs.includes(storedTab)
    ? storedTab
    : "history";

  const tabStripRef = useRef<HTMLDivElement>(null);
  const roving = useTablistRoving(
    tabs,
    activeTab,
    selectBottomTab,
    tabStripRef,
  );

  return (
    <div
      className="flex shrink-0 flex-col border-t border-border"
      data-testid="workspace-bottom-panel"
    >
      <div className="flex h-7 shrink-0 items-center border-b border-border bg-secondary pr-1">
        <div
          ref={tabStripRef}
          role="tablist"
          aria-label={t("bottomPanel.tablistAria")}
          className="flex h-full items-center"
          onKeyDown={roving.onKeyDown}
        >
          {tabs.map((tab) => {
            const selected = tab === activeTab && !collapsed;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`bottom-panel-tab-${tab}`}
                data-tab-value={tab}
                data-testid={`bottom-panel-tab-${tab}`}
                aria-controls={`bottom-panel-tabpanel-${tab}`}
                aria-selected={selected}
                tabIndex={tab === activeTab ? 0 : -1}
                onClick={() => selectBottomTab(tab)}
                className={`-mb-px h-full border-b px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                  selected
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-secondary-foreground"
                }`}
              >
                {t(`bottomPanel.tab.${tab}`)}
              </button>
            );
          })}
        </div>
        {/* Second collapse control (owner decision). It reads the same
            `bottomPanelCollapsed` field as the toolbar cluster's button and
            renders the same `aria-pressed`, so the two can never disagree. */}
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          className="ml-auto"
          aria-pressed={!collapsed}
          aria-label={t("bottomPanel.toggleAria")}
          title={t("bottomPanel.toggleTitle")}
          data-testid="bottom-panel-toggle-strip"
          onClick={toggleBottomPanel}
        >
          <PanelBottom
            className={`h-4 w-4 ${collapsed ? "text-muted-foreground" : "text-primary"}`}
            aria-hidden="true"
          />
        </Button>
      </div>

      {!collapsed && activeTab === "history" && (
        <div
          role="tabpanel"
          id="bottom-panel-tabpanel-history"
          aria-labelledby="bottom-panel-tab-history"
          tabIndex={0}
        >
          <GlobalQueryLogPanel visible onClose={() => setCollapsed(true)} />
        </div>
      )}
      {!collapsed && activeTab === "operations" && (
        <div
          role="tabpanel"
          id="bottom-panel-tabpanel-operations"
          aria-labelledby="bottom-panel-tab-operations"
          tabIndex={0}
        >
          <OperationsPanel visible onClose={() => setCollapsed(true)} />
        </div>
      )}
      {/* Details stays mounted even when another tab owns the dock. The grid
          portals its `QuickLookPanel` in here, and a target that appears only
          on the render *after* the tab is picked would flash the panel inside
          the grid first. `hidden` (no display utility on this node, so the UA
          rule wins) keeps it out of layout and out of the a11y tree. */}
      <div
        role="tabpanel"
        id="bottom-panel-tabpanel-details"
        aria-labelledby="bottom-panel-tab-details"
        tabIndex={0}
        hidden={collapsed || activeTab !== "details"}
      >
        <div ref={onDetailsSlotChange} />
        {!collapsed && activeTab === "details" && !detailsAvailable && (
          <p
            className="px-3 py-4 text-center text-xs text-muted-foreground"
            data-testid="bottom-panel-details-empty"
          >
            {t("bottomPanel.detailsEmpty")}
          </p>
        )}
      </div>
    </div>
  );
}
