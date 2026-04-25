import { ArrowLeft } from "lucide-react";
import Sidebar from "@components/layout/Sidebar";
import MainArea from "@components/layout/MainArea";
import { Button } from "@components/ui/button";
import { useAppShellStore } from "@stores/appShellStore";

/**
 * WorkspacePage — multi-paradigm tab + sidebar work surface (sprint 125).
 *
 * Renders the existing `Sidebar` (now schemas-only — the
 * connections-mode/SidebarModeToggle branch has been removed for sprint 125)
 * alongside `MainArea`, with a `[← Connections]` button stacked above the
 * sidebar so the user can swap back to Home without losing tab state.
 *
 * Tab persistence happens entirely inside `tabStore` — this component does
 * not touch tabs when swapping screens, so re-entry restores whichever tab
 * was active before the user clicked `[← Connections]`.
 *
 * Sprint 126+ will introduce a `WorkspaceToolbar` and a paradigm-aware
 * sidebar slot. Sprint 125 deliberately keeps the existing Sidebar shell so
 * tab-store / schema-store invariants stay flat.
 */
export default function WorkspacePage() {
  const setScreen = useAppShellStore((s) => s.setScreen);

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
            onClick={() => setScreen("home")}
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
