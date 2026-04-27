import { useEffect, useState } from "react";
import {
  ArrowDownUp,
  Clock,
  FolderPlus,
  Monitor,
  Moon,
  Plus,
  Sun,
} from "lucide-react";
import { useAppShellStore } from "@stores/appShellStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useTabStore } from "@stores/tabStore";
import { useThemeStore } from "@stores/themeStore";
import { THEME_CATALOG } from "@lib/themeCatalog";
import { subscribeSystemModeChange } from "@lib/themeBoot";
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
export default function HomePage() {
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [showNewGroupDialog, setShowNewGroupDialog] = useState(false);

  const focusedConnId = useConnectionStore((s) => s.focusedConnId);
  const setFocusedConn = useConnectionStore((s) => s.setFocusedConn);
  const setScreen = useAppShellStore((s) => s.setScreen);

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
  // Sprint 134 — when the user double-clicks a *different* connection from
  // Home while another is currently focused, the swap must update
  // `focusedConnId` even when the new connection was already connected via
  // a previous session/context-menu Connect. ConnectionItem's
  // `handleDoubleClick` calls `connectToDatabase` for the not-yet-connected
  // path, so we don't have to duplicate that here — but `setFocusedConn`
  // must run unconditionally so the Workspace Sidebar/Toolbar re-render
  // around the new connection. (This was the root cause of the toolbar
  // ConnectionSwitcher's "swap doesn't happen" bug per the lesson.)
  const handleActivate = (id: string) => {
    // Sprint 148 (AC-142-2) — when the user activates a connection that
    // differs from any open workspace tab's owner, close those stale
    // tabs so the new workspace doesn't inherit cross-connection state.
    // Same-connection reactivation keeps existing tabs untouched.
    const tabState = useTabStore.getState();
    const staleConnIds = new Set(
      tabState.tabs
        .filter((t) => t.connectionId !== id)
        .map((t) => t.connectionId),
    );
    for (const cid of staleConnIds) {
      tabState.clearTabsForConnection(cid);
    }
    setFocusedConn(id);
    setScreen("workspace");
  };

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

      {/* Body — connection list. Sprint 125 leaves the layout single-column
          intentionally; sprints 127+ may split this into a wider canvas. */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-auto">
          <ConnectionList
            selectedId={focusedConnId}
            onSelect={handleSelect}
            onActivate={handleActivate}
          />
        </div>
      </div>

      {/* Recent — placeholder slot reserved for sprint 127's MRU wiring.
          The empty card stays visible so the layout doesn't shift when the
          real list lands. */}
      <div
        className="border-t border-border px-3 py-2"
        data-testid="home-recent"
      >
        <div className="mb-1 flex items-center gap-1.5 text-3xs uppercase tracking-wider text-muted-foreground">
          <Clock size={10} />
          <span>Recent</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Recently opened connections will appear here.
        </p>
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
