import { useEffect, useRef } from "react";
import ErrorBoundary from "./components/shared/ErrorBoundary";
import WorkspacePage from "./pages/WorkspacePage";
import QuickOpen from "./components/shared/QuickOpen";
import PgValueSearch from "./components/shared/PgValueSearch";
import ShortcutCheatsheet from "./components/shared/ShortcutCheatsheet";
import QueryLog from "./components/query/QueryLog";
import { Toaster } from "./components/ui/toaster";
import { useConnectionStore } from "@features/connection";
import {
  resolveActiveDb,
  useActiveTabId,
  useActiveTabSansSql,
  useConnectionHasDirtyTabs,
  useCurrentTabIds,
  useCurrentWorkspaceKey,
  useDirtyTabIds,
  useWorkspaceStore,
  flushPersistWorkspaces,
} from "./stores/workspaceStore";
import { useCurrentWindowConnectionId } from "./hooks/useCurrentWindowConnectionId";
import { useDiscardConfirm } from "./hooks/useDiscardConfirm";
import { useFavoritesStore } from "./stores/favoritesStore";
import { useSnippetsStore } from "./stores/snippetsStore";
import { useMruStore } from "./stores/mruStore";
import { useTableActivityStore } from "./stores/tableActivityStore";
import { isEditableTarget } from "./lib/keyboard/isEditableTarget";
import { useThemeStore } from "./stores/themeStore";
import { markBootMilestone } from "./lib/perf/bootInstrumentation";
import { useActiveTabConnection } from "./hooks/useActiveTabConnection";
import { destroyCurrentWindow } from "./lib/window-controls";
import { getCurrentWindowLabel, parseWorkspaceLabel } from "./lib/window-label";
import { listen } from "@tauri-apps/api/event";
import { useTauriListener } from "./hooks/useTauriListener";

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
  // longer emit it implicitly, so the three handlers below pair the call.
  const markConnectionUsed = useMruStore((s) => s.markConnectionUsed);

  const activeTabId = useActiveTabId();
  // #1447 — App consumes only sql-free tab data (active-tab fields for the
  // shortcut handlers, ordered ids for Cmd+1..9). Subscribing to the full
  // `tabs` array re-rendered the entire App tree on every editor keystroke.
  const activeTab = useActiveTabSansSql();
  const tabIds = useCurrentTabIds();
  const workspaceKey = useCurrentWorkspaceKey();
  // Wave 9.5 회귀 5 — Cmd+N + menu:new-query-tab 의 fallback path 에서 사용.
  // 컴포넌트에서 `store.getState()` 직접 호출은 룰 (no-restricted-syntax) 위반
  // 이라 selector hook 으로 받는다.
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

  // Cmd+W / Ctrl+W — 활성 탭이 있으면 그 탭을 닫고, 빈 워크스페이스면 창
  // 자체를 destroy. macOS native NSMenu 의 Cmd+W (lib.rs `close_focused_window`)
  // 가 우선이지만, webview 가 가로채는 input field focus 같은 경우 fallback
  // 으로 같은 시맨틱 (workspace → destroy, launcher → hide) 제공.
  //
  // Wave 9.5 회귀 5 (2026-05-16): 이전 핸들러는 빈 탭일 때 `preventDefault()`
  // 만 호출해 OS default close 도 막아 no-op 으로 떨어졌다. 사용자: "탭 없는
  // 상태에서 Cmd+W = window 꺼져야 해" — destroyCurrentWindow 명시 호출로 fix.
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
      // 빈 워크스페이스 — backend `workspace_close` 가 caller webview 의
      // Window::destroy() 직접 호출. launcher 안에서 fire 되면 backend 는
      // 노출된 command 의 caller 가 launcher 라는 점만 보고 destroy — launcher
      // hide 시맨틱은 native menu 가 처리하므로 webview keydown 으로 도달할
      // 경로는 사실상 workspace 만 (launcher 의 Cmd+W 는 NSMenu 가 먼저
      // 가로채 hide 분기로 간다). 탭이 없으므로 dirty 검사 불필요.
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

  // Sprint 291 + Wave 9.5 회귀 5 (2026-05-16) — workspace 윈도우에서의 Cmd+N
  // 은 connection-create dialog 가 아니라 raw query tab 을 연다 (Cmd+T 와
  // 동일 동작). 사용자 요청: workspace 안에서 새 연결 만들기는 launcher 윈도우
  // (macOS 메뉴 / 별도 진입점) 의 책무이고, workspace 의 Cmd+N 은 "쿼리 새로
  // 작성" 시그널이라는 멘탈 모델.
  //
  // 빈 탭 fallback (회귀 5): 이전 핸들러는 activeTab 의 connectionId 가
  // 비어있으면 no-op 으로 떨어졌다. workspace 마운트 직후엔 tab 이 없을 수
  // 있으므로 window label (`workspace-{conn_id}`) 에서 conn 을 추출해
  // addQueryTab. macOS NSMenu Cmd+N 의 dispatch (lib.rs::handle_menu_new_connection)
  // 가 우선이지만 webview 가 가로채는 input field focus 같은 경우 fallback.
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
          // 회귀 5 fallback A — 현재 window 라벨에서 conn 추출 (workspace
          // window 의 가장 authoritative source). launcher 라벨은
          // parseWorkspaceLabel 이 null 반환.
          const label = getCurrentWindowLabel();
          if (label) connectionId = parseWorkspaceLabel(label) ?? "";
        }
        if (!connectionId) {
          // 회귀 5 fallback B — store 의 focusedConnId. WorkspacePage mount
          // 직후 `useWindowFocusHydration` 이 set 한 값.
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

  // Wave 9.5 회귀 5 (2026-05-16) — backend NSMenu Cmd+N 가 workspace 라벨로
  // 발사하는 `menu:new-query-tab` 수신. user journey: workspace focused +
  // Cmd+N → backend dispatcher 가 이 window 에 emit → raw query tab 열림.
  // 빈 탭 상태에서도 동작 — workspace label 의 conn id 를 추출해 addQueryTab.
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
  }, [activeTab, confirmDiscard]);

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
