import { useEffect, useLayoutEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
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
import { getCurrentWindowLabel, parseWorkspaceLabel } from "@lib/window-label";
import { markBootMilestone } from "@lib/perf/bootInstrumentation";
import { logger } from "@lib/logger";
import App from "./App";

/**
 * Bridge the macOS native menu click (`File > New Connection`, Cmd+N) into
 * the existing `new-connection` DOM event flow that `HomePage` and
 * `Sidebar` already listen for. Rust emits `menu:new-connection` only
 * after the launcher window is shown/focused (see `install_macos_menu` in
 * `src-tauri/src/lib.rs`), so by the time this listener fires the
 * `<HomePage>` mounted under `<LauncherShell>` is guaranteed to be alive.
 *
 * No-op on Windows/Linux where the menu is never installed and the event
 * is never emitted. `listen` resolves regardless — it is a passive
 * subscription and cheap to keep mounted.
 */
function useMenuNewConnectionBridge() {
  useEffect(() => {
    const unlistenPromise = listen("menu:new-connection", () => {
      window.dispatchEvent(new CustomEvent("new-connection"));
    }).catch(() => undefined);
    return () => {
      // Cleanup is best-effort: unlisten can reject if the listener was
      // already removed or the Tauri runtime is unavailable (test env).
      // The effect is unmounting either way, so swallowing is safe.
      unlistenPromise.then((fn) => fn?.()).catch(() => {});
    };
  }, []);
}

/**
 * AppRouter — boot-time label dispatcher.
 *
 * Reads the current `WebviewWindow.label` once at mount and picks the
 * appropriate top-level shell:
 *   - `launcher`  → `LauncherPage` (connection management, 720×560)
 *   - `workspace` → workspace shell (sidebar + tabs, 1280×800)
 *   - anything else (including `null` when the Tauri seam isn't available)
 *     → defensive fallback to `LauncherPage` with a single `console.warn`.
 *
 * `App` is mounted under the workspace branch so all keyboard-shortcut
 * wiring / portal mounts that live there keep working untouched.
 */
export default function AppRouter() {
  const label = getCurrentWindowLabel();

  // `react:first-paint` boot-tracing milestone. `useLayoutEffect` fires
  // synchronously after React's first commit (after layout, before
  // browser paint), matching the "first commit" semantic. The ref guard
  // prevents StrictMode's double-invoke (and any subsequent re-render)
  // from emitting the mark more than once.
  const firstPaintMarkedRef = useRef(false);
  useLayoutEffect(() => {
    if (firstPaintMarkedRef.current) return;
    firstPaintMarkedRef.current = true;
    markBootMilestone("react:first-paint");
  }, []);

  // sprint-361 (Phase 3, Q13) — workspace windows are now per-connection,
  // labeled `workspace-{connection_id}`. The router recognizes the new
  // pattern via `parseWorkspaceLabel(label) !== null` and treats the bare
  // legacy `"workspace"` label as unknown (it should no longer be emitted
  // by backend after Phase 3 lands). Launcher label is unchanged.
  const isWorkspaceLabel =
    typeof label === "string" && parseWorkspaceLabel(label) !== null;

  // Keep `document.title` in sync with the Tauri window decoration
  // title. webdriver's `getTitle()` reports `document.title` (the
  // webview's HTML `<title>`), NOT the OS window title from
  // `tauri.conf.json`. Both windows load the same `index.html`, so
  // without this they'd both report "Table View" and the e2e helper
  // `switchToWorkspaceWindow` couldn't distinguish them. Aligning the two
  // titles also fixes the dock/taskbar/alt-tab labels in prod.
  useEffect(() => {
    document.title = isWorkspaceLabel ? "Table View — Workspace" : "Table View";
  }, [isWorkspaceLabel]);

  // Resolve the route up front so the JSX has a single, exhaustive branch.
  // We intentionally accept `string | null` — `getCurrentWindowLabel()`
  // doesn't enforce the `KnownWindowLabel` union (future windows / runtime
  // failures), and the router fallback is what makes that safe.
  let route: "launcher" | "workspace";
  if (label === "launcher") {
    route = "launcher";
  } else if (isWorkspaceLabel) {
    route = "workspace";
  } else {
    // Defensive: a missing or unknown label means the Tauri side gave us
    // something the frontend doesn't know how to mount. Surface it once
    // (so debug builds notice) and land the user on the launcher — that
    // is the safer default because the launcher's connection list is the
    // entry surface for every workflow.
    logger.warn(
      `[AppRouter] unknown window label ${JSON.stringify(label)} — falling back to launcher`,
    );
    route = "launcher";
  }

  return route === "launcher" ? <LauncherShell /> : <WorkspaceShell />;
}

/**
 * Launcher chrome: connection bootstrap + LauncherPage. The launcher
 * window is the only place where the connection list / groups / favorites
 * load on boot, so those stores are initialized here.
 */
function LauncherShell() {
  const loadConnections = useConnectionStore((s) => s.loadConnections);
  const loadGroups = useConnectionStore((s) => s.loadGroups);
  const initEventListeners = useConnectionStore((s) => s.initEventListeners);
  const loadPersistedFavorites = useFavoritesStore(
    (s) => s.loadPersistedFavorites,
  );
  const loadPersistedMru = useMruStore((s) => s.loadPersistedMru);

  useMenuNewConnectionBridge();

  useEffect(() => {
    loadConnections();
    loadGroups();
    initEventListeners();
    loadPersistedFavorites();
    loadPersistedMru();
    // Emit the `app:effects-fired` boot-tracing milestone once the
    // launcher's five IPC dispatches have been kicked off. Launcher-side
    // anchor for the end-to-end `T0 → app:effects-fired` measurement row.
    markBootMilestone("app:effects-fired");
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
