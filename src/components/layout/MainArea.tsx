import { useState, useEffect } from "react";
import TabBar from "./TabBar";
import type { TableTab, TabSubView } from "@stores/workspaceStore";
import {
  resolveActiveDb,
  useActiveTabId,
  useCurrentTabs,
  useCurrentWorkspaceKey,
  useWorkspaceStore,
} from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useMruStore } from "@stores/mruStore";
import { Plus } from "lucide-react";
import DataGrid from "@components/rdb/DataGrid";
import DocumentDataGrid from "@components/document/DocumentDataGrid";
import StructurePanel from "@components/schema/StructurePanel";
import ViewStructurePanel from "@components/schema/ViewStructurePanel";
import QueryTab from "@components/query/QueryTab";
import GlobalQueryLogPanel from "@components/query/GlobalQueryLogPanel";
import { Button } from "@components/ui/button";
import { Skeleton } from "@components/ui/skeleton";
import { LogoWordmark } from "@components/shared/Logo";
import { assertNever, type Paradigm } from "@/lib/paradigm";
import WorkspaceToolbar from "@components/workspace/WorkspaceToolbar";

interface TableTabProps {
  tab: TableTab;
  onSubViewChange: (subView: TabSubView) => void;
}

function TableTabView({ tab, onSubViewChange }: TableTabProps) {
  // Document-paradigm tabs bypass the Records/Structure sub-tabs (no
  // collection-structure inspector yet). Paradigm dispatch is wrapped in an
  // exhaustive switch so adding a new variant to the `Paradigm` union
  // surfaces a TypeScript error here.
  const paradigm: Paradigm = tab.paradigm ?? "rdb";

  switch (paradigm) {
    case "document":
      // Prefer the dedicated `database` / `collection` fields; fall back to
      // legacy `schema` / `table` aliasing for persisted tabs that predate
      // the migration in `loadPersistedTabs`.
      return (
        <div className="flex flex-1 flex-col overflow-hidden">
          <DocumentDataGrid
            connectionId={tab.connectionId}
            database={tab.database ?? tab.schema!}
            collection={tab.collection ?? tab.table!}
          />
        </div>
      );
    case "rdb":
    case "search":
    case "kv":
      return (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Sub-tab bar */}
          <div
            className="flex items-center border-b border-border bg-secondary"
            role="tablist"
            aria-label="Table view"
          >
            <button
              role="tab"
              aria-selected={tab.subView === "records"}
              tabIndex={tab.subView === "records" ? 0 : -1}
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                tab.subView === "records"
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-secondary-foreground"
              }`}
              onClick={() => onSubViewChange("records")}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  onSubViewChange(
                    tab.subView === "records" ? "structure" : "records",
                  );
                }
              }}
            >
              Records
            </button>
            <button
              role="tab"
              aria-selected={tab.subView === "structure"}
              tabIndex={tab.subView === "structure" ? 0 : -1}
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                tab.subView === "structure"
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-secondary-foreground"
              }`}
              onClick={() => onSubViewChange("structure")}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  onSubViewChange(
                    tab.subView === "structure" ? "records" : "structure",
                  );
                }
              }}
            >
              Structure
            </button>
          </div>

          {/* Content */}
          {tab.subView === "records" ? (
            <DataGrid
              connectionId={tab.connectionId}
              database={tab.database ?? ""}
              table={tab.table!}
              schema={tab.schema!}
              initialFilters={tab.initialFilters}
            />
          ) : tab.objectKind === "view" ? (
            <ViewStructurePanel
              connectionId={tab.connectionId}
              database={tab.database ?? ""}
              view={tab.table!}
              schema={tab.schema!}
            />
          ) : (
            <StructurePanel
              connectionId={tab.connectionId}
              database={tab.database ?? ""}
              table={tab.table!}
              schema={tab.schema!}
              initialSubTab={tab.initialStructureSubTab}
            />
          )}
        </div>
      );
    default:
      return assertNever(paradigm);
  }
}

/**
 * Sprint 270 — first-paint skeleton for the no-active-tab main area. Shape
 * mirrors the `EmptyState` welcome card (logo block + two message lines +
 * a CTA-sized button) so the post-hydrate swap doesn't reflow. `role="status"`
 * + `aria-busy="true"` keeps screen-reader users informed that the surface
 * is hydrating, not empty.
 */
function MainAreaSkeleton() {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6"
      role="status"
      aria-busy="true"
      aria-label="Loading workspace"
      data-testid="main-area-skeleton"
    >
      <Skeleton className="h-20 w-20" />
      <Skeleton className="h-4 w-3/5" />
      <Skeleton className="h-4 w-2/5" />
      <Skeleton className="mt-1 h-8 w-32" />
    </div>
  );
}

function EmptyState() {
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const lastUsedConnectionId = useMruStore((s) => s.lastUsedConnectionId);
  // MRU marking lives on each caller (not inside tabStore.addQueryTab) so
  // the CTA's single-action observable transition (click → new tab + MRU
  // shift) is preserved.
  const markConnectionUsed = useMruStore((s) => s.markConnectionUsed);
  const addQueryTab = useWorkspaceStore((s) => s.addQueryTab);

  // MRU-first policy with first-connected fallback. The MRU id is null on
  // first run (or after a reset); stale-MRU (the previously-used connection
  // is currently disconnected) also falls back to first-connected so the
  // CTA never points at a connection the user can't actually query.
  const mruConnection =
    lastUsedConnectionId !== null
      ? connections.find(
          (c) =>
            c.id === lastUsedConnectionId &&
            activeStatuses[c.id]?.type === "connected",
        )
      : undefined;
  const firstConnected = connections.find(
    (c) => activeStatuses[c.id]?.type === "connected",
  );
  const target = mruConnection ?? firstConnected;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-muted-foreground">
      <LogoWordmark className="h-20 w-auto" />
      {target ? (
        <>
          <p className="text-sm">
            Open a table from the sidebar, or start writing SQL against{" "}
            <span className="font-medium text-foreground">{target.name}</span>.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-1"
            onClick={() => {
              const db = resolveActiveDb(target.id);
              addQueryTab(target.id, db);
              markConnectionUsed(target.id);
            }}
          >
            <Plus />
            New Query
          </Button>
        </>
      ) : (
        <p className="text-sm">
          Select a connection from the sidebar to get started
        </p>
      )}
    </div>
  );
}

export default function MainArea() {
  const tabs = useCurrentTabs();
  const activeTabId = useActiveTabId();
  const workspaceKey = useCurrentWorkspaceKey();
  const setSubView = useWorkspaceStore((s) => s.setSubView);
  // Sprint 270 — gates the no-active-tab fallback between skeleton (pre-
  // hydrate) and `EmptyState` (post-hydrate). Once flipped to true the
  // skeleton never re-renders for the remainder of the session.
  const hasLoadedOnce = useConnectionStore((s) => s.hasLoadedOnce);
  const [showGlobalLog, setShowGlobalLog] = useState(false);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Listen for toggle-global-query-log custom event
  useEffect(() => {
    const handler = () => {
      setShowGlobalLog((prev) => !prev);
    };
    window.addEventListener("toggle-global-query-log", handler);
    return () => window.removeEventListener("toggle-global-query-log", handler);
  }, []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <WorkspaceToolbar />
      <TabBar />
      <div className="flex flex-1 overflow-hidden bg-background">
        {activeTab?.type === "table" &&
        (activeTab.table ?? activeTab.collection) &&
        (activeTab.schema ?? activeTab.database) ? (
          // Keying by `activeTab.id` forces React to unmount the previous
          // tab's grid and mount a fresh instance when the user swaps tabs.
          // Without this the same `useDataGridEdit` hook instance survives
          // the prop change and its locally-held `pendingEdits` Map leaks
          // across tabs — making the dirty marker flip onto the newly
          // focused tab.
          <TableTabView
            key={activeTab.id}
            tab={activeTab}
            onSubViewChange={(subView) => {
              if (!workspaceKey) return;
              setSubView(
                workspaceKey.connId,
                workspaceKey.db,
                activeTab.id,
                subView,
              );
            }}
          />
        ) : activeTab?.type === "query" ? (
          <QueryTab key={activeTab.id} tab={activeTab} />
        ) : hasLoadedOnce ? (
          <EmptyState />
        ) : (
          <MainAreaSkeleton />
        )}
      </div>
      <GlobalQueryLogPanel
        visible={showGlobalLog}
        onClose={() => setShowGlobalLog(false)}
      />
    </div>
  );
}
