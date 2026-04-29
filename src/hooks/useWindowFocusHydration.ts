import { useEffect } from "react";
import { useConnectionStore } from "@stores/connectionStore";

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
 */
export function useWindowFocusHydration(): void {
  useEffect(() => {
    const hydrate = () => {
      useConnectionStore.getState().hydrateFromSession();
    };
    hydrate();
    window.addEventListener("focus", hydrate);
    return () => window.removeEventListener("focus", hydrate);
  }, []);
}
