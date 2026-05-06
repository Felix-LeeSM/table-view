import { useCallback } from "react";
import {
  useConnectionStore,
  type ConnectionState,
} from "@stores/connectionStore";
import type { ConnectionStatus } from "@/types/connection";
import { readConnectionSession } from "@lib/session-storage";

/**
 * Sprint 224 (P10 step 3a) — moves the read-only `hydrateFromSession`
 * orchestration out of `connectionStore.ts` so the store stays a pure
 * state-transition module. The store still owns the action interface
 * (`hydrateFromSession: () => void` on `ConnectionState`) as a thin proxy
 * that delegates to `hydrateConnectionSession()` here, preserving callers
 * that read it via `useConnectionStore.getState().hydrateFromSession()`.
 *
 * Behaviour change 0 — for every `readConnectionSession()` shape (empty /
 * `focusedConnId`-only / `activeStatuses`-only / both) the post-call store
 * snapshot is byte-equivalent to the pre-extraction store body:
 *   - Empty session ⇒ `setState` is NOT called (no-op).
 *   - Partial / both ⇒ exactly ONE `setState(patch)` call with the same
 *     partial-key shape the store used to apply.
 *
 * Two exports:
 *   - `hydrateConnectionSession()` — plain function, callable outside the
 *     React tree (the boot path in `main.tsx` runs before any React mount).
 *   - `useConnectionSessionHydration()` — `useCallback` wrap providing a
 *     stable identity for hook-context callers.
 *
 * Pure orchestration — no React effects, timers, store subscriptions, or
 * window event listeners. Persist 3 site (`connectToDatabase` /
 * `disconnectFromDatabase` / `setFocusedConn`) and the
 * `attachZustandIpcBridge` module-load attach are out of scope (P10 step 3b
 * / step 4) and remain in `connectionStore.ts` byte-equivalent.
 */
export function hydrateConnectionSession(): void {
  const session = readConnectionSession();
  const patch: Partial<
    Pick<ConnectionState, "focusedConnId" | "activeStatuses">
  > = {};
  if (session.focusedConnId) patch.focusedConnId = session.focusedConnId;
  if (session.activeStatuses)
    patch.activeStatuses = session.activeStatuses as Record<
      string,
      ConnectionStatus
    >;
  if (Object.keys(patch).length > 0) useConnectionStore.setState(patch);
}

export function useConnectionSessionHydration(): {
  hydrateFromSession: () => void;
} {
  const hydrateFromSession = useCallback(() => hydrateConnectionSession(), []);
  return { hydrateFromSession };
}
