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

const MODE_KEY = "viewtable.sidebar.mode";
const WIDTH_KEY = "viewtable.sidebar.width";
const DEFAULT_WIDTH = 280;

function readMode(): SidebarMode {
  if (typeof window === "undefined") return "connections";
  try {
    const v = window.localStorage.getItem(MODE_KEY);
    return v === "schemas" ? "schemas" : "connections";
  } catch {
    return "connections";
  }
}

function readWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  try {
    const v = window.localStorage.getItem(WIDTH_KEY);
    if (!v) return DEFAULT_WIDTH;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

export default function Sidebar() {
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [mode, setMode] = useState<SidebarMode>(() => readMode());
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const activeTab = useTabStore((s) => {
    const id = s.activeTabId;
    return id ? s.tabs.find((t) => t.id === id) : null;
  });
  const activeTabConnId = activeTab?.connectionId ?? null;
  const addQueryTab = useTabStore((s) => s.addQueryTab);

  const { theme, setTheme } = useTheme();

  // The connection whose schema tree is shown when in "schemas" mode.
  const [selectedConnId, setSelectedConnId] = useState<string | null>(() => {
    const firstConnected = connections.find(
      (c) => activeStatuses[c.id]?.type === "connected",
    );
    return firstConnected?.id ?? null;
  });

  // Auto-sync the selection to the active tab so opening a tab in a different
  // connection brings its schema into view.
  useEffect(() => {
    if (activeTabConnId && activeTabConnId !== selectedConnId) {
      setSelectedConnId(activeTabConnId);
      // Switching active tab implies the user wants to look at that
      // connection's data — flip to schemas mode for them.
      setMode("schemas");
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

  // Persist mode whenever it changes.
  useEffect(() => {
    try {
      window.localStorage.setItem(MODE_KEY, mode);
    } catch {
      // localStorage may be unavailable (privacy mode, quota)
    }
  }, [mode]);

  const {
    size: sidebarWidth,
    panelRef: sidebarRef,
    handleMouseDown: handleResizeMouseDown,
  } = useResizablePanel({
    axis: "horizontal",
    min: 220,
    max: 540,
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

  const selectedConnected =
    !!selectedConnId && activeStatuses[selectedConnId]?.type === "connected";

  // Right-side action buttons. New Connection + Import/Export are always
  // available so test/keyboard flows don't depend on the current mode. The
  // mode-context "+ Query" only appears in schemas mode.
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
            if (selectedConnected && selectedConnId) {
              addQueryTab(selectedConnId);
            }
          }}
        >
          <Plus />
          Query
        </Button>
      )}
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
    </div>
  );

  return (
    <>
      <div
        ref={sidebarRef}
        className="relative flex h-full shrink-0 select-none flex-col border-r border-border bg-secondary"
        style={{ width: sidebarWidth }}
      >
        {/* Mode toggle + context-aware action button */}
        <div className="flex items-center gap-2 border-b border-border px-2 py-2">
          <SidebarModeToggle mode={mode} onChange={setMode} />
          {renderActionButtons()}
        </div>

        {/* Header strip — shows the connection name in schemas mode and the
            current mode label otherwise. The data-testid is always rendered
            so e2e tests have a stable readiness sentinel. */}
        <div className="border-b border-border px-3 py-1.5">
          <span
            data-testid="sidebar-connection-header"
            className="block truncate text-xs font-semibold text-foreground"
          >
            {mode === "schemas"
              ? selectedConnId
                ? (connections.find((c) => c.id === selectedConnId)?.name ??
                  "Schemas")
                : "Schemas"
              : "Connections"}
          </span>
        </div>

        {/* Body — exclusive view */}
        <div className="flex flex-1 flex-col overflow-auto">
          {mode === "connections" ? (
            <ConnectionList
              selectedId={selectedConnId}
              onSelect={(id) => setSelectedConnId(id)}
              onActivate={(id) => {
                setSelectedConnId(id);
                setMode("schemas");
              }}
            />
          ) : (
            <SchemaPanel selectedId={selectedConnId} />
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
