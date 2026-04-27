import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import Sidebar from "@components/layout/Sidebar";
import MainArea from "@components/layout/MainArea";
import { Button } from "@components/ui/button";
import { hideWindow, showWindow, onCloseRequested } from "@lib/window-controls";

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
  // Sprint 154 contract pins this — closing the workspace window must NOT
  // tear down the connection pool; it must mirror the explicit Back path.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      const fn = await onCloseRequested("workspace", () =>
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

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Sidebar column — back button stacked above the existing Sidebar
          so its layout (header / mode toggle / body / theme picker) stays
          unchanged from the user's perspective. The button gets its own
          aria-label per the sprint contract for unambiguous e2e selection. */}
      <div className="flex h-full flex-col">
        <div className="flex items-center border-b border-border bg-secondary px-2 py-1.5">
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
        </div>
        <Sidebar />
      </div>
      <MainArea />
    </div>
  );
}
