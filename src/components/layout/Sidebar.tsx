import { useEffect, useState } from "react";
import { ArrowDownUp, Sun, Moon, Monitor, Plus } from "lucide-react";
import { useConnectionStore } from "@stores/connectionStore";
import { useTabStore } from "@stores/tabStore";
import { useTheme } from "@hooks/useTheme";
import { useResizablePanel } from "@hooks/useResizablePanel";
import { Button } from "@components/ui/button";
import ConnectionDialog from "@components/connection/ConnectionDialog";
import ConnectionList from "@components/connection/ConnectionList";
import ImportExportDialog from "@components/connection/ImportExportDialog";
import SchemaPanel from "@components/schema/SchemaPanel";
import SidebarModeToggle, { type SidebarMode } from "./SidebarModeToggle";

const WIDTH_KEY = "viewtable.sidebar.width";
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

export default function Sidebar() {
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [mode, setMode] = useState<SidebarMode>("connections");
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

  const { theme, setTheme } = useTheme();

  // Focus the active tab's connection so its schema tree comes into view.
  useEffect(() => {
    if (activeTabConnId && activeTabConnId !== focusedConnId) {
      setFocusedConn(activeTabConnId);
      setMode("schemas");
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

  const focusAndOpenSchemas = (id: string) => {
    setFocusedConn(id);
    setMode("schemas");
  };

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

  // When a new connection is saved, surface it to the user by flipping to
  // connections mode so the new item is visible immediately.
  useEffect(() => {
    const handler = () => setMode("connections");
    window.addEventListener("connection-added", handler);
    return () => window.removeEventListener("connection-added", handler);
  }, []);

  const selectedConnected =
    !!focusedConnId && activeStatuses[focusedConnId]?.type === "connected";

  // Right-side action buttons — each visible only in the mode where it makes sense:
  //   - schemas mode: "+ Query" against the selected connection
  //   - connections mode: Import / Export of connection definitions, New Connection
  const renderActionButtons = () => (
    <div className="flex items-center gap-1">
      {mode === "schemas" && (
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
      )}
      {mode === "connections" && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground hover:text-secondary-foreground"
          aria-label="Import / Export"
          title="Import / Export"
          onClick={() => setShowImportExport(true)}
        >
          <ArrowDownUp />
        </Button>
      )}
      {mode === "connections" && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground hover:text-secondary-foreground"
          aria-label="New Connection"
          title="New Connection"
          onClick={() => setShowNewDialog(true)}
        >
          <Plus />
        </Button>
      )}
    </div>
  );

  return (
    <>
      <div
        ref={sidebarRef}
        className="relative flex h-full shrink-0 select-none flex-col border-r border-border bg-secondary"
        style={{ width: sidebarWidth }}
      >
        {/* Mode toggle */}
        <div className="flex items-center border-b border-border px-2 py-2">
          <SidebarModeToggle mode={mode} onChange={setMode} />
        </div>

        {/* Header strip — shows the connection name (schemas) or mode label
            (connections), with contextual action buttons on the right.
            data-testid is always rendered so e2e tests have a stable sentinel. */}
        <div className="flex items-center justify-between border-b border-border py-1 pl-3 pr-1">
          <span
            data-testid="sidebar-connection-header"
            className="block truncate text-xs font-semibold text-foreground"
          >
            {mode === "schemas"
              ? focusedConnId
                ? (connections.find((c) => c.id === focusedConnId)?.name ??
                  "Schemas")
                : "Schemas"
              : "Connections"}
          </span>
          {renderActionButtons()}
        </div>

        {/* Body — exclusive view */}
        <div className="flex flex-1 flex-col overflow-auto">
          {mode === "connections" ? (
            <ConnectionList
              selectedId={focusedConnId}
              onSelect={focusAndOpenSchemas}
              onActivate={focusAndOpenSchemas}
            />
          ) : (
            <SchemaPanel selectedId={focusedConnId} />
          )}
        </div>

        {/* Theme toggle footer */}
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

        {/* Resize handle */}
        <div
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/90 active:bg-primary/90"
          onMouseDown={handleResizeMouseDown}
        />
      </div>

      {showNewDialog && (
        <ConnectionDialog onClose={() => setShowNewDialog(false)} />
      )}

      {showImportExport && (
        <ImportExportDialog onClose={() => setShowImportExport(false)} />
      )}
    </>
  );
}
