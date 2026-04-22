import { useRef, useState } from "react";
import { X, Table2, Code2, Plus } from "lucide-react";
import { useTabStore, type TableTab } from "@stores/tabStore";
import { useConnectionStore } from "@stores/connectionStore";
import { Button } from "@components/ui/button";
import { getConnectionColor } from "@lib/connectionColor";

export default function TabBar() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const removeTab = useTabStore((s) => s.removeTab);
  const promoteTab = useTabStore((s) => s.promoteTab);
  const addQueryTab = useTabStore((s) => s.addQueryTab);
  const moveTab = useTabStore((s) => s.moveTab);
  const connections = useConnectionStore((s) => s.connections);

  // Visual feedback states
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Ref for drag state — used in native DOM listeners (no stale closure issues)
  const dragStateRef = useRef<{
    tabId: string;
    startX: number;
    isDragging: boolean;
  } | null>(null);

  // Find the connectionId from the active tab to use for new query tabs.
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeConnectionId = activeTab?.connectionId ?? "";

  if (tabs.length === 0) return null;

  return (
    <div
      className="flex items-center border-b border-border bg-secondary select-none"
      role="tablist"
      aria-label="Open connections"
    >
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          data-tab-id={tab.id}
          aria-selected={tab.id === activeTabId}
          tabIndex={tab.id === activeTabId ? 0 : -1}
          className={`group relative flex items-center gap-1.5 border-r border-border pl-3 pr-3 py-1.5 text-sm cursor-pointer select-none transition-opacity ${
            tab.id === activeTabId
              ? "bg-background text-foreground border-b-2 border-b-primary"
              : "text-secondary-foreground hover:bg-muted"
          } ${draggingId === tab.id ? "opacity-50" : ""} ${
            dragOverId === tab.id && draggingId !== tab.id
              ? "ring-2 ring-inset ring-primary/60"
              : ""
          }`}
          onClick={() => setActiveTab(tab.id)}
          onDoubleClick={() => {
            if (tab.type === "table" && (tab as TableTab).isPreview) {
              promoteTab(tab.id);
            }
          }}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              removeTab(tab.id);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setActiveTab(tab.id);
            }
          }}
          // Mouse-based drag reorder — more reliable than HTML5 DnD in WKWebView
          onMouseDown={(e) => {
            if (e.button !== 0) return; // primary button only
            dragStateRef.current = {
              tabId: tab.id,
              startX: e.clientX,
              isDragging: false,
            };

            const handleMouseMove = (moveEvent: MouseEvent) => {
              if (!dragStateRef.current) return;
              const dx = Math.abs(
                moveEvent.clientX - dragStateRef.current.startX,
              );
              if (dx > 4 && !dragStateRef.current.isDragging) {
                dragStateRef.current.isDragging = true;
                setDraggingId(dragStateRef.current.tabId);
                document.body.style.cursor = "grabbing";
                document.body.style.userSelect = "none";
              }
            };

            const handleMouseUp = () => {
              dragStateRef.current = null;
              setDraggingId(null);
              setDragOverId(null);
              document.body.style.cursor = "";
              document.body.style.userSelect = "";
              document.removeEventListener("mousemove", handleMouseMove);
              document.removeEventListener("mouseup", handleMouseUp);
            };

            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
          }}
          onMouseEnter={() => {
            if (
              dragStateRef.current?.isDragging &&
              dragStateRef.current.tabId !== tab.id
            ) {
              setDragOverId(tab.id);
            }
          }}
          onMouseLeave={() => {
            if (dragStateRef.current?.isDragging) {
              setDragOverId(null);
            }
          }}
          onMouseUp={() => {
            const src = dragStateRef.current;
            if (src?.isDragging && src.tabId !== tab.id) {
              moveTab(src.tabId, tab.id);
            }
          }}
        >
          {(() => {
            const conn = connections.find((c) => c.id === tab.connectionId);
            if (!conn) return null;
            const color = getConnectionColor(conn);
            const isActive = tab.id === activeTabId;
            return (
              <span
                className={`absolute inset-y-0 left-0 w-0.5 ${
                  isActive ? "opacity-100" : "opacity-60"
                }`}
                style={{ backgroundColor: color }}
                aria-label="Connection color"
                title={conn.name}
              />
            );
          })()}
          {tab.type === "query" ? (
            <Code2 size={12} className="shrink-0 text-muted-foreground" />
          ) : (
            <Table2 size={12} className="shrink-0 text-muted-foreground" />
          )}
          <span
            className={`max-w-30 truncate${tab.type === "table" && (tab as TableTab).isPreview ? " italic opacity-70" : ""}`}
          >
            {tab.title}
          </span>
          {tab.closable && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Close ${tab.title}`}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                removeTab(tab.id);
              }}
            >
              <X size={12} />
            </Button>
          )}
        </div>
      ))}

      {/* New query tab button */}
      {activeConnectionId && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-secondary-foreground"
          aria-label="New Query Tab"
          title="New Query Tab"
          onClick={() => addQueryTab(activeConnectionId)}
        >
          <Plus size={14} />
        </Button>
      )}
    </div>
  );
}
