import { useState, useEffect } from "react";
import TabBar from "./TabBar";
import { useTabStore, type TableTab, type TabSubView } from "@stores/tabStore";
import { useConnectionStore } from "@stores/connectionStore";
import { Database, Plus } from "lucide-react";
import DataGrid from "@components/DataGrid";
import StructurePanel from "@components/schema/StructurePanel";
import ViewStructurePanel from "@components/schema/ViewStructurePanel";
import QueryTab from "@components/query/QueryTab";
import GlobalQueryLogPanel from "@components/query/GlobalQueryLogPanel";
import { Button } from "@components/ui/button";

interface TableTabProps {
  tab: TableTab;
  onSubViewChange: (subView: TabSubView) => void;
}

function TableTabView({ tab, onSubViewChange }: TableTabProps) {
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
}

function EmptyState() {
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const addQueryTab = useTabStore((s) => s.addQueryTab);

  const firstConnected = connections.find(
    (c) => activeStatuses[c.id]?.type === "connected",
  );

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-muted-foreground">
      <Database size={48} />
      <p className="text-lg text-foreground">View Table</p>
      {firstConnected ? (
        <>
          <p className="text-sm">
            Open a table from the sidebar, or start writing SQL against{" "}
            <span className="font-medium text-foreground">
              {firstConnected.name}
            </span>
            .
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-1"
            onClick={() => addQueryTab(firstConnected.id)}
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
