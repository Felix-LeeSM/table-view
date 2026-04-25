import { useState, useEffect } from "react";
import TabBar from "./TabBar";
import { useTabStore, type TableTab, type TabSubView } from "@stores/tabStore";
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
import { LogoWordmark } from "@components/shared/Logo";
import { assertNever, type Paradigm } from "@/lib/paradigm";

interface TableTabProps {
  tab: TableTab;
  onSubViewChange: (subView: TabSubView) => void;
}

function TableTabView({ tab, onSubViewChange }: TableTabProps) {
  // Sprint 66: document-paradigm tabs bypass the Records/Structure sub-tabs
  // for the P0 milestone. Structure inspection for collections is tracked
  // by Sprint 67 (schema inference panel) and deliberately omitted here.
  // Sprint 120: paradigm dispatch wrapped in an exhaustive switch so adding
  // a new variant to the `Paradigm` union surfaces a TypeScript error here.
  const paradigm: Paradigm = tab.paradigm ?? "rdb";

  switch (paradigm) {
    case "document":
      return (
        <div className="flex flex-1 flex-col overflow-hidden">
          <DocumentDataGrid
            connectionId={tab.connectionId}
            database={tab.schema!}
            collection={tab.table!}
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
              table={tab.table!}
              schema={tab.schema!}
              initialFilters={tab.initialFilters}
            />
          ) : tab.objectKind === "view" ? (
            <ViewStructurePanel
              connectionId={tab.connectionId}
              view={tab.table!}
              schema={tab.schema!}
            />
          ) : (
            <StructurePanel
              connectionId={tab.connectionId}
              table={tab.table!}
              schema={tab.schema!}
            />
          )}
        </div>
      );
    default:
      return assertNever(paradigm);
  }
}

function EmptyState() {
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const lastUsedConnectionId = useMruStore((s) => s.lastUsedConnectionId);
  const addQueryTab = useTabStore((s) => s.addQueryTab);

  // Sprint 119 (#SHELL-1) — MRU-first policy with first-connected fallback.
  // The MRU id is null on first run (or after a reset), and stale-MRU (the
  // previously-used connection is currently disconnected) also falls back
  // to first-connected so the CTA never points at a connection the user
  // can't actually query.
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
            onClick={() => addQueryTab(target.id)}
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
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setSubView = useTabStore((s) => s.setSubView);
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
      <TabBar />
      <div className="flex flex-1 overflow-hidden bg-background">
        {activeTab?.type === "table" && activeTab.table && activeTab.schema ? (
          <TableTabView
            tab={activeTab}
            onSubViewChange={(subView) => setSubView(activeTab.id, subView)}
          />
        ) : activeTab?.type === "query" ? (
          <QueryTab tab={activeTab} />
        ) : (
          <EmptyState />
        )}
      </div>
      <GlobalQueryLogPanel
        visible={showGlobalLog}
        onClose={() => setShowGlobalLog(false)}
      />
    </div>
  );
}
