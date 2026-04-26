import { useEffect } from "react";
import ErrorBoundary from "./components/shared/ErrorBoundary";
import HomePage from "./pages/HomePage";
import WorkspacePage from "./pages/WorkspacePage";
import QuickOpen from "./components/shared/QuickOpen";
import ShortcutCheatsheet from "./components/shared/ShortcutCheatsheet";
import QueryLog from "./components/query/QueryLog";
import { Toaster } from "./components/ui/toaster";
import { useAppShellStore } from "./stores/appShellStore";
import { useConnectionStore } from "./stores/connectionStore";
import { useTabStore } from "./stores/tabStore";
import { useFavoritesStore } from "./stores/favoritesStore";
import { useMruStore } from "./stores/mruStore";
import { isEditableTarget } from "./lib/keyboard/isEditableTarget";

export default function App() {
  const loadConnections = useConnectionStore((s) => s.loadConnections);
  const loadGroups = useConnectionStore((s) => s.loadGroups);
  const initEventListeners = useConnectionStore((s) => s.initEventListeners);
  const loadPersistedFavorites = useFavoritesStore(
    (s) => s.loadPersistedFavorites,
  );
  const loadPersistedMru = useMruStore((s) => s.loadPersistedMru);

  useEffect(() => {
    loadConnections();
    loadGroups();
    initEventListeners();
    loadPersistedFavorites();
    loadPersistedMru();
  }, [
    loadConnections,
    loadGroups,
    initEventListeners,
    loadPersistedFavorites,
    loadPersistedMru,
  ]);

  // Cmd+W / Ctrl+W closes the active tab (does NOT close the app)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "w") {
        if (isEditableTarget(e.target)) return;
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
        if (isEditableTarget(e.target)) return;
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
        if (isEditableTarget(e.target)) return;
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
  // Cmd+, / Ctrl+, — toggle Home/Workspace (sprint 133 — repurposed from the
  //                  old `open-settings` event which had zero consumers).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;

      const key = e.key;

      // Sprint 133 — Cmd+, toggles between Home and Workspace screens.
      // Repurposed from the dead `open-settings` event dispatch. The Shift /
      // Alt guard prevents accidentally toggling on Cmd+Shift+, etc.
      if (key === ",") {
        if (e.shiftKey || e.altKey) return;
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        const { screen: current, setScreen } = useAppShellStore.getState();
        setScreen(current === "workspace" ? "home" : "workspace");
        return;
      }

      let eventName: string | null = null;
      if (key === "n") eventName = "new-connection";
      else if (key === "s") eventName = "commit-changes";
      else if (key === "p") eventName = "quick-open";

      if (!eventName) return;

      // Skip if focus is inside a text input, textarea, select, or contenteditable
      if (isEditableTarget(e.target)) return;

      e.preventDefault();
      window.dispatchEvent(new CustomEvent(eventName));
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Sprint 133 — Cmd+1..9 / Ctrl+1..9: switch the active workspace tab to
  // the N-th tab (1-indexed). No-op outside the workspace screen, when
  // focus is inside an editable element, or when the requested index is
  // out of range. Numpad digit keys (`Numpad1`..) are intentionally NOT
  // matched — only the top-row digit keys, per the sprint design bar.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      const digit = e.key;
      if (digit < "1" || digit > "9") return;
      if (isEditableTarget(e.target)) return;
      const { screen: current } = useAppShellStore.getState();
      if (current !== "workspace") return;
      const index = Number(digit) - 1;
      const { tabs, setActiveTab } = useTabStore.getState();
      const tab = tabs[index];
      if (!tab) return;
      e.preventDefault();
      setActiveTab(tab.id);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Sprint 134 — the Sprint 133 Cmd+K handler that dispatched
  // `open-connection-switcher` was removed alongside the
  // `<ConnectionSwitcher>` component itself. Connection swap is now a
  // single path: Home → double-click. Cmd+K is intentionally a no-op
  // until a future sprint reclaims the chord.

  // Cmd+R / Ctrl+R / F5 — context-aware refresh
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isRefresh =
        (e.key === "r" && (e.metaKey || e.ctrlKey)) || e.key === "F5";
      if (!isRefresh) return;

      // Skip if focus is inside a text input, textarea, select, or contenteditable
      if (isEditableTarget(e.target)) return;

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
        if (isEditableTarget(e.target)) return;
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
        if (isEditableTarget(e.target)) return;
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
        if (isEditableTarget(e.target)) return;
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
        if (isEditableTarget(e.target)) return;
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
        if (isEditableTarget(e.target)) return;
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

  // Sprint 125 — appShell routing. Home and Workspace are full-screen siblings;
  // the user toggles between them via Open (Home -> Workspace) and the
  // [← Connections] button (Workspace -> Home). Tab state lives in tabStore
  // and is preserved across swaps.
  const screen = useAppShellStore((s) => s.screen);

  return (
    <ErrorBoundary>
      <div className="flex h-screen w-screen overflow-hidden bg-background">
        {screen === "home" ? <HomePage /> : <WorkspacePage />}
        <QuickOpen />
        <ShortcutCheatsheet />
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
