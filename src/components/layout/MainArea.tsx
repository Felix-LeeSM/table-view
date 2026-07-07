import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
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
import {
  MongoStructurePanel,
  type MongoStructureSubTab,
} from "@components/document/MongoStructurePanel";
import {
  SchemaErdPanel,
  StructurePanel,
  ViewStructurePanel,
} from "@features/catalog";
import QueryTab from "@components/query/QueryTab";
import GlobalQueryLogPanel from "@components/query/GlobalQueryLogPanel";
import { Button } from "@components/ui/button";
import { Skeleton } from "@components/ui/skeleton";
import { LogoWordmark } from "@components/shared/Logo";
import ErrorBoundary from "@components/shared/ErrorBoundary";
import SearchIndexDetailPanel from "@components/search/SearchIndexDetailPanel";
import KvKeyDetailPanel from "@components/workspace/KvKeyDetailPanel";
import { assertNever, type Paradigm } from "@/lib/paradigm";
import { getDataSourceProfile } from "@/types/dataSource";
import WorkspaceToolbar from "@components/workspace/WorkspaceToolbar";
import { useTablistRoving } from "@components/shared/tablist/useTablistRoving";

interface TableTabProps {
  tab: TableTab;
  onSubViewChange: (subView: TabSubView) => void;
}

function TableTabView({ tab, onSubViewChange }: TableTabProps) {
  const { t } = useTranslation("layout");
  // Paradigm dispatch is wrapped in an exhaustive switch so adding a new
  // variant to the `Paradigm` union surfaces a TypeScript error here.
  const paradigm: Paradigm = tab.paradigm ?? "rdb";

  // Owned here (not in `MongoStructurePanel`) so the user's inner
  // Indexes/Validator pick survives an outer Records ↔ Structure
  // remount. `TableTabView` is keyed by `activeTab.id` upstream, so this
  // state outlives outer-toggle re-renders and only resets when the
  // user closes/swaps the tab itself.
  const [mongoStructureSubTab, setMongoStructureSubTab] =
    useState<MongoStructureSubTab>("indexes");

  // #1042 — the ERD sub-tab is gated on the `intelligence.erd` capability
  // (single source of truth), not on `paradigm === "rdb"`. DuckDB is an rdb
  // paradigm but a read-only file-analytics engine that declares
  // `intelligence.erd = false`, so it must not carry an ERD tab.
  // ponytail: no-connection fallback keeps the paradigm default — a live
  // table tab always carries a connection, so this only guards test/edge
  // states where the connection isn't in the store.
  const connection = useConnectionStore((s) =>
    s.connections.find((c) => c.id === tab.connectionId),
  );
  const erdCapable = connection
    ? getDataSourceProfile(connection.dbType).capabilities.intelligence.erd
    : paradigm === "rdb";

  // Shared roving nav for whichever sub-tab bar this paradigm renders. Only
  // ERD-capable rdb sources carry the ERD tab; mongo/kv are records/structure
  // only. One unconditional hook call drives the single tablist the active
  // branch mounts.
  const subTabBarRef = useRef<HTMLDivElement>(null);
  const subViewValues: TabSubView[] = erdCapable
    ? ["records", "structure", "erd"]
    : ["records", "structure"];
  const subTabRoving = useTablistRoving(
    subViewValues,
    tab.subView,
    onSubViewChange,
    subTabBarRef,
  );

  switch (paradigm) {
    case "document": {
      // Prefer the dedicated `database` / `collection` fields; fall back to
      // legacy `schema` / `table` aliasing for persisted tabs that predate
      // the migration in `loadPersistedTabs`.
      const database = tab.database ?? tab.schema ?? "";
      const collection = tab.collection ?? tab.table ?? "";
      return (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div
            ref={subTabBarRef}
            className="flex items-center border-b border-border bg-secondary"
            role="tablist"
            aria-label={t("mainArea.mongoCollectionViewAria")}
            data-testid="mongo-table-subtab-bar"
            onKeyDown={subTabRoving.onKeyDown}
          >
            <button
              role="tab"
              id="tab-mongo-records"
              data-tab-value="records"
              aria-controls="tabpanel-mongo-records"
              aria-selected={tab.subView === "records"}
              tabIndex={tab.subView === "records" ? 0 : -1}
              className={`px-4 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                tab.subView === "records"
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-secondary-foreground"
              }`}
              onClick={() => onSubViewChange("records")}
            >
              {t("mainArea.records")}
            </button>
            <button
              role="tab"
              id="tab-mongo-structure"
              data-tab-value="structure"
              aria-controls="tabpanel-mongo-structure"
              aria-selected={tab.subView === "structure"}
              tabIndex={tab.subView === "structure" ? 0 : -1}
              className={`px-4 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                tab.subView === "structure"
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-secondary-foreground"
              }`}
              onClick={() => onSubViewChange("structure")}
            >
              {t("mainArea.structure")}
            </button>
          </div>

          {tab.subView === "records" ? (
            <div
              role="tabpanel"
              id="tabpanel-mongo-records"
              aria-labelledby="tab-mongo-records"
              tabIndex={0}
              className="flex flex-1 flex-col overflow-hidden"
            >
              <DocumentDataGrid
                connectionId={tab.connectionId}
                database={database}
                collection={collection}
              />
            </div>
          ) : (
            <div
              role="tabpanel"
              id="tabpanel-mongo-structure"
              aria-labelledby="tab-mongo-structure"
              tabIndex={0}
              className="flex flex-1 flex-col overflow-hidden"
            >
              <MongoStructurePanel
                connectionId={tab.connectionId}
                database={database}
                collection={collection}
                active={mongoStructureSubTab}
                onActiveChange={setMongoStructureSubTab}
              />
            </div>
          )}
        </div>
      );
    }
    case "search": {
      const index = tab.table ?? "";
      return (
        <SearchIndexDetailPanel connectionId={tab.connectionId} index={index} />
      );
    }
    case "kv": {
      // KV key tabs carry the numeric Redis DB index in `database` (its string
      // form; also mirrored to `schema` so the MainArea render gate passes).
      const database = Number.parseInt(tab.database ?? tab.schema ?? "0", 10);
      return (
        <KvKeyDetailPanel
          connectionId={tab.connectionId}
          database={Number.isFinite(database) ? database : 0}
          keyName={tab.table ?? ""}
        />
      );
    }
    case "rdb":
      return (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Sub-tab bar */}
          <div
            ref={subTabBarRef}
            className="flex items-center border-b border-border bg-secondary"
            role="tablist"
            aria-label={t("mainArea.tableViewAria")}
            onKeyDown={subTabRoving.onKeyDown}
          >
            <button
              role="tab"
              id="tab-rdb-records"
              data-tab-value="records"
              aria-controls="tabpanel-rdb-records"
              aria-selected={tab.subView === "records"}
              tabIndex={tab.subView === "records" ? 0 : -1}
              className={`px-4 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                tab.subView === "records"
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-secondary-foreground"
              }`}
              onClick={() => onSubViewChange("records")}
            >
              {t("mainArea.records")}
            </button>
            <button
              role="tab"
              id="tab-rdb-structure"
              data-tab-value="structure"
              aria-controls="tabpanel-rdb-structure"
              aria-selected={tab.subView === "structure"}
              tabIndex={tab.subView === "structure" ? 0 : -1}
              className={`px-4 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                tab.subView === "structure"
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-secondary-foreground"
              }`}
              onClick={() => onSubViewChange("structure")}
            >
              {t("mainArea.structure")}
            </button>
            {erdCapable && (
              <button
                role="tab"
                id="tab-rdb-erd"
                data-tab-value="erd"
                aria-controls="tabpanel-rdb-erd"
                aria-selected={tab.subView === "erd"}
                tabIndex={tab.subView === "erd" ? 0 : -1}
                className={`px-4 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                  tab.subView === "erd"
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground hover:text-secondary-foreground"
                }`}
                onClick={() => onSubViewChange("erd")}
              >
                {t("mainArea.erd")}
              </button>
            )}
          </div>

          {/* Content — one tabpanel per active subView, wired to the tab of
              the same name (records / structure / erd). `structure` covers
              both the view and table branches; both are the Structure tab's
              panel. */}
          <div
            role="tabpanel"
            id={`tabpanel-rdb-${tab.subView}`}
            aria-labelledby={`tab-rdb-${tab.subView}`}
            tabIndex={0}
            className="flex flex-1 flex-col overflow-hidden"
          >
            {tab.subView === "erd" && erdCapable ? (
              <SchemaErdPanel
                connectionId={tab.connectionId}
                database={tab.database ?? ""}
              />
            ) : tab.subView === "records" ? (
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
  const { t } = useTranslation("layout");
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6"
      role="status"
      aria-busy="true"
      aria-label={t("mainArea.loadingWorkspaceAria")}
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
  const { t } = useTranslation("layout");
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
  const emptyStateLead =
    target?.paradigm === "kv"
      ? t("mainArea.emptyKvLead", {
          dbLabel: target.dbType === "valkey" ? "Valkey" : "Redis",
        })
      : t("mainArea.emptyTableLead");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-muted-foreground">
      <LogoWordmark className="h-20 w-auto" />
      {target ? (
        <>
          <p className="text-sm">
            {emptyStateLead}
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
            {t("mainArea.newQuery")}
          </Button>
        </>
      ) : (
        <p className="text-sm">{t("mainArea.selectConnection")}</p>
      )}
    </div>
  );
}

export default function MainArea() {
  const { t } = useTranslation("layout");
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
    <main
      aria-label={t("mainArea.mainLandmarkAria")}
      className="flex flex-1 flex-col overflow-hidden"
    >
      <WorkspaceToolbar />
      <TabBar />
      <div
        className="flex flex-1 overflow-hidden bg-background"
        // Wires the active editor tab (TabItem `id={`tab-${id}`}`) to its
        // content. Only meaningful while a tab is active; the empty/skeleton
        // fallback carries no tab so the tabpanel role is applied
        // conditionally to avoid a panel labelled by a non-existent tab.
        {...(activeTab
          ? {
              role: "tabpanel",
              id: `tabpanel-${activeTab.id}`,
              "aria-labelledby": `tab-${activeTab.id}`,
              tabIndex: 0,
            }
          : {})}
      >
        {/* #1312 — isolate the active tab's content (grid / query result /
            detail panel) so a render crash degrades to a retryable panel
            fallback while TabBar, toolbar, and sidebar keep working. Keyed by
            the active tab id so both the boundary and the underlying panel
            reset when the user swaps tabs. */}
        <ErrorBoundary
          key={activeTab?.id ?? "empty"}
          variant="panel"
          label={t("mainArea.mainLandmarkAria")}
        >
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
            <QueryTab tab={activeTab} />
          ) : hasLoadedOnce ? (
            <EmptyState />
          ) : (
            <MainAreaSkeleton />
          )}
        </ErrorBoundary>
      </div>
      <GlobalQueryLogPanel
        visible={showGlobalLog}
        onClose={() => setShowGlobalLog(false)}
      />
    </main>
  );
}
