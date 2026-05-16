import { useCallback, useEffect, useRef, useState } from "react";
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
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useThemeStore } from "@stores/themeStore";
import { THEME_CATALOG } from "@lib/themeCatalog";
import { useWindowFocusHydration } from "@hooks/useWindowFocusHydration";
import { subscribeSystemModeChange } from "@lib/themeBoot";
import { showWindow, hideWindow, focusWindow } from "@lib/window-controls";
import { logger } from "@lib/logger";
import { toast } from "@lib/toast";
import { persistSettingValue } from "@lib/tauri/settings";
import { Button } from "@components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import ConnectionDialog from "@components/connection/ConnectionDialog";
import ConnectionList from "@components/connection/ConnectionList";
import GroupDialog from "@components/connection/GroupDialog";
import ImportExportDialog from "@components/connection/ImportExportDialog";
import RecentConnections from "@components/connection/RecentConnections";
import { LogoWordmark } from "@components/shared/Logo";
import ThemePicker from "@components/theme/ThemePicker";

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
 * top header strip alongside the brand wordmark.
 */
// Sprint 296 — theme picker 를 제외한 footer (현재는 Recent 묶음) 가 한
// 단위로 접힌다.
// Sprint 369 (Phase 4, Q20.1) — `table-view-recent-collapsed` localStorage 영속
// 폐기. `settings.home_recent_collapsed` 의 SQLite SOT 로 전환. 본 컴포넌트는
// 초기 default = false 로 가벼운 mount 만 하고 (boot snapshot 가 차후 sprint
// 에서 hydrate 추가), 사용자 토글 시 `persistSetting` IPC 로 즉시 commit.

export default function HomePage() {
  // Re-hydrate from session storage on mount and window focus so the
  // launcher picks up disconnects/state changes made in the workspace.
  useWindowFocusHydration();

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [showNewGroupDialog, setShowNewGroupDialog] = useState(false);
  const [recentCollapsed, setRecentCollapsed] = useState<boolean>(false);

  const toggleRecentCollapsed = useCallback(() => {
    setRecentCollapsed((prev) => {
      const next = !prev;
      // Best-effort SQLite write. Failure leaves the in-process state
      // updated (UX uninterrupted) — next mutate retries.
      void persistSettingValue("home_recent_collapsed", next).catch(() => {
        /* best-effort; next toggle retries */
      });
      return next;
    });
  }, []);

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

      // When the user activates a connection that differs from any open
      // workspace tab's owner, close those stale tabs so the new workspace
      // doesn't inherit cross-connection state. Same-connection
      // reactivation keeps existing tabs untouched.
      const staleConnIds = Object.keys(workspaces).filter((cid) => cid !== id);
      for (const cid of staleConnIds) {
        clearForConnection(cid);
      }
      setFocusedConn(id);
      activatingRef.current = true;
      // Activation order: workspace.show() → workspace.setFocus() →
      // launcher.hide(). The order matters: `show` then `setFocus` ensures
      // the workspace takes input focus the moment it becomes visible;
      // `launcher.hide()` happens last so a `workspace.show()` rejection
      // leaves the launcher on screen for retry.
      void (async () => {
        try {
          await showWindow("workspace");
        } catch (e) {
          toast.error(
            `Failed to open workspace: ${e instanceof Error ? e.message : String(e)}`,
          );
          return;
        } finally {
          activatingRef.current = false;
        }
        try {
          await focusWindow("workspace");
          await hideWindow("launcher");
        } catch (e) {
          // Best-effort post-show cleanup. The user already sees the
          // workspace at this point, so a focus/hide failure is logged
          // but does not surface a toast (would be misleading — the
          // primary action succeeded).
          logger.warn(
            "[home-activate] post-show cleanup failed:",
            e instanceof Error ? e.message : e,
          );
        }
      })();
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
      {/* Brand header */}
      <div className="flex items-center justify-center border-b border-border px-3 py-2">
        <LogoWordmark className="h-7 w-auto" />
      </div>

      {/* Action bar — connection-management buttons only. The legacy
          SidebarModeToggle ToggleGroup is intentionally absent here; Home is
          a single-mode screen. */}
      <div className="flex items-center justify-between border-b border-border py-1 pl-3 pr-1">
        <span
          data-testid="home-header"
          className="block truncate text-xs font-semibold text-foreground"
        >
          Connections
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-secondary-foreground"
            aria-label="Import / Export"
            title="Import / Export"
            onClick={() => setShowImportExport(true)}
          >
            <ArrowDownUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-secondary-foreground"
            aria-label="New Group"
            title="New Group"
            onClick={() => setShowNewGroupDialog(true)}
          >
            <FolderPlus />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-secondary-foreground"
            aria-label="New Connection"
            title="New Connection"
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
          이 collapse 의 영향을 받지 않는다. */}
      <div
        className="border-t border-border px-3 py-2"
        data-testid="home-recent"
      >
        <button
          type="button"
          onClick={toggleRecentCollapsed}
          aria-expanded={!recentCollapsed}
          aria-controls="home-recent-body"
          aria-label="Toggle Recent"
          className="mb-1 flex w-full items-center gap-1.5 text-3xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          {recentCollapsed ? (
            <ChevronRight size={10} />
          ) : (
            <ChevronDown size={10} />
          )}
          <Clock size={10} />
          <span>Recent</span>
        </button>
        {!recentCollapsed && (
          <div id="home-recent-body">
            <RecentConnections onActivate={handleActivate} />
          </div>
        )}
      </div>

      {/* Theme picker footer — same control as the legacy Sidebar so the
          user can change themes without leaving Home. */}
      <div className="border-t border-border px-3 py-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="w-full justify-start text-muted-foreground"
              aria-label={`Theme picker: currently ${activeEntry.name} (${themeMode})`}
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
