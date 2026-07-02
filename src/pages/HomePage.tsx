import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownUp,
  ChevronDown,
  ChevronRight,
  Clock,
  FolderPlus,
  Monitor,
  Moon,
  Plus,
  Sun,
} from "lucide-react";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useThemeStore } from "@stores/themeStore";
import { THEME_CATALOG } from "@lib/themeCatalog";
import { useWindowFocusHydration } from "@hooks/useWindowFocusHydration";
import { subscribeSystemModeChange } from "@lib/themeBoot";
import { persistSettingValue } from "@lib/tauri/settings";
import { Button } from "@components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import {
  ConnectionDialog,
  ConnectionList,
  GroupDialog,
  ImportExportDialog,
  RecentConnections,
  useConnectionStore,
} from "@features/connection";
import ThemePicker from "@components/theme/ThemePicker";
import { resetSetting } from "@lib/tauri/settings";
import { useMruStore } from "@stores/mruStore";
import { logger } from "@lib/logger";
import { toast } from "@lib/runtime/toast";
import i18n from "@lib/i18n";
import { RotateCcw, Eraser } from "lucide-react";

/**
 * HomePage — paradigm-agnostic connection management screen (sprint 125).
 *
 * Renders the existing `ConnectionList` (which transitively includes
 * `ConnectionGroup` headers + drag/drop + import/export plumbing) along with
 * a "Recent" placeholder slot reserved for sprint 127.
 *
 * "Open" semantics: a single click selects (focuses) a connection; a double
 * click (or Enter) on a connected row activates it and swaps the app shell
 * to the Workspace screen. The activation itself flows through
 * `connectionStore.connectToDatabase` exactly as the previous Sidebar did —
 * we only intercept the post-connect callback so that the full-screen swap
 * happens at the right moment.
 *
 * Reaching here when nothing is connected: the user gets the empty-state
 * card from `ConnectionList` directing them to add a connection. The
 * `[+ Connection]` / `[+ Group]` / `[Import / Export]` buttons live in the
 * top header strip.
 */
// Sprint 296 — theme picker 를 제외한 footer (현재는 Recent 묶음) 가 한
// 단위로 접힌다.
// Sprint 369 (Phase 4, Q20.1) — `table-view-recent-collapsed` localStorage 영속
// 폐기. `settings.home_recent_collapsed` 의 SQLite SOT 로 전환. 본 컴포넌트는
// 초기 default = false 로 가벼운 mount 만 하고 (boot snapshot 가 차후 sprint
// 에서 hydrate 추가), 사용자 토글 시 `persistSetting` IPC 로 즉시 commit.

export default function HomePage() {
  const { t } = useTranslation("pages");
  // Re-hydrate from session storage on mount and window focus so the
  // launcher picks up disconnects/state changes made in the workspace.
  useWindowFocusHydration();

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [showNewGroupDialog, setShowNewGroupDialog] = useState(false);
  const [recentCollapsed, setRecentCollapsed] = useState<boolean>(false);
  const clearRecentConnections = useMruStore((s) => s.clearRecentConnections);

  const toggleRecentCollapsed = useCallback(() => {
    setRecentCollapsed((prev) => {
      const next = !prev;
      // #1092 — SQLite is the SOT with no boot reconcile; surface a failed
      // write (dev log + toast) instead of swallowing it. The in-process
      // state stays updated so the UX is uninterrupted.
      void persistSettingValue("home_recent_collapsed", next).catch(
        (e: unknown) => {
          const message = e instanceof Error ? e.message : String(e ?? "");
          logger.warn(
            `[HomePage] persist_setting(home_recent_collapsed) failed: ${message}`,
          );
          toast.error(i18n.t("feedback:storageWriteFailed"));
        },
      );
      return next;
    });
  }, []);

  // Sprint 376 (Phase 6 Q21 #2) — Recent collapse reset. Backend deletes
  // the SQLite row and emits setting.reset; the strategy contract
  // line 1389 says receivers don't refetch — they apply the frontend
  // default (false) directly. Local window: collapse to default false
  // synchronously to mirror the cross-window outcome.
  const handleResetRecentCollapse = useCallback(() => {
    setRecentCollapsed(false);
    void resetSetting("home_recent_collapsed").catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e ?? "");
      logger.warn(
        `[HomePage] reset_setting(home_recent_collapsed) failed: ${message}`,
      );
    });
  }, []);

  // Sprint 376 (Phase 6 Q21 #8) — "Clear recent" affordance. Empties
  // the local zustand store + fires `clear_mru` IPC. No confirm dialog
  // (Q21 contract — direct IPC).
  const handleClearRecent = useCallback(() => {
    clearRecentConnections();
  }, [clearRecentConnections]);

  const focusedConnId = useConnectionStore((s) => s.focusedConnId);
  const setFocusedConn = useConnectionStore((s) => s.setFocusedConn);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const clearForConnection = useWorkspaceStore((s) => s.clearForConnection);

  const themeId = useThemeStore((s) => s.themeId);
  const themeMode = useThemeStore((s) => s.mode);
  const handleSystemChange = useThemeStore((s) => s.handleSystemChange);

  useEffect(() => {
    if (themeMode !== "system") return;
    return subscribeSystemModeChange(handleSystemChange);
  }, [themeMode, handleSystemChange]);

  // Listen for Cmd+N keyboard shortcut dispatched from App. Mirrors the
  // wiring the legacy Sidebar had so the existing global shortcut keeps
  // working from the Home screen.
  useEffect(() => {
    const handler = () => setShowNewDialog(true);
    window.addEventListener("new-connection", handler);
    return () => window.removeEventListener("new-connection", handler);
  }, []);

  const handleSelect = (id: string) => {
    setFocusedConn(id);
  };

  // onActivate is fired by ConnectionItem after a successful double-click
  // connect (or for already-connected rows). We hand that signal directly to
  // the appShell so the user lands inside Workspace immediately. The actual
  // schema-tree mount happens because Workspace's Sidebar reads the same
  // focusedConnId we set on select.
  //
  // When the user double-clicks a *different* connection from Home while
  // another is currently focused, the swap must update `focusedConnId`
  // even when the new connection was already connected via a previous
  // session / context-menu Connect. ConnectionItem's `handleDoubleClick`
  // calls `connectToDatabase` for the not-yet-connected path; the
  // `setFocusedConn` here must run unconditionally so the Workspace
  // Sidebar/Toolbar re-render around the new connection.
  //
  // The `activatingRef` guard prevents rapid re-entry so double-clicks
  // don't trigger multiple `showWindow` calls in parallel.
  const activatingRef = useRef(false);

  const handleActivate = useCallback(
    (id: string) => {
      if (activatingRef.current) return; // guard against rapid re-entry

      // Stale-tab cleanup for connections different from the activated one.
      const staleConnIds = Object.keys(workspaces).filter((cid) => cid !== id);
      for (const cid of staleConnIds) {
        clearForConnection(cid);
      }
      setFocusedConn(id);
      activatingRef.current = true;
      // Wave 9.5 회귀 1 (2026-05-16) — 사용자 desired UX 정정:
      // "connection 을 열어도 connections 창이 안 닫혀야 해". launcher 는
      // 항상 visible 로 유지. workspace 윈도우 build/focus 는 ConnectionList
      // 의 `openWorkspaceWindow(id)` 책임. HomePage 의 handleActivate 는
      // store side (focusedConn / stale cleanup) 만 책임.
      // (이전 sprint-175 single-workspace 모델의 showWindow / focusWindow /
      // hideWindow 호출은 모두 제거 — 두 창 공존 회귀의 원천.)
      // microtask 한 번 양보해 activatingRef 의 lifecycle 을 일관되게 유지
      // (rapid double-click guard 의 비동기 release 시점).
      void Promise.resolve().finally(() => {
        activatingRef.current = false;
      });
    },
    [setFocusedConn, workspaces, clearForConnection],
  );

  const activeEntry =
    THEME_CATALOG.find((t) => t.id === themeId) ?? THEME_CATALOG[0];
  const ThemeIcon =
    themeMode === "dark" ? Moon : themeMode === "light" ? Sun : Monitor;

  return (
    <div
      className="flex h-full w-full flex-col bg-secondary"
      data-testid="home-page"
    >
      {/* Action bar — connection-management buttons only. The legacy
          SidebarModeToggle ToggleGroup is intentionally absent here; Home is
          a single-mode screen. */}
      <div className="flex items-center justify-between border-b border-border py-1 pl-3 pr-1">
        <span
          data-testid="home-header"
          className="block truncate text-xs font-semibold text-foreground"
        >
          {t("connections")}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-secondary-foreground"
            aria-label={t("clearRecent")}
            title={t("clearRecentTitle")}
            onClick={handleClearRecent}
            data-testid="home-clear-recent"
          >
            <Eraser />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-secondary-foreground"
            aria-label={t("importExport")}
            title={t("importExport")}
            onClick={() => setShowImportExport(true)}
          >
            <ArrowDownUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-secondary-foreground"
            aria-label={t("newGroup")}
            title={t("newGroup")}
            onClick={() => setShowNewGroupDialog(true)}
          >
            <FolderPlus />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-secondary-foreground"
            aria-label={t("newConnection")}
            title={t("newConnection")}
            onClick={() => setShowNewDialog(true)}
          >
            <Plus />
          </Button>
        </div>
      </div>

      {/* Body — connection list. Single-column layout intentionally. */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-auto">
          <ConnectionList
            selectedId={focusedConnId}
            onSelect={handleSelect}
            onActivate={handleActivate}
          />
        </div>
      </div>

      {/* Recent — MRU connection list. Sprint 296: 라벨 헤더가 토글
          버튼 역할을 한다. theme picker 는 별도 footer 영역에 머무르며
          이 collapse 의 영향을 받지 않는다.

          Sprint 376 (Phase 6 Q21 #2) — 헤더에 "Reset" 버튼 추가. 우클릭
          context-menu 대신 가시 버튼 — 키보드 사용자가 발견 가능하도록
          (Q21 직관적 위치 contract). */}
      <div
        className="border-t border-border px-3 py-2"
        data-testid="home-recent"
      >
        <div className="mb-1 flex w-full items-center gap-1.5">
          <button
            type="button"
            onClick={toggleRecentCollapsed}
            aria-expanded={!recentCollapsed}
            aria-controls="home-recent-body"
            aria-label={t("toggleRecent")}
            className="flex flex-1 items-center gap-1.5 text-3xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            {recentCollapsed ? (
              <ChevronRight size={10} />
            ) : (
              <ChevronDown size={10} />
            )}
            <Clock size={10} />
            <span>{t("recent")}</span>
          </button>
          <button
            type="button"
            onClick={handleResetRecentCollapse}
            aria-label={t("resetRecentCollapse")}
            title={t("resetRecentCollapseTitle")}
            className="rounded p-0.5 text-3xs text-muted-foreground hover:bg-muted hover:text-foreground"
            data-testid="home-recent-reset"
          >
            <RotateCcw size={10} />
          </button>
        </div>
        {!recentCollapsed && (
          <div id="home-recent-body">
            <RecentConnections onActivate={handleActivate} />
          </div>
        )}
      </div>

      {/* Sprint 377 (2026-05-17) — sprint-376 의 Settings panel reset
          버튼 strip 제거. 사용자 직접 요청; Q21 9 affordance contract
          의 #1 / #3-b 는 sidebar handle 우클릭 (#3-a) + home-recent
          footer reset (#2) + 다른 7 affordance 로 충분. */}

      {/* Theme picker footer — same control as the legacy Sidebar so the
          user can change themes without leaving Home. */}
      <div className="border-t border-border px-3 py-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="w-full justify-start text-muted-foreground"
              aria-label={t("themePickerAria", {
                name: activeEntry.name,
                mode: themeMode,
              })}
            >
              <span
                aria-hidden="true"
                className="h-3 w-3 shrink-0 rounded-full border border-border"
                style={{ backgroundColor: activeEntry.swatch }}
              />
              <span className="truncate">{activeEntry.name}</span>
              <ThemeIcon className="ml-auto" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="top"
            sideOffset={8}
            collisionPadding={8}
            className="w-72 p-2"
          >
            <ThemePicker />
          </PopoverContent>
        </Popover>
      </div>

      {showNewDialog && (
        <ConnectionDialog onClose={() => setShowNewDialog(false)} />
      )}

      {showImportExport && (
        <ImportExportDialog onClose={() => setShowImportExport(false)} />
      )}

      {showNewGroupDialog && (
        <GroupDialog onClose={() => setShowNewGroupDialog(false)} />
      )}
    </div>
  );
}
