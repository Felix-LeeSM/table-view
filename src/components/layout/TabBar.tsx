import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Table2, Code2, Network } from "lucide-react";
import {
  useActiveTabId,
  useCurrentTabs,
  useCurrentWorkspaceKey,
  useDirtyTabIds,
  useWorkspaceStore,
} from "@stores/workspaceStore";
import type { Tab, TableTab } from "@stores/workspaceStore";
import ConfirmDialog from "@components/ui/dialog/ConfirmDialog";
import TabItem from "./TabItem";
import { useTabDrag } from "./useTabDrag";
import { useTablistRoving } from "@components/shared/tablist/useTablistRoving";

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
  const { t } = useTranslation("layout");
  const tabs = useCurrentTabs();
  const activeTabId = useActiveTabId();
  const workspaceKey = useCurrentWorkspaceKey();
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const removeTab = useWorkspaceStore((s) => s.removeTab);
  const promoteTab = useWorkspaceStore((s) => s.promoteTab);
  const dirtyTabIds = useDirtyTabIds();

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

  // ArrowLeft/Right/Home/End roving nav across the open tabs (automatic
  // activation). Reuses `scrollRef` — it already wraps the `role="tablist"`
  // strip — as the focus lookup container.
  const roving = useTablistRoving(
    useMemo(() => tabs.map((tab) => tab.id), [tabs]),
    activeTabId,
    (id) => {
      if (!workspaceKey) return;
      setActiveTab(workspaceKey.connId, workspaceKey.db, id);
    },
    scrollRef,
  );

  const requestCloseTab = (tab: Tab) => {
    if (dirtyTabIds.includes(tab.id)) {
      setPendingClose(tab);
      return;
    }
    if (!workspaceKey) return;
    removeTab(workspaceKey.connId, workspaceKey.db, tab.id);
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
        aria-label={t("tabBar.openConnectionsAria")}
        className="flex flex-1 overflow-x-auto select-none"
        style={{ scrollbarWidth: "none" }}
        onKeyDown={roving.onKeyDown}
      >
        {tabs.map((tab) => {
          const displayTitle =
            tab.type === "erd"
              ? t("tabBar.erdTab", { db: tab.database })
              : tab.type === "table" &&
                  tab.table &&
                  !ambiguousTableNames.has(tab.table)
                ? tab.table
                : tab.title;
          return (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              isDirty={dirtyTabIds.includes(tab.id)}
              isDragging={draggingId === tab.id}
              displayTitle={displayTitle}
              onActivate={() => {
                // Suppress activation when a drag just ended — the click
                // event fires after pointerup, and a drag that lands on
                // the originating tab would otherwise re-activate it.
                if (shouldSuppressClick()) return;
                if (!workspaceKey) return;
                setActiveTab(workspaceKey.connId, workspaceKey.db, tab.id);
              }}
              onPromote={() => {
                if (tab.type === "table" && (tab as TableTab).isPreview) {
                  if (!workspaceKey) return;
                  promoteTab(workspaceKey.connId, workspaceKey.db, tab.id);
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
          title={t("tabBar.discardTitle")}
          message={t("tabBar.discardMessage", { title: pendingClose.title })}
          confirmLabel={t("tabBar.discardConfirm")}
          danger
          onConfirm={() => {
            const id = pendingClose.id;
            setPendingClose(null);
            if (!workspaceKey) return;
            removeTab(workspaceKey.connId, workspaceKey.db, id);
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
          ) : ghostStyle.type === "erd" ? (
            <Network size={12} className="shrink-0 text-muted-foreground" />
          ) : (
            <Table2 size={12} className="shrink-0 text-muted-foreground" />
          )}
          <span className="max-w-30 truncate">{ghostStyle.title}</span>
        </div>
      )}
    </div>
  );
}
