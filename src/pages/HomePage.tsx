import RevealLogsButton from "@components/settings/RevealLogsButton";
import ThemeGallery from "@components/theme/ThemeGallery";
import ThemePicker from "@components/theme/ThemePicker";
import { Button } from "@components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import {
  ConnectionBrowser,
  ConnectionDialog,
  GroupDialog,
  ImportExportDialog,
  useConnectionStore,
} from "@features/connection";
import { useWindowFocusHydration } from "@hooks/useWindowFocusHydration";
import { subscribeSystemModeChange } from "@lib/themeBoot";
import { THEME_CATALOG } from "@lib/themeCatalog";
import { useThemeStore } from "@stores/themeStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import {
  ArrowDownUp,
  FolderPlus,
  Monitor,
  Moon,
  Plus,
  Sun,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * HomePage — paradigm-agnostic connection management screen (sprint 125).
 *
 * Renders `ConnectionBrowser` — the group rail plus the connections it filters
 * to (which transitively includes `ConnectionGroup` headers + drag/drop).
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
// #2440 — Recent 는 footer 가 아니라 group rail 의 한 view 다. footer 를
// 접던 `settings.home_recent_collapsed` 는 접을 대상이 없어져 이 컴포넌트에서
// 빠졌다 (SQLite key 자체는 backend 에 남아 있고 쓰는 쪽이 없다).

export default function HomePage() {
  const { t } = useTranslation("pages");
  // Re-hydrate from session storage on mount and window focus so the
  // launcher picks up disconnects/state changes made in the workspace.
  useWindowFocusHydration();

  // #1134 — move focus to the "Connections" landmark heading when the
  // launcher window mounts so screen-reader users land on the page name.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [showNewGroupDialog, setShowNewGroupDialog] = useState(false);

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
        <h1
          ref={headingRef}
          tabIndex={-1}
          data-testid="home-header"
          className="block truncate text-xs font-semibold text-foreground focus:outline-none"
        >
          {t("connections")}
        </h1>
        {/* #2433 — the "Clear recent" Eraser used to sit here, first in this
            row. It aims at the Recent list, so it now lives at the foot of
            that list (`RecentConnections`) behind a confirm; this bar keeps
            only the connection-management actions. */}
        <div className="flex items-center gap-1">
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

      {/* Body — group rail on the left, its connections on the right (#2440).
          "Recent" is a rail view, so there is no footer list any more. */}
      <ConnectionBrowser
        selectedId={focusedConnId}
        onSelect={handleSelect}
        onActivate={handleActivate}
      />

      {/* Sprint 377 (2026-05-17) — sprint-376 의 Settings panel reset
          버튼 strip 제거. 사용자 직접 요청; Q21 9 affordance contract
          의 #1 / #3-b 는 sidebar handle 우클릭 (#3-a) + 나머지 affordance
          로 충분. #2440 에서 home-recent footer reset (#2) 은 접을 footer
          자체가 없어져 같이 빠졌다. */}

      {/* Diagnostics footer — reveal the rotating log folder (#1566 / #1599)
          so a user can attach logs to a bug report without hunting the
          platform data dir. The launcher footer is the app-level settings
          surface (theme picker lives here) and is always visible, so support
          can reliably direct users to it; no dedicated About/Settings screen
          exists. */}
      <div className="border-t border-border px-3 py-2">
        <RevealLogsButton className="w-full justify-start text-muted-foreground" />
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
            className="w-72 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-2"
          >
            <ThemePicker />
          </PopoverContent>
        </Popover>
      </div>

      {/* #2118 — mounted here, not inside the popover: the picker's "browse all"
          button raises `themeFavoritesStore.galleryOpen`, and if the overlay
          were a child of `PopoverContent` it would unmount with the popover. */}
      <ThemeGallery />

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
