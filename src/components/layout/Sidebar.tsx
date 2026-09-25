import { Button } from "@components/ui/button";
import WorkspaceSidebar from "@components/workspace/WorkspaceSidebar";
import { useCurrentWindowConnectionId } from "@hooks/useCurrentWindowConnectionId";
import { useResizablePanel } from "@hooks/useResizablePanel";
import { getSidebarObjectLabel } from "@lib/dbTypeLabels";
import { logger } from "@lib/logger";
import { persistSettingValue, resetSetting } from "@lib/tauri/settings";
import { useConnectionStore } from "@stores/connectionStore";
import { useMruStore } from "@stores/mruStore";
import { useSchemaStore } from "@stores/schemaStore";
import { resolveActiveDb, useWorkspaceStore } from "@stores/workspaceStore";
import { FoldVertical, Plus, RotateCcw, UnfoldVertical } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { SchemaInfo } from "@/types/schema";

// Q20.2 — `table-view.sidebar.width` localStorage persistence is dropped. If
// a boot snapshot later hydrates `settings.sidebar_width`, that value becomes
// the initial width. Today the width starts at the default and only commits
// over IPC 500ms after the drag mouseup.
// #1737 — stable empty ref so the schema-slot selector below doesn't churn
// re-renders when the focused connection has no cached schemas yet.
const EMPTY_SCHEMAS: readonly SchemaInfo[] = Object.freeze([]);

const MIN_WIDTH = 220;
const MAX_WIDTH = 540;
const DEFAULT_WIDTH = 280;
const PERSIST_DEBOUNCE_MS = 500;

/**
 * Workspace Sidebar — schema/work surface column shown on `WorkspacePage`.
 * Connection management lives on the dedicated `HomePage` / launcher window.
 *
 * Cmd+N in a workspace window now opens a raw query tab, so this component's
 * `new-connection` listener and the embedded `ConnectionDialog` mount were
 * removed. A user who wants a new connection goes through the launcher window
 * (Cmd+, or reopening the dock icon).
 */
export default function Sidebar() {
  const { t } = useTranslation("layout");
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  // Q15 — Sidebar lives in the workspace window only (see top-of-file
  // docstring). The window's connection identity is derived from its Tauri
  // label (`workspace-{connection_id}`) rather than from the cross-window
  // `focusedConnId` slot, which is launcher-only.
  // `useCurrentWindowConnectionId()` returns `null` when the hook runs
  // outside a workspace window (jsdom tests, or theoretical launcher
  // mount) — the rest of the component already handles that null case.
  const focusedConnId = useCurrentWindowConnectionId();
  const addQueryTab = useWorkspaceStore((s) => s.addQueryTab);
  const setExpanded = useWorkspaceStore((s) => s.setExpanded);
  // MRU marking lives on each caller (not inside tabStore.addQueryTab) —
  // the "+ Query" button explicitly marks the focused connection used so
  // the launcher Recent rail / EmptyState CTA reflect the user's continued
  // engagement with the connection.
  const markConnectionUsed = useMruStore((s) => s.markConnectionUsed);

  // #1738 (2026-07-25) — theme/language controls moved out of here into a
  // single place, and the system-mode subscription that backed them moved to
  // `WorkspacePage`. #2431 then moved the controls again, to `AppearanceButton`
  // in the workspace toolbar. The sidebar footer renders no theme popover.

  // Q15 — Removed the two `setFocusedConn` effects ("focus active tab's
  // conn" + "heal vanished focus") that previously wrote to the cross-window
  // `focusedConnId` slot from a workspace window. Both are incoherent: each
  // workspace window is pinned to one connection via its Tauri label, so (a)
  // the active tab's conn always matches the window's by construction, and
  // (b) a vanished connection means the window itself should close — not a
  // silent reassignment to a sibling connection (which would surprise the
  // user). Strategy doc line 1656 requires "zero set calls from the
  // workspace"; keeping these as dead writes propagates to the launcher slot
  // via the cross-window IPC bridge and races with the user's own launcher
  // selection.

  const {
    size: sidebarWidth,
    panelRef: sidebarRef,
    handleMouseDown: handleResizeMouseDown,
    handleKeyDown: handleResizeKeyDown,
    min: sidebarMinWidth,
    max: sidebarMaxWidth,
  } = useResizablePanel({
    axis: "horizontal",
    min: MIN_WIDTH,
    max: MAX_WIDTH,
    initial: DEFAULT_WIDTH,
  });

  // Q20.2 — commits `set_setting("sidebar_width", N)` over IPC on a 500ms
  // debounce after the drag mouseup. mousemove during a drag is a DOM-only
  // update on useResizablePanel's hot path, so this effect only fires right
  // after the commit (mouseup → state set) — meaning "another drag within
  // 500ms of the end of the previous one collapses into a single IPC call".
  // AC-369-12.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialPersistSkippedRef = useRef(false);
  useEffect(() => {
    // Skip the very first effect run (mount with the default width) — IPC
    // shouldn't fire just because the component mounted. Subsequent updates
    // (mouseup commit) trigger the debounced persist.
    if (!initialPersistSkippedRef.current) {
      initialPersistSkippedRef.current = true;
      return;
    }
    if (persistTimerRef.current !== null) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => {
      void persistSettingValue("sidebar_width", sidebarWidth).catch(() => {
        /* best-effort — next drag retries */
      });
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (persistTimerRef.current !== null) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [sidebarWidth]);

  // Q21 #3-a — Sidebar handle "Reset width". Same backend IPC as the
  // Settings panel's "Reset sidebar width" (Q21 #3-b) — the receiver applies
  // the frontend default. The local window's useResizablePanel is not reset
  // here; the next setting.reset event arriving at this same window
  // (self-echo) is intentionally ignored, because the dispatcher's self-echo
  // skip path means the local panel's width stays at the user's last drag
  // value until they explicitly drag again. Acceptable for #3-a (the
  // cross-window listeners still get the row-delete event); a local "apply
  // default width" path can be wired later if user feedback demands.
  const handleResetSidebarWidth = useCallback(() => {
    void resetSetting("sidebar_width").catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e ?? "");
      logger.warn(`[Sidebar] reset_setting(sidebar_width) failed: ${message}`);
    });
  }, []);

  // Q21 #7 — header "Collapse all". Empties the active workspace's
  // sidebar.expanded list. The workspace persist pipeline (SQLite write)
  // carries the change to other windows on the same connection_id.
  //
  // The single button exposes the object name that fits the DB type
  // (schemas / tables / collections) and toggles.
  const handleCollapseAll = useCallback(() => {
    if (!focusedConnId) return;
    const db = resolveActiveDb(focusedConnId);
    setExpanded(focusedConnId, db, []);
  }, [focusedConnId, setExpanded]);

  // #1737 — currently-cached schema list for the focused (connId, db).
  // Subscribed via selector (not getState) so the component stays within the
  // no-restricted-syntax store rule; the slot's array ref only changes when
  // schemas load, so this is not a hot-path subscription.
  const focusedSchemas = useSchemaStore((s) => {
    if (!focusedConnId) return EMPTY_SCHEMAS;
    const db = resolveActiveDb(focusedConnId);
    return s.schemas[focusedConnId]?.[db] ?? EMPTY_SCHEMAS;
  });

  // #1737 — "Expand all", implementing what was left as a no-op stub.
  // Expands only the loaded scope: fills sidebar.expanded with every schema
  // name cached for this (connId, db). SchemaTree keys on the bare schema
  // name via `expandedSchemas.has(schema.name)` (treeRows.getVisibleRows +
  // useSchemaTreeActions.handleExpandSchema), so the same rule is reused here
  // — nodeIdToString is not used (the tree would fail to match and the data
  // would be invalid). Unloaded children are not eagerly fetched: changing
  // the expanded set drives the tree's reconciliation effect
  // (useSchemaTreeActions #1219), which lazy-loads each schema, so collapsed
  // schemas stay unfetched.
  const handleExpandAll = useCallback(() => {
    if (!focusedConnId || focusedSchemas.length === 0) return;
    const db = resolveActiveDb(focusedConnId);
    setExpanded(
      focusedConnId,
      db,
      focusedSchemas.map((s) => s.name),
    );
  }, [focusedConnId, focusedSchemas, setExpanded]);

  // Branches the toggle label / click handler on the current state of
  // sidebar.expanded. Uses only the safe read path (no focusedConnId is
  // treated as an empty workspace → "Expand" label + disabled).
  // #1447 — select the primitive count (not the whole `workspaces` map): a
  // whole-map subscription re-rendered the entire sidebar tree on every
  // editor keystroke (`updateQuerySql` replaces the map identity).
  const expandedCount = useWorkspaceStore((s) => {
    if (!focusedConnId) return 0;
    const db = resolveActiveDb(focusedConnId);
    return s.workspaces[focusedConnId]?.[db]?.sidebar.expanded?.length ?? 0;
  });
  const focusedDbType = useMemo(() => {
    if (!focusedConnId) return null;
    return connections.find((c) => c.id === focusedConnId)?.dbType ?? null;
  }, [focusedConnId, connections]);
  const sidebarObjectPlural = useMemo(() => {
    if (!focusedDbType) return "schemas";
    return getSidebarObjectLabel(focusedDbType).plural;
  }, [focusedDbType]);
  const isAllCollapsed = expandedCount === 0;
  const toggleLabel = isAllCollapsed
    ? t("sidebar.expandAll", { objectPlural: sidebarObjectPlural })
    : t("sidebar.collapseAll", { objectPlural: sidebarObjectPlural });
  const ToggleIcon = isAllCollapsed ? UnfoldVertical : FoldVertical;
  const handleToggleExpansion = useCallback(() => {
    if (!focusedConnId) return;
    // #1737 — Collapse path empties the expanded array; expand path fills it
    // with every currently-loaded schema name (loaded scope only).
    if (isAllCollapsed) {
      handleExpandAll();
    } else {
      handleCollapseAll();
    }
  }, [focusedConnId, isAllCollapsed, handleCollapseAll, handleExpandAll]);

  // New-connection creation happens on the launcher window (HomePage);
  // the `connections` effect above heals focus when the new connection
  // lands in the store.

  const selectedConnected =
    !!focusedConnId && activeStatuses[focusedConnId]?.type === "connected";

  return (
    <div
      ref={sidebarRef}
      className="relative flex h-full shrink-0 select-none flex-col border-r border-border bg-secondary"
      style={{ width: sidebarWidth }}
    >
      {/* Header strip — connection name + "+ Query" action. data-testid is
            kept stable for e2e tests (`sidebar-connection-header`).

            Q21 #7 — a visible "Collapse all" button in the header. Q21's
            intuitive-placement contract — a visible button instead of a
            right-click menu, so keyboard users can find it. */}
      <div className="flex items-center justify-between border-b border-border py-1 pl-3 pr-1">
        <span
          data-testid="sidebar-connection-header"
          className="block truncate text-xs font-semibold text-foreground"
        >
          {focusedConnId
            ? (connections.find((c) => c.id === focusedConnId)?.name ??
              t("sidebar.schemasLabel"))
            : t("sidebar.schemasLabel")}
        </span>
        <div className="flex items-center gap-1">
          {/* Object name per DB type + toggle. PG → schemas,
                MySQL/SQLite → tables, Mongo → collections. When expanded is
                empty the same button switches to the "Expand all *" label.
                #1737 — the expand path fills from the loaded schema cache. */}
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-secondary-foreground"
            aria-label={toggleLabel}
            title={toggleLabel}
            disabled={!focusedConnId}
            onClick={handleToggleExpansion}
            data-testid="sidebar-collapse-all"
          >
            <ToggleIcon />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0 text-muted-foreground hover:text-secondary-foreground"
            aria-label={t("sidebar.newQueryTabAria")}
            title={t("sidebar.newQueryTabAria")}
            disabled={!selectedConnected}
            onClick={() => {
              if (selectedConnected && focusedConnId) {
                const db = resolveActiveDb(focusedConnId);
                addQueryTab(focusedConnId, db);
                markConnectionUsed(focusedConnId);
              }
            }}
          >
            <Plus />
            {t("sidebar.query")}
          </Button>
        </div>
      </div>

      {/* Body — paradigm-aware sidebar slot. `WorkspaceSidebar` resolves
            the driving connection with active-tab priority and falls back
            to `focusedConnId`. */}
      <div className="flex flex-1 flex-col overflow-auto">
        <WorkspaceSidebar selectedId={focusedConnId} />
      </div>

      {/* Sidebar footer. #1738 (2026-07-25) — the duplicate theme popover +
            LanguageSwitcher were removed from here; theme/language live in a
            single place, which #2431 moved on to `AppearanceButton` in the
            workspace toolbar. Only the "Reset width" affordance remains. */}
      <div className="border-t border-border px-3 py-2">
        {/* Q21 #3-a — a visible "Reset sidebar width" button. Placed
              intuitively (bottom of the sidebar, visually near the drag
              handle) instead of in a right-click context menu. */}
        <Button
          variant="ghost"
          size="xs"
          type="button"
          className="mt-1 w-full justify-start text-muted-foreground"
          aria-label={t("sidebar.resetWidthAria")}
          title={t("sidebar.resetWidthTitle")}
          onClick={handleResetSidebarWidth}
          data-testid="sidebar-reset-width"
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
          <span className="ml-1 text-3xs">{t("sidebar.resetWidth")}</span>
        </Button>
      </div>

      {/* Resize handle.
            Double-click = width reset. `handleResetSidebarWidth` is the
            Q21 #3-a IPC wrapper (`reset_setting("sidebar_width")`). A single
            click / drag-start only triggers mousedown, so it is independent
            of the reset. */}
      <div
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/90 active:bg-primary/90 focus-visible:outline-1 focus-visible:outline-ring"
        onMouseDown={handleResizeMouseDown}
        onKeyDown={handleResizeKeyDown}
        onDoubleClick={handleResetSidebarWidth}
        tabIndex={0}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("sidebar.resizeAria")}
        aria-valuemin={sidebarMinWidth}
        aria-valuemax={sidebarMaxWidth}
        aria-valuenow={Math.round(sidebarWidth)}
      />
    </div>
  );
}
