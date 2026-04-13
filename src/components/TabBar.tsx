import { X, Table2, Code2, Plus } from "lucide-react";
import { useTabStore, type TableTab } from "../stores/tabStore";
import { useConnectionStore } from "../stores/connectionStore";
import { Button } from "./ui/button";

export default function TabBar() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const removeTab = useTabStore((s) => s.removeTab);
  const promoteTab = useTabStore((s) => s.promoteTab);
  const addQueryTab = useTabStore((s) => s.addQueryTab);
  const connections = useConnectionStore((s) => s.connections);

  // Find the connectionId from the active tab to use for new query tabs.
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeConnectionId = activeTab?.connectionId ?? "";

  if (tabs.length === 0) return null;

  return (
    <div
      className="flex items-center border-b border-border bg-secondary select-none"
      role="tablist"
      aria-label="Open connections"
    >
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeTabId}
          tabIndex={tab.id === activeTabId ? 0 : -1}
          className={`group flex items-center gap-1.5 border-r border-border px-3 py-1.5 text-sm cursor-pointer select-none ${
            tab.id === activeTabId
              ? "bg-background text-foreground border-b-2 border-b-primary"
              : "text-secondary-foreground hover:bg-muted"
          }`}
          onClick={() => setActiveTab(tab.id)}
          onDoubleClick={() => {
            if (tab.type === "table" && (tab as TableTab).isPreview) {
              promoteTab(tab.id);
            }
          }}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              removeTab(tab.id);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setActiveTab(tab.id);
            }
          }}
        >
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{
              backgroundColor:
                connections.find((c) => c.id === tab.connectionId)?.color ??
                "var(--primary)",
            }}
            aria-label="Connection color"
            title={
              connections.find((c) => c.id === tab.connectionId)?.name ?? ""
            }
          />
          {tab.type === "query" ? (
            <Code2 size={12} className="shrink-0 text-muted-foreground" />
          ) : (
            <Table2 size={12} className="shrink-0 text-muted-foreground" />
          )}
          <span
            className={`max-w-30 truncate${tab.type === "table" && (tab as TableTab).isPreview ? " italic opacity-70" : ""}`}
          >
            {tab.title}
          </span>
          {tab.closable && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Close ${tab.title}`}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                removeTab(tab.id);
              }}
            >
              <X size={12} />
            </Button>
          )}
        </div>
      ))}

      {/* New query tab button */}
      {activeConnectionId && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-secondary-foreground"
          aria-label="New Query Tab"
          title="New Query Tab"
          onClick={() => addQueryTab(activeConnectionId)}
        >
          <Plus size={14} />
        </Button>
      )}
    </div>
  );
}
