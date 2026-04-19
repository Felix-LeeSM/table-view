import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { useConnectionStore } from "@stores/connectionStore";
import { useTabStore } from "@stores/tabStore";
import { useTheme } from "@hooks/useTheme";
import { useResizablePanel } from "@hooks/useResizablePanel";
import ConnectionDialog from "@components/connection/ConnectionDialog";
import ConnectionRail from "@components/connection/ConnectionRail";
import SchemaPanel from "@components/schema/SchemaPanel";

export default function Sidebar() {
  const [showNewDialog, setShowNewDialog] = useState(false);
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const activeTab = useTabStore((s) => {
    const id = s.activeTabId;
    return id ? s.tabs.find((t) => t.id === id) : null;
  });
  const activeTabConnId = activeTab?.connectionId ?? null;

  const { theme, setTheme } = useTheme();

  // The connection whose schema tree is shown in the right pane of the sidebar.
  // Initially: pick the first connected connection if any, otherwise null.
  const [selectedConnId, setSelectedConnId] = useState<string | null>(() => {
    const firstConnected = connections.find(
      (c) => activeStatuses[c.id]?.type === "connected",
    );
    return firstConnected?.id ?? null;
  });

  // Auto-sync the rail selection to the active tab so that opening a tab in
  // a different connection brings its schema into view. The user can still
  // override this by clicking another rail icon.
  useEffect(() => {
    if (activeTabConnId && activeTabConnId !== selectedConnId) {
      setSelectedConnId(activeTabConnId);
    }
  }, [activeTabConnId, selectedConnId]);

  // If the currently-selected connection vanishes (deleted or disconnected and
  // never re-selected), pick another connected one — falls back to null.
  useEffect(() => {
    if (selectedConnId) {
      const stillExists = connections.some((c) => c.id === selectedConnId);
      if (!stillExists) {
        const firstConnected = connections.find(
          (c) => activeStatuses[c.id]?.type === "connected",
        );
        setSelectedConnId(firstConnected?.id ?? null);
      }
    } else if (connections.length > 0) {
      const firstConnected = connections.find(
        (c) => activeStatuses[c.id]?.type === "connected",
      );
      if (firstConnected) setSelectedConnId(firstConnected.id);
    }
  }, [connections, activeStatuses, selectedConnId]);

  const {
    size: sidebarWidth,
    panelRef: sidebarRef,
    handleMouseDown: handleResizeMouseDown,
  } = useResizablePanel({
    axis: "horizontal",
    min: 220,
    max: 540,
    initial: 280,
  });

  const cycleTheme = () => {
    const next =
      theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(next);
  };

  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  // Listen for Cmd+N keyboard shortcut dispatched from App
  useEffect(() => {
    const handler = () => setShowNewDialog(true);
    window.addEventListener("new-connection", handler);
    return () => window.removeEventListener("new-connection", handler);
  }, []);

  return (
    <>
      <div
        ref={sidebarRef}
        className="relative flex h-full shrink-0 select-none border-r border-border bg-secondary"
        style={{ width: sidebarWidth }}
      >
        {/* Left rail: vertical strip of connections */}
        <ConnectionRail
          selectedId={selectedConnId}
          onSelect={setSelectedConnId}
          onNewConnection={() => setShowNewDialog(true)}
        />

        {/* Right pane: schema tree of the selected connection + theme footer */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Header strip showing the current connection name */}
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span
              data-testid="sidebar-connection-header"
              className="truncate text-xs font-semibold text-foreground"
            >
              {selectedConnId
                ? (connections.find((c) => c.id === selectedConnId)?.name ??
                  "Schemas")
                : "Schemas"}
            </span>
          </div>

          <SchemaPanel selectedId={selectedConnId} />

          {/* Theme toggle */}
          <div className="border-t border-border px-3 py-2">
            <button
              className="flex w-full items-center gap-2 rounded p-1 text-xs text-muted-foreground hover:bg-muted hover:text-secondary-foreground"
              onClick={cycleTheme}
              aria-label={`Theme: ${theme}. Click to change.`}
            >
              <ThemeIcon size={14} />
              <span className="capitalize">{theme}</span>
            </button>
          </div>
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
