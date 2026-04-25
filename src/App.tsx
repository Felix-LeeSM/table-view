import { useEffect } from "react";
import ErrorBoundary from "./components/shared/ErrorBoundary";
import Sidebar from "./components/layout/Sidebar";
import MainArea from "./components/layout/MainArea";
import QuickOpen from "./components/shared/QuickOpen";
import QueryLog from "./components/query/QueryLog";
import { Toaster } from "./components/ui/toaster";
import { useConnectionStore } from "./stores/connectionStore";
import { useTabStore } from "./stores/tabStore";
import { useFavoritesStore } from "./stores/favoritesStore";

export default function App() {
  const loadConnections = useConnectionStore((s) => s.loadConnections);
  const loadGroups = useConnectionStore((s) => s.loadGroups);
  const initEventListeners = useConnectionStore((s) => s.initEventListeners);
  const loadPersistedFavorites = useFavoritesStore(
    (s) => s.loadPersistedFavorites,
  );

  useEffect(() => {
    loadConnections();
    loadGroups();
    initEventListeners();
    loadPersistedFavorites();
  }, [loadConnections, loadGroups, initEventListeners, loadPersistedFavorites]);

  // Cmd+W / Ctrl+W closes the active tab (does NOT close the app)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "w") {
        e.preventDefault();
        const activeTabId = useTabStore.getState().activeTabId;
        if (activeTabId) {
          useTabStore.getState().removeTab(activeTabId);
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Cmd+T / Ctrl+T — new query tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "t") {
        e.preventDefault();
        const { activeTabId, tabs } = useTabStore.getState();
        const activeTab = activeTabId
          ? tabs.find((t) => t.id === activeTabId)
          : null;
        const connectionId = activeTab?.connectionId ?? "";
        if (connectionId) {
          useTabStore.getState().addQueryTab(connectionId);
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Cmd+. / Ctrl+. — cancel running query
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        const { activeTabId, tabs } = useTabStore.getState();
        const activeTab = activeTabId
          ? tabs.find((t) => t.id === activeTabId)
          : null;
        if (
          activeTab &&
          activeTab.type === "query" &&
          activeTab.queryState.status === "running" &&
          "queryId" in activeTab.queryState
        ) {
          window.dispatchEvent(
            new CustomEvent("cancel-query", {
              detail: { queryId: activeTab.queryState.queryId },
            }),
          );
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Cmd+N / Ctrl+N — new connection
  // Cmd+S / Ctrl+S — commit changes
  // Cmd+P / Ctrl+P — quick open
  // Cmd+, / Ctrl+, — settings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;

      const key = e.key;
      let eventName: string | null = null;
      if (key === "n") eventName = "new-connection";
      else if (key === "s") eventName = "commit-changes";
      else if (key === "p") eventName = "quick-open";
      else if (key === ",") eventName = "open-settings";

      if (!eventName) return;

      // Skip if focus is inside a text input, textarea, select, or contenteditable
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target as HTMLElement)?.isContentEditable
      )
        return;

      e.preventDefault();
      window.dispatchEvent(new CustomEvent(eventName));
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Cmd+R / Ctrl+R / F5 — context-aware refresh
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isRefresh =
        (e.key === "r" && (e.metaKey || e.ctrlKey)) || e.key === "F5";
      if (!isRefresh) return;

      // Skip if focus is inside a text input, textarea, or select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      e.preventDefault();

      const { activeTabId, tabs } = useTabStore.getState();
      const activeTab = activeTabId
        ? tabs.find((t) => t.id === activeTabId)
        : null;

      if (activeTab && activeTab.type === "table") {
        // Table tab active — dispatch based on subview
        if (activeTab.subView === "records") {
          window.dispatchEvent(new CustomEvent("refresh-data"));
        } else if (activeTab.subView === "structure") {
          window.dispatchEvent(new CustomEvent("refresh-structure"));
        }
      } else {
        // No table tab active — refresh schema tree for active connections
        window.dispatchEvent(new CustomEvent("refresh-schema"));
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Cmd+I / Ctrl+I — format SQL
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "i") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("format-sql"));
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Cmd+Shift+I / Ctrl+Shift+I — uglify SQL
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "I") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("uglify-sql"));
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Cmd+Shift+T / Ctrl+Shift+T — reopen last closed tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "T") {
        e.preventDefault();
        useTabStore.getState().reopenLastClosedTab();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Cmd+Shift+F / Ctrl+Shift+F — toggle favorites panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "F") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-favorites"));
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Cmd+Shift+C / Ctrl+Shift+C — toggle global query log panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "C") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-global-query-log"));
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Navigate-table event — open a table or view tab from Quick Open
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          connectionId: string;
          schema: string;
          table: string;
          objectKind?: "table" | "view";
        }>
      ).detail;
      const { connectionId, schema, table, objectKind } = detail;
      useTabStore.getState().addTab({
        type: "table",
        connectionId,
        schema,
        table,
        title: `${schema}.${table}`,
        closable: true,
        subView: "records",
        objectKind: objectKind ?? "table",
      });
    };
    window.addEventListener("navigate-table", handler);
    return () => window.removeEventListener("navigate-table", handler);
  }, []);

  // Quick Open function/procedure — open a query tab with the source pre-filled
  useEffect(() => {
    const handler = (e: Event) => {
      const { connectionId, source } = (
        e as CustomEvent<{
          connectionId: string;
          source: string;
          title: string;
        }>
      ).detail;
      const tabStore = useTabStore.getState();
      tabStore.addQueryTab(connectionId);
      const latestTabs = useTabStore.getState().tabs;
      const newTab = latestTabs[latestTabs.length - 1];
      if (newTab && newTab.type === "query" && source) {
        tabStore.updateQuerySql(newTab.id, source);
      }
    };
    window.addEventListener("quickopen-function", handler);
    return () => window.removeEventListener("quickopen-function", handler);
  }, []);

  return (
    <ErrorBoundary>
      <div className="flex h-screen w-screen overflow-hidden bg-background">
        <Sidebar />
        <MainArea />
        <QuickOpen />
        <QueryLog />
        {/* Sprint 94 — global toaster. Mounted at the App root (NOT inside any
            Radix dialog portal) so a toast surfaced from inside a modal
            survives the modal being closed. See AC-03 in
            docs/sprints/sprint-94/contract.md. */}
        <Toaster />
      </div>
    </ErrorBoundary>
  );
}
