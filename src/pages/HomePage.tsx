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
 * HomePage — paradigm-agnostic connection management screen.
 *
 * Renders `ConnectionBrowser` — the group rail plus the connections it filters
 * to (which transitively includes `ConnectionGroup` headers + drag/drop).
 *
 * "Open" semantics: a single click selects (focuses) a connection; a double
 * click (or Enter) on a connected row activates it, and `ConnectionList`
 * opens or focuses that connection's workspace window
 * (`activateConnection`). The activation itself flows through
 * `connectionStore.connectToDatabase` exactly as the previous Sidebar did —
 * we only intercept the post-connect callback to update the store side.
 *
 * Reaching here with no connections at all: the user gets the empty-state
 * card from `ConnectionList` directing them to add a connection. The
 * `[+ Connection]` / `[+ Group]` / `[Import / Export]` buttons live in the
 * top header strip.
 */
// #2440 — Recent is a view in the group rail, not a footer. With nothing left
// to collapse, `settings.home_recent_collapsed` (which collapsed the footer)
// left this component (the SQLite key itself remains in the backend, with no
// writer).

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
      // 2026-05-16 — opening a connection must not close the connections
      // window: the launcher remains visible. Building / focusing the
      // workspace window is the job of `openWorkspaceWindow(id)` in
      // ConnectionList; HomePage's handleActivate owns only the store side
      // (focusedConn / stale cleanup). (The showWindow / focusWindow /
      // hideWindow calls of the earlier single-workspace model were all
      // removed — they caused the two-window regression.)
      // Yield one microtask so the activatingRef lifecycle stays consistent
      // (the async release point of the rapid double-click guard).
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

      {/* 2026-05-17 — the Settings panel's reset-button strip was removed.
          Of the state-management-strategy Q21 nine-affordance contract,
          Q21 #1 / #3-b are covered by the sidebar's "Reset width" (Q21
          #3-a) and the other affordances. #2440 dropped the home-recent
          footer reset (Q21 #2) as well, since the footer it collapsed is
          gone. */}

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
