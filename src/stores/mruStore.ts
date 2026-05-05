import { create } from "zustand";
import { attachZustandIpcBridge } from "@lib/zustand-ipc-bridge";
import { getCurrentWindowLabel } from "@lib/window-label";

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
 * Hand-rolled localStorage persistence (no zustand persist middleware) so
 * the codebase shares a single predictable persistence shape with
 * `favoritesStore`.
 */

const STORAGE_KEY = "table-view-mru";
const MAX_ENTRIES = 5;

function persistMruList(entries: MruEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage may be unavailable (SSR, quota exceeded, private mode).
  }
}

/**
 * Load persisted MRU entries. Handles two formats:
 *  1. New: JSON array of `MruEntry` objects.
 *  2. Legacy: a plain connection-id string written via `setItem(key, id)`.
 *
 * Migration is transparent — a plain string becomes a single-entry list
 * with `lastUsed: Date.now()`, and the next write persists the new shape.
 */
function loadPersistedMruList(): MruEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.slice(0, MAX_ENTRIES);
      }
      // Legacy format: JSON-quoted string (e.g. `"c1"`).
      if (typeof parsed === "string" && parsed.length > 0) {
        return [{ connectionId: parsed, lastUsed: Date.now() }];
      }
      return [];
    } catch {
      // Legacy format: unquoted plain string. `JSON.parse("c1")` throws
      // because bare identifiers aren't valid JSON — the old store wrote
      // the id verbatim via `setItem(key, id)`.
      if (raw.length > 0) {
        return [{ connectionId: raw, lastUsed: Date.now() }];
      }
      return [];
    }
  } catch {
    // localStorage unavailable (SSR / private mode) — start with empty list.
    return [];
  }
}

interface MruState {
  lastUsedConnectionId: string | null; // derived: recentConnections[0]?.connectionId ?? null (backward compat)
  recentConnections: MruEntry[]; // ordered list, most recent first

  markConnectionUsed: (id: string) => void;
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
      // Persist
      persistMruList(updated);
      return {
        recentConnections: updated,
        lastUsedConnectionId: id, // backward compat
      };
    });
  },

  loadPersistedMru: () => {
    const entries = loadPersistedMruList();
    set({
      recentConnections: entries,
      lastUsedConnectionId: entries[0]?.connectionId ?? null,
    });
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
 * Reset hook for tests. Wipes both the in-memory state and the
 * persisted entry so a single test cannot leak MRU into the next.
 */
export function __resetMruStoreForTests(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  useMruStore.setState({ lastUsedConnectionId: null, recentConnections: [] });
}
