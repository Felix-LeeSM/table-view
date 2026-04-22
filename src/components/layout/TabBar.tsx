import { useEffect, useRef, useState } from "react";
import { X, Table2, Code2 } from "lucide-react";
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
  const moveTab = useTabStore((s) => s.moveTab);
  const connections = useConnectionStore((s) => s.connections);

  // Visual feedback states
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const [ghostStyle, setGhostStyle] = useState<{
    x: number;
    y: number;
    width: number;
    title: string;
    type: "table" | "query";
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll active tab into view when it changes (e.g. new tab added off-screen)
  useEffect(() => {
    if (!scrollRef.current || !activeTabId) return;
    const el = scrollRef.current.querySelector<HTMLElement>(
      `[data-tab-id="${activeTabId}"]`,
    );
    el?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [activeTabId]);

  // Ref for drag state — used in native DOM listeners (no stale closure issues)
  const dragStateRef = useRef<{
    tabId: string;
    startX: number;
    isDragging: boolean;
    offsetX: number;
    tabWidth: number;
    tabHeight: number;
    tabTitle: string;
    tabType: "table" | "query";
  } | null>(null);

  // Table names that appear in more than one open tab — these need schema prefix.
  const tableNames = tabs
    .filter((t): t is TableTab => t.type === "table" && !!t.table)
    .map((t) => t.table!);
  const ambiguousTableNames = new Set(
    tableNames.filter((name, idx) => tableNames.indexOf(name) !== idx),
  );

  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center border-b border-border bg-secondary select-none overflow-hidden">
      {/* Scrollable tab strip — hides native scrollbar across browsers */}
      <div
        ref={scrollRef}
        role="tablist"
        aria-label="Open connections"
        className="flex flex-1 overflow-x-auto select-none"
        style={{ scrollbarWidth: "none" }}
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
            } ${draggingId === tab.id ? "opacity-50" : ""}`}
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
              const rect = (
                e.currentTarget as HTMLElement
              ).getBoundingClientRect();
              dragStateRef.current = {
                tabId: tab.id,
                startX: e.clientX,
                isDragging: false,
                offsetX: e.clientX - rect.left,
                tabWidth: rect.width,
                tabHeight: rect.height,
                tabTitle:
                  tab.type === "table" &&
                  tab.table &&
                  !ambiguousTableNames.has(tab.table)
                    ? tab.table
                    : tab.title,
                tabType: tab.type,
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
                if (dragStateRef.current.isDragging) {
                  const { offsetX, tabWidth, tabHeight, tabTitle, tabType } =
                    dragStateRef.current;
                  setGhostStyle({
                    x: moveEvent.clientX - offsetX,
                    y: moveEvent.clientY - tabHeight / 2,
                    width: tabWidth,
                    title: tabTitle,
                    type: tabType,
                  });
                }
              };

              const handleMouseUp = () => {
                dragStateRef.current = null;
                setDraggingId(null);
                setGhostStyle(null);
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
                document.removeEventListener("mousemove", handleMouseMove);
                document.removeEventListener("mouseup", handleMouseUp);
              };

              document.addEventListener("mousemove", handleMouseMove);
              document.addEventListener("mouseup", handleMouseUp);
            }}
            onMouseUp={(e) => {
              const src = dragStateRef.current;
              if (src?.isDragging && src.tabId !== tab.id) {
                const rect = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect();
                const side =
                  e.clientX < rect.left + rect.width / 2 ? "before" : "after";
                moveTab(src.tabId, tab.id, side);
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
              {tab.type === "table" &&
              tab.table &&
              !ambiguousTableNames.has(tab.table)
                ? tab.table
                : tab.title}
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
      </div>

      {/* Drag ghost — follows cursor during tab drag */}
      {ghostStyle && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 flex items-center gap-1.5 rounded border border-border bg-background px-3 py-1.5 text-sm text-foreground opacity-90 shadow-md"
          style={{
            left: ghostStyle.x,
            top: ghostStyle.y,
            width: ghostStyle.width,
          }}
        >
          {ghostStyle.type === "query" ? (
            <Code2 size={12} className="shrink-0 text-muted-foreground" />
          ) : (
            <Table2 size={12} className="shrink-0 text-muted-foreground" />
          )}
          <span className="max-w-30 truncate">{ghostStyle.title}</span>
        </div>
      )}
    </div>
  );
}
