import { create } from "zustand";
import { attachZustandIpcBridge } from "@lib/zustand-ipc-bridge";
import { getCurrentWindowLabel } from "@lib/window-label";
import { logger } from "@lib/logger";
import { clearMru, persistMru, type PersistMruPayload } from "@lib/tauri/mru";

/**
 * MRU entry. `lastUsed` is a `Date.now()` epoch ms so the launcher's
 * "Recent" rail can render relative-time labels without querying the
 * connection store.
 */
export interface MruEntry {
  connectionId: string;
  lastUsed: number;
}

/**
 * Most-recently-used connection store. Tracks the connections the user
 * most recently engaged with (signal: `addTab` / `addQueryTab` callers).
 * Consumed by `MainArea`'s EmptyState so the New Query CTA defaults to
 * the connection the user actually cares about.
 *
 * Holds an ordered list of up to 5 entries. `lastUsedConnectionId` is a
 * derived view of `recentConnections[0]` kept for backward compat.
 *
 * Sprint 370 (Phase 4 W2→W3) — `table-view-mru` LS read/write retired.
 * Boot hydration arrives via the snapshot IPC (`get_initial_app_state`)
 * and every mutate ships through `persist_mru` to keep SQLite truth in
 * sync. `loadPersistedMru` is now a no-op so existing call sites in
 * `App.tsx` / `AppRouter.tsx` keep compiling but emit zero IPC + LS work;
 * sprint-375 removes the call sites entirely.
 */

const MAX_ENTRIES = 5;

function toPersistPayload(entries: MruEntry[]): PersistMruPayload[] {
  return entries.map((e) => ({
    connectionId: e.connectionId,
    lastUsed: e.lastUsed,
  }));
}

function persistMruList(entries: MruEntry[]): void {
  // Sprint 370 — fire-and-forget IPC mirror. Same optimistic semantics as
  // the legacy LS path: store mutates synchronously, IPC failures only
  // surface in the dev log so the next persist (or next boot's
  // mismatch metric) heals SQLite truth.
  void persistMru(toPersistPayload(entries)).catch((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e ?? "");
    logger.warn(`[mruStore] persist_mru failed: ${message}`);
  });
}

/**
 * Sprint 376 (Phase 6 Q21 #8) — backend `clear_mru` IPC dispatch.
 * Truncates the SQLite `mru` table and emits `state-changed
 * { domain:"mru", op:"bulk", entityId:null }` so every window's
 * `RecentConnections` panel converges to empty. Fire-and-forget — store
 * mutation has already happened; an IPC failure surfaces in dev log and
 * is healed by the next mutate or boot reconcile.
 */
function clearMruRemote(): void {
  void clearMru().catch((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e ?? "");
    logger.warn(`[mruStore] clear_mru failed: ${message}`);
  });
}

interface MruState {
  lastUsedConnectionId: string | null; // derived: recentConnections[0]?.connectionId ?? null (backward compat)
  recentConnections: MruEntry[]; // ordered list, most recent first

  markConnectionUsed: (id: string) => void;
  /**
   * Sprint 290 — remove a single entry from the Recent rail. Persists the
   * shortened list synchronously. `lastUsedConnectionId` is recomputed
   * from the new head so a future Sprint that resurrects this derived
   * pointer stays consistent.
   */
  removeRecentConnection: (id: string) => void;
  /**
   * Sprint 376 (Phase 6 Q21 #8) — "Clear recent" affordance. Drops every
   * entry locally + dispatches `clear_mru` IPC so the SQLite `mru` table
   * is truncated and every other window receives `state-changed
   * mru.bulk` (frontend dispatcher applies the empty array on receive).
   */
  clearRecentConnections: () => void;
  hydrateMruFromSnapshot: (
    entries: MruEntry[],
    lastUsedConnectionId: string | null,
  ) => void;
  /**
   * Sprint 370 — no-op. Snapshot IPC (`loadAllFromSnapshot`) is the sole
   * hydration path; this function survives only so existing call sites
   * in `App.tsx` / `AppRouter.tsx` keep compiling. Sprint-375 removes
   * the call sites and the function alongside.
   */
  loadPersistedMru: () => void;
}

/**
 * Cross-window broadcast allowlist. Both keys must stay in sync between
 * launcher and workspace so a tab opened in either window updates the
 * other's "Recent" rail. Both shapes are JSON-stable and free of secrets.
 */
export const SYNCED_KEYS: ReadonlyArray<keyof MruState> = [
  "lastUsedConnectionId",
  "recentConnections",
] as const;

export const useMruStore = create<MruState>((set) => ({
  lastUsedConnectionId: null,
  recentConnections: [],

  markConnectionUsed: (id) => {
    const now = Date.now();
    set((state) => {
      // Remove existing entry for this id (if any), then prepend.
      const filtered = state.recentConnections.filter(
        (e) => e.connectionId !== id,
      );
      const updated: MruEntry[] = [
        { connectionId: id, lastUsed: now },
        ...filtered,
      ].slice(0, MAX_ENTRIES);
      // Persist via IPC — SQLite is the SOT after W3 cut.
      persistMruList(updated);
      return {
        recentConnections: updated,
        lastUsedConnectionId: id, // backward compat
      };
    });
  },

  removeRecentConnection: (id) => {
    set((state) => {
      const updated = state.recentConnections.filter(
        (e) => e.connectionId !== id,
      );
      if (updated.length === state.recentConnections.length) return state;
      persistMruList(updated);
      return {
        recentConnections: updated,
        lastUsedConnectionId: updated[0]?.connectionId ?? null,
      };
    });
  },

  clearRecentConnections: () => {
    set((state) => {
      if (state.recentConnections.length === 0) {
        // Empty already — still fire IPC so a stale SQLite row in
        // another window gets cleared (idempotent backend contract).
        clearMruRemote();
        return state;
      }
      clearMruRemote();
      return {
        recentConnections: [],
        lastUsedConnectionId: null,
      };
    });
  },

  hydrateMruFromSnapshot: (entries, lastUsedConnectionId) => {
    set({
      recentConnections: entries,
      lastUsedConnectionId,
    });
  },

  loadPersistedMru: () => {
    // Snapshot IPC hydrates `recentConnections` + `lastUsedConnectionId`
    // before any consumer mounts. This function is a no-op kept for
    // backward compatibility with the boot effect call sites; the LS
    // `table-view-mru` read is retired (sprint-370 AC-370-05).
  },
}));

/**
 * Symmetric attach — both launcher and workspace listen and broadcast
 * (either side may mark a connection used). `originId` falls back to
 * `"unknown"` rather than `"test"` so the loop guard stays distinct from
 * any future stores that share the fallback in the same process.
 */
void attachZustandIpcBridge<MruState>(useMruStore, {
  channel: "mru-sync",
  syncKeys: SYNCED_KEYS,
  originId: getCurrentWindowLabel() ?? "unknown",
}).catch(() => {
  // best-effort: if the listen registration fails (e.g. Tauri runtime not
  // available outside vitest mocks), the store still works window-local.
});

/**
 * Reset hook for tests. Wipes the in-memory state so a single test cannot
 * leak MRU into the next. Sprint 370 — LS removal means the only state
 * worth resetting lives in the zustand store.
 */
export function __resetMruStoreForTests(): void {
  useMruStore.setState({ lastUsedConnectionId: null, recentConnections: [] });
}
