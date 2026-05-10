import { useEffect } from "react";
import ErrorBoundary from "./components/shared/ErrorBoundary";
import WorkspacePage from "./pages/WorkspacePage";
import QuickOpen from "./components/shared/QuickOpen";
import ShortcutCheatsheet from "./components/shared/ShortcutCheatsheet";
import QueryLog from "./components/query/QueryLog";
import { Toaster } from "./components/ui/toaster";
import { useConnectionStore } from "./stores/connectionStore";
import { useTabStore } from "./stores/tabStore";
import { useFavoritesStore } from "./stores/favoritesStore";
import { useMruStore } from "./stores/mruStore";
import { isEditableTarget } from "./lib/keyboard/isEditableTarget";
import { useThemeStore } from "./stores/themeStore";
import { markBootMilestone } from "./lib/perf/bootInstrumentation";
import { useActiveTabConnection } from "./hooks/useActiveTabConnection";

export default function App() {
  const loadConnections = useConnectionStore((s) => s.loadConnections);
  const loadGroups = useConnectionStore((s) => s.loadGroups);
  const initEventListeners = useConnectionStore((s) => s.initEventListeners);
  const loadPersistedFavorites = useFavoritesStore(
    (s) => s.loadPersistedFavorites,
  );
  const loadPersistedMru = useMruStore((s) => s.loadPersistedMru);
  // MRU marking is the caller's responsibility — `addTab`/`addQueryTab` no
  // longer emit it implicitly, so the three handlers below pair the call.
  const markConnectionUsed = useMruStore((s) => s.markConnectionUsed);

  const activeTabId = useTabStore((s) => s.activeTabId);
  const tabs = useTabStore((s) => s.tabs);
  const removeTab = useTabStore((s) => s.removeTab);
  const addQueryTab = useTabStore((s) => s.addQueryTab);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const reopenLastClosedTab = useTabStore((s) => s.reopenLastClosedTab);
  const addTab = useTabStore((s) => s.addTab);
  const updateQuerySql = useTabStore((s) => s.updateQuerySql);
  const themeMode = useThemeStore((s) => s.mode);
  const setThemeMode = useThemeStore((s) => s.setMode);

  useEffect(() => {
    loadConnections();
    loadGroups();
    initEventListeners();
    loadPersistedFavorites();
    loadPersistedMru();
    // Workspace-side anchor for cold-boot tracing — fires after the five
    // IPC dispatches above have been kicked off (not awaited).
    markBootMilestone("app:effects-fired");
  }, [
    loadConnections,
    loadGroups,
    initEventListeners,
    loadPersistedFavorites,
    loadPersistedMru,
  ]);

  // Cmd+W / Ctrl+W closes the active tab (NOT the app). Unlike every other
  // global shortcut we intentionally do NOT skip on `isEditableTarget`:
  // Tauri/wry on macOS falls through to the native Close-Window action
  // whenever the handler doesn't `preventDefault`, and the editor or grid
  // (both `contenteditable`) holds focus most of the time. Cmd+W has no
  // in-editor meaning to preserve, so always intercept.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "w") {
        e.preventDefault();
        if (activeTabId) {
          removeTab(activeTabId);
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeTabId, removeTab]);

  // Cmd+T / Ctrl+T — new query tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "t") {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        const activeTab = activeTabId
          ? tabs.find((t) => t.id === activeTabId)
          : null;
        const connectionId = activeTab?.connectionId ?? "";
        if (connectionId) {
          addQueryTab(connectionId);
          markConnectionUsed(connectionId);
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeTabId, tabs, addQueryTab, markConnectionUsed]);

  // Cmd+. / Ctrl+. — cancel running query
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
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
  }, [activeTabId, tabs]);

  // Cmd+N / Ctrl+N — new connection
  // Cmd+S / Ctrl+S — commit changes
  // Cmd+P / Ctrl+P — quick open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;

      const key = e.key;

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

  // Cmd+1..9 / Ctrl+1..9 — switch to the N-th workspace tab (1-indexed).
  // Top-row digits only; `Numpad1`.. are intentionally NOT matched.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      const digit = e.key;
      if (digit < "1" || digit > "9") return;
      if (isEditableTarget(e.target)) return;
      const index = Number(digit) - 1;
      const tab = tabs[index];
      if (!tab) return;
      e.preventDefault();
      setActiveTab(tab.id);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [tabs, setActiveTab]);

  // Cmd+R / Ctrl+R / F5 — context-aware refresh.
  // Cmd+Shift+R / Ctrl+Shift+R — Sprint 258 (AC-258-08): broadcasts a
  // `reset-column-widths` event so any mounted grid (RDB / Document /
  // raw query result) can re-run its initial widths formula. We
  // normalise via `e.key.toLowerCase()` because shift flips `e.key` to
  // upper-case, and we'd otherwise miss the shortcut entirely.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const lowerKey = typeof e.key === "string" ? e.key.toLowerCase() : "";
      const isRefreshKey =
        (lowerKey === "r" && (e.metaKey || e.ctrlKey)) || e.key === "F5";
      if (!isRefreshKey) return;

      // Skip if focus is inside a text input, textarea, select, or contenteditable
      if (isEditableTarget(e.target)) return;

      e.preventDefault();

      // Cmd+Shift+R routes to widths reset, NOT data refetch.
      if (lowerKey === "r" && e.shiftKey) {
        window.dispatchEvent(new CustomEvent("reset-column-widths"));
        return;
      }

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
  }, [activeTabId, tabs]);

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
        reopenLastClosedTab();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [reopenLastClosedTab]);

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

  // Cmd+Shift+L / Ctrl+Shift+L — cycle theme mode
  // (dark → light → system → dark).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.metaKey || e.ctrlKey) && e.key === "L") {
        e.preventDefault();
        const nextMode =
          themeMode === "dark"
            ? "light"
            : themeMode === "light"
              ? "system"
              : "dark";
        setThemeMode(nextMode);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [themeMode, setThemeMode]);

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
      addTab({
        type: "table",
        connectionId,
        schema,
        table,
        title: `${schema}.${table}`,
        closable: true,
        subView: "records",
        objectKind: objectKind ?? "table",
        permanent: true,
      });
      markConnectionUsed(connectionId);
    };
    window.addEventListener("navigate-table", handler);
    return () => window.removeEventListener("navigate-table", handler);
  }, [addTab, markConnectionUsed]);

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
      addQueryTab(connectionId);
      markConnectionUsed(connectionId);
      // The selector-bound `tabs` snapshot doesn't include the just-added
      // tab until React's next commit, but we need its id to seed the SQL
      // body. Read the store directly for this one call.
      // eslint-disable-next-line no-restricted-syntax
      const latestTabs = useTabStore.getState().tabs;
      const newTab = latestTabs[latestTabs.length - 1];
      if (newTab && newTab.type === "query" && source) {
        updateQuerySql(newTab.id, source);
      }
    };
    window.addEventListener("quickopen-function", handler);
    return () => window.removeEventListener("quickopen-function", handler);
  }, [addQueryTab, markConnectionUsed, updateQuerySql]);

  // Sprint 256 (ADR 0023, AC-256-02) — prod-only 1px window border
  // tracks the *active tab* (not focusedConnId) so a user pivoting from
  // a prod tab to a dev tab loses the red frame instantly. The
  // `chrome-prod-border` class is opted-in here on a wrapper that lives
  // *outside* the existing flex shell so the existing layout math is
  // untouched (prevents a re-layout / scroll-shift the moment the
  // border appears).
  const activeConnection = useActiveTabConnection();
  const isProdActive = activeConnection?.environment === "production";

  return (
    <ErrorBoundary>
      <div
        className="flex h-screen w-screen flex-col overflow-hidden bg-background"
        data-prod-active={isProdActive ? "true" : undefined}
        style={
          isProdActive
            ? {
                boxShadow: "inset 0 0 0 1px var(--tv-env-prod)",
              }
            : undefined
        }
      >
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <WorkspacePage />
        </div>
        <QuickOpen />
        <ShortcutCheatsheet />
        <QueryLog />
        {/* Mounted at the App root, NOT inside a Radix dialog portal — a
            toast surfaced from inside a modal must survive the modal
            being closed. */}
        <Toaster />
      </div>
    </ErrorBoundary>
  );
}
