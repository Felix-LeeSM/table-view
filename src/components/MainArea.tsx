import TabBar from "./TabBar";
import { useTabStore } from "../stores/tabStore";
import { Database } from "lucide-react";

export default function MainArea() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TabBar />
      <div className="flex flex-1 items-center justify-center bg-(--color-bg-primary)">
        {activeTab ? (
          <div className="p-4 text-(--color-text-secondary)">
            Connected to: {activeTab.title}
          </div>
        ) : (
          <div className="flex flex-col items-center text-(--color-text-muted)">
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
