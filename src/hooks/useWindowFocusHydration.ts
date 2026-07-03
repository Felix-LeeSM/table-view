import { useEffect } from "react";
import { hydrateConnectionSession } from "@lib/runtime/connection/hydrateConnectionSession";

/**
 * Re-hydrate connection state from session-scoped localStorage on mount
 * and whenever the window gains focus.
 *
 * Both the launcher and workspace windows need this because:
 *   - The workspace boots hidden with empty session data; the launcher
 *     writes fresh state after connecting.
 *   - The launcher is hidden while the workspace is active; disconnects in
 *     the workspace update session storage but the launcher may miss the
 *     IPC bridge event while hidden.
 *
 * Calling `hydrateConnectionSession()` is idempotent — it reads from
 * localStorage and patches only `connectionStore` (focusedConnId +
 * activeStatuses) when data exists. Zustand skips re-renders when the patched
 * values are referentially equal to the current state.
 *
 * This hook never touches `workspaceStore`. Under the sprint-361 per-connection
 * window model each `workspace-{connId}` window owns only its own tabs, so a
 * focus event that hydrates a *different* `focusedConnId` (the launcher moved
 * focus elsewhere while this window was hidden) must not clear anything —
 * doing so wiped this window's own tabs (#1098). Workspace teardown belongs to
 * disconnect/remove (`cleanupConnectionFrontendState`), not focus hydration.
 */
export function useWindowFocusHydration(): void {
  useEffect(() => {
    // Distinct closure per mount: addEventListener dedupes identical
    // (type, listener) pairs, so registering the shared entrypoint directly
    // would collapse two hook instances into a single listener.
    const hydrate = () => hydrateConnectionSession();
    hydrate();
    window.addEventListener("focus", hydrate);
    return () => window.removeEventListener("focus", hydrate);
  }, []);
}
