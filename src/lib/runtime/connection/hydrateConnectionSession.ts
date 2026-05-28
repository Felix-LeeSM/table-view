import { useConnectionStore } from "@stores/connectionStore";

/**
 * Runtime entrypoint for boot/focus session hydration. The store owns the
 * state transition; runtime callers only trigger the use-case outside React.
 */
export function hydrateConnectionSession(): void {
  useConnectionStore.getState().hydrateFromSession();
}
