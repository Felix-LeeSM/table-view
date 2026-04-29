import { useEffect } from "react";
import { useConnectionStore } from "@stores/connectionStore";
import { useTabStore } from "@stores/tabStore";

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
 * Calling `hydrateFromSession()` is idempotent — it reads from localStorage
 * and patches the store only when data exists. Zustand skips re-renders when
 * the patched values are referentially equal to the current state.
 *
 * When the workspace hydrates a different `focusedConnId` (e.g. the user
 * switched from PG to Mongo on the launcher while the workspace was hidden),
 * stale tabs from the previous connection are cleared. Without this, the
 * Sidebar's active-tab effect would override `focusedConnId` back to the
 * old connection, showing the wrong paradigm.
 */
export function useWindowFocusHydration(): void {
  useEffect(() => {
    const hydrate = () => {
      const prevConnId = useConnectionStore.getState().focusedConnId;
      useConnectionStore.getState().hydrateFromSession();
      const newConnId = useConnectionStore.getState().focusedConnId;

      if (newConnId && newConnId !== prevConnId) {
        const { tabs } = useTabStore.getState();
        const staleConnIds = new Set(
          tabs.map((t) => t.connectionId).filter((cid) => cid !== newConnId),
        );
        const clear = useTabStore.getState().clearTabsForConnection;
        for (const cid of staleConnIds) {
          clear(cid);
        }
      }
    };
    hydrate();
    window.addEventListener("focus", hydrate);
    return () => window.removeEventListener("focus", hydrate);
  }, []);
}
