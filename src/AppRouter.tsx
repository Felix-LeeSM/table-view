import { useEffect } from "react";
import ErrorBoundary from "./components/shared/ErrorBoundary";
import LauncherPage from "./pages/LauncherPage";
import WorkspacePage from "./pages/WorkspacePage";
import QuickOpen from "./components/shared/QuickOpen";
import ShortcutCheatsheet from "./components/shared/ShortcutCheatsheet";
import QueryLog from "./components/query/QueryLog";
import { Toaster } from "./components/ui/toaster";
import { useConnectionStore } from "./stores/connectionStore";
import { useFavoritesStore } from "./stores/favoritesStore";
import { useMruStore } from "./stores/mruStore";
import { getCurrentWindowLabel } from "@lib/window-label";
import App from "./App";

/**
 * AppRouter — Sprint 150 boot-time label dispatcher (Phase 12).
 *
 * Reads the current `WebviewWindow.label` once at mount and picks the
 * appropriate top-level shell:
 *   - `launcher`  → `LauncherPage` (connection management, 720×560)
 *   - `workspace` → existing workspace shell (sidebar + tabs, 1280×800)
 *   - anything else (including `null` when the Tauri seam isn't available)
 *     → defensive fallback to `LauncherPage` with a single `console.warn`.
 *
 * Cross-window state sync (Sprint 151+), real lifecycle wiring
 * (Sprint 154), and `appShellStore.screen` deprecation (Sprint 154) are
 * deliberately out of scope here. `App` is still mounted under the
 * workspace branch so all keyboard-shortcut wiring keeps working untouched
 * — the only thing this sprint takes away from `App` is its top-level
 * `screen`-driven page selection (which the launcher window has no need
 * for).
 */
export default function AppRouter() {
  const label = getCurrentWindowLabel();

  // Resolve the route up front so the JSX has a single, exhaustive branch.
  // We intentionally accept `string | null` — `getCurrentWindowLabel()`
  // doesn't enforce the `KnownWindowLabel` union (future windows / runtime
  // failures), and the router fallback is what makes that safe.
  let route: "launcher" | "workspace";
  if (label === "launcher") {
    route = "launcher";
  } else if (label === "workspace") {
    route = "workspace";
  } else {
    // Defensive: a missing or unknown label means the Tauri side gave us
    // something the frontend doesn't know how to mount. Surface it once
    // (so debug builds notice) and land the user on the launcher — that
    // is the safer default because the launcher's connection list is the
    // entry surface for every workflow.
    console.warn(
      `[AppRouter] unknown window label ${JSON.stringify(label)} — falling back to launcher`,
    );
    route = "launcher";
  }

  return route === "launcher" ? <LauncherShell /> : <WorkspaceShell />;
}

/**
 * Launcher chrome: connection bootstrap + LauncherPage. The launcher window
 * is the only place where the connection list / groups / favorites must
 * load on boot, so we initialize those stores here. (Sprint 152 will move
 * these into a cross-window bridge so the workspace window observes the
 * same state without re-loading.)
 */
function LauncherShell() {
  const loadConnections = useConnectionStore((s) => s.loadConnections);
  const loadGroups = useConnectionStore((s) => s.loadGroups);
  const initEventListeners = useConnectionStore((s) => s.initEventListeners);
  const loadPersistedFavorites = useFavoritesStore(
    (s) => s.loadPersistedFavorites,
  );
  const loadPersistedMru = useMruStore((s) => s.loadPersistedMru);

  useEffect(() => {
    loadConnections();
    loadGroups();
    initEventListeners();
    loadPersistedFavorites();
    loadPersistedMru();
  }, [
    loadConnections,
    loadGroups,
    initEventListeners,
    loadPersistedFavorites,
    loadPersistedMru,
  ]);

  return (
    <ErrorBoundary>
      <div className="flex h-screen w-screen overflow-hidden bg-background">
        <LauncherPage />
        <QuickOpen />
        <ShortcutCheatsheet />
        <QueryLog />
        <Toaster />
      </div>
    </ErrorBoundary>
  );
}

/**
 * Workspace chrome: keep mounting the existing `App` so all of the
 * keyboard shortcut wiring / portal mounts that currently live in `App.tsx`
 * keep working. `App.tsx` no longer routes between Home and Workspace at
 * the top level (that responsibility now lives here); it always renders
 * `WorkspacePage`.
 */
function WorkspaceShell() {
  return <App />;
}

// Re-export the workspace mount so unit tests that previously imported the
// concrete `WorkspacePage` continue to work while later sprints peel apart
// `App`.
export { WorkspacePage };
