import TabBar from "./TabBar";
import { useTabStore } from "../stores/tabStore";
import { Database } from "lucide-react";
import DataGrid from "./DataGrid";
import StructurePanel from "./StructurePanel";

export default function MainArea() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TabBar />
      <div className="flex flex-1 overflow-hidden bg-(--color-bg-primary)">
        {activeTab?.type === "data" && activeTab.table && activeTab.schema ? (
          <DataGrid
            connectionId={activeTab.connectionId}
            table={activeTab.table}
            schema={activeTab.schema}
          />
        ) : activeTab?.type === "structure" &&
          activeTab.table &&
          activeTab.schema ? (
          <StructurePanel
            connectionId={activeTab.connectionId}
            table={activeTab.table}
            schema={activeTab.schema}
          />
        ) : activeTab ? (
          <div className="flex flex-1 items-center justify-center p-4 text-(--color-text-secondary)">
            Connected to: {activeTab.title}
          </div>
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
