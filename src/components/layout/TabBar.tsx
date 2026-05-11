import { useEffect, useState } from "react";
import { Table2, Code2 } from "lucide-react";
import { useTabStore, type Tab, type TableTab } from "@stores/tabStore";
import ConfirmDialog from "@components/ui/dialog/ConfirmDialog";
import TabItem from "./TabItem";
import { useTabDrag } from "./useTabDrag";

/**
 * 2026-05-11 — split into `useTabDrag` (pointer-capture-backed drag
 * orchestration) + presentational `TabItem` + this thin composer. The
 * shell owns:
 *   - the dirty-close confirm dialog
 *   - active-tab scroll-into-view
 *   - same-name table disambiguation across open tabs
 *   - the drag ghost overlay (positioned via `useTabDrag.ghostStyle`)
 *
 * The per-tab markup + every pointer / keyboard handler lives in
 * `TabItem`; drag state + reorder math lives in `useTabDrag`.
 */
export default function TabBar() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const removeTab = useTabStore((s) => s.removeTab);
  const promoteTab = useTabStore((s) => s.promoteTab);
  const dirtyTabIds = useTabStore((s) => s.dirtyTabIds);

  const {
    scrollRef,
    draggingId,
    ghostStyle,
    getDragHandlers,
    shouldSuppressClick,
  } = useTabDrag();

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

  // Scroll active tab into view when it changes (e.g. new tab added off-screen)
  useEffect(() => {
    if (!scrollRef.current || !activeTabId) return;
    const el = scrollRef.current.querySelector<HTMLElement>(
      `[data-tab-id="${activeTabId}"]`,
    );
    el?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [activeTabId, scrollRef]);

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
        {tabs.map((tab) => {
          const displayTitle =
            tab.type === "table" &&
            tab.table &&
            !ambiguousTableNames.has(tab.table)
              ? tab.table
              : tab.title;
          return (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              isDirty={dirtyTabIds.has(tab.id)}
              isDragging={draggingId === tab.id}
              displayTitle={displayTitle}
              onActivate={() => {
                // Suppress activation when a drag just ended — the click
                // event fires after pointerup, and a drag that lands on
                // the originating tab would otherwise re-activate it.
                if (shouldSuppressClick()) return;
                setActiveTab(tab.id);
              }}
              onPromote={() => {
                if (tab.type === "table" && (tab as TableTab).isPreview) {
                  promoteTab(tab.id);
                }
              }}
              onRequestClose={() => requestCloseTab(tab)}
              dragHandlers={getDragHandlers(tab, displayTitle)}
            />
          );
        })}
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
