import TabBar from "./TabBar";
import { useTabStore, type TableTab, type TabSubView } from "../stores/tabStore";
import { Database } from "lucide-react";
import DataGrid from "./DataGrid";
import StructurePanel from "./StructurePanel";
import QueryTab from "./QueryTab";

interface TableTabProps {
  tab: TableTab;
  onSubViewChange: (subView: TabSubView) => void;
}

function TableTabView({ tab, onSubViewChange }: TableTabProps) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Sub-tab bar */}
      <div
        className="flex items-center border-b border-(--color-border) bg-(--color-bg-secondary)"
        role="tablist"
        aria-label="Table view"
      >
        <button
          role="tab"
          aria-selected={tab.subView === "records"}
          tabIndex={tab.subView === "records" ? 0 : -1}
          className={`px-4 py-1.5 text-xs font-medium transition-colors ${
            tab.subView === "records"
              ? "border-b-2 border-(--color-accent) text-(--color-text-primary)"
              : "text-(--color-text-muted) hover:text-(--color-text-secondary)"
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
              ? "border-b-2 border-(--color-accent) text-(--color-text-primary)"
              : "text-(--color-text-muted) hover:text-(--color-text-secondary)"
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

export default function MainArea() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setSubView = useTabStore((s) => s.setSubView);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TabBar />
      <div className="flex flex-1 overflow-hidden bg-(--color-bg-primary)">
        {activeTab?.type === "table" && activeTab.table && activeTab.schema ? (
          <TableTabView
            tab={activeTab}
            onSubViewChange={(subView) => setSubView(activeTab.id, subView)}
          />
        ) : activeTab?.type === "query" ? (
          <QueryTab tab={activeTab} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-(--color-text-muted)">
            <Database size={48} className="mb-3" />
            <p className="text-lg">View Table</p>
            <p className="mt-1 text-sm">
              Select a connection from the sidebar to get started
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
