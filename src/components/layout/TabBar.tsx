import { useEffect, useRef, useState } from "react";
import { X, Table2, Code2, Leaf } from "lucide-react";
import { useTabStore, type Tab, type TableTab } from "@stores/tabStore";
import { Button } from "@components/ui/button";
import ConfirmDialog from "@components/ui/dialog/ConfirmDialog";

export default function TabBar() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const removeTab = useTabStore((s) => s.removeTab);
  const promoteTab = useTabStore((s) => s.promoteTab);
  const moveTab = useTabStore((s) => s.moveTab);
  const dirtyTabIds = useTabStore((s) => s.dirtyTabIds);

  // Pending close confirmation. When the user attempts to close a dirty
  // tab via the close button or middle-click we stash the tab here and
  // surface ConfirmDialog; the actual `removeTab` only runs on `onConfirm`.
  // `onCancel` clears the pending state (the close is rejected).
  const [pendingClose, setPendingClose] = useState<Tab | null>(null);

  const requestCloseTab = (tab: Tab) => {
    if (dirtyTabIds.has(tab.id)) {
      setPendingClose(tab);
      return;
    }
    removeTab(tab.id);
  };

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
        // Sprint 253 (AC-253-04, ADR 0023, grill Q13): drop on the
        // strip's empty area (past the last tab, or the visual gap
        // between two tabs) — Chrome/VSCode standard. Without this
        // handler, only releases on the per-tab elements would reorder,
        // and a release in the empty trailing space silently no-ops.
        //
        // Bubble guard: per-tab onMouseUp calls e.stopPropagation(), so
        // this handler only fires for releases that did NOT land on a
        // [data-tab-id] descendant. As a defense-in-depth check, we also
        // verify dragStateRef.isDragging — if drag never started (mouse
        // up without prior mouse down threshold-cross), this is a no-op.
        onMouseUp={(e) => {
          const src = dragStateRef.current;
          if (!src?.isDragging) return;
          const container = e.currentTarget as HTMLElement;
          const tabEls = Array.from(
            container.querySelectorAll<HTMLElement>("[data-tab-id]"),
          );
          if (tabEls.length === 0) return;
          const cursorX = e.clientX;
          // Past the last tab's right edge → insert source after the
          // last tab (= move to end). This matches the natural "drop in
          // the trailing space" UX.
          const lastEl = tabEls[tabEls.length - 1]!;
          const lastRect = lastEl.getBoundingClientRect();
          let targetEl: HTMLElement;
          let side: "before" | "after";
          if (cursorX >= lastRect.right) {
            targetEl = lastEl;
            side = "after";
          } else {
            // Otherwise, find the first tab whose midpoint is ≥ cursor X
            // and insert before it. Falls through to the last tab if no
            // midpoint comparison matches (defensive — shouldn't happen
            // because we already handled "past last tab" above).
            const found = tabEls.find((el) => {
              const r = el.getBoundingClientRect();
              return r.left + r.width / 2 >= cursorX;
            });
            targetEl = found ?? lastEl;
            side = "before";
          }
          const targetId = targetEl.getAttribute("data-tab-id");
          if (!targetId || targetId === src.tabId) return;
          moveTab(src.tabId, targetId, side);
        }}
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            data-tab-id={tab.id}
            data-preview={
              tab.type === "table" && (tab as TableTab).isPreview
                ? "true"
                : undefined
            }
            aria-selected={tab.id === activeTabId}
            tabIndex={tab.id === activeTabId ? 0 : -1}
            // Compact tab metrics. `py-1 text-sm` keeps the row ≤ 32px
            // (≈20px line-height + 8px padding + 1px border) while leaving
            // the close button (`size-6` = 24px) inside a comfortable hit
            // target. `text-xs` would tighten things further but drop the
            // close button below the ADR 0008 accessibility floor.
            className={`group relative flex items-center gap-1.5 border-r border-border pl-3 pr-3 py-1 text-sm cursor-pointer select-none transition-opacity ${
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
                requestCloseTab(tab);
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
              // Sprint 253 (AC-253-05) — stop bubble so the strip-level
              // onMouseUp (empty-area handler) does not also reorder on
              // a release that already landed on a tab. Without this,
              // both handlers would fire (per-tab first, strip on bubble)
              // and the strip's cursor-X resolution might pick the same
              // tab again, double-invoking moveTab and corrupting order.
              e.stopPropagation();
            }}
          >
            {tab.type === "query" ? (
              <Code2 size={12} className="shrink-0 text-muted-foreground" />
            ) : (
              <Table2 size={12} className="shrink-0 text-muted-foreground" />
            )}
            {tab.paradigm === "document" && (
              <Leaf
                size={10}
                className="shrink-0 text-muted-foreground"
                aria-label={
                  tab.type === "table"
                    ? "MongoDB collection tab"
                    : "MongoDB query tab"
                }
              />
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
            {dirtyTabIds.has(tab.id) && (
              <span
                aria-label="Unsaved changes"
                data-dirty="true"
                title="Unsaved changes"
                className="size-1.5 shrink-0 rounded-full bg-primary"
              />
            )}
            {tab.closable && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Close ${tab.title}`}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  requestCloseTab(tab);
                }}
              >
                <X size={12} />
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Dirty-close gate. Mounted only while a close attempt on a dirty
          tab is pending; `onConfirm` discards the unsaved diff by removing
          the tab (grid pending state is tab-local and dies with it),
          `onCancel` aborts the close. */}
      {pendingClose && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          message={`"${pendingClose.title}" has unsaved changes. Closing the tab will discard them.`}
          confirmLabel="Discard and close"
          danger
          onConfirm={() => {
            const id = pendingClose.id;
            setPendingClose(null);
            removeTab(id);
          }}
          onCancel={() => setPendingClose(null)}
        />
      )}

      {/* Drag ghost — follows cursor during tab drag */}
      {ghostStyle && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 flex items-center gap-1.5 rounded border border-border bg-background px-3 py-1 text-sm text-foreground opacity-90 shadow-md"
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
