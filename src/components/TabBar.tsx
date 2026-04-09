import { useTabStore } from "../stores/tabStore";
import { X, Table2 } from "lucide-react";

export default function TabBar() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const removeTab = useTabStore((s) => s.removeTab);

  if (tabs.length === 0) return null;

  return (
    <div
      className="flex items-center border-b border-(--color-border) bg-(--color-bg-secondary)"
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
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setActiveTab(tab.id);
            }
          }}
        >
          <Table2 size={12} className="shrink-0 text-(--color-text-muted)" />
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
    </div>
  );
}
