import { X, Table2, Code2, Plus } from "lucide-react";
import { useTabStore } from "../stores/tabStore";
import { useConnectionStore } from "../stores/connectionStore";

export default function TabBar() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const removeTab = useTabStore((s) => s.removeTab);
  const addQueryTab = useTabStore((s) => s.addQueryTab);
  const connections = useConnectionStore((s) => s.connections);

  // Find the connectionId from the active tab to use for new query tabs.
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeConnectionId = activeTab?.connectionId ?? "";

  if (tabs.length === 0) return null;

  return (
    <div
      className="flex items-center border-b border-(--color-border) bg-(--color-bg-secondary) select-none"
      role="tablist"
      aria-label="Open connections"
    >
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeTabId}
          tabIndex={tab.id === activeTabId ? 0 : -1}
          className={`group flex items-center gap-1.5 border-r border-(--color-border) px-3 py-1.5 text-sm cursor-pointer select-none ${
            tab.id === activeTabId
              ? "bg-(--color-bg-primary) text-(--color-text-primary) border-b-2 border-b-(--color-accent)"
              : "text-(--color-text-secondary) hover:bg-(--color-bg-tertiary)"
          }`}
          onClick={() => setActiveTab(tab.id)}
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
                "var(--color-accent)",
            }}
            aria-label="Connection color"
          />
          {tab.type === "query" ? (
            <Code2 size={12} className="shrink-0 text-(--color-text-muted)" />
          ) : (
            <Table2 size={12} className="shrink-0 text-(--color-text-muted)" />
          )}
          <span className="max-w-30 truncate">{tab.title}</span>
          {tab.closable && (
            <button
              aria-label={`Close ${tab.title}`}
              className="rounded p-0.5 opacity-0 hover:bg-(--color-bg-tertiary) group-hover:opacity-100 focus:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                removeTab(tab.id);
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}

      {/* New query tab button */}
      {activeConnectionId && (
        <button
          className="flex items-center rounded px-2 py-1.5 text-(--color-text-muted) hover:bg-(--color-bg-tertiary) hover:text-(--color-text-secondary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)"
          aria-label="New Query Tab"
          title="New Query Tab"
          onClick={() => addQueryTab(activeConnectionId)}
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}
