import { useConnectionStore } from "@features/connection";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import QueryLog from "./components/query/QueryLog";
import ErrorBoundary from "./components/shared/ErrorBoundary";
import PgValueSearch from "./components/shared/PgValueSearch";
import QuickOpen from "./components/shared/QuickOpen";
import ShortcutCheatsheet from "./components/shared/ShortcutCheatsheet";
import { Toaster } from "./components/ui/toaster";
import { useActiveTabConnection } from "./hooks/useActiveTabConnection";
import { useCurrentWindowConnectionId } from "./hooks/useCurrentWindowConnectionId";
import { useDiscardConfirm } from "./hooks/useDiscardConfirm";
import { useTauriListener } from "./hooks/useTauriListener";
import { isEditableTarget } from "./lib/keyboard/isEditableTarget";
import { markBootMilestone } from "./lib/perf/bootInstrumentation";
import { useHardRefresh } from "./lib/runtime/connection/hardRefresh";
import { destroyCurrentWindow } from "./lib/window-controls";
import { getCurrentWindowLabel, parseWorkspaceLabel } from "./lib/window-label";
import WorkspacePage from "./pages/WorkspacePage";
import { useFavoritesStore } from "./stores/favoritesStore";
import { useLayoutStore } from "./stores/layoutStore";
import { useMruStore } from "./stores/mruStore";
import { useSnippetsStore } from "./stores/snippetsStore";
import { useTableActivityStore } from "./stores/tableActivityStore";
import { useThemeStore } from "./stores/themeStore";
import {
  flushPersistWorkspaces,
  resolveActiveDb,
  useActiveTabId,
  useActiveTabSansSql,
  useConnectionHasDirtyTabs,
  useCurrentTabIds,
  useCurrentWorkspaceKey,
  useDirtyTabIds,
  useWorkspaceStore,
} from "./stores/workspaceStore";

// #1621 G3a — the window-close flush persists the last edit before destroy, but
// `persist_workspace` is a Tauri IPC that can hang (backend stall / lost reply).
// A bare `flushPersistWorkspaces().finally(destroy)` would then trap the window
// open forever. Cap the wait: destroy once the flush settles OR this timeout
// elapses, whichever comes first. A lost last-edit beats an unclosable window.
export const PERSIST_FLUSH_TIMEOUT_MS = 3000;

function flushThenDestroy() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, PERSIST_FLUSH_TIMEOUT_MS);
  });
  void Promise.race([flushPersistWorkspaces(), timeout]).finally(() => {
    clearTimeout(timer);
    void destroyCurrentWindow();
  });
}

export default function App() {
  const loadConnections = useConnectionStore((s) => s.loadConnections);
  const loadGroups = useConnectionStore((s) => s.loadGroups);
  const initEventListeners = useConnectionStore((s) => s.initEventListeners);
  const loadPersistedFavorites = useFavoritesStore(
    (s) => s.loadPersistedFavorites,
  );
  const loadPersistedSnippets = useSnippetsStore(
    (s) => s.loadPersistedSnippets,
  );
  const loadPersistedMru = useMruStore((s) => s.loadPersistedMru);
  const loadPersistedTableActivity = useTableActivityStore(
    (s) => s.loadPersistedTableActivity,
  );
  // MRU marking is the caller's responsibility — `addTab`/`addQueryTab` no
  // longer emit it implicitly, so the handlers below pair the call.
  const markConnectionUsed = useMruStore((s) => s.markConnectionUsed);

  const activeTabId = useActiveTabId();
  // #1447 — App consumes only sql-free tab data (active-tab fields for the
  // shortcut handlers, ordered ids for Cmd+1..9). Subscribing to the full
  // `tabs` array re-rendered the entire App tree on every editor keystroke.
  const activeTab = useActiveTabSansSql();
  const tabIds = useCurrentTabIds();
  const workspaceKey = useCurrentWorkspaceKey();
  // Used by the Cmd+N and `menu:new-query-tab` fallback paths. Calling
  // `store.getState()` directly in a component breaks the lint rule
  // (no-restricted-syntax), so it is read through a selector hook.
  const focusedConnId = useConnectionStore((s) => s.focusedConnId);
  const removeTab = useWorkspaceStore((s) => s.removeTab);
  const addQueryTab = useWorkspaceStore((s) => s.addQueryTab);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const reopenLastClosedTab = useWorkspaceStore((s) => s.reopenLastClosedTab);
  const addTab = useWorkspaceStore((s) => s.addTab);
  const updateQuerySql = useWorkspaceStore((s) => s.updateQuerySql);
  const themeMode = useThemeStore((s) => s.mode);
  const setThemeMode = useThemeStore((s) => s.setMode);

  // #1101 — unsaved-changes ("dirty tab") guard shared across the close
  // paths App owns: Cmd+W (JS fallback) and the native window-close signal.
  const dirtyTabIds = useDirtyTabIds();
  const currentConnId = useCurrentWindowConnectionId();
  // #1583 — this workspace window self-closes when its own connection id
  // disappears from the (cross-window synced) connection list, e.g. the
  // launcher deleted it. `hasLoadedOnce` gates the check so an in-flight
  // initial load can't be mistaken for "connection gone".
  const connections = useConnectionStore((s) => s.connections);
  const connectionsLoadedOnce = useConnectionStore((s) => s.hasLoadedOnce);
  const windowHasDirtyTabs = useConnectionHasDirtyTabs(currentConnId);
  const { guard: confirmDiscard, dialog: discardDialog } = useDiscardConfirm();
  // #1719 (Part of #1717) — Cmd+Shift+R hard refresh orchestration (reconnect
  // + cache invalidate + refetch) for the current window's connection.
  const hardRefresh = useHardRefresh();
  // Keep the latest dirty snapshot in a ref so the one-shot native-close
  // listener reads fresh state without re-registering on every edit (a
  // re-register gap could drop the OS close event).
  const windowHasDirtyRef = useRef(windowHasDirtyTabs);
  windowHasDirtyRef.current = windowHasDirtyTabs;

  // #1705 — the backend intercepts the OS window *close* (prevent_close →
  // `window:close-requested`, gated above), but a webview *reload* (Cmd+R / F5
  // while a grid cell editor holds focus, or a menu / right-click reload) is
  // never intercepted. Since the pending-edit stores (`dataGridEditStore` /
  // `rawQueryGridEditStore`) are window-local and non-persisted, that reload
  // silently discarded every uncommitted edit. `beforeunload` is the native
  // unsaved-changes guard for that path: while the window holds dirty tabs,
  // cancel the event so the webview prompts before reloading. Reuses the same
  // dirty snapshot ref the native-close listener reads (no re-register on every
  // edit, which could leave a gap that drops the event).
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!windowHasDirtyRef.current) return;
      // `preventDefault()` is the modern trigger for the unsaved-changes prompt
      // (the legacy `returnValue` assignment is deprecated).
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  useEffect(() => {
    loadConnections();
    loadGroups();
    initEventListeners();
    loadPersistedFavorites();
    loadPersistedSnippets();
    loadPersistedMru();
    loadPersistedTableActivity();
    // Workspace-side anchor for cold-boot tracing — fires after the IPC
    // dispatches above have been kicked off (not awaited).
    markBootMilestone("app:effects-fired");
  }, [
    loadConnections,
    loadGroups,
    initEventListeners,
    loadPersistedFavorites,
    loadPersistedSnippets,
    loadPersistedMru,
    loadPersistedTableActivity,
  ]);

  // Cmd+W / Ctrl+W — close the active tab if there is one; in an empty
  // workspace, destroy the window itself. The macOS native NSMenu Cmd+W
  // (lib.rs `close_focused_window`) takes precedence; this handler is the
  // fallback when the webview takes the key first, such as while an input
  // field holds focus.
  //
  // 2026-05-16: with no tabs, the earlier handler called only
  // `preventDefault()`, which also blocked the OS default close and left
  // Cmd+W a no-op. With no tab open Cmd+W must close the window, so the
  // handler calls destroyCurrentWindow explicitly.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "w") return;
      e.preventDefault();
      if (activeTabId && workspaceKey) {
        // #1101 — a dirty tab closes only after the discard confirmation
        // (same gate as the TabBar X button); clean tabs close immediately.
        confirmDiscard(dirtyTabIds.includes(activeTabId), () =>
          removeTab(workspaceKey.connId, workspaceKey.db, activeTabId),
        );
        return;
      }
      // Empty workspace — the backend `workspace_close` calls
      // Window::destroy() on the caller webview directly. Fired inside the
      // launcher, the backend would only see that the command's caller is
      // the launcher and destroy it; the native menu owns the launcher hide
      // semantics, so in practice only a workspace reaches this path through
      // a webview keydown (the launcher's Cmd+W is taken by NSMenu first and
      // goes to the hide branch). No tabs, so no dirty check is needed.
      void destroyCurrentWindow();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeTabId, workspaceKey, removeTab, dirtyTabIds, confirmDiscard]);

  // #1101 — native close paths (workspace window X button + macOS menu
  // Cmd+W) can't read the frontend's window-local dirty state. The backend
  // intercepts the OS-level close (`api.prevent_close()` in lib.rs
  // `on_window_event`) and emits `window:close-requested` to this window
  // instead of destroying it; the menu Cmd+W routes through the same
  // intercept via `win.close()`. Here we run the shared discard
  // confirmation over the whole window's dirty tabs, then destroy on
  // confirm (`destroyCurrentWindow` → backend `workspace_close`).
  useTauriListener(
    () =>
      listen("window:close-requested", () => {
        confirmDiscard(windowHasDirtyRef.current, () => {
          // #1580 F1 — a pure trailing 200ms debounce has no flush point, so an
          // SQL edit made within 200ms of closing (SQL-only edits never mark a
          // tab dirty, so this takes the no-confirm branch) was destroyed before
          // it persisted. Flush the pending snapshot, then destroy — bounded so a
          // hung persist still closes the window (#1621 G3a).
          flushThenDestroy();
        });
      }),
    [confirmDiscard],
  );

  // #1583 — deleting a connection (from the launcher) removes it from the
  // synced `connections` list and the connection-sync bridge purges this
  // window's tabs/schema/grid, but nothing closed the now-empty
  // `workspace-{id}` window — it lingered as a blank orphan. When this
  // window's own connection id is gone from the loaded list, self-close it
  // through the same discard-confirm + persist-flush + destroy path the
  // native window close uses.
  //
  // Presence latch: only treat an *absence* as a deletion once we've seen
  // this window's connection id present in the loaded list. At boot the
  // snapshot (`hydrateConnectionsFromSnapshot`) flips `hasLoadedOnce=true`
  // and may not yet contain a just-created connection — the very one this
  // window is for — until `loadConnections` catches up. Without the latch
  // that transient absence self-closes the window the instant it opens
  // (the CI E2E boot race). Guards: `connectionsLoadedOnce` (never fire
  // mid-load), `currentConnId === null` (launcher / non-workspace windows).
  const sawConnectionRef = useRef(false);
  useEffect(() => {
    if (!connectionsLoadedOnce || currentConnId === null) return;
    if (connections.some((c) => c.id === currentConnId)) {
      sawConnectionRef.current = true;
      return;
    }
    if (!sawConnectionRef.current) return;
    confirmDiscard(windowHasDirtyRef.current, () => {
      // #1621 G3a — bounded flush so a hung persist can't strand this orphan
      // self-close (same trap as the native window-close path above).
      flushThenDestroy();
    });
  }, [connectionsLoadedOnce, currentConnId, connections, confirmDiscard]);

  // #1580 F2 — flush the debounced workspace persist when the webview is
  // backgrounded/hidden, so a crash or SIGKILL while hidden doesn't lose the
  // last edit that the trailing debounce hadn't written yet.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flushPersistWorkspaces();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Cmd+T / Ctrl+T — new query tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "t") {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        const connectionId = activeTab?.connectionId ?? "";
        if (connectionId) {
          const db = resolveActiveDb(connectionId);
          addQueryTab(connectionId, db);
          markConnectionUsed(connectionId);
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, addQueryTab, markConnectionUsed]);

  // Cmd+. / Ctrl+. — cancel running query
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
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
  }, [activeTab]);

  // 2026-05-16 — in a workspace window Cmd+N opens a raw query tab (same as
  // Cmd+T), not the connection-create dialog. Creating a new connection is
  // the launcher window's job (macOS menu / a separate entry point); inside
  // a workspace, Cmd+N means "write a new query".
  //
  // Empty-tab fallback: a workspace can have no tab right after it mounts,
  // so when the active tab has no connectionId, take the conn from the window
  // label (`workspace-{conn_id}`) and call addQueryTab. The macOS NSMenu
  // Cmd+N dispatch (lib.rs::handle_menu_new_connection) takes precedence;
  // this handler is the fallback when the webview takes the key first.
  // Cmd+S / Ctrl+S — commit changes
  // Cmd+P / Ctrl+P — quick open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;

      const key = e.key;

      // Cmd+N is special — dispatch addQueryTab directly (no DOM event hop).
      if (key === "n") {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        let connectionId = activeTab?.connectionId ?? "";
        if (!connectionId) {
          // Fallback A — take the conn from the current window label (the
          // most authoritative source in a workspace window).
          // parseWorkspaceLabel returns null for the launcher label.
          const label = getCurrentWindowLabel();
          if (label) connectionId = parseWorkspaceLabel(label) ?? "";
        }
        if (!connectionId) {
          // Fallback B — the store's focusedConnId, which
          // `useWindowFocusHydration` sets right after WorkspacePage mounts.
          connectionId = focusedConnId ?? "";
        }
        if (connectionId) {
          const db = resolveActiveDb(connectionId);
          addQueryTab(connectionId, db);
          markConnectionUsed(connectionId);
        }
        return;
      }

      let eventName: string | null = null;
      if (key === "s") eventName = "commit-changes";
      else if (key === "p") eventName = "quick-open";

      if (!eventName) return;

      // Skip if focus is inside a text input, textarea, select, or contenteditable
      if (isEditableTarget(e.target)) return;

      e.preventDefault();
      window.dispatchEvent(new CustomEvent(eventName));
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, addQueryTab, markConnectionUsed, focusedConnId]);

  // 2026-05-16 — receives `menu:new-query-tab`, which the backend NSMenu
  // Cmd+N emits to the focused workspace window. User journey: workspace
  // focused + Cmd+N → the backend dispatcher emits to this window → a raw
  // query tab opens. Works with no tabs too — takes the conn id from the
  // workspace label and calls addQueryTab.
  useTauriListener(
    () =>
      listen("menu:new-query-tab", () => {
        let connectionId = activeTab?.connectionId ?? "";
        if (!connectionId) {
          const label = getCurrentWindowLabel();
          if (label) connectionId = parseWorkspaceLabel(label) ?? "";
        }
        if (!connectionId) connectionId = focusedConnId ?? "";
        if (!connectionId) return;
        const db = resolveActiveDb(connectionId);
        addQueryTab(connectionId, db);
        markConnectionUsed(connectionId);
      }),
    [activeTab, addQueryTab, markConnectionUsed, focusedConnId],
  );

  // Cmd+1..9 / Ctrl+1..9 — switch to the N-th workspace tab (1-indexed).
  // Top-row digits only; `Numpad1`.. are intentionally NOT matched.
  //
  // Unlike most global shortcuts we intentionally do NOT skip on
  // `isEditableTarget`: the SQL editor (CodeMirror `contenteditable`) and
  // inline-edit DataGrid cells hold focus during normal use, and Cmd+1..9
  // has no in-editor meaning to preserve. Same rationale as Cmd+W above.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      const digit = e.key;
      if (digit < "1" || digit > "9") return;
      const index = Number(digit) - 1;
      const tabId = tabIds[index];
      if (!tabId) return;
      e.preventDefault();
      if (!workspaceKey) return;
      setActiveTab(workspaceKey.connId, workspaceKey.db, tabId);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [tabIds, workspaceKey, setActiveTab]);

  // Cmd+R / Ctrl+R / F5 — context-aware soft refresh.
  // Cmd+Shift+R / Ctrl+Shift+R — #1719 (Part of #1717) Stage 2 hard refresh:
  // reconnect the session, invalidate the schema/grid caches, and refetch. We
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

      // #1719 (Part of #1717) — Cmd+Shift+R hard refresh: tear the session
      // down + rebuild, invalidate the schema/grid caches, and refetch. Gated
      // behind the same shared #1705 discard-confirm the soft records refresh
      // uses so pending edits aren't dropped without a prompt (clean windows
      // reconnect immediately). reset-column-widths moved to the grid header
      // context menu (right-click a column header).
      if (lowerKey === "r" && e.shiftKey) {
        const connId = activeTab?.connectionId ?? currentConnId;
        if (!connId) return;
        confirmDiscard(windowHasDirtyRef.current, () => {
          void hardRefresh(connId);
        });
        return;
      }

      if (activeTab && activeTab.type === "table") {
        // Table tab active — dispatch based on subview
        if (activeTab.subView === "records") {
          // #1718 (Part of #1717) — a records-grid refresh refetches and drops
          // the active cell editor (`useRdbDataGridShortcuts` → onCancelEdit),
          // so it can discard an in-progress edit. Route the dispatch through
          // the shared #1705 discard-confirm while the window holds pending
          // edits: confirm proceeds (refresh + reset), cancel preserves the
          // edit. Clean windows refresh immediately. The gate lives here so it
          // applies uniformly to every records paradigm (RDB + document).
          confirmDiscard(windowHasDirtyRef.current, () =>
            window.dispatchEvent(new CustomEvent("refresh-data")),
          );
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
  }, [activeTab, confirmDiscard, currentConnId, hardRefresh]);

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
        if (!workspaceKey) return;
        reopenLastClosedTab(workspaceKey.connId, workspaceKey.db);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [workspaceKey, reopenLastClosedTab]);

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

  // Cmd+Shift+P / Ctrl+Shift+P — #1525 read-only data value search (PG).
  // Sibling of Quick Open (Cmd+P, which navigates to an object): Shift finds
  // the object *contents*. The dialog self-gates to PostgreSQL connections.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "P") {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("pg-value-search"));
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

  // Cmd+L / Ctrl+L — show the bottom dock's Details tab, or collapse the dock
  // when it is already showing it. #2426 lifted this from the two grids (RDB
  // and document each registered their own copy) once row details became a
  // dock tab instead of a grid-owned panel. `!e.shiftKey` keeps it off
  // Cmd+Shift+L below; the grids never needed that guard because `e.key` is
  // `"L"` with Shift held.
  const showBottomTab = useLayoutStore((s) => s.showBottomTab);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "l") {
        e.preventDefault();
        showBottomTab("details");
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showBottomTab]);

  // Cmd+B / Ctrl+B — collapse or restore the schema sidebar.
  // Cmd+J / Ctrl+J — collapse or restore the bottom dock, leaving whichever
  // tab it is showing alone. Cmd+L above is the tab-targeted sibling: it
  // asks for a *view* ("show me row details"), this asks for *space* ("give
  // me the grid back"). They overlap only on the collapse half, so both stay.
  //
  // The focus policy differs per letter, and the matrix in `App.test.tsx`
  // carries the two rows:
  //   - `b` skips editable targets. `standardKeymap` folds `emacsStyleKeymap`
  //     in as mac-only bindings and `Ctrl-b` there is `cursorCharLeft`, which
  //     every editor in this app inherits through `defaultKeymap`. CodeMirror
  //     preventDefaults without stopping propagation (#1224), so an unguarded
  //     handler here would collapse the sidebar *on top of* the caret moving
  //     one character left.
  //   - `j` does not skip them, like Cmd+L and Cmd+1..9 above. Neither
  //     `standardKeymap` nor any editor in this repo binds it, so no
  //     keystroke is taken away — and wanting the grid back is at its most
  //     useful while the editor holds focus.
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const toggleBottomPanel = useLayoutStore((s) => s.toggleBottomPanel);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key === "b") {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        toggleSidebar();
      } else if (e.key === "j") {
        e.preventDefault();
        toggleBottomPanel();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar, toggleBottomPanel]);

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
      addTab(connectionId, {
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
      const db = resolveActiveDb(connectionId);
      addQueryTab(connectionId, db);
      markConnectionUsed(connectionId);
      // The selector-bound `tabs` snapshot doesn't include the just-added
      // tab until React's next commit, but we need its id to seed the SQL
      // body. Read the store directly for this one call.
      // eslint-disable-next-line no-restricted-syntax
      const ws = useWorkspaceStore.getState().workspaces[connectionId]?.[db];
      const newTab = ws?.tabs[ws.tabs.length - 1];
      if (newTab && newTab.type === "query" && source) {
        updateQuerySql(connectionId, db, newTab.id, source);
      }
    };
    window.addEventListener("quickopen-function", handler);
    return () => window.removeEventListener("quickopen-function", handler);
  }, [addQueryTab, markConnectionUsed, updateQuerySql]);

  // ADR 0023, AC-256-02 — prod-only 1px window border tracks the *active
  // tab* (not focusedConnId) so a user pivoting from a prod tab to a dev tab
  // loses the red frame instantly. The border (an inset `box-shadow`) is
  // opted in here on a wrapper that lives *outside* the existing flex shell
  // so the existing layout math is untouched (prevents a re-layout /
  // scroll-shift the moment the border appears).
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
        <PgValueSearch />
        <ShortcutCheatsheet />
        <QueryLog />
        {/* #1101 — discard confirmation for Cmd+W / native window close. */}
        {discardDialog}
        {/* Mounted at the App root, NOT inside a Radix dialog portal — a
            toast surfaced from inside a modal must survive the modal
            being closed. */}
        <Toaster />
      </div>
    </ErrorBoundary>
  );
}
