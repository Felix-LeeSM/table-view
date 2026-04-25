import { useEffect, useState } from "react";
import { Sun, Moon, Monitor, Plus } from "lucide-react";
import { useConnectionStore } from "@stores/connectionStore";
import { useTabStore } from "@stores/tabStore";
import { useThemeStore } from "@stores/themeStore";
import { useResizablePanel } from "@hooks/useResizablePanel";
import { THEME_CATALOG } from "@lib/themeCatalog";
import { subscribeSystemModeChange } from "@lib/themeBoot";
import { Button } from "@components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import ConnectionDialog from "@components/connection/ConnectionDialog";
import WorkspaceSidebar from "@components/workspace/WorkspaceSidebar";
import { LogoWordmark } from "@components/shared/Logo";
import ThemePicker from "@components/theme/ThemePicker";

const WIDTH_KEY = "table-view.sidebar.width";
const MIN_WIDTH = 220;
const MAX_WIDTH = 540;
const DEFAULT_WIDTH = 280;

function readWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  try {
    const v = window.localStorage.getItem(WIDTH_KEY);
    if (!v) return DEFAULT_WIDTH;
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return DEFAULT_WIDTH;
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, n));
  } catch {
    return DEFAULT_WIDTH;
  }
}

/**
 * Workspace Sidebar (sprint 125+).
 *
 * Sprint 125 removed the legacy connections-mode branch (and the
 * `SidebarModeToggle` mount it depended on); connection management now lives
 * on the dedicated `HomePage`. This component is now exclusively the
 * schema/work surface column shown on `WorkspacePage`.
 *
 * The `connection-added` window event still flips focus to the newly-saved
 * connection so a user who creates a new connection while inside the
 * workspace (via Cmd+N) sees that connection's schema tree on the next
 * Open. The mode-toggling fallback that the legacy Sidebar performed is
 * unnecessary now that there is no second mode.
 */
export default function Sidebar() {
  const [showNewDialog, setShowNewDialog] = useState(false);
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const focusedConnId = useConnectionStore((s) => s.focusedConnId);
  const setFocusedConn = useConnectionStore((s) => s.setFocusedConn);
  const activeTab = useTabStore((s) => {
    const id = s.activeTabId;
    return id ? s.tabs.find((t) => t.id === id) : null;
  });
  const activeTabConnId = activeTab?.connectionId ?? null;
  const addQueryTab = useTabStore((s) => s.addQueryTab);

  const themeId = useThemeStore((s) => s.themeId);
  const themeMode = useThemeStore((s) => s.mode);
  const handleSystemChange = useThemeStore((s) => s.handleSystemChange);

  useEffect(() => {
    if (themeMode !== "system") return;
    return subscribeSystemModeChange(handleSystemChange);
  }, [themeMode, handleSystemChange]);

  // Focus the active tab's connection so its schema tree comes into view.
  useEffect(() => {
    if (activeTabConnId && activeTabConnId !== focusedConnId) {
      setFocusedConn(activeTabConnId);
    }
  }, [activeTabConnId, focusedConnId, setFocusedConn]);

  // Keep focus pointing at an existing connection: seed on first load, and
  // heal if the focused connection vanishes (deleted, or store reset).
  useEffect(() => {
    const firstConnected = connections.find(
      (c) => activeStatuses[c.id]?.type === "connected",
    );
    if (!focusedConnId) {
      if (firstConnected) setFocusedConn(firstConnected.id);
      return;
    }
    const stillExists = connections.some((c) => c.id === focusedConnId);
    if (!stillExists) {
      setFocusedConn(firstConnected?.id ?? null);
    }
  }, [connections, activeStatuses, focusedConnId, setFocusedConn]);

  const {
    size: sidebarWidth,
    panelRef: sidebarRef,
    handleMouseDown: handleResizeMouseDown,
  } = useResizablePanel({
    axis: "horizontal",
    min: MIN_WIDTH,
    max: MAX_WIDTH,
    initial: readWidth(),
  });

  // Persist width on every commit (mouseup).
  useEffect(() => {
    try {
      window.localStorage.setItem(WIDTH_KEY, String(sidebarWidth));
    } catch {
      // ignore
    }
  }, [sidebarWidth]);

  const activeEntry =
    THEME_CATALOG.find((t) => t.id === themeId) ?? THEME_CATALOG[0];
  const ThemeIcon =
    themeMode === "dark" ? Moon : themeMode === "light" ? Sun : Monitor;

  // Listen for Cmd+N keyboard shortcut dispatched from App
  useEffect(() => {
    const handler = () => setShowNewDialog(true);
    window.addEventListener("new-connection", handler);
    return () => window.removeEventListener("new-connection", handler);
  }, []);

  // The legacy `connection-added` flip-to-connections-mode behaviour was
  // removed in sprint 125; new-connection creation is now done from
  // HomePage. The `connections` effect above takes care of focus healing
  // when the new connection lands in the store.

  const selectedConnected =
    !!focusedConnId && activeStatuses[focusedConnId]?.type === "connected";

  return (
    <>
      <div
        ref={sidebarRef}
        className="relative flex h-full shrink-0 select-none flex-col border-r border-border bg-secondary"
        style={{ width: sidebarWidth }}
      >
        {/* Brand header */}
        <div className="flex items-center justify-center border-b border-border px-3 py-2">
          <LogoWordmark className="h-7 w-auto" />
        </div>

        {/* Header strip — connection name + "+ Query" action. data-testid is
            kept stable for e2e tests (`sidebar-connection-header`). */}
        <div className="flex items-center justify-between border-b border-border py-1 pl-3 pr-1">
          <span
            data-testid="sidebar-connection-header"
            className="block truncate text-xs font-semibold text-foreground"
          >
            {focusedConnId
              ? (connections.find((c) => c.id === focusedConnId)?.name ??
                "Schemas")
              : "Schemas"}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              className="shrink-0 text-muted-foreground hover:text-secondary-foreground"
              aria-label="New Query Tab"
              title="New Query Tab"
              disabled={!selectedConnected}
              onClick={() => {
                if (selectedConnected && focusedConnId) {
                  addQueryTab(focusedConnId);
                }
              }}
            >
              <Plus />
              Query
            </Button>
          </div>
        </div>

        {/* Body — paradigm-aware sidebar slot (sprint 126). The
            connections-mode branch was removed in sprint 125 (now lives on
            HomePage). `WorkspaceSidebar` resolves the driving connection
            with active-tab priority and falls back to `focusedConnId`. */}
        <div className="flex flex-1 flex-col overflow-auto">
          <WorkspaceSidebar selectedId={focusedConnId} />
        </div>

        {/* Theme picker footer */}
        <div className="border-t border-border px-3 py-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                className="w-full justify-start text-muted-foreground"
                aria-label={`Theme picker: currently ${activeEntry.name} (${themeMode})`}
              >
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 rounded-full border border-border"
                  style={{ backgroundColor: activeEntry.swatch }}
                />
                <span className="truncate">{activeEntry.name}</span>
                <ThemeIcon className="ml-auto" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              side="top"
              sideOffset={8}
              collisionPadding={8}
              className="w-72 p-2"
            >
              <ThemePicker />
            </PopoverContent>
          </Popover>
        </div>

        {/* Resize handle */}
        <div
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/90 active:bg-primary/90"
          onMouseDown={handleResizeMouseDown}
        />
      </div>

      {showNewDialog && (
        <ConnectionDialog onClose={() => setShowNewDialog(false)} />
      )}
    </>
  );
}
