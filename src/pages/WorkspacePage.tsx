import { useEffect } from "react";
import { ArrowLeft, Sun, Moon, Monitor } from "lucide-react";
import Sidebar from "@components/layout/Sidebar";
import MainArea from "@components/layout/MainArea";
import { Button } from "@components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import ThemePicker from "@components/theme/ThemePicker";
import { useThemeStore } from "@stores/themeStore";
import { useConnectionStore } from "@stores/connectionStore";
import { THEME_CATALOG } from "@lib/themeCatalog";
import {
  hideWindow,
  showWindow,
  onCurrentWindowCloseRequested,
} from "@lib/window-controls";

/**
 * WorkspacePage — multi-paradigm tab + sidebar work surface.
 *
 * Renders the existing `Sidebar` alongside `MainArea`, with a
 * `[← Connections]` button stacked above the sidebar so the user can swap
 * back to the launcher without losing tab state.
 *
 * Sprint 154 wires the lifecycle to real Tauri windows:
 *
 *   - `handleBackToConnections` (toolbar back button) hides the workspace
 *     window then shows the launcher window. The connection pool is
 *     deliberately NOT torn down — Back ≠ Disconnect. Re-entry from the
 *     launcher must be instant.
 *
 *   - The `tauri://close-requested` listener treats the OS-level close
 *     as identical to Back (AC-154-05): hide workspace + show launcher,
 *     no disconnect. The default close behaviour (which would actually
 *     close the window) is prevented by the `onCloseRequested` seam.
 *
 * Disconnect (which DOES tear down the pool) is owned by the
 * `DisconnectButton` in `WorkspaceToolbar` and is intentionally NOT a
 * window-level affordance — pool eviction must not cascade into a window
 * hide.
 */
export default function WorkspacePage() {
  // Theme store — used to render the theme toggle trigger button alongside
  // the Back button in the workspace header strip. The ThemePicker popover
  // itself reads the store directly, so we only need themeId/mode for the
  // trigger's visual state.
  const themeId = useThemeStore((s) => s.themeId);
  const themeMode = useThemeStore((s) => s.mode);

  const activeEntry =
    THEME_CATALOG.find((t) => t.id === themeId) ?? THEME_CATALOG[0];
  const ThemeIcon =
    themeMode === "dark" ? Moon : themeMode === "light" ? Sun : Monitor;

  // Back-to-connections — separate handler from disconnect. Calling order
  // is asserted in window-transitions.test.tsx (AC-154-02).
  const handleBackToConnections = async () => {
    try {
      await hideWindow("workspace");
      await showWindow("launcher");
    } catch (e) {
      console.warn(
        "[workspace-back] window transition failed:",
        e instanceof Error ? e.message : e,
      );
    }
  };

  // Register the `tauri://close-requested` listener with Back semantics.
  // Uses `onCurrentWindowCloseRequested` instead of `onCloseRequested(label)`
  // because the latter depends on `getByLabel` which proved unreliable — it
  // could return null and skip registering the handler, leaving the OS free
  // to actually destroy the workspace with no launcher visible.
  // `getCurrentWebviewWindow()` is reliable from within the window itself.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      const fn = await onCurrentWindowCloseRequested(() =>
        handleBackToConnections(),
      );
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  // Re-hydrate connection state from session storage when the workspace
  // gains focus. The workspace window is born hidden at app startup; its
  // boot-time hydration (main.tsx) reads empty session data. When the user
  // later connects in the launcher and focuses the workspace, this effect
  // ensures the store picks up the latest focusedConnId + activeStatuses.
  useEffect(() => {
    const hydrate = () => {
      useConnectionStore.getState().hydrateFromSession();
    };
    hydrate();
    window.addEventListener("focus", hydrate);
    return () => window.removeEventListener("focus", hydrate);
  }, []);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Sidebar column — back button + theme picker stacked above the
          existing Sidebar so its layout (header / mode toggle / body) stays
          unchanged from the user's perspective. The buttons get their own
          aria-labels per the sprint contract for unambiguous e2e selection. */}
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border bg-secondary px-2 py-1.5">
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:text-secondary-foreground"
            aria-label="Back to connections"
            title="Back to connections"
            onClick={handleBackToConnections}
          >
            <ArrowLeft />
            <span className="text-xs">Connections</span>
          </Button>

          {/* Sprint 161 — Workspace-level theme toggle. Mirrors the
              Popover+ThemePicker pattern from Sidebar.tsx so users can
              change theme from the header without scrolling to the sidebar
              footer. */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground hover:text-secondary-foreground"
                aria-label={`Workspace theme: ${activeEntry.name} (${themeMode})`}
                title="Change theme"
              >
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 rounded-full border border-border"
                  style={{ backgroundColor: activeEntry.swatch }}
                />
                <ThemeIcon size={12} />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="bottom"
              sideOffset={4}
              collisionPadding={8}
              className="w-72 p-2"
            >
              <ThemePicker />
            </PopoverContent>
          </Popover>
        </div>
        <Sidebar />
      </div>
      <MainArea />
    </div>
  );
}
